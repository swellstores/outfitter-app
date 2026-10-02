import type { MiddlewareHandler } from 'astro';

import { tenantKey } from '@/swell';
import { invalidateAppSettings } from '@/lib/app-settings';
import { isEditorRequest } from '@/lib/editor';

/**
 * Decides whether this render is an editing one.
 *
 * Edit mode needs two things at once: the `__edit` flag on the URL and a
 * request the editor gate accepts — editor or preview mode, with a signed
 * Swell-Context naming an admin of this store (dev builds also accept the
 * dashboard session cookie). The flag alone does nothing, so a shopper who
 * finds it sees the ordinary page.
 *
 * This runs before the page cache on purpose: an editing render is never
 * cached, and the cache reads nothing else from here. The copy itself is
 * resolved in `resolveCopy`, once the storefront settings have loaded — the
 * SDK cannot report a locale or currency before then.
 */
export const editMode: MiddlewareHandler = async (context, next) => {
  const wantsEdit = context.url.searchParams.has('__edit');

  // The settings document is the slow read on an editing render, so it is
  // taken fresh only when the shell asks for it: a reload after a save carries
  // `__v`, because that save may have landed in another isolate whose memo
  // this one still holds. Ordinary editor navigation reads the memo, like a
  // public page. Dropped BEFORE the gate reads, so the gate's read is the one
  // fresh read of this render and everything after it hits the memo.
  if (wantsEdit && context.url.searchParams.has('__v')) {
    invalidateAppSettings(tenantKey(context));
  }

  context.locals.editMode = wantsEdit && (await isEditorRequest(context));

  return next();
};
