/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type Swell = import('@swell/apps-sdk').Swell;
type SwellData = import('@swell/apps-sdk').SwellData;
type ContentResolver = import('./lib/content').ContentResolver;

interface ENV {
  ASSETS: import('@cloudflare/workers-types').Fetcher;
  /** Set by the `version_metadata` binding: the epoch for the page cache. */
  CF_VERSION_METADATA?: { id: string; tag?: string };
  /** `"false"` disables the page cache for the whole deployment. */
  HTML_CACHE?: string;
  /** Seconds a page stays fresh; overrides the merchant's setting. `0` disables. */
  HTML_CACHE_TTL?: string;
  /** Manual cache epoch, for deployments without version metadata. */
  HTML_CACHE_EPOCH?: string;
  /** The page cache's KV store, shared by every data center. Absent, the Cache API is used. */
  NAMESPACE?: import('@cloudflare/workers-types').KVNamespace;
}

type Runtime = import('@astrojs/cloudflare').Runtime<ENV>;

declare namespace App {
  interface Locals extends Runtime {
    /** Swell client for this request. Set by `initContext` on every request. */
    swell: Swell;

    /**
     * Key for anything memoised in module scope for this store. Set by
     * `initContext` on every request; see `tenantKey` in src/swell.ts.
     */
    tenant: string;

    /**
     * True when this render is for the copy editor: the URL carries `__edit`
     * and the request passes the editor gate — editor or preview mode, with a
     * signed Swell-Context naming an admin of this store (dev builds also
     * accept the dashboard session cookie). Set by the `editMode` middleware
     * on every request; false on a live storefront no matter what the URL
     * says.
     */
    editMode: boolean;

    /**
     * The locale the copy is resolved for: the storefront's current locale,
     * as chosen in the header. Set by `resolveCopy`, after the storefront
     * settings have loaded; empty on requests that render no page.
     */
    editLocale: string;

    /**
     * Resolves a field id from settings/content.json to its copy for
     * `editLocale`. Use `<T id="…" />` for visible text and this for copy in
     * attributes, titles and scripts. Never throws; set on every request.
     */
    t: ContentResolver;

    /** Storefront settings (store name, currency, locale). Page requests only. */
    settings?: SwellData;

    /**
     * Current cart, or null when there is no cart yet. Only hydrated on the cart
     * and checkout pages — everywhere else pages are cached and shared, so the
     * client fetches its own cart from /cart.json.
     */
    cart?: SwellData | null;

    /** Logged-in account, or null. Only hydrated under `/account`. */
    account?: SwellData | null;
  }
}
