import { describe, expect, it } from 'vitest';
import {
  base64Url,
  createCodeChallenge,
  createCodeVerifier,
  expiresAtFrom,
  needsRefresh,
  REFRESH_MARGIN_MS,
  refreshDelay,
  VERIFIER_CHARSET,
} from '../src/services/spotify/auth';

const ALLOWED = /^[A-Za-z0-9\-._~]+$/;

describe('PKCE code verifier', () => {
  it('has the requested length and only unreserved characters', () => {
    for (const length of [43, 64, 128]) {
      const verifier = createCodeVerifier(length);
      expect(verifier).toHaveLength(length);
      expect(verifier).toMatch(ALLOWED);
    }
    expect(VERIFIER_CHARSET).toHaveLength(66);
    expect(VERIFIER_CHARSET).toMatch(ALLOWED);
  });

  it('defaults to 64 characters and is different every time', () => {
    const a = createCodeVerifier();
    expect(a).toHaveLength(64);
    expect(createCodeVerifier()).not.toBe(a);
  });

  it('rejects lengths outside 43–128', () => {
    expect(() => createCodeVerifier(42)).toThrow(RangeError);
    expect(() => createCodeVerifier(129)).toThrow(RangeError);
  });

  it('discards biased bytes instead of using modulo on them', () => {
    // 198 = 3 × 66 is the last full multiple of 66 below 256: bytes 198–255 would favour some characters.
    let call = 0;
    const fake = (bytes: Uint8Array) => {
      bytes.fill(call++ === 0 ? 255 : 0); // first batch is all rejected, then 'A's
      return bytes;
    };
    expect(createCodeVerifier(43, fake)).toBe('A'.repeat(43));
  });
});

describe('PKCE code challenge', () => {
  it('matches the RFC 7636 example', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(await createCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('is the base64url SHA-256 of the verifier, without padding', async () => {
    // SHA-256("abc") = ba7816bf…f20015ad (FIPS 180-2 test vector), written in base64url.
    expect(await createCodeChallenge('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
    const challenge = await createCodeChallenge(createCodeVerifier());
    expect(challenge).toHaveLength(43); // 32 bytes → 43 base64url characters
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('base64Url replaces + and / and drops the padding', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64Url(new Uint8Array([0xff]))).toBe('_w');
  });
});

describe('token expiry', () => {
  const now = 1_000_000;

  it('turns expires_in seconds into an absolute time', () => {
    expect(expiresAtFrom(3600, now)).toBe(now + 3_600_000);
  });

  it('needs a refresh only inside the safety margin', () => {
    const tokens = { expiresAt: now + 3_600_000 };
    expect(needsRefresh(tokens, now)).toBe(false);
    expect(needsRefresh(tokens, tokens.expiresAt - REFRESH_MARGIN_MS - 1)).toBe(false);
    expect(needsRefresh(tokens, tokens.expiresAt - REFRESH_MARGIN_MS)).toBe(true);
    expect(needsRefresh(tokens, tokens.expiresAt + 5)).toBe(true);
  });

  it('schedules the proactive refresh before expiry, never in the past', () => {
    const tokens = { expiresAt: now + 3_600_000 };
    expect(refreshDelay(tokens, now)).toBe(3_600_000 - REFRESH_MARGIN_MS);
    expect(refreshDelay(tokens, tokens.expiresAt)).toBe(0);
    expect(refreshDelay({ expiresAt: now + 10_000 }, now, 30_000)).toBe(0);
  });
});
