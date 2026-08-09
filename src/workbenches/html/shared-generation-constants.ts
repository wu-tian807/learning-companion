/**
 * Shared constants for the HTML assistant generation capability.
 *
 * Re-exports the canonical definition IDs and instruction format identifiers
 * from `shared/generation-definitions` so workbench-local code never hardcodes
 * them. Mirrors the Mind Map generation module's pattern.
 */
export {
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
  HTML_ASSISTANT_INSTRUCTION_FORMAT,
  HTML_ASSISTANT_INSTRUCTION_VERSION,
} from '../../shared/generation-definitions';
