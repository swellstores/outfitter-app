/**
 * One answer to "will this response be shared between visitors?", used by the
 * page cache to decide what to store and by the Swell client to decide when
 * it may not write cookies. They must agree: a cookie written during a cached
 * render would either block the cache or hand one visitor's session to the next.
 */

import type { Swell } from '@swell/apps-sdk';

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

// Query params the SDK's page cache leaves out of its key: tracking tags. A
// page reached with one is stored under the bare URL and served to everyone,
// so nothing it renders may carry them.
const UNKEYED_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'ref',
  'source',
  'mc_cid',
  'mc_eid',
];

/** The query string of `url` without the params the page cache ignores. */
export function keyedSearch(url: URL): string {
  const params = new URLSearchParams(url.search);

  for (const name of UNKEYED_PARAMS) {
    params.delete(name);
  }

  const search = params.toString();

  return search ? `?${search}` : '';
}

// Renders that went without something because a read failed: the defaults for
// settings, an empty grid for products. They are served — a store with default
// styling beats an error page — but never stored, or one failed read would be
// every visitor's page for the TTL. Keyed by the request's Swell client, which
// every read goes through.
const degraded = new WeakSet<Swell>();

export function markDegraded(swell: Swell): void {
  degraded.add(swell);
}

export function isDegraded(swell: Swell): boolean {
  return degraded.has(swell);
}
