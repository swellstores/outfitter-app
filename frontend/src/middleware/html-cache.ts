import type { APIContext, MiddlewareHandler } from 'astro';
import {
  getHtmlCache,
  DEFAULT_CACHE_RULES,
  type CacheRules,
  type HtmlCache,
  type Swell,
} from '@swell/apps-sdk';

import { getCookie, tenantKey } from '@/swell';
import { getAppSettings } from '@/lib/app-settings';
import {
  deploymentMode,
  isCacheablePageRequest,
  isDegraded,
} from '@/lib/cacheable';

/**
 * Stale-while-revalidate for rendered pages, on the SDK's HtmlCache: in the
 * deployment's KV namespace, shared by every data center, or the Workers Cache
 * API when no namespace is bound.
 *
 * A hit is served with no API calls at all — not even the settings read that
 * gives the TTL, which a stored page carries — and once the entry is older
 * than its TTL it is still served immediately and refreshed in the background,
 * so a shopper never waits on a render after the first one.
 *
 * This is only safe because pages carry no per-visitor state: the cart count
 * and drawer are hydrated client-side from /cart.json, and every path that is
 * personal (cart, checkout, account) is excluded below. The SDK's cache key
 * covers storefront, deployment mode, currency, locale and deploy epoch — and
 * the shopper's account and cart, which the proxy sends in
 * Swell-Storefront-Context. Visitors with neither share one context and so one
 * entry; a shopper with a cart or a login gets entries of their own, which
 * are rarely hit. That is the price of keeping account-group prices, which the
 * render asks for with a signed-in shopper's session, out of shared pages.
 * With no account in the context the render goes without the session (see
 * `initSwell`), whose locale and currency the key cannot see.
 *
 * The app's settings are not in the key. A save in the editor reaches the
 * live store as each page goes stale, like a product or price change — and a
 * revalidation in an isolate still holding the old settings in its one-minute
 * memo stores them for one more TTL.
 */

export const DEFAULT_TTL_SECONDS = 60;
const SWR_SECONDS = 60 * 60 * 24; // a day — beyond this a stale page is re-rendered inline
// The longest a page is ever fresh for, whatever the setting says: the SDK
// keeps an entry until `ttl + swr` has passed, so an absurd value would pin a
// page — a forged one included — until the next deploy.
const MAX_TTL_SECONDS = SWR_SECONDS;

// The SDK's key falls back to USD and en-US when the shopper has chosen
// neither, but the render falls back to the store's defaults, which need not
// be those. No choice gets a key of its own.
const NO_CHOICE = '~default';

// Carries the tenant key on this worker's own fallback revalidation (see
// `revalidate`). The key digests the access token, which only the proxy and
// this worker hold, so no client can produce it.
const REVALIDATION_HEADER = 'x-outfitter-revalidation';

const SKIP: NonNullable<CacheRules['pathRules']> = [
  { path: '/cart', skip: true },
  { path: '/cart.json', skip: true },
  { path: '/checkout', skip: true },
  { path: '/checkout/**', skip: true },
  { path: '/account', skip: true },
  { path: '/account/**', skip: true },
  { path: '/health', skip: true },
];

