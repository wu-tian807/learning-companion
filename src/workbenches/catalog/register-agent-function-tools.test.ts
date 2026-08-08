import { describe, expect, it } from 'vitest';

import { AgentFunctionToolRegistry } from '../../main/agents/function-tools/agent-function-tool-registry';
import { PDF_READ_FUNCTION_TOOL_ID } from '../pdf/agent/pdf-function-tool';
import { registerWorkbenchAgentFunctionTools } from './register-agent-function-tools';

describe('registerWorkbenchAgentFunctionTools', () => {
  it('registers PDF capability through the shared Registry and declares it as a default', () => {
    const registry = new AgentFunctionToolRegistry();
    const registration = registerWorkbenchAgentFunctionTools(registry);

    expect(registry.list().map(({ id }) => id)).toEqual([
      PDF_READ_FUNCTION_TOOL_ID,
    ]);
    expect(registration.defaultToolRequirements).toEqual([
      {
        id: PDF_READ_FUNCTION_TOOL_ID,
        availability: 'required',
      },
    ]);
  });
});
