import type { APIRoute } from 'astro';

import swellConfig from '../../../swell.json';

/**
 * Is this worker alive? It answers without touching the storefront API, which
 * is what makes it useful: a 200 here and a broken page means the proxy or the
 * API is the problem, not the deployment.
 */
export const GET: APIRoute = () => {
  const body = {
    app: swellConfig.id,
    version: swellConfig.version,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  });
};
