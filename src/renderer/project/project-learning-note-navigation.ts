import type { AssetAttachment } from '../../shared/attachments/contracts';
import type { ProjectLearningNoteReferenceLink } from '../../shared/project-learning-notes';
import type { AssetTarget } from '../../shared/workbench/asset-target';

export interface ResolvedProjectLearningNoteReference {
  readonly assetId: string;
  readonly target: AssetTarget;
  readonly sourceRevision?: string;
}

export async function resolveProjectLearningNoteReference(
  projectId: string,
  link: ProjectLearningNoteReferenceLink,
  listAttachments: (request: {
    readonly projectId: string;
    readonly assetId: string;
  }) => Promise<readonly AssetAttachment[]>,
  signal: AbortSignal,
): Promise<ResolvedProjectLearningNoteReference> {
  if (link.projectId !== projectId) {
    throw new Error('这条资料引用不属于当前 Project。');
  }
  if (signal.aborted) throw signal.reason;
  if (!('attachmentId' in link)) {
    return {
      assetId: link.assetId,
      target: link.target,
      sourceRevision: link.sourceRevision,
    };
  }

  const attachments = await listAttachments({
    projectId,
    assetId: link.assetId,
  });
  if (signal.aborted) throw signal.reason;
  const attachment = attachments.find(
    (candidate) => candidate.id === link.attachmentId,
  );
  if (
    !attachment ||
    attachment.projectId !== projectId ||
    attachment.assetId !== link.assetId
  ) {
    throw new Error('引用的标注已被删除，无法定位原文。');
  }
  return {
    assetId: attachment.assetId,
    target: attachment.target,
  };
}
