import type { APIContext, MiddlewareHandler } from 'astro';

import { computeTenantKey, initSwell } from '@/swell';
import { markDegraded } from '@/lib/cacheable';

// Assets (`/favicon.svg`, `/_astro/*`, `/_image`), the JSON routes and the
// editor shell render no storefront page, so they skip hydration and its API
// calls.
const NON_PAGE = /^\/(?:_|health$|editor(?:\/|$))|^\/favicon\.[a-z0-9]+$|\.(?:css|js|mjs|map|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|txt|xml|json)$/i;

export function isPageRequest(context: APIContext): boolean {
  return !NON_PAGE.test(context.url.pathname);
}

/**
 * Runs first and does no network work. Everything downstream — middleware and
 * pages alike — reads `locals.swell`, so it is set for every request.
 */
export const initContext: MiddlewareHandler = async (context, next) => {
  try {
    // The proxy sends its access token on every request. A request without
    // one did not come through the proxy, whatever other headers it carries,
    // and gets the same answer as one without a store id.
    if (!context.request.headers.get('swell-access-token')) {
      throw new Error('Missing required header: "swell-access-token"');
    }

    context.locals.swell = initSwell(context);
    context.locals.tenant = await computeTenantKey(context);
  } catch (err) {
    // The SDK throws when `swell-store-id` / `swell-public-key` are absent,
    // which means the request did not arrive through the Swell proxy. Left
    // unhandled that took down every route, `/health` included, with an empty
    // 500 — the one endpoint you would hit to find out what is wrong.
    return new Response(
      JSON.stringify({
        error: 'not_reachable_directly',
        message:
          'This worker is served through Swell and needs the swell-* request headers. Open the storefront URL rather than the worker URL.',
        detail: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      },
    );
  }

  return next();
};

/**
 * Loads what the layout needs to render a page. Sits after the HTML cache on
 * purpose: a cache hit returns before this runs, so a hit costs no API calls.
 */
export const hydratePage: MiddlewareHandler = async (context, next) => {
  // Only a GET renders a layout. The cart posts answer with a redirect or
  // JSON and would otherwise pay for a settings read they never use.
  if (context.request.method !== 'GET' || !isPageRequest(context)) {
    return next();
  }

  const { swell } = context.locals;

  // Currency, locale and store name for the layout. Never throws: a page that
  // cannot read the store's settings still renders, with the app's own, but
  // is not cached.
  context.locals.settings = await swell
    .getStorefrontSettings()
    .catch(() => undefined);

  // The SDK swallows a failed read and hands back settings with nothing in.
  if (!context.locals.settings?.state?.store) {
    markDegraded(swell);
  }

  return next();
};
