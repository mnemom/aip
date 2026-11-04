/**
 * Snapshot of the published Mnemom signing keys. The page ships with these
 * so verifying never needs a network call; the key set box on the page is
 * prefilled with this document and can be replaced by pasting another JWKS.
 *
 * Source: GET https://api.mnemom.ai/v1/.well-known/jwks.json
 * Taken:  2026-10-23
 */
export const PUBLISHED_JWKS_TAKEN_ON = "2026-10-23";

export const PUBLISHED_JWKS = {
  keys: [
    {
      kty: "OKP",
      crv: "Ed25519",
      x: "Gt5MQjvO5oaA6U1v50RMjAp4KSyGZTqYnqzAHYJ0rw4",
      kid: "aap-prod-2026-05-23",
      alg: "EdDSA",
      use: "sig",
    },
  ],
} as const;
