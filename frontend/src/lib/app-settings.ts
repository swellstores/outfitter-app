import type { Swell, SwellData } from '@swell/apps-sdk';

import { markDegraded } from '@/lib/cacheable';

const CACHE_TTL_MS = 60000;
// How long the defaults stand in after a failed read with nothing older to
// fall back on: long enough that a render asks once, not once per caller.
const FAILED_TTL_MS = 5000;
const MAX_CACHED_TENANTS = 200;

interface Entry {
  settings: SwellData;
  at: number;
  failed?: boolean;
}

// One deployed script serves every store running this app, so the cache is keyed
// by tenant: a memo held for one storefront must never answer for another.
const cached = new Map<string, Entry>();

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
 * Cached per storefront so the layout and the page inside it share one read,
 * and never throws — this is a backend read whose token is not guaranteed to
 * be on a storefront request, and a store with default styling beats a store
 * with an error page.
 */
export async function getAppSettings(
  swell: Swell,
  tenant: string,
): Promise<SwellData> {
  const entry = cached.get(tenant);

  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    if (entry.failed) {
      markDegraded(swell);
    }

    return entry.settings;
  }

  const values = await readValues(swell);

  // A failed read is not an empty document. The last good settings, however
  // old, beat the defaults, and are held for another minute rather than asked
  // for again on every call while the API is failing. With none to fall back
  // on, the defaults are served but never let into the page cache, and are
  // held for a few seconds only.
  if (!values) {
    if (entry && !entry.failed) {
      entry.at = Date.now();
      return entry.settings;
    }

    markDegraded(swell);
    remember(tenant, {
      settings: {},
      // Dated back, so the entry lapses after FAILED_TTL_MS, not a minute.
      at: Date.now() - CACHE_TTL_MS + FAILED_TTL_MS,
      failed: true,
    });

    return {};
  }

  const panel = values?.[PANEL];
  const settings: SwellData =
    panel && typeof panel === 'object' ? { ...values, ...panel } : values;

  remember(tenant, { settings, at: Date.now() });

  return settings;
}

function remember(tenant: string, entry: Entry): void {
  if (cached.size >= MAX_CACHED_TENANTS) {
    cached.delete(cached.keys().next().value as string);
  }

  cached.set(tenant, entry);
}

/**
 * The `values` of the storefront's settings document, read the way the editor
 * reads them before a save. The SDK's own `getAppSettings()` asks for
 * `/:storefronts/{id}/configs/settings/values`, which answers an app's access
 * token with an empty body — no error, so it read as "no settings" and every
 * store ran on the defaults. This path answers with the document.
 *
 * `undefined` when the read failed. A storefront with no document yet has
 * not failed: it has no settings, and gets `{}`.
 */
async function readValues(swell: Swell): Promise<SwellData | undefined> {
  const storefrontId = swell.swellHeaders?.['storefront-id'];

  if (!storefrontId) {
    return {};
  }

  let config: SwellData | undefined;

  try {
    config = await swell.get<SwellData>(
      `/:storefronts/${encodeURIComponent(storefrontId)}/configs/settings`,
    );
  } catch (err) {
    // A 5xx, a 429 or a timeout says nothing about what the settings are.
    if ((err as { status?: number })?.status !== 404) {
      return undefined;
    }
  }

  const values = config?.values;

  return values && typeof values === 'object' ? values : {};
}

/**
 * Drops the memoised settings for a storefront, so the next read goes to the API.
 * Called after a save from the editor: the merchant who just typed a heading
 * should see it on the very next render, not a minute later.
 */
export function invalidateAppSettings(tenant: string): void {
  cached.delete(tenant);
}
