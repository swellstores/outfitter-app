import type { Swell } from '@swell/apps-sdk';

import { localizationOptions } from './localization';

export interface StoreLocale {
  code: string;
  /** The display name from store settings, or the code when there is none. */
  name: string;
}

export interface StoreLocales {
  /** The store's default locale. */
  locale: string;
  /** Every locale the store has active, the default included. */
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
 * The locales the merchant can edit copy for: the store's default and every
 * locale it has active, from the public storefront settings — the same
 * `settings.state.store` the header's language control reads (see
 * middleware/localization.ts), so no settings scope is needed for it.
 *
 * Cached per store, and never throws. `null` when the settings cannot be
 * read, and that is not cached. Nothing stands in for the default then: the
 * storefront's current locale is whatever the merchant picked in the header,
 * and taking it for the default would write a translation over the copy
 * every shopper sees.
 */
export async function getStoreLocales(
  swell: Swell,
  tenant: string,
): Promise<StoreLocales | null> {
  const entry = cached.get(tenant);

  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return entry.locales;
  }

  const locales = await readStoreLocales(swell);

  if (!locales) {
    return null;
  }

  if (cached.size >= MAX_CACHED_TENANTS) {
    cached.delete(cached.keys().next().value as string);
  }

  cached.set(tenant, { locales, at: Date.now() });

  return locales;
}

async function readStoreLocales(swell: Swell): Promise<StoreLocales | null> {
  // The SDK logs a failed load and resolves anyway, without a store.
  const settings = await swell.getStorefrontSettings().catch(() => undefined);
  const store = settings?.state?.store;
  const locale =
    typeof store?.locale === 'string' && store.locale ? store.locale : '';

  if (!locale) {
    return null;
  }

  const list = localizationOptions(locale, store?.locales);

  return { locale, codes: list.map((item) => item.code), list };
}
