/**
 * Tests for card summary extraction.
 *
 * Verifies that AlignmentCards are summarized correctly for
 * inclusion in the conscience prompt, following SPEC Section 6.2.
 */

import { describe, it, expect } from "vitest";
import { summarizeCard } from "../../src/analysis/card-summary.js";
import { MINIMAL_CARD, FULL_CARD, FORBIDDEN_ACTIONS_CARD } from "../fixtures/cards.js";

describe("summarizeCard", () => {
  it("includes card_id in output", () => {
    const result = summarizeCard(FULL_CARD);
    expect(result).toContain("card_id: ac-test-full");
  });

  it("lists values in priority order (ascending)", () => {
    const result = summarizeCard(FULL_CARD);
    // FULL_CARD has transparency(1), accuracy(2), helpfulness(3), safety(4)
    expect(result).toContain(
      "Values (priority order): transparency, accuracy, helpfulness, safety",
    );
  });

  it("sorts values by priority even when declared out of order", () => {
    const card = {
      card_id: "ac-unordered",
      values: [
        { name: "safety", priority: 3 },
        { name: "accuracy", priority: 1 },
        { name: "helpfulness", priority: 2 },
      ],
      autonomy_envelope: {},
    };
    const result = summarizeCard(card);
    expect(result).toContain(
      "Values (priority order): accuracy, helpfulness, safety",
    );
  });

  it("includes bounded actions", () => {
    const result = summarizeCard(FULL_CARD);
    expect(result).toContain(
      "Bounded actions: read_files, write_files, run_commands",
    );
  });

  it("includes forbidden actions", () => {
    const result = summarizeCard(FULL_CARD);
    expect(result).toContain(
      "Forbidden actions: delete_system_files, exfiltrate_data, modify_security_settings",
    );
  });

  it("includes escalation triggers with condition, action, and reason", () => {
    const result = summarizeCard(FULL_CARD);
    // Check the arrow format: condition -> action: reason
    expect(result).toContain("Escalation triggers:");
    expect(result).toContain(
      "action_outside_bounded_list \u2192 pause_and_ask: Action not in approved list",
    );
    expect(result).toContain(
      "user_data_access \u2192 log_and_continue: Track data access patterns",
    );
  });

  it('says "none declared" when card has no bounded_actions', () => {
    const result = summarizeCard(MINIMAL_CARD);
    expect(result).toContain("Bounded actions: none declared");
  });

  it('says "none declared" when card has no forbidden_actions', () => {
    const result = summarizeCard(MINIMAL_CARD);
    expect(result).toContain("Forbidden actions: none declared");
  });

  it('says "none declared" when card has no escalation_triggers', () => {
    const result = summarizeCard(MINIMAL_CARD);
    expect(result).toContain("Escalation triggers: none declared");
  });

  it("handles escalation trigger without reason", () => {
    const card = {
      card_id: "ac-no-reason",
      values: [{ name: "safety", priority: 1 }],
      autonomy_envelope: {
        escalation_triggers: [
          { condition: "unknown_action", action: "deny" },
        ],
      },
    };
    const result = summarizeCard(card);
    expect(result).toContain("unknown_action \u2192 deny");
    // Should NOT have a trailing colon when reason is absent
    expect(result).not.toContain("deny:");
  });

  it("produces correctly structured multi-line output", () => {
    const result = summarizeCard(FULL_CARD);
    const lines = result.split("\n");
    expect(lines[0]).toBe("ALIGNMENT CARD SUMMARY (card_id: ac-test-full)");
    expect(lines[1]).toMatch(/^Values \(priority order\):/);
    expect(lines[2]).toMatch(/^Bounded actions:/);
    expect(lines[3]).toMatch(/^Forbidden actions:/);
    expect(lines[4]).toBe("Escalation triggers:");
    expect(lines[5]).toMatch(/^\s{2}-/);
  });
});
