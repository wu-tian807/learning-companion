import { expect, it, vi } from 'vitest';
import { WorkbenchConversationContextProviderRegistry } from './workbench-conversation-context-provider-registry';
import type { WorkbenchConversationContextProvider, WorkbenchConversationMaterialsContext } from './workbench-conversation-context-provider';
import { createTextAgentUserMessage } from '../generation/contracts/agent-message';

it('rejects a material-only entry in the ordinary conversation registry', () => {
  const registry = new WorkbenchConversationContextProviderRegistry();
  expect(() => registry.register({ id: 'test.materials', prepareMaterials: vi.fn() } as unknown as WorkbenchConversationContextProvider)).toThrow('REGISTRATION_CONFLICT');
});

it('requires the declared material capability and preserves its owning instance', async () => {
  const registry = new WorkbenchConversationContextProviderRegistry();
  const prepare = vi.fn();
  registry.register({ id: 'test.ordinary', prepare });
  expect(() => registry.requireMaterials('test.ordinary')).toThrow('FEATURE_NOT_SUPPORTED');
  const provider = {
    id: 'test.materials', prepare,
    async prepareMaterials() { return { userMessage: createTextAgentUserMessage(this.id), toolRequirements: [] }; },
  };
  registry.register(provider);
  const context: WorkbenchConversationMaterialsContext = {
    taskId: 'task-1', projectId: 'project-1', question: 'question',
    workspaces: { primary: { key: 'test', instanceKey: 'task-1', path: '/workspace', permissions: { read: true, write: false } }, secondary: [] },
    assetReferences: {}, reportStatus: vi.fn(),
  };
  const materials = await registry.requireMaterials(provider.id).prepareMaterials(context);
  expect(materials.userMessage).toEqual(createTextAgentUserMessage(provider.id));
  expect(prepare).not.toHaveBeenCalled();
});
