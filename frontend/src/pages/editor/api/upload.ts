import type { APIRoute } from 'astro';

import { jsonResponse } from '@/lib/cart-json';
import {
  MAX_UPLOAD_BYTES,
  isEditorRequest,
  readJsonBody,
  uploadFile,
} from '@/lib/editor';

/**
 * Turns an image the merchant picked in the editor into a URL.
 *
 * Body: `{ data: <bare base64>, filename?: string }`. Answers
 * `{ ok: true, url }`. The route mints a URL and nothing else — it writes no
 * setting, so nothing here reads or writes the storefront's settings document
 * and nothing is invalidated. The URL it returns is saved by the existing
 * paths: `/editor/api/settings` for a global image, `/editor/api/sections` for
 * a section's.
 *
 * The CSRF guard is the `/editor` middleware's: a non-GET under `/editor/api/`
 * must be `application/json` with an `Origin` matching `swell-storefront-host`.
 * That is why the body is JSON base64 rather than multipart, and why nothing
 * here re-checks `Origin`.
 *
 * Two rules the implementation depends on:
 *
 * 1. **The client's `content_type` is never trusted.** The API prefers an
 *    explicit `content_type` over its own detection, so passing the browser's
 *    claim through would let the editor mint a CDN URL served as `text/html`.
 *    The type is sniffed from the decoded bytes, and only that is sent.
 *
 * 2. **SVG is not accepted.** An SVG is executable markup; storing one under a
 *    URL the storefront then embeds makes the API's SVG XSS validator the only
 *    control between merchant-supplied `<svg onload=…>` and stored XSS, and if
 *    the file CDN is same-origin with the storefront that is same-origin XSS.
 *    This repo can verify neither property, so the route does not create the
 *    exposure. Pasting an existing SVG URL into an image field is unchanged.
 */
export const POST: APIRoute = async (context) => {
  const { swell } = context.locals;

  if (!(await isEditorRequest(context))) {
    return jsonResponse({ error: 'not_found' }, 404);
  }

  // `readJsonBody` calls `request.json()`, which buffers the whole body into a
  // string, so the size is checked from the header first — every check after
  // that point is too late to stop a large upload.
  const length = Number(context.request.headers.get('content-length'));

  if (!Number.isFinite(length) || length <= 0) {
    return jsonResponse(
      { error: 'invalid_body', detail: 'expected a content-length' },
      400,
    );
  }

  if (length > MAX_BODY_BYTES) {
    return jsonResponse(
      { error: 'file_too_large', detail: `larger than ${MAX_UPLOAD_BYTES} bytes` },
      400,
    );
  }

  const body = await readJsonBody(context.request);

  if (!body) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  if (typeof body.data !== 'string') {
    return jsonResponse(
      { error: 'invalid_value', detail: BAD_DATA },
      400,
    );
  }

  // A data: URL is tolerated — the browser's FileReader produces one — but the
  // prefix is the browser's claim about the type, so it is dropped, not read.
  const data = body.data.replace(/^data:[^,]{0,64},/, '').replace(/\s+/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
    return jsonResponse({ error: 'invalid_value', detail: BAD_DATA }, 400);
  }

  const bytes =
    (data.length / 4) * 3 -
    (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

  if (bytes > MAX_UPLOAD_BYTES) {
    return jsonResponse(
      { error: 'file_too_large', detail: `larger than ${MAX_UPLOAD_BYTES} bytes` },
      400,
    );
  }

  let head: number[];

  try {
    // 32 base64 characters decode to 24 bytes — every signature fits.
    head = decodeHead(data.slice(0, 32));
  } catch {
    return jsonResponse({ error: 'invalid_value', detail: BAD_DATA }, 400);
  }

  const contentType = sniffType(head);

  if (!contentType) {
    return jsonResponse(
      {
        error: 'unsupported_type',
        detail: 'expected a PNG, JPEG, GIF or WebP image',
      },
      400,
    );
  }

  try {
    const url = await uploadFile(swell, {
      data,
      contentType,
      filename: safeFilename(body.filename, contentType),
    });

    return jsonResponse({ ok: true, url });
  } catch (err) {
    console.error('Editor upload failed', err);
    return jsonResponse({ error: 'upload_failed' }, 502);
  }
};

/** base64 expansion (4/3) plus JSON envelope, rounded up. */
const MAX_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 1024;

const BAD_DATA = 'expected base64 image data';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

function decodeHead(chunk: string): number[] {
  const decoded = atob(chunk);
  const head: number[] = [];

  for (let i = 0; i < decoded.length; i += 1) {
    head.push(decoded.charCodeAt(i));
  }

  return head;
}

/** The image type the bytes themselves declare, or `''` for anything else. */
function sniffType(head: number[]): string {
  if (matches(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  if (matches(head, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (ascii(head, 0, 'GIF8')) {
    return 'image/gif';
  }

  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) {
    return 'image/webp';
  }

  return '';
}

function matches(head: number[], at: number, signature: number[]): boolean {
  return signature.every((byte, index) => head[at + index] === byte);
}

function ascii(head: number[], at: number, text: string): boolean {
  return matches(
    head,
    at,
    Array.from(text, (character) => character.charCodeAt(0)),
  );
}

/**
 * The merchant's filename, made safe, or nothing — in which case the API
 * generates `file-<id>.<ext>` itself.
 *
 * Two reasons it cannot be passed through. `SwellBackendAPI` computes
 * `Content-Length` from the JS string length, so a multibyte filename
 * under-declares the body and the API sees a truncated request. And the name
 * is `encodeURIComponent`-ed into the CDN URL, which has to stay under
 * `MAX_SETTING_LENGTH` for `checkSetting`'s image case to accept it later —
 * the fixed part of that URL is already ~110–140 characters.
 *
 * The extension is the sniffed type's, never the one the merchant typed.
 */
function safeFilename(raw: unknown, contentType: string): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const base = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.[^.]*$/, '')
    .replace(/^[.\-]+/, '')
    .slice(0, 60);

  return base ? `${base}${EXTENSIONS[contentType]}` : undefined;
}
