import {
  Swell,
  type SwellAppConfig,
  type SwellData,
  type CFThemeEnv,
  type CFWorkerContext,
} from '@swell/apps-sdk';
import type { AstroGlobal, APIContext, AstroCookieSetOptions } from 'astro';

import swellConfig from '../../swell.json';
import { isCacheablePageRequest, markDegraded } from '@/lib/cacheable';

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
 * part of the key. So is the storefront id: a store can run this app on more
 * than one storefront, all under the same token, and each has its own
 * settings document. Computed once per request by `initContext`.
 */
export function tenantKey(context: AstroGlobal | APIContext): string {
  return context.locals.tenant;
}

export async function computeTenantKey(
  context: AstroGlobal | APIContext,
): Promise<string> {
  const storeId = context.request.headers.get('swell-store-id') ?? '';
  const storefrontId =
    context.request.headers.get('swell-storefront-id') ?? '';
  const token = context.request.headers.get('swell-access-token') ?? '';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `store:${storeId}:${storefrontId}:${hex.slice(0, 16)}`;
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

  // A page the cache shares is rendered without the shopper's session unless
  // the proxy's storefront context names their account. The cache key covers
  // that context and nothing else of the session, yet the API falls back to
  // the locale and currency a session carries — so a session with no account
  // would render one shopper's choice into the entry every new visitor reads.
  // A signed-in shopper's context keys their pages apart, and their session
  // gets them their account's prices.
  const withholdSession =
    isCacheablePageRequest(context.request) && !namesAccount(context.request);

  const swell = new Swell({
    url: context.url,
    // Double cast because the SDK's SwellAppConfig hardcodes
    // `storefront.theme.provider: 'app'` and never models `'self'`. The client
    // only reads `id` and `version` off this, both of which are right.
    config: swellConfig as unknown as SwellAppConfig,
    serverHeaders,
    workerEnv: runtime?.env as unknown as CFThemeEnv,
    workerCtx: runtime?.ctx as unknown as CFWorkerContext,
    getCookie(name: string) {
      if (name === 'swell-session' && withholdSession) {
        return undefined;
      }

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

  // swell-js sends the shopper's locale and currency as headers, and the SDK
  // leaves headers out of its memo key, so one locale's products could answer
  // for another's — from the memo, or from a concurrent read it shares. Passed
  // as options as well they are part of the key. swell-js reads them from
  // there first, and they are the values it would have read from the cookie.
  // The storefront id is there for the key alone, and swell-js ignores it: the
  // SDK's key leaves it out, though /settings/all differs from one storefront
  // to the next.
  //
  // A read that fails marks the render degraded. swell-js answers a missing
  // record with null, so a rejection is the API failing, and the sections
  // that swallow it would otherwise store an empty grid for every visitor.
  const request = swell.storefront.request;

  swell.storefront.request = <T>(
    method: string,
    url: string,
    id?: string,
    data?: unknown,
    opt?: unknown,
  ) =>
    request<T>(method, url, id, data, {
      locale: getCookie(context, 'swell-locale'),
      currency: getCookie(context, 'swell-currency'),
      storefrontId: swell.swellHeaders['storefront-id'],
      ...(opt as object | undefined),
    }).catch((err: unknown) => {
      markDegraded(swell);
      throw err;
    });

  return swell;
}

/**
 * Whether the proxy's storefront context names a signed-in account. A context
 * that is missing or will not parse names none.
 */
function namesAccount(request: Request): boolean {
  const value = request.headers.get('swell-storefront-context');

  try {
    return Boolean(value && JSON.parse(decodeURIComponent(value))?.account);
  } catch {
    return false;
  }
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
