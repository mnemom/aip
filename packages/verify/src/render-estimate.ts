/**
 * The render-estimate rule (criterion K4.4, design decision T8).
 *
 * The savings estimate stays off every rendering until the estimator gives a
 * conservative net lower bound. Today's estimator overstates: it uses median
 * benchmark savings, starts counting at 60k tokens, does not subtract μ, and
 * never shows a loss. `estimateQualifies` is the registry's rule written as a
 * pure function over the estimator's self-description, so a renderer and the
 * verifier reach the same answer. Even when it qualifies, the estimate never
 * appears on a PR comment or a share card.
 */

import { ESTIMATE_FORBIDDEN_SURFACES, SURFACES, type Surface } from "./claim-table.js";

/** Tokens above which the gateway's context work is counted (the 200k line). */
export const ESTIMATE_COUNTING_FLOOR_TOKENS = 200_000;

export interface EstimateDescription {
  /** How the per-request saving is derived. Only a lower bound qualifies. */
  method: "lower_bound" | "median" | "mean" | string;
  /** Tokens from which the estimator starts counting. Must be at least the 200k line. */
  counting_floor_tokens: number;
  /** True when μ is subtracted from the gross saving. */
  net_of_mu: boolean;
  /** True when the estimator reports a loss as a negative figure rather than clamping at zero. */
  reports_loss: boolean;
  /** The net lower bound itself, in the same currency as model cost. */
  net_lower_bound?: number;
  [k: string]: unknown;
}

export const ESTIMATE_DISQUALIFIERS = {
  not_an_object: "not_an_object",
  method_not_lower_bound: "method_not_lower_bound",
  counting_floor_below_200k: "counting_floor_below_200k",
  not_net_of_mu: "not_net_of_mu",
  never_shows_loss: "never_shows_loss",
  value_not_finite: "value_not_finite",
} as const;

export type EstimateDisqualifier = (typeof ESTIMATE_DISQUALIFIERS)[keyof typeof ESTIMATE_DISQUALIFIERS];

export interface EstimateQualification {
  qualifies: boolean;
  reasons: EstimateDisqualifier[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The registry's `estimate_qualifies` rule: a conservative net lower bound. */
export function estimateQualifies(estimate: unknown): EstimateQualification {
  if (!isObject(estimate)) return { qualifies: false, reasons: [ESTIMATE_DISQUALIFIERS.not_an_object] };
  const reasons: EstimateDisqualifier[] = [];
  if (estimate.method !== "lower_bound") reasons.push(ESTIMATE_DISQUALIFIERS.method_not_lower_bound);
  const floor = estimate.counting_floor_tokens;
  if (typeof floor !== "number" || !Number.isFinite(floor) || floor < ESTIMATE_COUNTING_FLOOR_TOKENS) {
    reasons.push(ESTIMATE_DISQUALIFIERS.counting_floor_below_200k);
  }
  if (estimate.net_of_mu !== true) reasons.push(ESTIMATE_DISQUALIFIERS.not_net_of_mu);
  if (estimate.reports_loss !== true) reasons.push(ESTIMATE_DISQUALIFIERS.never_shows_loss);
  if (typeof estimate.net_lower_bound !== "number" || !Number.isFinite(estimate.net_lower_bound)) {
    reasons.push(ESTIMATE_DISQUALIFIERS.value_not_finite);
  }
  return { qualifies: reasons.length === 0, reasons };
}

export const RENDER_ESTIMATE_REASONS = {
  unknown_surface: "unknown_surface",
  surface_never_shows_estimate: "surface_never_shows_estimate",
  estimate_does_not_qualify: "estimate_does_not_qualify",
} as const;

export interface RenderEstimateDecision {
  render: boolean;
  reasons: string[];
}

/**
 * Whether a rendering on `surface` may show the estimate. False on a PR
 * comment or any card regardless of the estimate; otherwise the registry's
 * rule decides. A missing estimate never renders.
 */
export function shouldRenderEstimate(estimate: unknown, surface: unknown): RenderEstimateDecision {
  if (!(SURFACES as readonly unknown[]).includes(surface)) {
    return { render: false, reasons: [RENDER_ESTIMATE_REASONS.unknown_surface] };
  }
  if (ESTIMATE_FORBIDDEN_SURFACES.includes(surface as Surface)) {
    return { render: false, reasons: [RENDER_ESTIMATE_REASONS.surface_never_shows_estimate] };
  }
  const q = estimateQualifies(estimate);
  if (!q.qualifies) {
    return { render: false, reasons: [RENDER_ESTIMATE_REASONS.estimate_does_not_qualify, ...q.reasons] };
  }
  return { render: true, reasons: [] };
}
