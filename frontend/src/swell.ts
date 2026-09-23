import {
  Swell,
  type SwellAppConfig,
  type SwellData,
  type CFThemeEnv,
  type CFWorkerContext,
} from '@swell/apps-sdk';
import type { AstroGlobal, APIContext, AstroCookieSetOptions } from 'astro';

import swellConfig from '../../swell.json';
import { isCacheablePageRequest } from '@/lib/cacheable';

// Every value the SDK stores as a "cookie" is a key inside this one JSON cookie.
const SWELL_DATA_COOKIE = 'swell-data';

const defaultCookieOptions: AstroCookieSetOptions = {
  path: '/',
  sameSite: 'lax',
};

/**
 * Cache key for anything held in module scope. One deployed Worker script
 * serves every store that installs this app, so the key has to identify the
 * store. The hostname does not: a store is reachable on more than one
 * hostname, and a custom domain shares nothing with the store id. The store id
 * alone does not either: it is public, and the worker is reachable directly,
 * so a request carrying someone else's id would share their bucket. The
 * access token is the one header only the proxy knows, so a digest of it is
 * part of the key. Computed once per request by `initContext`.
 */
export function tenantKey(context: AstroGlobal | APIContext): string {
  return context.locals.tenant;
}

export async function computeTenantKey(
  context: AstroGlobal | APIContext,
): Promise<string> {
  const storeId = context.request.headers.get('swell-store-id') ?? '';
  const token = context.request.headers.get('swell-access-token') ?? '';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `store:${storeId}:${hex.slice(0, 16)}`;
}

/**
 * Builds the Swell client for a request.
 *
 * The store id and access token are not configured here — they arrive as
 * `swell-*` request headers from the Swell proxy, which is why this app can be
 * pushed to any store without a store id in the source.
 */
export function initSwell(
  context: AstroGlobal | APIContext,
  options?: Record<string, unknown>,
): Swell {
  const runtime = context.locals.runtime;
  const serverHeaders = new Headers(context.request.headers);

  return new Swell({
    url: context.url,
    // Double cast because the SDK's SwellAppConfig hardcodes
    // `storefront.theme.provider: 'app'` and never models `'self'`. The client
    // only reads `id` and `version` off this, both of which are right.
    config: swellConfig as unknown as SwellAppConfig,
    serverHeaders,
    workerEnv: runtime?.env as unknown as CFThemeEnv,
    workerCtx: runtime?.ctx as unknown as CFWorkerContext,
    getCookie(name: string) {
      return getCookie(context, name);
    },
    setCookie(
      name: string,
      value: string,
      cookieOptions?: AstroCookieSetOptions,
      swell?: Swell,
    ) {
      if (canUpdateCookies(context, swell)) {
        setCookie(context, name, value, cookieOptions);
      }
    },
    deleteCookie(
      name: string,
      cookieOptions?: AstroCookieSetOptions,
      swell?: Swell,
    ) {
      if (canUpdateCookies(context, swell)) {
        deleteCookie(context, name, cookieOptions);
      }
    },
    ...options,
  });
}

export function isResponseSent(request: Request): boolean {
  return Boolean(Reflect.get(request, Symbol.for('astro.responseSent')));
}

/**
 * Cookies may be written unless the response is already on its way — or the
 * page is one the cache will share between visitors. The SDK creates a session
 * on the first storefront call of a render; on a shared page that session is
 * nobody's, and a Set-Cookie header would stop the page being cached at all.
 * Sessions get created where they belong: /cart.json and the cart posts.
 */
export function canUpdateCookies(
  context: AstroGlobal | APIContext,
  swell?: Swell,
): boolean {
  if ((context as AstroGlobal).response || swell?.sentResponse) {
    return false;
  }

  return !isCacheablePageRequest(context.request);
}

export function getSwellDataCookie(
  context: AstroGlobal | APIContext,
): SwellData {
  const value = context.cookies.get(SWELL_DATA_COOKIE)?.value;

  if (value) {
    try {
      return JSON.parse(value);
    } catch {
      // Malformed cookie: start over rather than fail the request.
    }
  }

  return {};
}

export function getCookie(
  context: AstroGlobal | APIContext,
  name: string,
): string | undefined {
  return (getSwellDataCookie(context)[name] as string) || undefined;
}

export function setCookie(
  context: AstroGlobal | APIContext,
  name: string,
  value: string,
  options?: AstroCookieSetOptions,
): void {
  if (isResponseSent(context.request)) {
    return;
  }

  const data = getSwellDataCookie(context);
  data[name] = value;

  context.cookies.set(SWELL_DATA_COOKIE, JSON.stringify(data), {
    ...defaultCookieOptions,
    ...options,
  });
}

export function deleteCookie(
  context: AstroGlobal | APIContext,
  name: string,
  options?: AstroCookieSetOptions,
): void {
  if (isResponseSent(context.request)) {
    return;
  }

  const data = getSwellDataCookie(context);
  delete data[name];

  context.cookies.set(SWELL_DATA_COOKIE, JSON.stringify(data), {
    ...defaultCookieOptions,
    ...options,
  });
}
