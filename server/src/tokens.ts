/**
 * Access tokens = Ed25519 (EdDSA) JWTs; the public key is published at the JWKS endpoint so future
 * sibling services (Centrifugo, calls) can verify WITHOUT the signing key (the SSO seam). In prod the
 * private key comes from `JWT_PRIVATE_JWK` (Lockbox); in local dev an ephemeral key is generated.
 */
import { SignJWT, jwtVerify, exportJWK, importJWK, generateKeyPair, calculateJwkThumbprint, type JWK, type KeyLike } from 'jose';

const ISS = process.env.JWT_ISS ?? 'https://api.dayenglish.ru';
const AUD = process.env.JWT_AUD ?? 'dayenglish';
const ACCESS_TTL_S = Number(process.env.ACCESS_TTL_S ?? 3600); // 60 min

type Signing = { privateKey: KeyLike; publicKey: KeyLike; publicJwk: JWK; kid: string };
let signingPromise: Promise<Signing> | null = null;

async function init(): Promise<Signing> {
  let privateKey: KeyLike;
  let publicJwk: JWK;
  const envJwk = process.env.JWT_PRIVATE_JWK;
  if (envJwk) {
    const jwk = JSON.parse(envJwk) as JWK;
    privateKey = (await importJWK(jwk, 'EdDSA')) as KeyLike;
    publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  } else {
    // Dev only: ephemeral key (tokens won't survive a restart — fine for local skeleton).
    const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    privateKey = kp.privateKey as KeyLike;
    publicJwk = await exportJWK(kp.publicKey);
    if (!process.env.JWT_PRIVATE_JWK) {
      // eslint-disable-next-line no-console
      console.warn('[tokens] JWT_PRIVATE_JWK not set — using an ephemeral dev key.');
    }
  }
  const kid = process.env.JWT_KID ?? (await calculateJwkThumbprint(publicJwk));
  publicJwk = { ...publicJwk, kid, alg: 'EdDSA', use: 'sig' };
  const publicKey = (await importJWK(publicJwk, 'EdDSA')) as KeyLike;
  return { privateKey, publicKey, publicJwk, kid };
}

function signing(): Promise<Signing> {
  return (signingPromise ??= init());
}

/** Sign a short-lived access token; returns the JWT + its expiry (epoch ms) for the client to refresh by. */
export async function signAccess(sub: string, deviceId: string, authVersion = 0): Promise<{ token: string; expiresAt: number }> {
  const { privateKey, kid } = await signing();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TTL_S;
  const token = await new SignJWT({ deviceId, ...(authVersion ? { authVersion } : {}) })
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);
  return { token, expiresAt: exp * 1000 };
}

/** Verify an access token; returns its claims or throws. */
export type AccessClaims = { sub: string; deviceId: string; authVersion?: number };
const accessValidators = new WeakMap<object, (claims: AccessClaims) => Promise<boolean>>();
export function bindAccessValidator(request: object, validate: (claims: AccessClaims) => Promise<boolean>): void {
  accessValidators.set(request, validate);
}

export async function verifyAccess(token: string): Promise<AccessClaims> {
  const { publicKey } = await signing();
  const { payload } = await jwtVerify(token, publicKey, { issuer: ISS, audience: AUD });
  if (payload.authVersion != null && (!Number.isSafeInteger(payload.authVersion) || Number(payload.authVersion) < 0)) throw new Error('Invalid credential generation');
  return { sub: String(payload.sub), deviceId: String(payload.deviceId ?? ''), ...(payload.authVersion == null ? {} : { authVersion: Number(payload.authVersion) }) };
}

/** Extract + verify Bearer claims from a request; null on missing/invalid token. Shared by authed routes. */
export async function bearerClaims(c: { req: { header(name: string): string | undefined } }): Promise<AccessClaims | null> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let claims: AccessClaims;
  try {
    claims = await verifyAccess(token);
  } catch {
    return null;
  }
  const validate = accessValidators.get(c.req);
  return !validate || await validate(claims) ? claims : null;
}

/** Public JWKS document for token verification by this and future services. */
export async function jwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await signing();
  return { keys: [publicJwk] };
}
