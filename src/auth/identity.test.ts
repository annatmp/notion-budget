import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Config } from '@/config';

import {
  ACCESS_IDENTITY_HEADER,
  ACCESS_JWT_HEADER,
  createIdentityResolver,
  IdentityUnavailableError,
  UnauthorisedError,
} from './identity';

const TEAM_DOMAIN = 'https://anna.cloudflareaccess.com';
const AUDIENCE = 'aud-tag-8f21';
const EMAIL = 'anna@example.com';
const ENDPOINT = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;

let signingKey: CryptoKey;
let rotatedInKey: CryptoKey;
let unknownKey: CryptoKey;
let signingJwk: Record<string, unknown>;
let rotatedInJwk: Record<string, unknown>;
let unknownJwk: Record<string, unknown>;

async function keyPair() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  return { publicKey, privateKey };
}

beforeAll(async () => {
  const first = await keyPair();
  signingKey = first.privateKey;
  signingJwk = { ...(await exportJWK(first.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };

  const second = await keyPair();
  rotatedInKey = second.privateKey;
  rotatedInJwk = {
    ...(await exportJWK(second.publicKey)),
    kid: 'key-2',
    alg: 'RS256',
    use: 'sig',
  };

  const third = await keyPair();
  unknownKey = third.privateKey;
  unknownJwk = { ...(await exportJWK(third.publicKey)), kid: 'key-9', alg: 'RS256', use: 'sig' };
});

/** A JWKS endpoint whose contents can be changed, as a rotation would change them. */
function jwksServer(initialKeys: unknown[]) {
  let keys = initialKeys;
  const requests: string[] = [];

  const fetchImpl = async (input: string | URL) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    fetchImpl,
    requests,
    setKeys: (next: unknown[]) => {
      keys = next;
    },
  };
}

function configWith(access: Config['access']): Config {
  return { access } as unknown as Config;
}

function resolverFor(server: ReturnType<typeof jwksServer>, cooldownMs = 0) {
  return createIdentityResolver(
    configWith({ mode: 'access', teamDomain: TEAM_DOMAIN, audience: AUDIENCE }),
    { fetch: server.fetchImpl, jwksCooldownMs: cooldownMs },
  );
}

async function mintToken(
  overrides: {
    key?: CryptoKey;
    kid?: string;
    audience?: string;
    email?: string | null;
    expiresAt?: number;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {};
  if (overrides.email !== null) {
    claims.email = overrides.email ?? EMAIL;
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid ?? 'key-1' })
    .setIssuer(TEAM_DOMAIN)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setIssuedAt(now - 120)
    .setExpirationTime(overrides.expiresAt ?? now + 3600)
    .sign(overrides.key ?? signingKey);
}

function requestWith(headers: Record<string, string>) {
  return new Request('https://budget.example.com/api/capture/text', {
    method: 'POST',
    headers,
  });
}

describe('a request that Access authenticated', () => {
  it('is accepted, with the identity taken from the verified token', async () => {
    const server = jwksServer([signingJwk]);
    const token = await mintToken();

    const identity = await resolverFor(server).resolve(requestWith({ [ACCESS_JWT_HEADER]: token }));

    expect(identity).toEqual({ email: EMAIL, source: 'access' });
  });

  it('fetches the keys from the team domain\u2019s certs endpoint', async () => {
    const server = jwksServer([signingJwk]);

    await resolverFor(server).resolve(requestWith({ [ACCESS_JWT_HEADER]: await mintToken() }));

    expect(server.requests[0]).toBe(ENDPOINT);
  });
});

describe('a request that did not', () => {
  it('is refused when there is no Access token at all', async () => {
    const server = jwksServer([signingJwk]);

    await expect(resolverFor(server).resolve(requestWith({}))).rejects.toBeInstanceOf(
      UnauthorisedError,
    );
  });

  it('is refused when only the identity header is present', async () => {
    // The critical case. Access sets this header, but so can anyone who can
    // reach the origin — so it is never proof of anything.
    const server = jwksServer([signingJwk]);

    await expect(
      resolverFor(server).resolve(requestWith({ [ACCESS_IDENTITY_HEADER]: EMAIL })),
    ).rejects.toBeInstanceOf(UnauthorisedError);
  });

  it('is refused when the identity header accompanies an unverifiable token', async () => {
    const server = jwksServer([signingJwk]);

    await expect(
      resolverFor(server).resolve(
        requestWith({ [ACCESS_IDENTITY_HEADER]: EMAIL, [ACCESS_JWT_HEADER]: 'not-a-jwt' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorisedError);
  });

  it('is refused when the token has expired', async () => {
    const server = jwksServer([signingJwk]);
    const expired = await mintToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });

    await expect(
      resolverFor(server).resolve(requestWith({ [ACCESS_JWT_HEADER]: expired })),
    ).rejects.toBeInstanceOf(UnauthorisedError);
  });

  it('is refused when the token is for a different application', async () => {
    // A valid token from another Access application on the same account is not
    // a credential for this one.
    const server = jwksServer([signingJwk]);
    const otherApp = await mintToken({ audience: 'some-other-app' });

    await expect(
      resolverFor(server).resolve(requestWith({ [ACCESS_JWT_HEADER]: otherApp })),
    ).rejects.toBeInstanceOf(UnauthorisedError);
  });

  it('is refused when the token is signed by a key that is not published', async () => {
    const server = jwksServer([signingJwk]);
    const forged = await mintToken({ key: unknownKey, kid: 'key-9' });

    expect(unknownJwk.kid).toBe('key-9');
    await expect(
      resolverFor(server).resolve(requestWith({ [ACCESS_JWT_HEADER]: forged })),
    ).rejects.toBeInstanceOf(UnauthorisedError);
  });

  it('is refused when the token carries no email', async () => {
    const server = jwksServer([signingJwk]);

    await expect(
      resolverFor(server).resolve(
        requestWith({ [ACCESS_JWT_HEADER]: await mintToken({ email: null }) }),
      ),
    ).rejects.toBeInstanceOf(UnauthorisedError);
  });

  it('says why it refused, so a broken deployment is diagnosable', async () => {
    const server = jwksServer([signingJwk]);
    const expired = await mintToken({ expiresAt: Math.floor(Date.now() / 1000) - 60 });

    await expect(
      resolverFor(server).resolve(requestWith({ [ACCESS_JWT_HEADER]: expired })),
    ).rejects.toThrow(/could not be verified/i);
  });
});

describe('key rotation', () => {
  it('accepts a token signed by a newly published key without a redeploy', async () => {
    // Access rotates every six weeks. The app must follow the published keys
    // rather than pin one, or it would start refusing both owners silently.
    const server = jwksServer([signingJwk]);
    const resolver = resolverFor(server);

    const newToken = await mintToken({ key: rotatedInKey, kid: 'key-2' });
    await expect(
      resolver.resolve(requestWith({ [ACCESS_JWT_HEADER]: newToken })),
    ).rejects.toBeInstanceOf(UnauthorisedError);

    // The rotation completes; the new key joins the published set.
    server.setKeys([signingJwk, rotatedInJwk]);

    await expect(resolver.resolve(requestWith({ [ACCESS_JWT_HEADER]: newToken }))).resolves.toEqual(
      { email: EMAIL, source: 'access' },
    );
  });

  it('still accepts a token signed by the previous key during the overlap', async () => {
    const server = jwksServer([signingJwk, rotatedInJwk]);
    const resolver = resolverFor(server);

    await expect(
      resolver.resolve(requestWith({ [ACCESS_JWT_HEADER]: await mintToken() })),
    ).resolves.toEqual({ email: EMAIL, source: 'access' });
  });
});

describe('when the keys cannot be fetched', () => {
  it('reports that it could not check, rather than that the token is bad', async () => {
    // A Cloudflare blip is not a reason to send someone to a sign-in screen.
    // Both refuse the request; only one is worth telling them to log in for.
    const resolver = createIdentityResolver(
      configWith({ mode: 'access', teamDomain: TEAM_DOMAIN, audience: AUDIENCE }),
      {
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
        jwksCooldownMs: 0,
      },
    );

    await expect(
      resolver.resolve(requestWith({ [ACCESS_JWT_HEADER]: await mintToken() })),
    ).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it('still refuses the request, so nothing proceeds unchecked', async () => {
    const resolver = createIdentityResolver(
      configWith({ mode: 'access', teamDomain: TEAM_DOMAIN, audience: AUDIENCE }),
      {
        fetch: async () => new Response('bad gateway', { status: 502 }),
        jwksCooldownMs: 0,
      },
    );

    await expect(
      resolver.resolve(requestWith({ [ACCESS_JWT_HEADER]: await mintToken() })),
    ).rejects.toThrow();
  });
});

describe('the local bypass', () => {
  it('yields an identity without any Cloudflare values present', async () => {
    const resolver = createIdentityResolver(configWith({ mode: 'bypass' }));

    await expect(resolver.resolve(requestWith({}))).resolves.toEqual({
      email: 'dev@localhost',
      source: 'bypass',
    });
  });

  it('does not attempt to verify anything it is given', async () => {
    const resolver = createIdentityResolver(configWith({ mode: 'bypass' }), {
      bypassEmail: 'local@example.test',
    });

    await expect(
      resolver.resolve(requestWith({ [ACCESS_JWT_HEADER]: 'garbage' })),
    ).resolves.toEqual({ email: 'local@example.test', source: 'bypass' });
  });

  it('is distinguishable from a real identity downstream', async () => {
    const resolver = createIdentityResolver(configWith({ mode: 'bypass' }));

    const identity = await resolver.resolve(requestWith({}));

    expect(identity.source).toBe('bypass');
  });
});
