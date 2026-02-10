"""Tests for card-conscience agreement validation.

Port of packages/typescript/test/analysis/agreement.test.ts
"""

from __future__ import annotations

from datetime import datetime

from aip.analysis.agreement import validate_agreement
from aip.schemas.conscience import ConscienceValue
from tests.conftest import FULL_CARD, MINIMAL_CARD


class TestValidateAgreement:
    """Tests for validate_agreement."""

    def test_returns_valid_agreement_with_no_conscience_values(self) -> None:
        result = validate_agreement(MINIMAL_CARD, [])

        assert result.valid is True
        assert len(result.conflicts) == 0
        assert len(result.augmentations) == 0

    def test_returns_valid_agreement_with_boundary_that_does_not_conflict(self) -> None:
        values = [
            ConscienceValue(type="BOUNDARY", content="Never harm a human being"),
        ]

        result = validate_agreement(FULL_CARD, values)

        assert result.valid is True
        assert len(result.conflicts) == 0

    def test_detects_conflict_when_boundary_contradicts_bounded_action(self) -> None:
        values = [
            ConscienceValue(type="BOUNDARY", content="Never write files to disk"),
        ]

        result = validate_agreement(FULL_CARD, values)

        assert result.valid is False
        assert len(result.conflicts) == 1
        assert result.conflicts[0].card_field == "autonomy_envelope.bounded_actions"
        assert "write_files" in result.conflicts[0].description
        assert result.conflicts[0].conscience_value is values[0]

    def test_detects_augmentation_when_boundary_mentions_forbidden_action(self) -> None:
        values = [
            ConscienceValue(type="BOUNDARY", content="Never exfiltrate data from the system"),
        ]

        result = validate_agreement(FULL_CARD, values)

        assert len(result.augmentations) >= 1
        aug = next(
            (a for a in result.augmentations if a.augments == "autonomy_envelope.forbidden_actions"),
            None,
        )
        assert aug is not None
        assert "exfiltrate_data" in aug.description
        assert aug.conscience_value is values[0]

    def test_detects_augmentation_when_fear_mentions_escalation_trigger(self) -> None:
        values = [
            ConscienceValue(type="FEAR", content="I fear unauthorized user data access could cause harm"),
        ]

        result = validate_agreement(FULL_CARD, values)

        assert len(result.augmentations) >= 1
        aug = next(
            (a for a in result.augmentations if a.augments == "autonomy_envelope.escalation_triggers"),
            None,
        )
        assert aug is not None
        assert "user_data_access" in aug.description
        assert aug.conscience_value is values[0]

    def test_skips_commitment_belief_and_hope_values_entirely(self) -> None:
        values = [
            ConscienceValue(type="COMMITMENT", content="Never write files to disk"),
            ConscienceValue(type="BELIEF", content="Never write files to disk"),
            ConscienceValue(type="HOPE", content="Never write files to disk"),
        ]

        result = validate_agreement(FULL_CARD, values)

        assert result.valid is True
        assert len(result.conflicts) == 0
        assert len(result.augmentations) == 0

    def test_includes_correct_card_id_and_conscience_value_count(self) -> None:
        values = [
            ConscienceValue(type="BOUNDARY", content="Always be honest"),
            ConscienceValue(type="FEAR", content="I fear being misleading"),
            ConscienceValue(type="COMMITMENT", content="I commit to transparency"),
        ]

        result = validate_agreement(FULL_CARD, values)

        assert result.card_id == "ac-test-full"
        assert result.conscience_value_count == 3

    def test_includes_validated_at_iso_8601_timestamp(self) -> None:
        from datetime import timezone

        before = datetime.now(timezone.utc).isoformat()
        result = validate_agreement(MINIMAL_CARD, [])
        after = datetime.now(timezone.utc).isoformat()

        assert result.validated_at != ""
        # Validate it is a parseable ISO 8601 date
        parsed = datetime.fromisoformat(result.validated_at)
        assert parsed.isoformat() is not None
        # Validate it falls within the expected time range
        assert result.validated_at >= before
        assert result.validated_at <= after
