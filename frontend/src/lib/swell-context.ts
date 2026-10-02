import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

/**
 * Swell-Context: the signed account of a request that the Swell proxy sends an
 * app frontend with every request it forwards. It names the store, the app
 * installation and storefront, and — only when a signed-in admin of that store
 * made the request — the admin. The proxy drops any copy a client sent, so
 * through the proxy the only context that arrives is Swell's own, and a
 * request made to the worker directly cannot forge one without Swell's key.
 *
 * The token is an ES256 JWT, valid for 60 seconds, signed by swell-admin
 * (server/lib/frontend-context.js) with its public keys at
 * `{issuer}/.well-known/jwks.json`.
 */

export interface SwellContext {
  store_id: string;
  environment_id: string | null;
  app_id: string;
  installation_id: string;
  storefront_id: string | null;
  /** The admin who made the request, or null for anyone else. */
  admin: { user_id: string } | null;
}

export interface VerifyOptions {
  /** This app's id in slug form — `id` in swell.json. */
  audience: string;
  /** The issuers whose keys are trusted, as origins. Never taken from the request. */
  issuers: readonly string[];
  /** For tests. */
  now?: number;
}

/** Allowed clock difference between Swell and the worker. */
const CLOCK_TOLERANCE_SECONDS = 30;

/**
 * One key set per issuer, kept for the isolate's life. jose caches the keys,
 * refetches for a key id it has not seen (a rotated key) at most once per
 * cooldown, and shares one fetch between concurrent requests.
 */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let set = keySets.get(issuer);

  if (!set) {
    set = createRemoteJWKSet(new URL('/.well-known/jwks.json', issuer), {
      cacheMaxAge: 5 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
    keySets.set(issuer, set);
  }

  return set;
}

/**
 * The context's claims if the token is genuine, current and meant for this
 * app; otherwise null. Never throws.
 */
export async function verifySwellContext(
  token: string | null | undefined,
  { audience, issuers, now }: VerifyOptions,
): Promise<SwellContext | null> {
  if (!token) {
    return null;
  }

  try {
    // Read unverified only to pick which trusted issuer's keys to try; the
    // verification below checks the issuer again, against the signature.
    const { iss } = decodeJwt(token);

    if (typeof iss !== 'string' || !issuers.includes(iss)) {
      return null;
    }

    const { payload } = await jwtVerify(token, keySet(iss), {
      issuer: iss,
      audience,
      algorithms: ['ES256'],
      requiredClaims: ['exp'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now === undefined ? undefined : new Date(now),
    });

    if (typeof payload.store_id !== 'string' || payload.store_id === '') {
      return null;
    }

    const admin = isRecord(payload.admin) ? text(payload.admin.user_id) : null;

    return {
      store_id: payload.store_id,
      environment_id: text(payload.environment_id),
      app_id: text(payload.app_id) ?? '',
      installation_id: text(payload.installation_id) ?? '',
      storefront_id: text(payload.storefront_id),
      admin: admin ? { user_id: admin } : null,
    };
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
