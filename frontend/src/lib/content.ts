import type { SwellData } from '@swell/apps-sdk';

import panel from '../../../settings/content.json';

/**
 * The store's copy — every static string a page shows — as declared in
 * settings/content.json and saved by the merchant under the `content` panel
 * of the app's settings.
 *
 * The settings file is the one source of truth: field ids, labels, types and
 * defaults are all read from it here at build time, so adding a string means
 * adding a field there and nothing else.
 */

export type ContentFieldType = 'text' | 'long_text';

export interface ContentField {
  /** The page tab the field belongs to: a slug of the group label. */
  page: string;
  label: string;
  type: ContentFieldType;
  /** What the page rendered before the merchant changed anything. */
  default: string;
}

export interface ContentPage {
  id: string;
  label: string;
}

/** Resolves a field id to its copy. Never throws; unknown ids resolve to ''. */
export type ContentResolver = (id: string) => string;

interface SettingsField {
  id?: string;
  type: string;
  label?: string;
  default?: unknown;
  fields?: SettingsField[];
}

// Only the top-level groups carry copy; the dashboard renders them as tabs.
const groups = (panel as { fields: SettingsField[] }).fields.filter(
  (field) => field.type === 'field_group',
);

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The pages, in the order the settings file lists them. */
export const CONTENT_PAGES: ContentPage[] = groups.map((group) => ({
  id: slug(group.label ?? ''),
  label: group.label ?? '',
}));

/** Every field by id. Ids are flat: the settings panel stores them that way. */
export const CONTENT_FIELDS: Record<string, ContentField> = {};

for (const group of groups) {
  const page = slug(group.label ?? '');

  for (const field of group.fields ?? []) {
    if (!field.id) {
      continue;
    }

    CONTENT_FIELDS[field.id] = {
      page,
      label: field.label ?? field.id,
      type: field.type === 'long_text' ? 'long_text' : 'text',
      default: typeof field.default === 'string' ? field.default : '',
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Only a non-empty string is a saved value: the dashboard writes '' or null
// when a field is cleared, and either should fall through to the default.
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Builds the resolver for one request.
 *
 * `app` is the app's settings as `getAppSettings()` returns them; the copy is
 * the raw `content` panel on it, in the dashboard's own shape: the default-
 * locale value at `content.<id>` and per-locale overrides at
 * `content.$locale.<code>.<id>`. Lookup order for a locale such as `fr-FR`:
 *
 *   content.$locale['fr-FR'][id] → content.$locale.fr[id] → content[id]
 *   → the default in settings/content.json
 */
export function resolveContent(
  app: SwellData | null | undefined,
  locale: string,
): ContentResolver {
  const content = isRecord(app?.content) ? app.content : {};
  const locales = isRecord(content.$locale) ? content.$locale : {};

  const language = locale.split(/[-_]/)[0];
  const exact = isRecord(locales[locale]) ? locales[locale] : undefined;
  const byLanguage =
    language !== locale && isRecord(locales[language])
      ? locales[language]
      : undefined;

  return (id) =>
    nonEmpty(exact?.[id]) ??
    nonEmpty(byLanguage?.[id]) ??
    nonEmpty(content[id]) ??
    CONTENT_FIELDS[id]?.default ??
    '';
}
