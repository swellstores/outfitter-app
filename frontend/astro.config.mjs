import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  security: {
    // Swell proxies storefront requests, so the Origin header is not ours to check.
    checkOrigin: false,
  },
  adapter: cloudflare({
    // Product images are already served from Swell's CDN, and sharp does not
    // run on Workers.
    imageService: 'passthrough',
    platformProxy: {
      enabled: true,
    },
  }),
  devToolbar: {
    enabled: false,
  },
  // Every request for this app crosses the Swell proxy and Cloudflare's
  // workers.dev routing, which together cost about a second each, however
  // small the file. A page therefore carries its stylesheet and its scripts
  // inline rather than fetching them: the HTML is the only round trip.
  build: {
    inlineStylesheets: 'always',
  },
  vite: {
    build: {
      // Astro inlines a hoisted script below this size (the largest is ~15 KB).
      assetsInlineLimit: 32768,
    },
    ssr: {
      // @swell/apps-sdk reaches for these; nodejs_compat provides them at runtime.
      external: [
        'buffer',
        'events',
        'node:crypto',
        'node:events',
        'node:fs/promises',
        'node:path',
        'node:url',
      ],
    },
  },
});
