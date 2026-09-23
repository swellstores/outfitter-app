import type { APIContext, MiddlewareHandler } from 'astro';
import {
  getHtmlCache,
  DEFAULT_CACHE_RULES,
  type CacheRules,
  type HtmlCache,
} from '@swell/apps-sdk';

import { tenantKey } from '@/swell';
import { getAppSettings } from '@/lib/app-settings';
import { deploymentMode, isCacheablePageRequest } from '@/lib/cacheable';

/**
 * Stale-while-revalidate for rendered pages, on the SDK's HtmlCache with the
 * Worker (Cache API) backend — no KV namespace needed.
 *
 * A hit is served from the edge cache with no API calls at all; once the entry
 * is older than the TTL it is still served immediately and refreshed in the
 * background, so a shopper never waits on a render after the first one.
 *
 * This is only safe because pages carry no per-visitor state: the cart count
 * and drawer are hydrated client-side from /cart.json, and every path that is
 * personal (cart, checkout, account) is excluded below. The SDK's cache key
 * covers store, currency, locale and deploy epoch, not the shopper's session.
 */

export const DEFAULT_TTL_SECONDS = 60;
const SWR_SECONDS = 60 * 60 * 24; // a day — beyond this a stale page is re-rendered inline
// The longest a page is ever fresh for, whatever the setting says: the SDK
// keeps an entry until `ttl + swr` has passed, so an absurd value would pin a
// page — a forged one included — until the next deploy.
const MAX_TTL_SECONDS = SWR_SECONDS;

const SKIP: CacheRules['pathRules'] = [
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

  const ttl = await resolveTtl(context, env?.HTML_CACHE_TTL);
  if (ttl <= 0) {
    return next();
  }

  // Each deploy gets its own epoch, so a release never serves last week's HTML.
  const epoch = env?.CF_VERSION_METADATA?.id || env?.HTML_CACHE_EPOCH || 'v1';

  const cache = getHtmlCache(
    { HTML_CACHE_EPOCH: epoch, HTML_CACHE_BACKEND: 'worker' },
    {
      defaults: {
        live: { ttl, swr: SWR_SECONDS },
        preview: { ttl, swr: SWR_SECONDS },
      },
      pathRules: [...SKIP, ...(DEFAULT_CACHE_RULES.pathRules ?? [])],
    },
  );

  if (!cache) {
    return next();
  }

  const request = cacheableRequest(context.request);
  const isRevalidation =
    context.request.headers.get('X-Cache-Bypass') === 'revalidation';

  if (!isRevalidation && cache.canReadFromCache(request)) {
    const cached = await cache.getWithConditionals(request);

    if (cached?.found && cached.response) {
      if (cached.notModified && cached.conditional304) {
        return cached.conditional304;
      }

      if (cached.stale && ctx?.waitUntil) {
        // Render the fresh page in this isolate and write it to this colo's
        // cache — the one serving the shopper. The SDK's alternative, re-fetching
        // the public URL, goes back out through the proxy and lands wherever
        // that routes, which need not be here. Kept only as a fallback.
        ctx.waitUntil(
          revalidateInPlace(cache, request, next).catch(() =>
            revalidate(cache, context.request),
          ),
        );
      }

      return cached.response;
    }
  }

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
 * The SDK refuses to cache a request without a `swell-theme-version-hash` and
 * a `swell-storefront-id`, because for theme apps those are what the key is
 * built from. This app has no theme — its markup only changes with a deploy,
 * which the epoch already covers — so the deployment mode stands in for the
 * hash (the SDK's key does not otherwise separate preview from live, and a
 * shared key would serve test-environment pages to live shoppers), and the
 * store id stands in for the
 * storefront id, when the proxy sends neither. Both only ever feed the key.
 */
function cacheableRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  let changed = false;

  if (!headers.get('swell-theme-version-hash')) {
    headers.set('swell-theme-version-hash', `self:${deploymentMode(request)}`);
    changed = true;
  }

  if (!headers.get('swell-storefront-id')) {
    const storeId = headers.get('swell-store-id');
    if (storeId) {
      headers.set('swell-storefront-id', storeId);
      changed = true;
    }
  }

  // The SDK keys on an `x-locale` header before the `swell-locale` cookie, but
  // the page is rendered from the cookie alone — so a request carrying both
  // would file one locale's page under another's key, for every shopper. The
  // proxy passes the header through and this app never reads it: the key
  // follows the cookie, as the render does.
  if (headers.has('x-locale')) {
    headers.delete('x-locale');
    changed = true;
  }

  return changed
    ? new Request(request.url, { method: request.method, headers })
    : request;
}

async function revalidateInPlace(
  cache: HtmlCache,
  request: Request,
  next: () => Promise<Response>,
): Promise<void> {
  const fresh = await next();
  fresh.headers.delete('set-cookie');

  if (!cache.canWriteToCache(request, fresh)) {
    return;
  }

  const body = await fresh.text();
  await cache.put(
    request,
    new Response(body, {
      status: fresh.status,
      statusText: fresh.statusText,
      headers: stripEncoding(fresh.headers),
    }),
  );
}

async function revalidate(cache: HtmlCache, request: Request): Promise<void> {
  try {
    await fetch(cache.createRevalidationRequest(request), {
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
