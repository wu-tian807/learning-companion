import {
  createProjectLearningNoteAttachmentHref,
} from '../../shared/project-learning-notes';
import type { AssetAttachment } from '../../shared/attachments/contracts';
import type { AssetTarget } from '../../shared/workbench/asset-target';

const LINK_LABEL_EXCERPT_LENGTH = 80;

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/[\\[\]]/gu, (character) => `\\${character}`);
}

function normalizeExcerpt(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, ' ').trim();
  if (!normalized) return undefined;
  const characters = Array.from(normalized);
  return characters.slice(0, LINK_LABEL_EXCERPT_LENGTH).join('') +
    (characters.length > LINK_LABEL_EXCERPT_LENGTH ? '…' : '');
}

function quoteFromTarget(target: AssetTarget): string | undefined {
  if (target.scope !== 'content') return undefined;
  const rawPayload: unknown = target.targetPayload;
  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    Array.isArray(rawPayload)
  ) {
    return undefined;
  }
  const payload = rawPayload as Readonly<Record<string, unknown>>;
  const quote = payload.quote;
  if (typeof quote === 'object' && quote !== null && !Array.isArray(quote)) {
    const exact = (quote as Readonly<Record<string, unknown>>).exact;
    if (typeof exact === 'string') return exact;
  }
  if (typeof payload.exact === 'string') return payload.exact;
  if (Array.isArray(payload.ranges)) {
    for (const range of payload.ranges) {
      if (typeof range !== 'object' || range === null || Array.isArray(range)) {
        continue;
      }
      const exact = (range as Readonly<Record<string, unknown>>).exact;
      if (typeof exact === 'string') return exact;
    }
  }
  return undefined;
}

function attachmentKindLabel(typeId: string): string {
  if (typeId.includes('reading-note')) return '阅读笔记';
  if (typeId.includes('explanation') || typeId === 'ai.annotation') {
    return 'AI 解释';
  }
  return 'Attachment';
}

export function projectLearningNoteAttachmentOptionLabel(
  attachment: AssetAttachment,
): string {
  const excerpt = normalizeExcerpt(quoteFromTarget(attachment.target));
  const kind = attachmentKindLabel(attachment.typeId);
  return excerpt ? `${kind} · “${excerpt}”` : `${kind} · ${attachment.typeId}`;
}

export function createLearningNoteAttachmentMarkdown(
  assetName: string,
  attachment: AssetAttachment,
): string {
  const label = escapeMarkdownLinkLabel(`${assetName} · 定位`);
  const href = createProjectLearningNoteAttachmentHref({
    projectId: attachment.projectId,
    assetId: attachment.assetId,
    attachmentId: attachment.id,
  });
  return `[${label}](${href})`;
}
