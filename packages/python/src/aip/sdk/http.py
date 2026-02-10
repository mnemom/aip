"""HMAC-SHA256 signing and verification for AIP webhook delivery.

Port of packages/typescript/src/sdk/http.ts
"""

from __future__ import annotations

import hashlib
import hmac


def sign_payload(secret: str, payload: str) -> str:
    """Sign a payload with HMAC-SHA256. Returns ``sha256={hex}``."""
    digest = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={digest}"


def verify_signature(secret: str, payload: str, signature: str) -> bool:
    """Verify an HMAC-SHA256 signature using constant-time comparison.

    SPEC requires constant-time comparison to prevent timing attacks.
    """
    expected = sign_payload(secret, payload)
    return hmac.compare_digest(expected, signature)
