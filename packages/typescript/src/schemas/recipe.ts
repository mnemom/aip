/**
 * Detection Recipe schema types.
 *
 * Canonical type definitions for the detection recipe engine.
 * The gateway evaluates recipes at runtime; the sideband analyzer generates them.
 * This module is the single source of truth for both.
 */

// ---------------------------------------------------------------------------
// String unions
// ---------------------------------------------------------------------------

export type RecipeOperator =
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "eq"
  | "neq"
  | "matches"
  | "contains";

export type RecipeSeverity = "low" | "medium" | "high" | "critical";

export type RecipeScope = "arena_only" | "canary" | "production";

export type RecipeMatchMode = "any" | "all";

export type RecipeTier3Action =
  | "override_to_review"
  | "flag"
  | "block"
  | "escalate"
  | "log";

// ---------------------------------------------------------------------------
// Tier 1 — heuristic prefilter (no LLM)
// ---------------------------------------------------------------------------

export interface RecipeCondition {
  metric: string;
  operator: RecipeOperator;
  threshold: number | string;
  signal: string;
}

export interface RecipeTier1 {
  match: RecipeMatchMode;
  conditions: RecipeCondition[];
}

// ---------------------------------------------------------------------------
// Tier 2 — conscience check injection
// ---------------------------------------------------------------------------

export interface RecipeTier2Trigger {
  on_signals?: string[];
  on_categories?: string[];
}

export interface RecipeTier2Check {
  id: string;
  type: string;
  content: string;
}

export interface RecipeTier2 {
  trigger: RecipeTier2Trigger;
  checks: RecipeTier2Check[];
}

// ---------------------------------------------------------------------------
// Tier 3 — verdict override rules
// ---------------------------------------------------------------------------

export interface RecipeTier3When {
  tier1_escalated: boolean;
  aip_verdict: string;
}

export interface RecipeTier3Rule {
  when: RecipeTier3When;
  action: RecipeTier3Action;
  reason: string;
}

export interface RecipeTier3 {
  rules: RecipeTier3Rule[];
}

// ---------------------------------------------------------------------------
// Top-level recipe types
// ---------------------------------------------------------------------------

export interface RecipeParsedContent {
  tier1?: RecipeTier1;
  tier2?: RecipeTier2;
  tier3?: RecipeTier3;
}

export interface DetectionRecipe {
  id: string;
  version: number;
  technique_category: string;
  technique_ids: string[];
  severity: RecipeSeverity;
  scope: RecipeScope;
  has_tier1: boolean;
  has_tier2: boolean;
  has_tier3: boolean;
  parsed_content: RecipeParsedContent;
}
