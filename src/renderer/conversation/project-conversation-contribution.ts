import { PROJECT_CONVERSATION_CONTEXT_PROVIDER_ID } from '../../shared/workbench-conversation';
import type { WorkbenchConversationContribution } from './conversation-contracts';

export const PROJECT_CONVERSATION_OWNER_ID = 'project.conversation';

export function createProjectConversationContribution(): WorkbenchConversationContribution {
  return Object.freeze({
    id: PROJECT_CONVERSATION_OWNER_ID,
    workbenchId: 'project',
    contextProviderId: PROJECT_CONVERSATION_CONTEXT_PROVIDER_ID,
    title: 'AI 问答',
    emptyLabel:
      '围绕当前 Project 开始提问；Workbench 中选择的内容会作为可选上下文附加。',
    inputPlaceholder: '输入问题…（Enter 发送 / Shift+Enter 换行）',
  });
}
