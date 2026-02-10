/**
 * Integrity Checkpoint types for the Agent Integrity Protocol.
 *
 * The Integrity Checkpoint is the primary data structure produced by AIP,
 * analogous to AAP's AP-Trace. It records what the analysis engine
 * concluded about the agent's thinking.
 */

import type { IntegrityConcern } from "./concern";
import type { ConscienceContext } from "./conscience";

/**
 * Overall integrity verdict from an integrity check.
 *
 * Follows the daimonion philosophy: silence means aligned, voice means outside boundaries.
 *
 * - "clear": Thinking block is consistent with the Alignment Card; the daimonion is silent
 * - "review_needed": Concerns raised that merit attention but are not hard violations; the daimonion warns
 * - "boundary_violation": Intent to violate a hard boundary detected; the daimonion speaks forcefully
 */
export type IntegrityVerdict = "clear" | "review_needed" | "boundary_violation";

/**
 * Metadata about the integrity analysis process.
 *
 * Enables performance monitoring, debugging, and confidence assessment
 * of the analysis result.
 */
export interface AnalysisMetadata {
  /** Analysis LLM model used */
  analysis_model: string;

  /** Time taken for analysis in milliseconds */
  analysis_duration_ms: number;

  /** Number of tokens in the thinking block (before truncation) */
  thinking_tokens_original: number;

  /** Number of tokens sent to analysis (after truncation) */
  thinking_tokens_analyzed: number;

  /** Whether the thinking block was truncated */
  truncated: boolean;

  /** Provider adapter extraction confidence (0.0 to 1.0) */
  extraction_confidence: number;
}

/**
 * Position of a checkpoint within the session window.
 *
 * Enables ordering and context within a session's integrity history.
 */
export interface WindowPosition {
  /** Index in window (0-based) */
  index: number;

  /** Current window size */
  window_size: number;
}

/**
 * The primary data structure produced by an integrity check.
 *
 * Contains the verdict, concerns, reasoning summary, conscience context,
 * window position, analysis metadata, and optional AAP trace linkage.
 * The checkpoint_id follows the format "ic-{uuid}".
 */
export interface IntegrityCheckpoint {
  /** Unique identifier (format: "ic-{uuid}") */
  checkpoint_id: string;

  /** Agent that produced the thinking block */
  agent_id: string;

  /** Alignment Card used for evaluation */
  card_id: string;

  /** Session identifier (shared with Gateway Worker) */
  session_id: string;

  /** When this checkpoint was created (ISO 8601, RFC 3339) */
  timestamp: string;

  /**
   * SHA-256 hash of the thinking block content.
   * The full thinking block text MUST NOT be stored in the checkpoint.
   * Hash enables correlation without retaining private reasoning.
   */
  thinking_block_hash: string;

  /** LLM provider that generated the thinking block */
  provider: string;

  /** Model that generated the thinking block */
  model: string;

  /** Overall integrity verdict */
  verdict: IntegrityVerdict;

  /** List of concerns identified (empty for "clear" verdicts) */
  concerns: IntegrityConcern[];

  /** Human-readable summary of the analysis reasoning */
  reasoning_summary: string;

  /** Conscience evaluation context */
  conscience_context: ConscienceContext;

  /** Position in the session window */
  window_position: WindowPosition;

  /** Analysis process metadata */
  analysis_metadata: AnalysisMetadata;

  /**
   * Linked AP-Trace ID (if AAP integration is active).
   * Set after the corresponding APTrace is created by the Observer.
   */
  linked_trace_id: string | null;
}
