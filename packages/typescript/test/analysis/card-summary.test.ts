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
    // FULL_CARD has transparency(1), accuracy(2), helpfulness(3), safety(4) with descriptions
    const lines = result.split("\n");
    const valueLines = lines.filter((l) => l.startsWith("  - "));
    expect(valueLines[0]).toContain("transparency:");
    expect(valueLines[1]).toContain("accuracy:");
    expect(valueLines[2]).toContain("helpfulness:");
    expect(valueLines[3]).toContain("safety:");
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
    expect(lines[1]).toBe("Values (priority order):");
    // Lines 2-5: expanded value entries (4 values with descriptions)
    expect(lines[2]).toMatch(/^\s{2}- transparency:/);
    expect(lines[3]).toMatch(/^\s{2}- accuracy:/);
    expect(lines[4]).toMatch(/^\s{2}- helpfulness:/);
    expect(lines[5]).toMatch(/^\s{2}- safety:/);
    expect(lines[6]).toMatch(/^Bounded actions:/);
    expect(lines[7]).toMatch(/^Forbidden actions:/);
    expect(lines[8]).toBe("Escalation triggers:");
    expect(lines[9]).toMatch(/^\s{2}-/);
  });

  it("should include agent_description when provided", () => {
    const card = {
      card_id: "ac-agent-desc",
      agent_description: "Independent AI correspondent",
      values: [
        { name: "transparency", priority: 1 },
        { name: "accuracy", priority: 2 },
      ],
      autonomy_envelope: {},
    };
    const result = summarizeCard(card);
    expect(result).toContain("Agent: Independent AI correspondent");
  });

  it("should omit Agent line when agent_description not provided", () => {
    const result = summarizeCard(MINIMAL_CARD);
    expect(result).not.toContain("Agent:");
  });

  it("should include value descriptions in expanded format", () => {
    const card = {
      card_id: "ac-expanded-values",
      values: [
        { name: "transparency", priority: 1, description: "Full visibility into decisions" },
        { name: "accuracy", priority: 2 },
        { name: "rigor", priority: 3, description: "Broad exploratory research" },
      ],
      autonomy_envelope: {},
    };
    const result = summarizeCard(card);
    expect(result).toContain("Values (priority order):");
    expect(result).toContain("  - transparency: Full visibility into decisions");
    expect(result).toContain("  - accuracy");
    expect(result).toContain("  - rigor: Broad exploratory research");
  });

  it("should use compact format when no values have descriptions", () => {
    const card = {
      card_id: "ac-compact-values",
      values: [
        { name: "transparency", priority: 1 },
        { name: "accuracy", priority: 2 },
      ],
      autonomy_envelope: {},
    };
    const result = summarizeCard(card);
    expect(result).toContain("Values (priority order): transparency, accuracy");
  });
});
