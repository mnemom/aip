/**
 * Detection recipe validation and legacy normalization.
 *
 * Validates parsed recipe content against the canonical schema and
 * normalizes legacy field names from the old sideband prompt format.
 */

import type {
  RecipeCondition,
  RecipeMatchMode,
  RecipeOperator,
  RecipeParsedContent,
  RecipeTier3Action,
} from "../schemas/recipe.js";

// ---------------------------------------------------------------------------
// Valid value sets (same pattern as engine.ts)
// ---------------------------------------------------------------------------

const VALID_OPERATORS = new Set<string>([
  "lt",
  "lte",
  "gt",
  "gte",
  "eq",
  "neq",
  "matches",
  "contains",
]);

const VALID_MATCH_MODES = new Set<string>(["any", "all"]);

const VALID_TIER3_ACTIONS = new Set<string>([
  "override_to_review",
  "flag",
  "block",
  "escalate",
  "log",
]);

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface RecipeValidationResult {
  valid: boolean;
  errors: string[];
  normalized: RecipeParsedContent | null;
}

// ---------------------------------------------------------------------------
// Tier validators
// ---------------------------------------------------------------------------

function validateTier1(
  tier1: Record<string, unknown>,
  errors: string[],
): boolean {
  if (tier1.match !== undefined && !VALID_MATCH_MODES.has(tier1.match as string)) {
    errors.push(
      `tier1.match must be one of: ${[...VALID_MATCH_MODES].join(", ")} (got "${tier1.match}")`,
    );
    return false;
  }

  if (!Array.isArray(tier1.conditions)) {
    errors.push("tier1.conditions must be an array");
    return false;
  }

  for (let i = 0; i < tier1.conditions.length; i++) {
    const c = tier1.conditions[i] as Record<string, unknown>;
    if (!c || typeof c !== "object") {
      errors.push(`tier1.conditions[${i}] must be an object`);
      return false;
    }
    if (typeof c.metric !== "string" || c.metric.length === 0) {
      errors.push(`tier1.conditions[${i}].metric must be a non-empty string`);
      return false;
    }
    if (!VALID_OPERATORS.has(c.operator as string)) {
      errors.push(
        `tier1.conditions[${i}].operator must be one of: ${[...VALID_OPERATORS].join(", ")} (got "${c.operator}")`,
      );
      return false;
    }
    if (c.threshold === undefined || c.threshold === null) {
      errors.push(`tier1.conditions[${i}].threshold is required`);
      return false;
    }
    if (typeof c.signal !== "string" || c.signal.length === 0) {
      errors.push(`tier1.conditions[${i}].signal must be a non-empty string`);
      return false;
    }
  }

  return true;
}

function validateTier2(
  tier2: Record<string, unknown>,
  errors: string[],
): boolean {
  if (!tier2.trigger || typeof tier2.trigger !== "object") {
    errors.push("tier2.trigger must be an object");
    return false;
  }

  const trigger = tier2.trigger as Record<string, unknown>;
  if (
    trigger.on_signals !== undefined &&
    !Array.isArray(trigger.on_signals)
  ) {
    errors.push("tier2.trigger.on_signals must be an array");
    return false;
  }
  if (
    trigger.on_categories !== undefined &&
    !Array.isArray(trigger.on_categories)
  ) {
    errors.push("tier2.trigger.on_categories must be an array");
    return false;
  }

  if (!Array.isArray(tier2.checks)) {
    errors.push("tier2.checks must be an array");
    return false;
  }

  for (let i = 0; i < tier2.checks.length; i++) {
    const check = tier2.checks[i] as Record<string, unknown>;
    if (!check || typeof check !== "object") {
      errors.push(`tier2.checks[${i}] must be an object`);
      return false;
    }
    if (typeof check.id !== "string" || check.id.length === 0) {
      errors.push(`tier2.checks[${i}].id must be a non-empty string`);
      return false;
    }
    if (typeof check.type !== "string" || check.type.length === 0) {
      errors.push(`tier2.checks[${i}].type must be a non-empty string`);
      return false;
    }
    if (typeof check.content !== "string" || check.content.length === 0) {
      errors.push(`tier2.checks[${i}].content must be a non-empty string`);
      return false;
    }
  }

  return true;
}

