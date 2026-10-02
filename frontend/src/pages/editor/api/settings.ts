import type { APIRoute } from 'astro';

import { tenantKey } from '@/swell';
import { invalidateAppSettings } from '@/lib/app-settings';
import { jsonResponse } from '@/lib/cart-json';
import {
  SETTINGS_PANEL,
  checkSetting,
  getSettingsField,
  getStorefrontId,
  isEditorRequest,
  isRecord,
  readJsonBody,
  readSettingsValues,
  writeSettingsValues,
} from '@/lib/editor';

/**
 * Saves the store's settings — store name, logo, palette and cache TTL — from
 * the editor's left nav.
 *
 * Body: `{ values: { <id>: value } }`. Only ids declared in
 * settings/outfitter.json are accepted, each checked against its declared
 * type; one bad key rejects the whole request rather than saving the rest.
 */
export const POST: APIRoute = async (context) => {
  const { swell } = context.locals;

  if (!(await isEditorRequest(context))) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  const body = await readJsonBody(context.request);
  const submitted = body?.values;

  if (!isRecord(submitted)) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  // `undefined` marks a key to remove, so the file default applies again.
  const patch: Record<string, unknown> = {};

  for (const [id, raw] of Object.entries(submitted)) {
    const field = getSettingsField(id);

    if (!field) {
      return jsonResponse({ error: 'unknown_setting', field: id }, 400);
    }

    const check = checkSetting(field, raw);

    if (!check.ok) {
      return jsonResponse(
        { error: 'invalid_value', field: id, detail: check.error },
        400,
      );
    }

    patch[id] = check.value;
  }

  const storefrontId = getStorefrontId(context);

  if (!storefrontId) {
    return jsonResponse({ error: 'no_storefront' }, 400);
  }

  let values: Record<string, unknown>;

  try {
    values = await readSettingsValues(swell, storefrontId);
  } catch (err) {
    console.error('Editor settings read failed', err);
    return jsonResponse({ error: 'read_failed' }, 502);
  }

  const panel = isRecord(values[SETTINGS_PANEL])
    ? { ...values[SETTINGS_PANEL] }
    : {};

  for (const [id, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete panel[id];
    } else {
      panel[id] = value;
    }
  }

  try {
    await writeSettingsValues(swell, storefrontId, {
      ...values,
      [SETTINGS_PANEL]: panel,
    });
  } catch (err) {
    console.error('Editor settings write failed', err);
    return jsonResponse({ error: 'write_failed' }, 502);
  }

  const tenant = tenantKey(context);
  invalidateAppSettings(tenant);

  return jsonResponse({ ok: true, values: panel });
};
