/**
 * Integrity drift detection for the Agent Integrity Protocol.
 *
 * Monitors the pattern of integrity verdicts over a session and raises
 * an IntegrityDriftAlert when consecutive non-clear verdicts exceed
 * the sustained checks threshold (SPEC Section 9.1).
 */

import type { IntegrityCheckpoint } from "../schemas/checkpoint.js";
import type { IntegrityDriftAlert, DriftDirection } from "../schemas/drift-alert.js";
import type { ConcernCategory } from "../schemas/concern.js";
import {
  DEFAULT_SUSTAINED_CHECKS_THRESHOLD,
  DRIFT_SEVERITY_LOW_THRESHOLD,
  DRIFT_SEVERITY_MEDIUM_THRESHOLD,
  DRIFT_ALERT_ID_PREFIX,
} from "../constants.js";
import { randomUUID } from "node:crypto";

/** Mutable state for tracking drift within a session */
export interface DriftState {
  /** Count of consecutive non-clear verdicts */
  sustainedNonclear: number;
  /** Whether an alert has been fired for the current streak */
  alertFired: boolean;
  /** Checkpoint IDs in the current non-clear streak */
  streakCheckpointIds: string[];
  /** Concern categories in the current non-clear streak */
  streakCategories: ConcernCategory[];
}

/** Create fresh drift state */
export function createDriftState(): DriftState {
  return {
    sustainedNonclear: 0,
    alertFired: false,
    streakCheckpointIds: [],
    streakCategories: [],
  };
}

/**
 * Update drift state with a new checkpoint and optionally produce a drift alert.
 *
 * Algorithm (SPEC Section 9.1):
 * 1. If verdict === "clear": reset sustainedNonclear to 0, alertFired to false, clear streak
 * 2. If verdict !== "clear": increment sustainedNonclear, record checkpoint ID, collect concern categories
 * 3. When sustainedNonclear >= threshold (default 3) AND !alertFired:
 *    - Generate IntegrityDriftAlert
 *    - Set alertFired = true (no more alerts until streak resets)
 * 4. Compute integrity_similarity from window checkpoints (clear_count / total)
 * 5. Derive severity from integrity_similarity:
 *    - >= 0.7: "low"
 *    - >= 0.4: "medium"
 *    - < 0.4: "high"
 * 6. Infer drift_direction from dominant ConcernCategory in streak:
 *    - majority prompt_injection -> "injection_pattern"
 *    - majority value_misalignment -> "value_erosion"
 *    - majority autonomy_violation -> "autonomy_creep"
 *    - majority deceptive_reasoning -> "deception_pattern"
 *    - no majority -> "unknown"
 *
 * Returns the updated DriftState and optionally an IntegrityDriftAlert (null if no alert).
 */
export function detectIntegrityDrift(
  state: DriftState,
  checkpoint: IntegrityCheckpoint,
  windowCheckpoints: IntegrityCheckpoint[],
  threshold?: number,
): { state: DriftState; alert: IntegrityDriftAlert | null } {
  const effectiveThreshold = threshold ?? DEFAULT_SUSTAINED_CHECKS_THRESHOLD;

  // Clone state to avoid mutation
  const newState: DriftState = {
    sustainedNonclear: state.sustainedNonclear,
    alertFired: state.alertFired,
    streakCheckpointIds: [...state.streakCheckpointIds],
    streakCategories: [...state.streakCategories],
  };

  if (checkpoint.verdict === "clear") {
    // Reset streak
    newState.sustainedNonclear = 0;
    newState.alertFired = false;
    newState.streakCheckpointIds = [];
    newState.streakCategories = [];
    return { state: newState, alert: null };
  }

  // Non-clear verdict — extend streak
  newState.sustainedNonclear++;
  newState.streakCheckpointIds.push(checkpoint.checkpoint_id);
  for (const concern of checkpoint.concerns) {
    newState.streakCategories.push(concern.category);
  }

  // Check if threshold crossed and no alert fired yet
  if (newState.sustainedNonclear >= effectiveThreshold && !newState.alertFired) {
    newState.alertFired = true;

    // Compute integrity_similarity from window
    const clearCount = windowCheckpoints.filter(
      (cp) => cp.verdict === "clear",
    ).length;
    const totalCount = windowCheckpoints.length;
    const integritySimilarity = totalCount > 0 ? clearCount / totalCount : 0;

    // Derive severity
    let severity: "low" | "medium" | "high";
    if (integritySimilarity >= DRIFT_SEVERITY_LOW_THRESHOLD) {
      severity = "low";
    } else if (integritySimilarity >= DRIFT_SEVERITY_MEDIUM_THRESHOLD) {
      severity = "medium";
    } else {
      severity = "high";
    }

    // Infer direction from dominant category
    const direction = inferDriftDirection(newState.streakCategories);

    const alert: IntegrityDriftAlert = {
      alert_id: `${DRIFT_ALERT_ID_PREFIX}${randomUUID()}`,
      agent_id: checkpoint.agent_id,
      session_id: checkpoint.session_id,
      checkpoint_ids: [...newState.streakCheckpointIds],
      integrity_similarity: integritySimilarity,
      sustained_checks: newState.sustainedNonclear,
      alert_type: "informative",
      severity,
      drift_direction: direction,
      message: `${newState.sustainedNonclear} consecutive integrity concerns detected. Dominant pattern: ${direction}. Integrity ratio: ${(integritySimilarity * 100).toFixed(0)}%.`,
      detection_timestamp: new Date().toISOString(),
    };

    return { state: newState, alert };
  }

  return { state: newState, alert: null };
}

/** Infer drift direction from the dominant concern category in the streak */
function inferDriftDirection(categories: ConcernCategory[]): DriftDirection {
  if (categories.length === 0) return "unknown";

  const counts = new Map<ConcernCategory, number>();
  for (const cat of categories) {
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  let maxCategory: ConcernCategory | null = null;
  let maxCount = 0;
  for (const [cat, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxCategory = cat;
    }
  }

  // Must be strict majority (> 50%)
  if (maxCategory && maxCount > categories.length / 2) {
    const CATEGORY_TO_DIRECTION: Record<string, DriftDirection> = {
      prompt_injection: "injection_pattern",
      value_misalignment: "value_erosion",
      autonomy_violation: "autonomy_creep",
      deceptive_reasoning: "deception_pattern",
    };
    return CATEGORY_TO_DIRECTION[maxCategory] ?? "unknown";
  }

  return "unknown";
}
