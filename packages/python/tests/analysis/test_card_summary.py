"""Tests for card summary extraction.

Verifies that AlignmentCards are summarized correctly for
inclusion in the conscience prompt, following SPEC Section 6.2.

Port of packages/typescript/test/analysis/card-summary.test.ts
"""

from __future__ import annotations

from aip.analysis.card_summary import summarize_card
from aip.schemas.config import (
    AlignmentCard,
    AlignmentCardValue,
    AutonomyEnvelope,
    EscalationTrigger,
)
from tests.conftest import FULL_CARD, MINIMAL_CARD


class TestSummarizeCard:
    """Tests for summarize_card."""

    def test_includes_card_id_in_output(self) -> None:
        result = summarize_card(FULL_CARD)
        assert "card_id: ac-test-full" in result

    def test_lists_values_in_priority_order_ascending(self) -> None:
        result = summarize_card(FULL_CARD)
        # FULL_CARD has transparency(1), accuracy(2), helpfulness(3), safety(4)
        # Values have descriptions so expanded format is used
        assert "Values (priority order):" in result
        lines = result.split("\n")
        # Extract value lines between "Values" header and "Bounded actions"
        values_start = next(i for i, line in enumerate(lines) if line.startswith("Values (priority order):"))
        bounded_start = next(i for i, line in enumerate(lines) if line.startswith("Bounded actions:"))
        value_lines = lines[values_start + 1 : bounded_start]
        value_names = [vl.strip().lstrip("- ").split(":")[0] for vl in value_lines]
        assert value_names == ["transparency", "accuracy", "helpfulness", "safety"]

    def test_sorts_values_by_priority_even_when_declared_out_of_order(self) -> None:
        card = AlignmentCard(
            card_id="ac-unordered",
            values=[
                AlignmentCardValue(name="safety", priority=3),
                AlignmentCardValue(name="accuracy", priority=1),
                AlignmentCardValue(name="helpfulness", priority=2),
            ],
            autonomy_envelope=AutonomyEnvelope(),
        )
        result = summarize_card(card)
        assert "Values (priority order): accuracy, helpfulness, safety" in result

    def test_includes_bounded_actions(self) -> None:
        result = summarize_card(FULL_CARD)
        assert "Bounded actions: read_files, write_files, run_commands" in result

    def test_includes_forbidden_actions(self) -> None:
        result = summarize_card(FULL_CARD)
        assert "Forbidden actions: delete_system_files, exfiltrate_data, modify_security_settings" in result

    def test_includes_escalation_triggers_with_condition_action_and_reason(self) -> None:
        result = summarize_card(FULL_CARD)
        assert "Escalation triggers:" in result
        assert "action_outside_bounded_list \u2192 pause_and_ask: Action not in approved list" in result
        assert "user_data_access \u2192 log_and_continue: Track data access patterns" in result

    def test_says_none_declared_when_card_has_no_bounded_actions(self) -> None:
        result = summarize_card(MINIMAL_CARD)
        assert "Bounded actions: none declared" in result

    def test_says_none_declared_when_card_has_no_forbidden_actions(self) -> None:
        result = summarize_card(MINIMAL_CARD)
        assert "Forbidden actions: none declared" in result

    def test_says_none_declared_when_card_has_no_escalation_triggers(self) -> None:
        result = summarize_card(MINIMAL_CARD)
        assert "Escalation triggers: none declared" in result

    def test_handles_escalation_trigger_without_reason(self) -> None:
        card = AlignmentCard(
            card_id="ac-no-reason",
            values=[AlignmentCardValue(name="safety", priority=1)],
            autonomy_envelope=AutonomyEnvelope(
                escalation_triggers=[
                    EscalationTrigger(
                        condition="unknown_action",
                        action="deny",
                    ),
                ],
            ),
        )
        result = summarize_card(card)
        assert "unknown_action \u2192 deny" in result
        # Should NOT have a trailing colon when reason is absent
        assert "deny:" not in result

    def test_produces_correctly_structured_multi_line_output(self) -> None:
        result = summarize_card(FULL_CARD)
        lines = result.split("\n")
        assert lines[0] == "ALIGNMENT CARD SUMMARY (card_id: ac-test-full)"
        assert lines[1].startswith("Values (priority order):")
        # FULL_CARD has descriptions, so expanded value lines follow
        assert lines[2].startswith("  - transparency:")
        assert lines[3].startswith("  - accuracy:")
        assert lines[4].startswith("  - helpfulness:")
        assert lines[5].startswith("  - safety:")
        assert lines[6].startswith("Bounded actions:")
        assert lines[7].startswith("Forbidden actions:")
        assert lines[8] == "Escalation triggers:"
        assert lines[9].startswith("  -")

    def test_includes_agent_description(self) -> None:
        card = AlignmentCard(
            card_id="ac-agent-desc",
            values=[AlignmentCardValue(name="accuracy", priority=1)],
            autonomy_envelope=AutonomyEnvelope(),
            agent_description="Independent AI correspondent",
        )
        result = summarize_card(card)
        assert "Agent: Independent AI correspondent" in result

    def test_omits_agent_line_when_no_description(self) -> None:
        result = summarize_card(MINIMAL_CARD)
        assert "Agent:" not in result

    def test_expanded_format_with_value_descriptions(self) -> None:
        card = AlignmentCard(
            card_id="ac-expanded",
            values=[
                AlignmentCardValue(name="accuracy", priority=1, description="Provide verified information"),
                AlignmentCardValue(name="safety", priority=2),
                AlignmentCardValue(name="helpfulness", priority=3, description="Be genuinely helpful"),
            ],
            autonomy_envelope=AutonomyEnvelope(),
        )
        result = summarize_card(card)
        assert "  - accuracy: Provide verified information" in result
        assert "  - safety" in result
        assert "  - helpfulness: Be genuinely helpful" in result

    def test_compact_format_without_descriptions(self) -> None:
        card = AlignmentCard(
            card_id="ac-compact",
            values=[
                AlignmentCardValue(name="honesty", priority=1),
                AlignmentCardValue(name="clarity", priority=2),
                AlignmentCardValue(name="safety", priority=3),
            ],
            autonomy_envelope=AutonomyEnvelope(),
        )
        result = summarize_card(card)
        assert "Values (priority order): honesty, clarity, safety" in result
