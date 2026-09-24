# Outfitter

A Swell **storefront app**: it renders its own markup instead of running a theme.
Astro on Cloudflare Workers, deployed to your own Cloudflare account by the Swell
CLI. Merchants compose the home, product and category pages from sections in a
visual editor the app itself serves at `/editor`.

## What you need

| | |
| --- | --- |
| Node | 22 or newer (the CLI's `engines` requires it) |
| CLI | `npm install -g @swell/cli` |
| A Swell store | with the **test environment enabled** — Settings → General → Test environment. Every `swell app` command runs against it, and without one they all die with `Test environment is not enabled for this store.` |
| Cloudflare | only for deploying. `swell app push` shells out to `npx wrangler deploy` against **your** account; there is no Swell-hosted build. |

You do not need to log in first — `swell app push` opens a browser when it finds
no session.

## Running it

```bash
npm install --workspaces
swell app dev
```

`swell app dev` pushes the app's config files, makes sure a storefront record
exists, opens a tunnel to your machine, registers it on the store, and runs
`astro dev` behind it. It prints the URL when Astro is ready:

```
https://<store-id>--<storefront-id>--local.swell.store
```

Use that URL, not localhost. Requests have to arrive through the Swell proxy,
which adds the `swell-*` headers carrying the store id and access token.

**`npm run dev` on its own will not work.** Astro starts, but the first
middleware refuses every request without those headers:

```json
{ "error": "not_reachable_directly", "message": "This worker is served through Swell and needs the swell-* request headers." }
```

If you stop `swell app dev` with anything harsher than Ctrl-C, the tunnel
registration is left behind and the storefront keeps pointing at a tunnel that is
gone. The next `swell app dev` re-registers it.

## Deploying

```bash
swell app push            # config + build + deploy worker
swell app frontend deploy # same deploy, and prints the storefront URL
```

`swell app push` hash-diffs local files against the app's remote configs and
uploads what changed. Two things surprise people:

- **`.swellrc` names the app a push updates.** It is committed, so a push from a
  clone updates that app rather than creating one. Delete it to have the CLI
  create a new app on your store and write a fresh id.
- **A push deletes remote files that no longer exist locally.** The deletes run
  after the uploads, so a `--force` push in the same run does not undo it.

## Layout

```
swell.json            app manifest: id, type, the /editor action, App Store metadata
settings/             merchant-facing settings panels (JSON schema, rendered by the dashboard)
  outfitter.json        store name, logo, palette, cache TTL, demo mode
  content.json          every shopper-facing string, per locale
  sections.json         the home page's section list (product/category are editor-only)
assets/               icon, screenshots and preview images for the App Store
frontend/             the Astro app — everything below is under frontend/src
  middleware/           the request chain (see below)
  layouts/Layout.astro  the shell: head, header, footer, cart drawer, and the whole stylesheet
  components/sections/  one component per section type
  lib/                  sections, content, product options, caching, the Swell client
  pages/                routes, including pages/editor (the visual editor)
```

## How a request flows

`frontend/src/middleware/index.ts` sequences these. Each one bails early when
the request is not its business:

| | |
| --- | --- |
| `initContext` | every request. Builds the Swell client from the proxy headers, sets `locals.swell` and `locals.tenant`. 503s a direct hit. |
| `editMode` | sets `locals.editMode` when the URL carries `__edit` **and** the request passes the editor gate |
| `htmlCache` | serves and stores the edge-cached HTML |
| `editor` | gates `/editor` and `/editor/api/*` |
| `hydratePage` | page GETs only: `locals.settings` |
| `resolveCopy` | builds `locals.t`, the copy resolver, and `locals.editLocale` |
| `cart`, `account`, `checkout`, `localization` | their own routes |

## The three places data lives

**Sections** — per-page lists in the app settings document under `sections.<page>`
(`home`, `product`, `category`). 17 marketing types plus 2 anchors: the product
page always keeps its `product_detail` and the category page its
`category_products`, neither of which can be hidden or deleted. Only
`sections.home` is declared in `settings/sections.json`; the other two are the
editor's alone.

**Copy** — `settings/content.json` declares every string; the merchant's overrides
live in the same settings document under `content`, with per-locale values at
`content.$locale.<code>.<id>`. Pages print copy through `<T id="..." />`, which in
edit mode wraps it in a `[data-edit]` span — that span is what makes it clickable
in the editor.

**Settings** — `settings/outfitter.json`, read at runtime via `lib/app-settings.ts`
(memoised 60s per tenant).

All three live in **one document** per storefront: `/:storefronts/{id}/configs/settings`.

## The editor

`/editor` is a shell that loads the storefront in an iframe and talks to it by
`postMessage` (`lib/edit-client.ts` is the preview side). It writes through three
routes under `pages/editor/api/` — `state`, `sections`, `content`.

Access needs editor or preview mode **and** a dashboard session cookie that the
admin API confirms. Mode alone is not a credential: a store's test environment
runs in preview on a public URL. Open it from the dashboard; hitting `/editor`
directly just redirects you to `/`.

## Recipes

**A new section type** — five files: add the id to `MarketingSectionType` and a
`SectionTypeDef` to `SECTION_TYPES` (`lib/sections.ts`); write
`components/sections/<Name>.astro` taking `{ section }`; register it in the
`marketing` map in `Sections.astro`; add any new field to `settings/sections.json`;
style it in `Layout.astro`.

**A new section field** — the union, `SECTION_FIELDS`, every type's `fields`
array, the `Section` interface, `resolveSection`, *and* `settings/sections.json`.
Miss the settings file and the dashboard cannot set it; miss the type's `fields`
array and it is silently dropped on read.

**A new copy string** — add it to `settings/content.json` and print it with
`<T id="..." />`. Nothing in the editor needs changing; it derives its field list
from that file.

**A new setting** — add it to `settings/outfitter.json` and read it off
`getAppSettings()`.
