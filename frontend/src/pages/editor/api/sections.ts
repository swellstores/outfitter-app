import type { APIRoute } from 'astro';

import { tenantKey } from '@/swell';
import { invalidateAppSettings } from '@/lib/app-settings';
import { jsonResponse } from '@/lib/cart-json';
import {
  CONTENT_PANEL,
  SECTIONS_PANEL,
  getStorefrontId,
  isEditorRequest,
  isRecord,
  readJsonBody,
  readSettingsValues,
  writeSettingsValues,
} from '@/lib/editor';
import {
  SECTION_PAGES,
  pageSections,
  validateSections,
  type SectionPage,
} from '@/lib/sections';

/**
 * Saves one page's sections — the whole list, in order.
 *
 * Body: `{ page, sections: [...] }`, the page being one of SECTION_PAGES.
 * Every structural change in the editor (add, remove, reorder) posts the full
 * list, per-locale copy included, and gets back what was stored. One bad item
 * rejects the whole request rather than saving the rest.
 */
export const POST: APIRoute = async (context) => {
  const { swell } = context.locals;

  if (!(await isEditorRequest(context))) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  const body = await readJsonBody(context.request);

  const page = body?.page as SectionPage;

  if (!body || !SECTION_PAGES.includes(page)) {
    return jsonResponse({ error: 'unknown_page' }, 400);
  }

  const check = validateSections(body.sections, page);

  if (!check.ok) {
    return jsonResponse(
      { error: 'invalid_sections', detail: check.errors.slice(0, 5).join('; ') },
      400,
    );
  }

  const storefrontId = getStorefrontId(context);

  if (!storefrontId) {
    return jsonResponse({ error: 'no_storefront' }, 400);
  }

  let values: Record<string, unknown>;

  try {
    values = await readSettingsValues(swell, storefrontId);
  } catch (err) {
    return jsonResponse({ error: 'read_failed', detail: message(err) }, 502);
  }

  const panel = isRecord(values[SECTIONS_PANEL]) ? values[SECTIONS_PANEL] : {};

  try {
    await writeSettingsValues(swell, storefrontId, {
      ...values,
      [SECTIONS_PANEL]: { ...panel, [page]: check.sections },
    });
  } catch (err) {
    return jsonResponse({ error: 'write_failed', detail: message(err) }, 502);
  }

  invalidateAppSettings(tenantKey(context));

  // What the page shows now — the defaults again, if the list was emptied —
  // so the editor's list and the page never disagree.
  return jsonResponse({
    ok: true,
    sections: pageSections({ [page]: check.sections }, page, values[CONTENT_PANEL]),
  });
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
