import {
  cloneAgentUserMessage,
  type AgentUserMessage,
} from '../contracts/agent-message';
import type { PreparedGenerationAssetReferenceBindings } from '../contracts/generation-asset-reference';

function createAssetReferencePrompt(
  bindings: PreparedGenerationAssetReferenceBindings,
): string {
  const sections = Object.entries(bindings).map(([slot, references]) => [
    `[${slot}]`,
    ...references.map((reference) => {
      const materializedMediaType =
        reference.materializedMediaType ?? reference.mediaType;
      return [
        `- alias=${JSON.stringify(reference.alias)}`,
        `name=${JSON.stringify(reference.name)}`,
        `mediaType=${JSON.stringify(reference.mediaType)}`,
        `materializedMediaType=${JSON.stringify(materializedMediaType)}`,
        `path=${JSON.stringify(reference.relativePath)}`,
      ].join('; ');
    }),
  ]);

  return [
    '参考资料已复制到主工作区。只能使用下面列出的相对路径读取资料，并在 TaskDefinition 要求生成的工作区文件中使用对应 alias 表达来源：',
    ...sections.flat(),
  ].join('\n');
}

export function appendAssetReferencesToUserMessage(
  message: AgentUserMessage,
  bindings: PreparedGenerationAssetReferenceBindings,
): AgentUserMessage {
  const cloned = cloneAgentUserMessage(message);

  return Object.freeze({
    role: 'user' as const,
    content: Object.freeze([
      ...cloned.content,
      Object.freeze({
        type: 'text' as const,
        text: createAssetReferencePrompt(bindings),
      }),
    ]),
  });
}
