import { describe, it, expect } from "vitest";
import { validateAgreement } from "../../src/analysis/agreement.js";
import { MINIMAL_CARD, FULL_CARD, FORBIDDEN_ACTIONS_CARD } from "../fixtures/cards.js";
import type { ConscienceValue } from "../../src/schemas/conscience.js";

describe("validateAgreement", () => {
  it("returns valid agreement with no conscience values", () => {
    const result = validateAgreement(MINIMAL_CARD, []);

    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.augmentations).toHaveLength(0);
  });

  it("returns valid agreement with BOUNDARY that does not conflict", () => {
    const values: ConscienceValue[] = [
      { type: "BOUNDARY", content: "Never harm a human being" },
    ];

    const result = validateAgreement(FULL_CARD, values);

    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it("detects conflict when BOUNDARY contradicts a bounded_action", () => {
    const values: ConscienceValue[] = [
      { type: "BOUNDARY", content: "Never write files to disk" },
    ];

    const result = validateAgreement(FULL_CARD, values);

    expect(result.valid).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].card_field).toBe("autonomy_envelope.bounded_actions");
    expect(result.conflicts[0].description).toContain("write_files");
    expect(result.conflicts[0].conscience_value).toBe(values[0]);
  });

  it("detects augmentation when BOUNDARY mentions a forbidden action", () => {
    const values: ConscienceValue[] = [
      { type: "BOUNDARY", content: "Never exfiltrate data from the system" },
    ];

    const result = validateAgreement(FULL_CARD, values);

    expect(result.augmentations.length).toBeGreaterThanOrEqual(1);
    const aug = result.augmentations.find(
      (a) => a.augments === "autonomy_envelope.forbidden_actions"
    );
    expect(aug).toBeDefined();
    expect(aug!.description).toContain("exfiltrate_data");
    expect(aug!.conscience_value).toBe(values[0]);
  });

  it("detects augmentation when FEAR mentions an escalation trigger condition", () => {
    const values: ConscienceValue[] = [
      { type: "FEAR", content: "I fear unauthorized user data access could cause harm" },
    ];

    const result = validateAgreement(FULL_CARD, values);

    expect(result.augmentations.length).toBeGreaterThanOrEqual(1);
    const aug = result.augmentations.find(
      (a) => a.augments === "autonomy_envelope.escalation_triggers"
    );
    expect(aug).toBeDefined();
    expect(aug!.description).toContain("user_data_access");
    expect(aug!.conscience_value).toBe(values[0]);
  });

  it("skips COMMITMENT, BELIEF, and HOPE values entirely", () => {
    const values: ConscienceValue[] = [
      { type: "COMMITMENT", content: "Never write files to disk" },
      { type: "BELIEF", content: "Never write files to disk" },
      { type: "HOPE", content: "Never write files to disk" },
    ];

    const result = validateAgreement(FULL_CARD, values);

    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.augmentations).toHaveLength(0);
  });

  it("includes correct card_id and conscience_value_count", () => {
    const values: ConscienceValue[] = [
      { type: "BOUNDARY", content: "Always be honest" },
      { type: "FEAR", content: "I fear being misleading" },
      { type: "COMMITMENT", content: "I commit to transparency" },
    ];

    const result = validateAgreement(FULL_CARD, values);

    expect(result.card_id).toBe("ac-test-full");
    expect(result.conscience_value_count).toBe(3);
  });

  it("includes a validated_at ISO 8601 timestamp", () => {
    const before = new Date().toISOString();
    const result = validateAgreement(MINIMAL_CARD, []);
    const after = new Date().toISOString();

    expect(result.validated_at).toBeDefined();
    // Validate it is a parseable ISO 8601 date
    const parsed = new Date(result.validated_at);
    expect(parsed.toISOString()).toBe(result.validated_at);
    // Validate it falls within the expected time range
    expect(result.validated_at >= before).toBe(true);
    expect(result.validated_at <= after).toBe(true);
  });
});
