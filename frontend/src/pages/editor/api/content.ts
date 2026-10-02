import type { APIRoute } from 'astro';

import { tenantKey } from '@/swell';
import { invalidateAppSettings } from '@/lib/app-settings';
import { jsonResponse } from '@/lib/cart-json';
import { CONTENT_FIELDS } from '@/lib/content';
import {
  CONTENT_PANEL,
  MAX_CONTENT_LENGTH,
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
  checkSectionValue,
  pageSections,
  parseSectionId,
  sectionFieldOf,
  type SectionPage,
  type StoredSection,
} from '@/lib/sections';
import { getStoreLocales } from '@/lib/store-locales';

/**
 * Saves one piece of copy for one locale.
 *
 * Body: `{ id, locale, value }`. The stored shape is the dashboard's own, so
 * the merchant can carry on editing from Apps → Outfitter → Settings: the
 * default locale's value at `content.<id>`, any other locale's at
 * `content.$locale.<code>.<id>`. An empty value on a non-default locale
 * removes that override, so the copy inherits again.
 *
 * A home page section's field has an id of the form `sec:<section>:<field>`
 * and lives on the section's item in `sections.home` instead, the same way:
 * `<item>.<field>` for the default locale, `<item>.$locale.<code>.<field>`
 * for any other. A field the type does not translate — a link, a layout, a
 * limit — has one value for every locale. Nothing stored yet means the
 * defaults, which are written out first so there is an item to write to.
 */
export const POST: APIRoute = async (context) => {
  const { swell } = context.locals;

  if (!(await isEditorRequest(context))) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  const body = await readJsonBody(context.request);
  const id = body?.id;
  const locale = body?.locale;
  const value = body?.value;
  const page = body?.page as SectionPage;

  if (typeof id !== 'string') {
    return jsonResponse({ error: 'unknown_field' }, 400);
  }

  const ref = parseSectionId(id);

  if (!ref && !Object.hasOwn(CONTENT_FIELDS, id)) {
    return jsonResponse({ error: 'unknown_field' }, 400);
  }

  // A section id is only unique within its own page's list, so a copy edit
  // without a page has nowhere safe to go. Refused loudly for one release
  // rather than resolved against the home page, which would write a product
  // page's copy into the home page's sections without a word.
  if (ref && !SECTION_PAGES.includes(page)) {
    return jsonResponse({ error: 'unknown_page' }, 400);
  }

  if (typeof value !== 'string' || value.length > MAX_CONTENT_LENGTH) {
    return jsonResponse({ error: 'invalid_value' }, 400);
  }

  const tenant = tenantKey(context);
  const store = await getStoreLocales(swell, tenant);

  // Whether the locale is the default decides where the copy goes, and the
  // wrong answer writes a translation over the copy every shopper sees. So it
  // is never guessed: without the store's own answer, nothing is written.
  if (!store) {
    return jsonResponse({ error: 'locales_unavailable' }, 503);
  }

  if (typeof locale !== 'string' || !store.codes.includes(locale)) {
    return jsonResponse({ error: 'unknown_locale' }, 400);
  }

  const storefrontId = getStorefrontId(context);

  if (!storefrontId) {
    return jsonResponse({ error: 'no_storefront' }, 400);
  }

  let values: Record<string, unknown>;

  try {
    values = await readSettingsValues(swell, storefrontId);
  } catch (err) {
    console.error('Editor copy read failed', err);
    return jsonResponse({ error: 'read_failed' }, 502);
  }

  const isDefault = locale === store.locale;
  let next: Record<string, unknown>;

  if (ref) {
    const panel = isRecord(values[SECTIONS_PANEL]) ? values[SECTIONS_PANEL] : {};
    const list = pageSections(panel, page, values[CONTENT_PANEL]);
    const item = list.find((entry) => entry.id === ref.itemId);

    if (!item) {
      return jsonResponse({ error: 'unknown_section' }, 400);
    }

    const field = sectionFieldOf(item.type, ref.field);

    if (!field) {
      return jsonResponse({ error: 'unknown_field' }, 400);
    }

    if (field.localized && !isDefault) {
      setOverride(item, locale, field.id, value);
    } else {
      const check = checkSectionValue(field, value);

      if (!check.ok) {
        return jsonResponse({ error: 'invalid_value', detail: check.error }, 400);
      }

      if (check.value === '') {
        delete item[field.id];
      } else {
        item[field.id] = check.value;
      }
    }

    next = { ...values, [SECTIONS_PANEL]: { ...panel, [page]: list } };
  } else {
    const content = isRecord(values[CONTENT_PANEL])
      ? { ...values[CONTENT_PANEL] }
      : {};

    if (isDefault) {
      content[id] = value;
    } else {
      setOverride(content, locale, id, value);
    }

    next = { ...values, [CONTENT_PANEL]: content };
  }

  try {
    await writeSettingsValues(swell, storefrontId, next);
  } catch (err) {
    console.error('Editor copy write failed', err);
    return jsonResponse({ error: 'write_failed' }, 502);
  }

  invalidateAppSettings(tenant);

  return jsonResponse({ ok: true, id, locale, value });
};

/**
 * Writes one locale's override onto a record — a content panel or a section
 * item — under `$locale.<code>.<key>`; an empty value removes it, and empty
 * containers go with it.
 */
function setOverride(
  record: Record<string, unknown> | StoredSection,
  locale: string,
  key: string,
  value: string,
): void {
  const target = record as Record<string, unknown>;
  const locales = isRecord(target.$locale) ? { ...target.$locale } : {};
  const overrides = isRecord(locales[locale]) ? { ...locales[locale] } : {};

  if (value === '') {
    delete overrides[key];
  } else {
    overrides[key] = value;
  }

  if (Object.keys(overrides).length > 0) {
    locales[locale] = overrides;
  } else {
    delete locales[locale];
  }

  if (Object.keys(locales).length > 0) {
    target.$locale = locales;
  } else {
    delete target.$locale;
  }
}
