import type { Swell, SwellData } from '@swell/apps-sdk';

const CACHE_TTL_MS = 60000;
const MAX_CACHED_TENANTS = 200;

// One deployed script serves every store running this app, so the cache is keyed
// by tenant: a memo held for one store must never answer for another.
const cached = new Map<string, { settings: SwellData; at: number }>();

// Settings values come back keyed by the settings file that declared them —
// our fields live in settings/outfitter.json, so they arrive under `outfitter`.
const PANEL = 'outfitter';

/**
 * The merchant's settings for this app: store name, logo, palette and page
 * cache lifetime.
 *
 * Returned flat, so callers read `app.color_primary` whether the values arrive
 * namespaced under the panel id or at the top level.
 *
 * Cached per store so the layout and the page inside it share one read, and
 * never throws — this is a backend read whose token is not guaranteed to be on
 * a storefront request, and a store with default styling beats a store with an
 * error page.
 */
export async function getAppSettings(
  swell: Swell,
  tenant: string,
): Promise<SwellData> {
  const entry = cached.get(tenant);

  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return entry.settings;
  }

  const values = await readValues(swell);
  const panel = values?.[PANEL];
  const settings: SwellData =
    panel && typeof panel === 'object' ? { ...values, ...panel } : values;

  if (cached.size >= MAX_CACHED_TENANTS) {
    cached.delete(cached.keys().next().value as string);
  }

  cached.set(tenant, { settings, at: Date.now() });

  return settings;
}

/**
 * The `values` of the storefront's settings document, read the way the editor
 * reads them before a save. The SDK's own `getAppSettings()` asks for
 * `/:storefronts/{id}/configs/settings/values`, which answers an app's access
 * token with an empty body — no error, so it read as "no settings" and every
 * store ran on the defaults. This path answers with the document.
 */
async function readValues(swell: Swell): Promise<SwellData> {
  const storefrontId = swell.swellHeaders?.['storefront-id'];

  if (!storefrontId) {
    return {};
  }

  const config = await swell
    .get<SwellData>(
      `/:storefronts/${encodeURIComponent(storefrontId)}/configs/settings`,
    )
    .catch(() => undefined);
  const values = config?.values;

  return values && typeof values === 'object' ? values : {};
}

/**
 * Drops the memoised settings for a store, so the next read goes to the API.
 * Called after a save from the editor: the merchant who just typed a heading
 * should see it on the very next render, not a minute later.
 */
export function invalidateAppSettings(tenant: string): void {
  cached.delete(tenant);
}
