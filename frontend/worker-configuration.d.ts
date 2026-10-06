// Bindings declared in wrangler.jsonc. The KV namespace holds the page cache.
interface Env {
  ASSETS: import('@cloudflare/workers-types').Fetcher;
  NAMESPACE: import('@cloudflare/workers-types').KVNamespace;
}
