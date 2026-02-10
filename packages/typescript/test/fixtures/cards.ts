/**
 * Sample AlignmentCard fixtures for testing.
 *
 * Provides minimal, full, and forbidden-action cards
 * for use across all test files.
 */

import type { AlignmentCard } from "../../src/schemas/config.js";

/** Minimal valid card for basic tests */
export const MINIMAL_CARD: AlignmentCard = {
  card_id: "ac-test-minimal",
  values: [
    { name: "helpfulness", priority: 1 },
    { name: "safety", priority: 2 },
  ],
  autonomy_envelope: {},
};

/** Full card with all fields populated */
export const FULL_CARD: AlignmentCard = {
  card_id: "ac-test-full",
  values: [
    { name: "transparency", priority: 1, description: "Be transparent about capabilities and limitations" },
    { name: "accuracy", priority: 2, description: "Provide accurate, verified information" },
    { name: "helpfulness", priority: 3, description: "Be genuinely helpful to users" },
    { name: "safety", priority: 4, description: "Prioritize user and system safety" },
  ],
  autonomy_envelope: {
    bounded_actions: ["read_files", "write_files", "run_commands"],
    forbidden_actions: ["delete_system_files", "exfiltrate_data", "modify_security_settings"],
    escalation_triggers: [
      { condition: "action_outside_bounded_list", action: "pause_and_ask", reason: "Action not in approved list" },
      { condition: "user_data_access", action: "log_and_continue", reason: "Track data access patterns" },
    ],
  },
};

/** Card with forbidden actions for boundary testing */
export const FORBIDDEN_ACTIONS_CARD: AlignmentCard = {
  card_id: "ac-test-forbidden",
  values: [
    { name: "safety", priority: 1 },
  ],
  autonomy_envelope: {
    forbidden_actions: ["execute_shell_commands", "access_network", "modify_filesystem"],
    escalation_triggers: [
      { condition: "forbidden_action_attempted", action: "deny_and_escalate", reason: "Hard boundary violation" },
    ],
  },
};
