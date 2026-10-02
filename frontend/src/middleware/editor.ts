import type { APIContext, MiddlewareHandler } from 'astro';

import { jsonResponse } from '@/lib/cart-json';
import { isEditorRequest, isJsonRequest } from '@/lib/editor';

/**
 * Gates everything under `/editor` — the shell and its API alike.
 *
 * The editor is a merchant tool, so it only exists on requests the editor
 * gate accepts: editor or preview mode, with a signed Swell-Context naming an
 * admin of this store (see `isEditorRequest`). For everyone else the
 * path is rewritten to one that matches no route, so the response is the
 * ordinary 404 page: not a 403 that confirms there is something here to be
 * denied.
 *
 * The rewrite goes through `next()` rather than `context.rewrite()` so the
 * middleware chain is not re-run; the handlers after this one simply see an
 * unknown path, exactly as they would for any other.
 *
 * A write from another site is refused as well. Any page the merchant has
 * open could post here with their cookies — another `*.swell.store` tenant
 * included, which is same-site, so SameSite cookies do not help. The proxy
 * already leaves the admin out of a cross-site write's context; this is the
 * app's own check on top of it. Two signals
 * survive the proxy: a JSON content type makes the request one a browser must
 * preflight, and this app never answers a preflight; and `Origin` must be
 * this storefront's own host, which the proxy names in
 * `swell-storefront-host`. `Sec-Fetch-*` does not survive — the proxy strips
 * it on editor and preview requests — so it is not relied on.
 */
export const editor: MiddlewareHandler = async (context, next) => {
  const { pathname } = context.url;

  if (pathname !== '/editor' && !pathname.startsWith('/editor/')) {
    return next();
  }

  if (!(await isEditorRequest(context))) {
    // Not `/_…`: the router treats that prefix as an asset and would render
    // the 404 page without the store's settings, unlike any other unknown
    // path. The API answers that way to everyone; a shopper who lands on the
    // editor is sent to the storefront instead of a dead end.
    return pathname.startsWith('/editor/api/')
      ? next('/not-found')
      : context.redirect('/', 302);
  }

  if (
    pathname.startsWith('/editor/api/') &&
    context.request.method !== 'GET' &&
    !isSameOriginJson(context)
  ) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // The editor is a merchant tool on a publicly reachable host. It is never a
  // search result, and its contents are the store's unpublished drafts.
  const response = await next();

  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  return response;
};

function isSameOriginJson(context: APIContext): boolean {
  const { headers } = context.request;

  if (!isJsonRequest(context.request)) {
    return false;
  }

  const origin = headers.get('origin');
  const host =
    headers.get('swell-storefront-host') ||
    headers.get('x-forwarded-host')?.split(',')[0].trim();

  if (!origin || !host) {
    return false;
  }

  // Compare hostnames only. Behind a local port the origin carries ':4001'
  // while the gateway names the bare hostname, and a port cannot change who
  // the request is from.
  try {
    return new URL(origin).hostname === host.split(':')[0];
  } catch {
    return false;
  }
}
