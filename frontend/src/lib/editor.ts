import type { Swell, SwellData } from '@swell/apps-sdk';
import type { APIContext, AstroGlobal } from 'astro';

import panel from '../../../settings/outfitter.json';
import manifest from '../../../swell.json';
import { safeColor } from './color';
import type { ContentField, ContentPage } from './content';
import type { SectionTypeDef, StoredSection } from './sections';
import { verifySwellContext } from './swell-context';

/**
 * What the editor shell and its API share: the gate, the storefront's settings
 * document, and the shape of the store's own settings panel.
 *
 * Settings values live in one document per storefront, keyed by the settings
 * file that declared them — `values.outfitter` for settings/outfitter.json,
 * `values.content` for settings/content.json, `values.sections` for
 * settings/sections.json and `values.editor` for settings/editor.json. The
 * dashboard writes the whole `values` object back with `$set`, so every
 * write here reads first and returns every other panel untouched.
 */

export const SETTINGS_PANEL = 'outfitter';
export const CONTENT_PANEL = 'content';
export const SECTIONS_PANEL = 'sections';

/** Longest copy the editor accepts for one field. */
export const MAX_CONTENT_LENGTH = 4000;
/** Longest text setting (a logo URL) it accepts. */
export const MAX_SETTING_LENGTH = 500;
/** Largest image the editor will upload, before base64 expansion. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type SettingsFieldType = 'color' | 'image' | 'text' | 'number' | 'toggle';

export interface SettingsField {
  id: string;
  label: string;
  type: SettingsFieldType;
  /** Which tab of the settings dialog shows it. */
  tab: SettingsTabId;
  default?: unknown;
  description?: string;
  placeholder?: string;
  options?: unknown;
}

export type SettingsTabId = 'general' | 'colors';

export const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'colors', label: 'Colors' },
];

/**
 * Which tab each setting belongs to, by id.
 *
 * A map here rather than a key in settings/outfitter.json, because that file is
 * also what the Swell dashboard renders and the dashboard has no tabs — a
 * grouping invented for this editor should not change what merchants see there.
 * By id and not by field type: a dark-mode toggle or a radius number would
 * belong on Colors too, and neither is a colour field.
 */
const TAB_BY_FIELD: Record<string, SettingsTabId> = {
  color_primary: 'colors',
  color_secondary: 'colors',
  color_text: 'colors',
  color_muted: 'colors',
  color_background: 'colors',
  color_surface: 'colors',
  color_border: 'colors',
};

export interface EditorPage {
  id: string;
  label: string;
  url: string;
  /** The content page (group in settings/content.json) whose copy it shows. */
  group: string;
}

export interface EditorState {
  storefrontId: string;
  /** The store's default locale: where copy without a `$locale` override lives. */
  defaultLocale: string;
  pages: EditorPage[];
  content: {
    /** The raw `content` panel, `$locale` overrides included. */
    values: SwellData;
    fields: Record<string, ContentField>;
    pages: ContentPage[];
  };
  settings: {
    /** The raw `outfitter` panel. */
    values: SwellData;
    fields: SettingsField[];
  };
  sections: {
    /**
     * Each page's sections as stored, keyed by page id, `$locale` overrides
     * included — or that page's defaults, when none are stored yet. A page
     * absent from this map has no section list at all.
     */
    lists: Record<string, StoredSection[]>;
    types: SectionTypeDef[];
  };
  /** Reads that failed; the editor still opens, on what it could get. */
  warnings: string[];
}

/**
 * Who may sign a Swell-Context this app trusts: Swell production and staging,
 * and under `swell app dev` a local Swell as well. Fixed here, never read from
 * the request.
 */
const CONTEXT_ISSUERS: readonly string[] = [
  'https://swell.store',
  'https://dev.swell.store',
  ...(import.meta.env.DEV ? ['http://swell.test:4001'] : []),
];

/** Whether Swell marks the request as editor or preview — a hint, not a credential. */
export function isEditorMode(swell: Swell): boolean {
  return swell.isEditor || swell.isPreview;
}

/**
 * Whether this request may see the editor's pages and write through its API.
 *
 * Editor and preview mode are a hint, not a credential: the proxy derives them
 * from the hostname alone, and a store's test environment runs in preview on a
 * public URL. The credential is the signed Swell-Context the proxy sends with
 * the request (see lib/swell-context.ts), which names an admin only when a
 * signed-in admin of the store made it — and, for a write, only when it came
 * from the storefront's own pages. Its store and storefront must be the ones
 * this request is for.
 *
 * Anything else, a live storefront included, is told nothing exists here.
 */
