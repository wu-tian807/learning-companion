import type { ResolvedAssetContent } from '../../main/content/content-ref';
import { AppError } from '../../main/errors/app-error';

/**
 * Returns the revision of the underlying video bytes.
 *
 * Asset.updatedTime also changes when an Attachment is added, so it cannot be
 * used to decide whether a captured frame still belongs to the current file.
 */
export function videoContentRevision(
  content: Pick<ResolvedAssetContent, 'observedUpdatedTime'>,
): string {
  if (
    !Number.isSafeInteger(content.observedUpdatedTime) ||
    Number(content.observedUpdatedTime) < 0
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error('视频文件缺少稳定的内容修改时间'),
    });
  }

  return String(content.observedUpdatedTime);
}
