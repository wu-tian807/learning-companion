import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { ProjectLearningNoteReferenceLink } from '../../../shared/project-learning-notes';
import type { LearningNoteSourceMark } from '../renderer-workbench-registry';

export function resolveLearningNoteSourceMarks(
  projectId: string,
  assetId: string,
  references: readonly ProjectLearningNoteReferenceLink[],
  attachments: readonly AssetAttachment[],
): readonly LearningNoteSourceMark[] {
  const attachmentById = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  const marks: LearningNoteSourceMark[] = [];
  const seenIds = new Set<string>();

  for (const reference of references) {
    if (
      reference.projectId !== projectId ||
      reference.assetId !== assetId
    ) {
      continue;
    }

    if ('attachmentId' in reference) {
      const attachment = attachmentById.get(reference.attachmentId);
      if (
        !attachment ||
        attachment.projectId !== projectId ||
        attachment.assetId !== assetId ||
        attachment.target.scope !== 'content'
      ) {
        continue;
      }
      const id = `attachment:${attachment.id}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      marks.push({ id, target: attachment.target });
      continue;
    }

    const id = `legacy:${JSON.stringify(reference.target)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    marks.push({ id, target: reference.target });
  }

  return Object.freeze(marks);
}
