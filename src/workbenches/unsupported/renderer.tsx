import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import {
  isUnsupportedWorkbenchPayload,
  unsupportedWorkbenchManifest,
} from './shared';

export function UnsupportedWorkbenchView({
  asset,
  bootstrap,
  onRelink,
  onRefresh,
}: RendererWorkbenchViewProps) {
  const availability = bootstrap.availability;

  if (availability === 'available') {
    const payload = isUnsupportedWorkbenchPayload(bootstrap.payload)
      ? bootstrap.payload
      : undefined;
    const message =
      payload?.reason === 'missing-capability'
        ? '当前工作台无法读取此资料'
        : '暂不支持渲染此类型';

    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-sm font-medium text-slate-300">{message}</p>
          <p className="mt-2 max-w-lg truncate text-xs text-slate-600">
            {asset.contentLocator.path}
          </p>
        </div>
      </div>
    );
  }

  const messages = {
    missing: ['本地文件已移动或删除', '重新定位'],
    inaccessible: ['当前没有权限访问该文件', '刷新状态'],
    invalid: ['该路径不是可读取的普通文件', '重新定位'],
  } as const;
  const [message, action] = messages[availability];

  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-slate-300">{message}</p>
        <p className="mt-2 max-w-lg truncate text-xs text-slate-600">
          {asset.contentLocator.path}
        </p>
        <button
          type="button"
          onClick={availability === 'inaccessible' ? onRefresh : onRelink}
          className="ui-control mt-5 rounded-full border border-white/10 px-4 py-2 text-xs"
        >
          {action}
        </button>
      </div>
    </div>
  );
}

export const unsupportedRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: unsupportedWorkbenchManifest,
  View: UnsupportedWorkbenchView,
};