function validateTier3(
  tier3: Record<string, unknown>,
  errors: string[],
): boolean {
  if (!Array.isArray(tier3.rules)) {
    errors.push("tier3.rules must be an array");
    return false;
  }

  for (let i = 0; i < tier3.rules.length; i++) {
    const rule = tier3.rules[i] as Record<string, unknown>;
    if (!rule || typeof rule !== "object") {
      errors.push(`tier3.rules[${i}] must be an object`);
      return false;
    }

    if (!rule.when || typeof rule.when !== "object") {
      errors.push(`tier3.rules[${i}].when must be an object`);
      return false;
    }
    const when = rule.when as Record<string, unknown>;
    if (typeof when.tier1_escalated !== "boolean") {
      errors.push(`tier3.rules[${i}].when.tier1_escalated must be a boolean`);
      return false;
    }
    if (typeof when.aip_verdict !== "string") {
      errors.push(`tier3.rules[${i}].when.aip_verdict must be a string`);
      return false;
    }

    if (!VALID_TIER3_ACTIONS.has(rule.action as string)) {
      errors.push(
        `tier3.rules[${i}].action must be one of: ${[...VALID_TIER3_ACTIONS].join(", ")} (got "${rule.action}")`,
      );
      return false;
    }

    if (typeof rule.reason !== "string" || rule.reason.length === 0) {
      errors.push(`tier3.rules[${i}].reason must be a non-empty string`);
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate parsed recipe content against the canonical schema.
 *
 * Returns a result with `valid: true` and the normalized content,
 * or `valid: false` with a list of human-readable error messages.
 */
export function validateRecipeContent(
  content: unknown,
): RecipeValidationResult {
  const errors: string[] = [];

  if (!content || typeof content !== "object") {
    return { valid: false, errors: ["content must be an object"], normalized: null };
  }

  const raw = content as Record<string, unknown>;

  // At least one tier must be present
  if (!raw.tier1 && !raw.tier2 && !raw.tier3) {
    return {
      valid: false,
      errors: ["at least one of tier1, tier2, or tier3 must be present"],
      normalized: null,
    };
  }

  const result: RecipeParsedContent = {};

  if (raw.tier1) {
    if (typeof raw.tier1 !== "object") {
      errors.push("tier1 must be an object");
    } else if (validateTier1(raw.tier1 as Record<string, unknown>, errors)) {
      const t1 = raw.tier1 as Record<string, unknown>;
      result.tier1 = {
        match: (t1.match as RecipeMatchMode) ?? "any",
        conditions: (t1.conditions as Record<string, unknown>[]).map((c) => ({
          metric: c.metric as string,
          operator: c.operator as RecipeOperator,
          threshold: c.threshold as number | string,
          signal: c.signal as string,
        })),
      };
    }
  }

  if (raw.tier2) {
    if (typeof raw.tier2 !== "object") {
      errors.push("tier2 must be an object");
    } else if (validateTier2(raw.tier2 as Record<string, unknown>, errors)) {
      const t2 = raw.tier2 as Record<string, unknown>;
      const trigger = t2.trigger as Record<string, unknown>;
      result.tier2 = {
        trigger: {
          on_signals: trigger.on_signals as string[] | undefined,
          on_categories: trigger.on_categories as string[] | undefined,
        },
        checks: (t2.checks as Record<string, unknown>[]).map((ch) => ({
          id: ch.id as string,
          type: ch.type as string,
          content: ch.content as string,
        })),
      };
    }
  }

  if (raw.tier3) {
    if (typeof raw.tier3 !== "object") {
      errors.push("tier3 must be an object");
    } else if (validateTier3(raw.tier3 as Record<string, unknown>, errors)) {
      const t3 = raw.tier3 as Record<string, unknown>;
      result.tier3 = {
        rules: (t3.rules as Record<string, unknown>[]).map((r) => {
          const when = r.when as Record<string, unknown>;
          return {
            when: {
              tier1_escalated: when.tier1_escalated as boolean,
              aip_verdict: when.aip_verdict as string,
            },
            action: r.action as RecipeTier3Action,
            reason: r.reason as string,
          };
        }),
      };
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return { valid: true, errors: [], normalized: result };
}

/**
 * Normalize a legacy recipe format (old sideband prompt) to canonical schema.
 *
 * Maps old field names:
 *   tier1.metrics → tier1.conditions
 *   condition.value → condition.threshold
 *   condition.weight → condition.signal
 *   tier1.threshold → tier1.match (converted: any numeric threshold → "any")
 *
 * Passes through already-canonical content unchanged.
 */
export function normalizeLegacyRecipe(
  raw: Record<string, unknown>,
): RecipeParsedContent {
  const result: RecipeParsedContent = {};

  if (raw.tier1 && typeof raw.tier1 === "object") {
    const t1 = raw.tier1 as Record<string, unknown>;

    // Legacy format uses "metrics" instead of "conditions"
    const conditions = (t1.conditions ?? t1.metrics) as
      | Record<string, unknown>[]
      | undefined;

    // Legacy format uses a numeric "threshold" instead of "match" mode
    let match: RecipeMatchMode = "any";
    if (t1.match === "all" || t1.match === "any") {
      match = t1.match;
    }

    if (Array.isArray(conditions)) {
      result.tier1 = {
        match,
        conditions: conditions.map((c): RecipeCondition => ({
          metric: (c.metric as string) || "",
          operator: ((c.operator as string) || "gt") as RecipeOperator,
          // Legacy uses "value", canonical uses "threshold"
          threshold: (c.threshold ?? c.value) as number | string,
          // Legacy uses "weight", canonical uses "signal"
          signal: String(c.signal ?? c.weight ?? ""),
        })),
      };
    }
  }

  if (raw.tier2 && typeof raw.tier2 === "object") {
    const t2 = raw.tier2 as Record<string, unknown>;
    const trigger = (t2.trigger as Record<string, unknown>) ?? {};
    result.tier2 = {
      trigger: {
        on_signals: trigger.on_signals as string[] | undefined,
        on_categories: trigger.on_categories as string[] | undefined,
      },
      checks: Array.isArray(t2.checks)
        ? (t2.checks as Record<string, unknown>[]).map((ch) => ({
            id: (ch.id as string) || "",
            type: (ch.type as string) || "conscience_value",
            content: (ch.content as string) || "",
          }))
        : [],
    };
  }

  if (raw.tier3 && typeof raw.tier3 === "object") {
    const t3 = raw.tier3 as Record<string, unknown>;
    if (Array.isArray(t3.rules)) {
      result.tier3 = {
        rules: (t3.rules as Record<string, unknown>[]).map((r) => {
          const when = (r.when as Record<string, unknown>) || {};
          return {
            when: {
              tier1_escalated: (when.tier1_escalated as boolean) ?? false,
              aip_verdict: (when.aip_verdict as string) || "clear",
            },
            action: ((r.action as string) || "flag") as RecipeTier3Action,
            reason: (r.reason as string) || "",
          };
        }),
      };
    }
  }

  return result;
}