export async function isEditorRequest(
  context: AstroGlobal | APIContext,
): Promise<boolean> {
  const { swell } = context.locals;

  if (!isEditorMode(swell)) {
    return false;
  }

  const storeId = String(swell.swellHeaders?.['store-id'] ?? '');

  if (!storeId) {
    return false;
  }

  const signed = await verifySwellContext(
    context.request.headers.get('swell-context'),
    { audience: manifest.id, issuers: CONTEXT_ISSUERS },
  );

  if (
    signed?.admin &&
    signed.store_id === storeId &&
    (!signed.storefront_id ||
      signed.storefront_id === swell.swellHeaders?.['storefront-id'])
  ) {
    return true;
  }

  return import.meta.env.DEV && (await hasDevAdminSession(context, storeId));
}

/**
 * `swell app dev` only. Swell never names an admin in the context of a local
 * storefront preview — any visitor to the preview link would be one — so the
 * editor falls back to the dashboard session cookie the proxy still sets,
 * checked against the admin API. Production builds compile this out; it goes
 * when Swell either stops setting the cookie or names the admin locally.
 */
const DEV_ADMIN_SESSION_COOKIE = '_swell_admin_session';

const devSessionChecks = new Map<string, { valid: boolean; at: number }>();

async function hasDevAdminSession(
  context: AstroGlobal | APIContext,
  storeId: string,
): Promise<boolean> {
  const sessionId = context.cookies.get(DEV_ADMIN_SESSION_COOKIE)?.value;
  const adminUrl = String(context.locals.swell.swellHeaders?.['admin-url'] ?? '');

  if (!sessionId || !adminUrl) {
    return false;
  }

  const key = `${storeId}:${sessionId}`;
  const cached = devSessionChecks.get(key);

  if (cached && Date.now() - cached.at < 60000) {
    return cached.valid;
  }

  let valid = false;

  try {
    const response = await fetch(
      new URL('/admin/api/session', adminUrl).toString(),
      { headers: { 'x-session': sessionId } },
    );
    const session: unknown = response.ok ? await response.json() : null;

    valid =
      isRecord(session) &&
      Boolean(session.user_id) &&
      session.client_id === storeId;
  } catch {
    valid = false;
  }

  devSessionChecks.set(key, { valid, at: Date.now() });

  return valid;
}

