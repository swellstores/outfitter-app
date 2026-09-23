/**
 * One answer to "will this response be shared between visitors?", used by the
 * page cache to decide what to store and by the Swell client to decide when
 * it may not write cookies. They must agree: a cookie written during a cached
 * render would either block the cache or hand one visitor's session to the next.
 */

// Anything rendered from the visitor's own state. These are never cached and
// are where sessions are allowed to be created. The editor is the merchant's
// own state: its shell and API are never shared either.
export const PERSONAL_PATH = /^\/(?:cart|checkout|account|editor)(?:\/|\.|$)|^\/health$/;

export function isCacheablePageRequest(request: Request): boolean {
  if (request.method !== 'GET') {
    return false;
  }

  const { pathname, searchParams } = new URL(request.url);

  if (PERSONAL_PATH.test(pathname) || pathname.startsWith('/_')) {
    return false;
  }

  // An editing render carries edit affordances; it is the merchant's alone
  // and never goes into the shared cache.
  if (searchParams.has('__edit')) {
    return false;
  }

  // The dashboard editor renders live edits and is never cached. Preview is
  // cached — a store's test environment runs in preview mode, so excluding it
  // would switch the cache off for every merchant testing their store — but
  // under its own key: preview serves the test environment's catalog, and one
  // shared key would hand that to a live shopper.
  return request.headers.get('swell-deployment-mode') !== 'editor';
}

/** Deployment mode as it should appear in a cache key. */
export function deploymentMode(request: Request): 'preview' | 'live' {
  return request.headers.get('swell-deployment-mode') === 'preview'
    ? 'preview'
    : 'live';
}
