# Developing Outfitter

App Store copy lives in `README.md`, which Swell reads as the app’s full
description. Build and deployment notes belong here.

The storefront is an Astro app on Cloudflare Workers under `frontend/`. `swell app push` builds it and deploys the worker to your own Cloudflare account, so `wrangler login` and a Cloudflare account are prerequisites.

```bash
cd frontend && npm install && npm run build
swell app push
```
