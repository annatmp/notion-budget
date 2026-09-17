import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

import type { Config } from '@/config';

/**
 * Establishing who is calling.
 *
 * The app has no accounts, no login endpoint and no session of its own:
 * Cloudflare Access authenticates, and this module is the only thing that turns
 * a request into a verified identity. Everything downstream trusts the result,
 * so nothing here may be inferred or defaulted.
 */

export interface Identity {
  email: string;
  /** Where the identity came from, so behaviour and logs can tell them apart. */
  source: 'access' | 'bypass';
}

export class UnauthorisedError extends Error {
  override readonly name = 'UnauthorisedError';
}

/**
 * The token could not be checked, because Access could not be reached.
 *
 * Distinct from `UnauthorisedError` on purpose: a 401 sends someone to a sign-in
 * screen, which is useless advice when the problem is a Cloudflare blip. Both
 * refuse the request — the distinction is only about what the user is told.
 */
export class IdentityUnavailableError extends Error {
  override readonly name = 'IdentityUnavailableError';
}

export interface IdentityResolver {
  resolve(request: Request): Promise<Identity>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface IdentityResolverOptions {
  fetch?: FetchLike;
  /**
   * How long the JWKS may be cached before a missing key triggers a refetch.
   * `jose` defaults to 30s; tests set 0 to exercise key rotation.
   */
  jwksCooldownMs?: number;
  /** The identity attributed to local development. */
  bypassEmail?: string;
}

/**
 * The header Access adds to every request it forwards.
 *
 * Deliberately not the `CF_Authorization` cookie: Cloudflare does not guarantee
 * the cookie is passed, and an installed iOS PWA has its own cookie jar, so the
 * cookie is the carrier most likely to be missing on the primary device
 * (design.md — "The origin must not be reachable directly").
 */
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

/** The identity header Access also sets. Never trusted — anyone can forge it. */
export const ACCESS_IDENTITY_HEADER = 'cf-access-authenticated-user-email';

const DEFAULT_BYPASS_EMAIL = 'dev@localhost';

export function createIdentityResolver(
  config: Config,
  options: IdentityResolverOptions = {},
): IdentityResolver {
  if (config.access.mode === 'bypass') {
    return bypassResolver(options.bypassEmail ?? DEFAULT_BYPASS_EMAIL);
  }
  return accessResolver(config.access, options);
}

/**
 * Local development only. The schema refuses this configuration when
 * `APP_ENV=production`, so it cannot reach a deployment.
 */
function bypassResolver(email: string): IdentityResolver {
  return {
    resolve: async () => ({ email, source: 'bypass' }),
  };
}

function accessResolver(
  access: { teamDomain: string; audience: string },
  options: IdentityResolverOptions,
): IdentityResolver {
  type JWKSOptions = NonNullable<Parameters<typeof createRemoteJWKSet>[1]>;

  const jwksOptions: JWKSOptions = {};
  if (options.jwksCooldownMs !== undefined) {
    jwksOptions.cooldownDuration = options.jwksCooldownMs;
  }
  if (options.fetch !== undefined) {
    jwksOptions[customFetch] = options.fetch as NonNullable<JWKSOptions[typeof customFetch]>;
  }

  // Fetched rather than pinned: Access rotates its signing key every six weeks
  // and retires the previous one seven days later, so a pinned key would begin
  // refusing both owners about six weeks after deployment.
  const jwks = createRemoteJWKSet(
    new URL(`${access.teamDomain}/cdn-cgi/access/certs`),
    jwksOptions,
  );

  return {
    async resolve(request: Request): Promise<Identity> {
      const token = request.headers.get(ACCESS_JWT_HEADER)?.trim() ?? '';

      if (token === '') {
        // No fallback to the identity header. Anyone who can reach the origin
        // can set it, which is the failure this whole design guards against.
        throw new UnauthorisedError('The request carries no Access token.');
      }

      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: access.teamDomain,
          audience: access.audience,
        }));
      } catch (cause) {
        throw classifyVerificationFailure(cause);
      }

      // Identity comes from the verified payload, never from a request header.
      const email = typeof payload.email === 'string' ? payload.email.trim() : '';
      if (email === '') {
        throw new UnauthorisedError('The verified Access token carries no email address.');
      }

      return { email, source: 'access' };
    },
  };
}

/**
 * Separates "this token is not trustworthy" from "we could not check".
 *
 * `jose` marks token problems with `ERR_JWT_*` / `ERR_JWS_*`, and a key that is
 * not published with `ERR_JWKS_NO_MATCHING_KEY` — all of which mean the caller's
 * credential is the problem. Anything else is a transport failure: a timeout, a
 * DNS error, Cloudflare being unreachable. Both refuse the request, because
 * failing closed is the only safe direction, but only one of them is worth
 * telling someone to sign in again for.
 */
function classifyVerificationFailure(cause: unknown): Error {
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  const name = typeof code === 'string' ? code : '';
  const detail = cause instanceof Error ? cause.message : String(cause);

  const tokenProblem =
    name.startsWith('ERR_JWT') || name.startsWith('ERR_JWS') || name === 'ERR_JWKS_NO_MATCHING_KEY';

  return tokenProblem
    ? new UnauthorisedError(`The Access token could not be verified: ${detail}`)
    : new IdentityUnavailableError(`Access could not be reached to verify the token: ${detail}`);
}
