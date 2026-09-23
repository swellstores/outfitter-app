# outfitter frontend

The storefront runtime: an Astro app in server mode on Cloudflare Workers, rendering its own
markup (`storefront.theme.provider: "self"` — there is no visual editor and no theme app).

**This workspace builds.** `npm install && npm run build` completes with zero type errors. What it
does not yet have is pages: `/health` is the only route. The layout and the product, category,
cart and account pages are still to be written, against the middleware described below.

## Commands

```sh
npm install        # hoists to the repo root — this is an npm workspace
npm run dev        # astro dev, with the Cloudflare platform proxy
npm run typecheck  # astro check
npm run build      # astro check && astro build
npm run preview    # serve the built worker locally
```

`npm run typecheck` at the repo root delegates here.

The build writes `dist/`, whose worker entry is `dist/_worker.js/index.js` — the `main` in
`wrangler.jsonc`. `dist/` is also the `ASSETS` directory, so anything in `public/` is served
from it.

## Files

| File | What it does |
| --- | --- |
| `astro.config.mjs` | `output: 'server'`, Cloudflare adapter with `platformProxy`, `checkOrigin: false` (Swell proxies our requests, so the Origin header is not ours to check). |
| `wrangler.jsonc` | Worker config. `nodejs_compat`, an `ASSETS` binding, `preview` / `production` environments. **No KV** — no theme to cache means no `THEME` namespace. |
| `worker-configuration.d.ts` | The `Env` interface for the bindings above. |
| `src/env.d.ts` | Astro + runtime types, including everything on `Astro.locals`. |
| `src/swell.ts` | `initSwell(context)` — the Swell client for a request, plus the cookie helpers it is wired to. |
| `src/middleware/` | `route.ts` (context), `cart.ts`, `account.ts`, `checkout.ts`, sequenced in `index.ts`. |
| `src/pages/health.ts` | `/health`: app id and version as JSON, uncached, always 200. Answers without touching the storefront API. |

## No store id lives here

The store id and access token arrive as `swell-*` request headers from the Swell proxy and are
read by the SDK off `context.request.headers`. Nothing in this directory names a store, and the
worker `name` (`outfitter`) is deliberately generic. The same build serves whichever store it
is pushed to — which is also why every module-scope cache here (`lib/app-settings.ts`) is keyed
by tenant rather than held globally.

## What middleware puts on `Astro.locals`

`src/middleware/index.ts` sequences `initContext → cart → account → checkout`.

| Local | Set on | Value |
| --- | --- | --- |
| `swell` | every request | The `Swell` client. Never undefined in a page or endpoint. |
| `settings` | page requests | Storefront settings — store name, currency, locale. `undefined` if the call failed. |
| `cart` | page requests | Current cart, or `null`. |
| `account` | `/account/*` only | Logged-in account, or `null`. |

"Page requests" means everything except `/health`, `/_*` and paths with a file extension —
those skip storefront hydration so an asset fetch costs no API calls.

`account` gates `/account/*`: `/account/logout` logs out and redirects to `/`, and anything
under `/account` other than `login`, `signup` and `recover` redirects to `/account/login` when
nobody is signed in.

`cart` also handles the form posts. Post to `/cart` with `action` = `add` (`product_id`,
optional `variant_id`, `quantity`), `update` (`item_id`, `quantity`; zero removes the line) or
`remove` (`item_id`). It redirects to the same-site path in `redirect_to`, or `/cart` — a
post-redirect-get, so a reload never re-submits. A failed cart write is logged and swallowed
rather than blanking the page.

`checkout` is the handoff: `GET /checkout` redirects to `locals.cart.checkout_url`, or `/cart`
when there is no cart. This app renders no checkout of its own, which is how any shipping app's
services reach the shopper without this app calling a carrier.

Do not use `Astro.session`. The Cloudflare adapter backs sessions with a `SESSION` KV namespace
we deliberately do not declare. Per-visitor state belongs in the `swell-data` cookie, which
`src/swell.ts` already wires the SDK to.

## No app-to-app dependencies

This storefront sells the Swell catalog and nothing else. Products, shipping rates and shipments
are ordinary Swell records, so a fulfillment or shipping app can be installed, configured or
removed without this app knowing. Keep it that way: no reads of another app's `$app.<id>`
namespace, no carrier named in code, no page that renders differently because a particular app
is present.

## Deploying

Not done yet, and not doable from here. `swell app push` on a storefront app shells out to
`npx wrangler deploy` from this directory against **the developer's own Cloudflare account** —
there is no Swell-hosted build. It needs `wrangler login` plus `CLOUDFLARE_ACCOUNT_ID`, and it
hard-errors if the project is configured for Pages rather than Workers. `wrangler.jsonc` is
written and valid; no deploy, push or login has been run.

`compatibility_date` is `2026-09-03`, matching the `workerd` that ships with the pinned
wrangler. Raise it deliberately, not incidentally.
