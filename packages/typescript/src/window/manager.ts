import type { IntegrityCheckpoint } from "../schemas/checkpoint.js";
import type { WindowConfig } from "../schemas/config.js";
import type { WindowSummary } from "../schemas/signal.js";
import type { WindowState } from "./state.js";
import { createWindowState } from "./state.js";
import { MIN_WINDOW_SIZE } from "../constants.js";

export class WindowManager {
  private state: WindowState;
  private readonly config: WindowConfig;

  constructor(config: WindowConfig, sessionId: string) {
    if (config.max_size < MIN_WINDOW_SIZE) {
      throw new Error(
        `Window max_size must be >= ${MIN_WINDOW_SIZE}, got ${config.max_size}`
      );
    }
    this.config = config;
    this.state = createWindowState(sessionId);
  }

  /** Add a checkpoint to the window. Handles eviction per mode. */
  push(checkpoint: IntegrityCheckpoint): void {
    // 1. Check session boundary
    if (checkpoint.session_id !== this.state.session_id) {
      if (this.config.session_boundary === "reset") {
        this.reset();
      }
      this.state.session_id = checkpoint.session_id;
    }

    // 2. Evict stale checkpoints (older than max_age_seconds)
    this.evictStale();

    // 3. If at max_size, handle eviction per mode
    if (this.state.checkpoints.length >= this.config.max_size) {
      if (this.config.mode === "sliding") {
        this.state.checkpoints.shift();
      } else {
        // fixed mode: reset entirely, then insert
        this.state.checkpoints = [];
      }
    }

    // 4. Push checkpoint, increment total_checks
    this.state.checkpoints.push(checkpoint);
    this.state.stats.total_checks++;

    // 5. Recompute window stats
    this.recomputeStats();
  }

  /** Format window for conscience prompt (numbered verdict list) */
  getContext(): string {
    if (this.state.checkpoints.length === 0) {
      return "SESSION CONTEXT: First check in session (no prior context)";
    }
    const lines = this.state.checkpoints.map(
      (cp, i) => `${i + 1}. [${cp.verdict}] ${cp.reasoning_summary}`
    );
    return `SESSION CONTEXT (window: ${this.state.size}/${this.config.max_size}):\n${lines.join("\n")}`;
  }

  /** Clear all checkpoints and reset statistics */
  reset(): void {
    this.state.checkpoints = [];
    this.state.size = 0;
    this.state.stats.total_checks = 0;
    this.state.stats.clear_count = 0;
    this.state.stats.review_count = 0;
    this.state.stats.violation_count = 0;
    this.state.stats.avg_analysis_ms = 0;
  }

  /** Get WindowSummary for IntegritySignal */
  getSummary(): WindowSummary {
    const verdicts = { clear: 0, review_needed: 0, boundary_violation: 0 };
    for (const cp of this.state.checkpoints) {
      verdicts[cp.verdict]++;
    }
    return {
      size: this.state.size,
      max_size: this.config.max_size,
      verdicts,
      integrity_ratio:
        this.state.size > 0 ? verdicts.clear / this.state.size : 1.0,
      drift_alert_active: false, // Set externally by drift detection
    };
  }

  /** Get full window state (for SDK getWindowState()) */
  getState(): WindowState {
    return { ...this.state, checkpoints: [...this.state.checkpoints] };
  }

  /** Get current session ID */
  getSessionId(): string {
    return this.state.session_id;
  }

  /** Evict checkpoints older than max_age_seconds */
  private evictStale(): void {
    const now = Date.now();
    const maxAgeMs = this.config.max_age_seconds * 1000;
    this.state.checkpoints = this.state.checkpoints.filter(
      (cp) => now - Date.parse(cp.timestamp) <= maxAgeMs
    );
  }

  /** Recompute window-level stats from current checkpoints */
  private recomputeStats(): void {
    const cps = this.state.checkpoints;
    this.state.size = cps.length;
    this.state.stats.clear_count = 0;
    this.state.stats.review_count = 0;
    this.state.stats.violation_count = 0;

    let totalMs = 0;
    for (const cp of cps) {
      switch (cp.verdict) {
        case "clear":
          this.state.stats.clear_count++;
          break;
        case "review_needed":
          this.state.stats.review_count++;
          break;
        case "boundary_violation":
          this.state.stats.violation_count++;
          break;
      }
      totalMs += cp.analysis_metadata.analysis_duration_ms;
    }
    this.state.stats.avg_analysis_ms =
      cps.length > 0 ? totalMs / cps.length : 0;
  }
}
