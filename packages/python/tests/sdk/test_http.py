"""Tests for HMAC-SHA256 signing and verification.

Port of packages/typescript/test/sdk/http.test.ts
"""

from __future__ import annotations

import json

from aip.sdk.http import sign_payload, verify_signature

# ---------------------------------------------------------------------------
# sign_payload
# ---------------------------------------------------------------------------


class TestSignPayload:
    """Tests for sign_payload."""

    def test_returns_string_starting_with_sha256(self) -> None:
        result = sign_payload("test-secret", "test-payload")
        assert result.startswith("sha256=")
        # Verify remainder is hex
        hex_part = result[7:]
        assert all(c in "0123456789abcdef" for c in hex_part)

    def test_produces_consistent_signatures_for_same_input(self) -> None:
        sig1 = sign_payload("my-secret", "my-payload")
        sig2 = sign_payload("my-secret", "my-payload")
        assert sig1 == sig2

    def test_produces_different_signatures_for_different_payloads(self) -> None:
        sig1 = sign_payload("same-secret", "payload-one")
        sig2 = sign_payload("same-secret", "payload-two")
        assert sig1 != sig2

    def test_produces_different_signatures_for_different_secrets(self) -> None:
        sig1 = sign_payload("secret-one", "same-payload")
        sig2 = sign_payload("secret-two", "same-payload")
        assert sig1 != sig2


# ---------------------------------------------------------------------------
# verify_signature
# ---------------------------------------------------------------------------


class TestVerifySignature:
    """Tests for verify_signature."""

    def test_returns_true_for_valid_signature_round_trip(self) -> None:
        secret = "webhook-secret"
        payload = json.dumps({"event": "integrity_check", "status": "clear"})
        signature = sign_payload(secret, payload)

        result = verify_signature(secret, payload, signature)

        assert result is True

    def test_returns_false_for_tampered_payload(self) -> None:
        secret = "webhook-secret"
        payload = "original-payload"
        signature = sign_payload(secret, payload)

        result = verify_signature(secret, "tampered-payload", signature)

        assert result is False

    def test_returns_false_for_wrong_secret(self) -> None:
        payload = "some-payload"
        signature = sign_payload("correct-secret", payload)

        result = verify_signature("wrong-secret", payload, signature)

        assert result is False

    def test_returns_false_for_malformed_signature_string(self) -> None:
        secret = "webhook-secret"
        payload = "some-payload"

        result = verify_signature(secret, payload, "not-a-real-signature")

        assert result is False
