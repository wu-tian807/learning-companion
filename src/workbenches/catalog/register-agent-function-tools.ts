import type { AgentFunctionToolRegistryApi } from '../../main/agents/function-tools/agent-function-tool-registry';
import type { AgentToolRequirement } from '../../main/generation/contracts/task-definition';
import {
  PDF_READ_FUNCTION_TOOL_ID,
  pdfFunctionTool,
} from '../pdf/agent/pdf-function-tool';

export interface WorkbenchAgentFunctionToolRegistration {
  readonly defaultToolRequirements: readonly AgentToolRequirement[];
}

/**
 * Registers Agent tools contributed by built-in Workbench features.
 *
 * A feature owns its implementation; this catalog is only the application
 * composition point. Future tools backed by optional external libraries can
 * register conditionally while keeping Provider adapters unaware of them.
 */
export function registerWorkbenchAgentFunctionTools(
  registry: AgentFunctionToolRegistryApi,
): WorkbenchAgentFunctionToolRegistration {
  registry.register(pdfFunctionTool);

  return Object.freeze({
    defaultToolRequirements: Object.freeze([
      Object.freeze({
        id: PDF_READ_FUNCTION_TOOL_ID,
        availability: 'required' as const,
      }),
    ]),
  });
}
