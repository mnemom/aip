import type { IntegrityCheckpoint } from "../schemas/checkpoint.js";

/** Current state of the session window */
export interface WindowState {
  checkpoints: IntegrityCheckpoint[];
  size: number;
  session_id: string;
  stats: {
    total_checks: number; // Including evicted
    clear_count: number; // In current window only
    review_count: number; // In current window only
    violation_count: number; // In current window only
    avg_analysis_ms: number; // Average across current window
  };
}

export function createWindowState(sessionId: string): WindowState {
  return {
    checkpoints: [],
    size: 0,
    session_id: sessionId,
    stats: {
      total_checks: 0,
      clear_count: 0,
      review_count: 0,
      violation_count: 0,
      avg_analysis_ms: 0,
    },
  };
}
