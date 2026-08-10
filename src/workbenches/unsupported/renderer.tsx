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
  const contentLocation = asset.contentRef.path;

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
            {contentLocation}
          </p>
        </div>
      </div>
    );
  }

  const isLocalFile = asset.contentRef.kind === 'local-file';
  const messages = isLocalFile
    ? {
        missing: ['本地文件已移动或删除', '重新定位'],
        inaccessible: ['当前没有权限访问该文件', '刷新状态'],
        invalid: ['该路径不是可读取的普通文件', '重新定位'],
      }
    : {
        missing: ['资料内容不存在', '刷新状态'],
        inaccessible: ['当前无法访问该资料内容', '刷新状态'],
        invalid: ['资料内容格式无效', '刷新状态'],
      };
  const [message, action] = messages[availability];
  const canRelink =
    isLocalFile && (availability === 'missing' || availability === 'invalid');

  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-slate-300">{message}</p>
        <p className="mt-2 max-w-lg truncate text-xs text-slate-600">
          {contentLocation}
        </p>
        <button
          type="button"
          onClick={canRelink ? onRelink : onRefresh}
          className="ui-control mt-5 rounded-full border border-white/10 px-4 py-2 text-xs"
        >
          {action}
        </button>
      </div>
    </div>
  );
}

export const unsupportedRendererWorkbenchModule: RendererWorkbenchModule<
  typeof unsupportedWorkbenchManifest.id
> = {
  manifest: unsupportedWorkbenchManifest,
  View: UnsupportedWorkbenchView,
};
