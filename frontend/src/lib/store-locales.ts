import type { Swell, SwellData } from '@swell/apps-sdk';

export interface StoreLocale {
  code: string;
  /** The display name from store settings, or the code when there is none. */
  name: string;
}

export interface StoreLocales {
  /** The store's default locale. */
  locale: string;
  /** Every locale the store is configured for, the default included. */
  codes: string[];
  /** The same locales with their names, the default first. */
  list: StoreLocale[];
}

const CACHE_TTL_MS = 60000;
const MAX_CACHED_TENANTS = 200;

// Keyed by tenant for the same reason as lib/app-settings.ts: one deployed
// script serves every store running this app.
const cached = new Map<string, { locales: StoreLocales; at: number }>();

/**
 * The locales the merchant can edit copy for, from the store's own settings.
 *
 * Cached per store and never throws — when the settings cannot be read the
 * storefront's current locale is the only one on offer, which is still a
 * working editor rather than an error page.
 */
export async function getStoreLocales(
  swell: Swell,
  tenant: string,
): Promise<StoreLocales> {
  const entry = cached.get(tenant);

  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return entry.locales;
  }

  const locales = await readStoreLocales(swell);

  if (cached.size >= MAX_CACHED_TENANTS) {
    cached.delete(cached.keys().next().value as string);
  }

  cached.set(tenant, { locales, at: Date.now() });

  return locales;
}

async function readStoreLocales(swell: Swell): Promise<StoreLocales> {
  const store = await swell
    .get<SwellData>('/settings/store')
    .catch(() => undefined);

  let locale =
    typeof store?.locale === 'string' && store.locale ? store.locale : '';

  if (!locale) {
    // The SDK only knows the storefront's locale once /settings/all has
    // loaded; asked before that it answers a hardcoded en-US and keeps the
    // pending settings promise as the request's currency. Load, then ask.
    await swell.getStorefrontSettings().catch(() => undefined);
    locale = swell.getStorefrontLocalization().locale;
  }

  // `locales` is a list of { code, name, ... } records in store settings.
  const names = new Map<string, string>([[locale, locale]]);
  const items: unknown[] = Array.isArray(store?.locales) ? store.locales : [];

  for (const item of items) {
    const record = typeof item === 'string' ? { code: item } : (item as SwellData | null);
    const code = record?.code;

    if (typeof code === 'string' && code) {
      names.set(
        code,
        typeof record?.name === 'string' && record.name ? record.name : code,
      );
    }
  }

  const list = [...names].map(([code, name]) => ({ code, name }));

  return { locale, codes: list.map((item) => item.code), list };
}