export const htmlCache: MiddlewareHandler = async (context, next) => {
  const env = context.locals.runtime?.env;
  const ctx = context.locals.runtime?.ctx;

  // Same predicate the Swell client uses to withhold cookies, so a page is
  // either shared and cookie-free or personal and uncached, never in between.
  if (env?.HTML_CACHE === 'false' || !isCacheablePageRequest(context.request)) {
    return next();
  }

  // Each deploy gets its own epoch, so a release never serves last week's HTML.
  const epoch = env?.CF_VERSION_METADATA?.id || env?.HTML_CACHE_EPOCH || 'v1';

  // A stored page carries its own TTL and is judged by it, so reading needs
  // none: the one given here is only what a write would use, and every write
  // below resolves the real one first. Reading before resolving keeps the
  // settings read — a round trip to the API whenever this isolate's memo has
  // lapsed, which on a quiet store is most requests — off every hit.
  const reader = cacheFor(env, epoch, DEFAULT_TTL_SECONDS);

  if (!reader) {
    return next();
  }

  const request = cacheableRequest(context);
  // A revalidation skips the read and always writes. The proxy passes
  // X-Cache-Bypass through from any client, so it only counts alongside a
  // value that takes this store's access token to produce.
  const isRevalidation =
    context.request.headers.get('X-Cache-Bypass') === 'revalidation' &&
    context.request.headers.get(REVALIDATION_HEADER) === tenantKey(context);

  if (!isRevalidation && reader.canReadFromCache(request)) {
    const cached = await reader.getWithConditionals(request);

    if (cached?.found && cached.response) {
      if (cached.notModified && cached.conditional304) {
        return cached.conditional304;
      }

      if (cached.stale && ctx?.waitUntil) {
        // Render the fresh page in this isolate and store it. The SDK's
        // alternative, re-fetching the public URL, goes back out through the
        // proxy for a second render. Kept only as a fallback.
        ctx.waitUntil(
          resolveTtl(context, env?.HTML_CACHE_TTL)
            .then((ttl) => {
              // Turned off since the page was stored: drop it, rather than
              // serve it stale for the rest of its day.
              if (ttl <= 0) {
                return reader.delete(request).then(() => undefined);
              }

              bypassMemo(context);
              return revalidateInPlace(cacheFor(env, epoch, ttl)!, request, context.locals.swell, next);
            })
            .catch(() => revalidate(reader, context.request, tenantKey(context))),
        );
      }

      return cached.response;
    }
  }

  const ttl = await resolveTtl(context, env?.HTML_CACHE_TTL);
  if (ttl <= 0) {
    return next();
  }

  const cache = cacheFor(env, epoch, ttl)!;
  bypassMemo(context);

  const response = await next();

  // The client withholds cookies on these renders; if one slipped through it
  // belongs to a session no browser holds, so it is dropped rather than let it
  // make the page uncacheable — or worse, be stored and replayed to everyone.
  response.headers.delete('set-cookie');

  if (!cache.canWriteToCache(request, response)) {
    response.headers.set('X-Cache-Status', 'BYPASS');
    return response;
  }

  // Body is read once and shared: one copy goes to the shopper now, the other
  // to the cache after the response has been sent.
  const body = await response.text();
  const headers = stripEncoding(response.headers);
  const init = { status: response.status, statusText: response.statusText };

  // Asked once the body is read, when every read of the render is done.
  if (isDegraded(context.locals.swell)) {
    headers.set('X-Cache-Status', 'BYPASS');
    return new Response(body, { ...init, headers });
  }

  if (ctx?.waitUntil) {
    ctx.waitUntil(
      cache.put(request, new Response(body, { ...init, headers: new Headers(headers) })),
    );
  }

  headers.set('X-Cache-Status', isRevalidation ? 'REVALIDATED' : 'MISS');
  return new Response(body, { ...init, headers });
};

/**
 * Seconds a page is fresh for. The merchant sets it in app settings; an env var
 * overrides it for a whole deployment. Zero disables caching.
 */
async function resolveTtl(
  context: APIContext,
  envTtl: string | undefined,
): Promise<number> {
  const fromEnv = Number(envTtl);
  if (envTtl !== undefined && Number.isFinite(fromEnv)) {
    return clampTtl(fromEnv);
  }

  const app = await getAppSettings(context.locals.swell, tenantKey(context));
  const fromSettings = Number(app.cache_ttl);

  return Number.isFinite(fromSettings) && app.cache_ttl !== '' && app.cache_ttl != null
    ? clampTtl(fromSettings)
    : DEFAULT_TTL_SECONDS;
}

function clampTtl(seconds: number): number {
  return Math.min(MAX_TTL_SECONDS, Math.max(0, Math.floor(seconds)));
}

/**
 * The page cache for this deploy, storing pages fresh for `ttl`. KV when the
 * deployment binds a namespace: one store for every data center, where the
 * Cache API keeps one per data center and the proxy reaches this worker
 * through several, so most requests found nothing.
 */
