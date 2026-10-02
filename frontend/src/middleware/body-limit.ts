import type { MiddlewareHandler } from 'astro';

import { jsonResponse } from '@/lib/cart-json';

const KB = 1024;
const MB = 1024 * KB;

// The cart, localization and account forms and the editor's single-field
// saves fit in this many times over.
const DEFAULT_LIMIT = 64 * KB;

// The two bodies that are big by design: an image travels as base64 in JSON
// (the route holds it to its own, tighter limit once it gets here), and a
// page's sections carry every locale's copy.
const LIMITS: Record<string, number> = {
  '/editor/api/upload': 8 * MB,
  '/editor/api/sections': 2 * MB,
};

/**
 * Refuses an oversized body before anything reads it. Every handler that
 * takes one — the forms and the editor's JSON alike — buffers it whole, so
 * without a limit a single post could run the isolate out of memory, and one
 * deployed script serves every store running this app.
 *
 * The size is the declared `Content-Length`, which browsers send with every
 * form post and fetch body. A body without one is refused rather than read to
 * find out.
 */
export const bodyLimit: MiddlewareHandler = (context, next) => {
  const { method, headers, body } = context.request;

  if (method === 'GET' || method === 'HEAD' || !body) {
    return next();
  }

  const declared = headers.get('content-length');
  const length = declared === null ? NaN : Number(declared);

  if (!Number.isFinite(length)) {
    return jsonResponse({ error: 'length_required' }, 411);
  }

  if (length > (LIMITS[context.url.pathname] ?? DEFAULT_LIMIT)) {
    return jsonResponse({ error: 'payload_too_large' }, 413);
  }

  return next();
};
