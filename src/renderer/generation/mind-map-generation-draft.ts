export interface MindMapGenerationDraft {
  readonly projectId: string;
  readonly sourceAssetIds: readonly string[];
  readonly additionalInstructions?: string;
}

export interface CreateMindMapGenerationDraftInput {
  readonly projectId: string;
  readonly sourceAssetIds: readonly string[];
  readonly additionalInstructions?: string;
}

export function createMindMapGenerationDraft({
  projectId,
  sourceAssetIds,
  additionalInstructions,
}: CreateMindMapGenerationDraftInput): MindMapGenerationDraft {
  const normalizedProjectId = projectId.trim();
  const normalizedSourceAssetIds = Array.from(new Set(sourceAssetIds));
  const normalizedInstructions = additionalInstructions?.trim();

  if (normalizedProjectId.length === 0) {
    throw new Error('Mind Map 生成缺少 Project ID');
  }

  if (normalizedSourceAssetIds.length === 0) {
    throw new Error('Mind Map 生成至少需要一份来源资料');
  }

  return {
    projectId: normalizedProjectId,
    sourceAssetIds: normalizedSourceAssetIds,
    ...(normalizedInstructions
      ? { additionalInstructions: normalizedInstructions }
      : {}),
  };
}