function cacheFor(env: ENV | undefined, epoch: string, ttl: number): HtmlCache | null {
  return getHtmlCache(
    env?.NAMESPACE
      ? { HTML_CACHE_EPOCH: epoch, NAMESPACE: env.NAMESPACE }
      : { HTML_CACHE_EPOCH: epoch, HTML_CACHE_BACKEND: 'worker' },
    {
      defaults: {
        live: { ttl, swr: SWR_SECONDS },
        preview: { ttl, swr: SWR_SECONDS },
      },
      pathRules: [...SKIP, ...(DEFAULT_CACHE_RULES.pathRules ?? [])],
    },
  );
}

/**
 * A page the cache stores is rendered from fresh reads. Otherwise the SDK
 * answers from its memo of whatever this isolate fetched last, kept for a week
 * and refreshed only after the render, and a revalidation would store last
 * hour's price as fresh. The header is the SDK's own switch for that, read at
 * each call; it goes on the client only, so the cache sees the request as
 * sent. Set only once a page is going to be stored, so a store with the cache
 * off keeps the memo.
 */
function bypassMemo(context: APIContext): void {
  context.locals.swell.headers['x-cache-bypass'] = 'revalidation';
}

/**
 * The SDK refuses to cache a request without a `swell-theme-version-hash` and
 * a `swell-storefront-id`, because for theme apps those are what the key is
 * built from. This app has no theme — its markup only changes with a deploy,
 * which the epoch already covers — so the deployment mode stands in for the
 * hash (the SDK's key does not otherwise separate preview from live, and a
 * shared key would serve test-environment pages to live shoppers), and the
 * store id stands in for the storefront id when the proxy sends none. Both
 * only ever feed the key. The hash is set even over one the request carries:
 * the proxy sends none for a storefront without a theme, so that one came
 * from the client.
 */
function cacheableRequest(context: APIContext): Request {
  const { request } = context;
  const headers = new Headers(request.headers);

  headers.set('swell-theme-version-hash', `self:${deploymentMode(request)}`);

  if (!headers.get('swell-storefront-id')) {
    const storeId = headers.get('swell-store-id');
    if (storeId) {
      headers.set('swell-storefront-id', storeId);
    }
  }

  // The SDK keys on an `x-locale` header before the `swell-locale` cookie, but
  // the page is rendered from the cookie alone — so a request carrying both
  // would file one locale's page under another's key, for every shopper. The
  // proxy passes the header through and this app never reads it: the key
  // follows the cookie, as the render does.
  headers.delete('x-locale');

  // The SDK finds the cookie with a pattern of its own, which matches inside
  // another cookie's name and misses one written `swell-data =`; the render
  // reads it with Astro's parser. A request crafted to tell them apart would
  // file one currency's page under another's key. So the key is given exactly
  // what the render will read, and nothing else.
  headers.set(
    'cookie',
    `swell-data=${encodeURIComponent(
      JSON.stringify({
        'swell-currency': getCookie(context, 'swell-currency') || NO_CHOICE,
        'swell-locale': getCookie(context, 'swell-locale') || NO_CHOICE,
      }),
    )}`,
  );

  return new Request(request.url, { method: request.method, headers });
}

async function revalidateInPlace(
  cache: HtmlCache,
  request: Request,
  swell: Swell,
  next: () => Promise<Response>,
): Promise<void> {
  const fresh = await next();
  fresh.headers.delete('set-cookie');

  if (!cache.canWriteToCache(request, fresh)) {
    return;
  }

  const body = await fresh.text();

  if (isDegraded(swell)) {
    return;
  }

  await cache.put(
    request,
    new Response(body, {
      status: fresh.status,
      statusText: fresh.statusText,
      headers: stripEncoding(fresh.headers),
    }),
  );
}

async function revalidate(
  cache: HtmlCache,
  request: Request,
  tenant: string,
): Promise<void> {
  const revalidation = cache.createRevalidationRequest(request);
  revalidation.headers.set(REVALIDATION_HEADER, tenant);

  try {
    await fetch(revalidation, {
      // @ts-expect-error `cf` is Cloudflare-specific; keep the CDN out of it.
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (err) {
    console.warn('html-cache revalidation failed', err);
  }
}

// The body has been decoded into a string, so any encoding headers are wrong.
function stripEncoding(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return headers;
}
