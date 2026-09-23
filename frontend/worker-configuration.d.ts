// Bindings declared in wrangler.jsonc. No KV: this app renders its own markup
// and has no theme cache to store.
interface Env {
  ASSETS: import('@cloudflare/workers-types').Fetcher;
}
