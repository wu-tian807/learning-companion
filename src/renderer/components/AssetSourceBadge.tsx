import type { AssetContentRef } from '../../shared/assets';
import { assetSourceBadgeLabel } from '../asset-view';

interface AssetSourceBadgeProps {
  readonly contentRef: AssetContentRef;
}

export function AssetSourceBadge({
  contentRef,
}: AssetSourceBadgeProps) {
  const label = assetSourceBadgeLabel(contentRef);

  if (!label) {
    return null;
  }

  return (
    <span
      title="此 Asset 链接到 Project 工作区之外的本地文件"
      className="shrink-0 rounded-full border border-sky-300/15 bg-sky-300/[0.07] px-1.5 py-px text-[9px] leading-3 text-sky-200/70"
    >
      {label}
    </span>
  );
}
