/**
 * Default recovery limits for recover_context / boot.ts.
 * FEAT-015 will replace these with DB-driven values from recovery_config table.
 */
export const RECOVERY_LIMITS = {
  task_states: 3,   // in_progress 1 + completed 2
  decisions: 5,
  knowledge: 5,
  messages: 10,
};