/** The storefront whose settings document the editor reads and writes. */
export function getStorefrontId(context: APIContext): string {
  return (
    context.request.headers.get('swell-storefront-id') ||
    context.locals.swell.swellHeaders?.['storefront-id'] ||
    ''
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Whether the request declares a JSON body. */
export function isJsonRequest(request: Request): boolean {
  return (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .startsWith('application/json');
}

/**
 * Parses a JSON body into a plain object; anything else is `null`. A body not
 * declared as JSON is refused too: a browser sends `text/plain` posts to any
 * origin without a preflight, and would otherwise be parsed all the same.
 */
export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (!isJsonRequest(request)) {
    return null;
  }

  const body: unknown = await request.json().catch(() => null);

  return isRecord(body) ? body : null;
}

function configPath(storefrontId: string): string {
  return `/:storefronts/${encodeURIComponent(storefrontId)}/configs/settings`;
}

function requireBackend(swell: Swell): void {
  // The backend client only exists when the proxy sent an access token; without
  // it `swell.get` resolves to undefined and a write would silently do nothing.
  if (!swell.backend) {
    throw new Error('backend_unavailable');
  }
}

/**
 * The full `values` object of the storefront's settings document, every panel
 * included. A document that does not exist yet reads as empty.
 */
export async function readSettingsValues(
  swell: Swell,
  storefrontId: string,
): Promise<Record<string, unknown>> {
  requireBackend(swell);

  let config: SwellData | undefined;

  try {
    config = await swell.get<SwellData>(configPath(storefrontId));
  } catch (err) {
    if ((err as { status?: number })?.status === 404) {
      return {};
    }

    throw err;
  }

  // Only a missing document reads as empty. Anything else that is not one —
  // the SDK hands an empty body back as '' — is a failed read: taken for an
  // empty document, the write after it would leave a single panel standing.
  if (config === null || config === undefined) {
    return {};
  }

  if (!isRecord(config)) {
    throw new Error('the settings document did not read as an object');
  }

  return isRecord(config.values) ? config.values : {};
}

/**
 * Writes `values` back whole — the caller has merged its one panel into it.
 *
 * Read, change, write back is not atomic: two writes to the same storefront
 * at once and the later one puts back what the earlier one changed. The
 * editor shell therefore sends its writes one at a time.
 */
export async function writeSettingsValues(
  swell: Swell,
  storefrontId: string,
  values: Record<string, unknown>,
): Promise<void> {
  requireBackend(swell);

  await swell.put(configPath(storefrontId), { $set: { values } });
}

/**
 * Creates a file from base64 and returns its public URL.
 *
 * It lives here, beside the other backend calls, so `requireBackend` stays
 * private and `/:files` is reached from the one module that already owns
 * backend access.
 *
 * Never `private: true`: a private file is stored without a URL, and a URL is
 * the only thing the caller wants.
 */
export async function uploadFile(
  swell: Swell,
  file: { data: string; contentType: string; filename?: string },
): Promise<string> {
  requireBackend(swell);

  const created = await swell.post<SwellData>('/:files', {
    data: { $base64: file.data },
    content_type: file.contentType,
    filename: file.filename,
  });

  const url = typeof created?.url === 'string' ? created.url : '';

  if (!url) {
    throw new Error('the file was created without a URL');
  }

  return url;
}

// ---- settings/outfitter.json ----------------------------------------------

interface RawField {
  id?: string;
  type: string;
  label?: string;
  default?: unknown;
  description?: string;
  placeholder?: string;
  options?: unknown;
  fields?: RawField[];
}

const FIELD_TYPES: Record<string, SettingsFieldType> = {
  color: 'color',
  image: 'image',
  short_text: 'text',
  text: 'text',
  number: 'number',
  toggle: 'toggle',
};

function collect(fields: RawField[], into: SettingsField[]): SettingsField[] {
  for (const field of fields) {
    if (field.fields) {
      collect(field.fields, into);
      continue;
    }

    const type = FIELD_TYPES[field.type];

    // A field the editor has no control for stays a dashboard-only setting.
    if (!field.id || !type) {
      continue;
    }

    into.push({
      id: field.id,
      label: field.label ?? field.id,
      type,
      tab: TAB_BY_FIELD[field.id] ?? 'general',
      default: field.default,
      description: field.description,
      placeholder: field.placeholder,
      options: field.options,
    });
  }

  return into;
}

/** The store's settings the editor can change, in the file's order. */
export const SETTINGS_FIELDS: SettingsField[] = collect(
  (panel as { fields: RawField[] }).fields,
  [],
);

const SETTINGS_BY_ID = new Map(SETTINGS_FIELDS.map((field) => [field.id, field]));

export function getSettingsField(id: string): SettingsField | undefined {
  return SETTINGS_BY_ID.get(id);
}

export type SettingCheck =
  /** `value` is what to store; `undefined` means remove the key. */
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * Checks one submitted setting against its declared type and returns the
 * value to store. Empty input clears the setting so the default applies again.
 */
export function checkSetting(field: SettingsField, raw: unknown): SettingCheck {
  switch (field.type) {
    case 'color': {
      if (typeof raw !== 'string') {
        return { ok: false, error: 'expected a string' };
      }

      if (raw.trim() === '') {
        return { ok: true, value: undefined };
      }

      const color = safeColor(raw);

      return color
        ? { ok: true, value: color }
        : { ok: false, error: 'expected a hex or rgba() colour' };
    }

    case 'number': {
      if (raw === '' || raw === null || raw === undefined) {
        return { ok: true, value: undefined };
      }

      const number = typeof raw === 'number' ? raw : Number(raw);

      return typeof raw !== 'boolean' && Number.isFinite(number)
        ? { ok: true, value: number }
        : { ok: false, error: 'expected a number' };
    }

    case 'toggle':
      return typeof raw === 'boolean'
        ? { ok: true, value: raw }
        : { ok: false, error: 'expected true or false' };

    case 'text': {
      if (typeof raw !== 'string') {
        return { ok: false, error: 'expected a string' };
      }

      return raw.length <= MAX_SETTING_LENGTH
        ? { ok: true, value: raw }
        : { ok: false, error: `longer than ${MAX_SETTING_LENGTH} characters` };
    }

    case 'image': {
      // The dashboard stores an uploaded file record here and reads its `url`;
      // the editor takes a URL and stores the same shape, so both keep working.
      if (typeof raw !== 'string' || raw.length > MAX_SETTING_LENGTH) {
        return { ok: false, error: 'expected a URL' };
      }

      const url = raw.trim();

      if (url === '') {
        // Same as every other type: clearing removes the key, so the file's
        // default applies again rather than a stored null standing in for it.
        return { ok: true, value: undefined };
      }

      try {
        const parsed = new URL(url);

        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error();
        }
      } catch {
        return { ok: false, error: 'expected an http(s) URL' };
      }

      return { ok: true, value: { url } };
    }
  }
}
