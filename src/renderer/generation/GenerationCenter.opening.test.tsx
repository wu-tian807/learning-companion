// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createProjectWorkspaceContentRef, type AssetSnapshot } from '../../shared/assets';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import { AssetSelectionCoordinatorProvider } from '../project/AssetSelectionCoordinatorProvider';
import type { AssetSelection } from '../project/use-asset-selection';
import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchOpenCoordinator } from '../workbench/workbench-open-coordinator';
import { LEARNING_OUTLINE_ASSET_MEDIA_TYPE, LEARNING_OUTLINE_INTAKE_MODE_ID } from '../../workbenches/learning-outline/shared';
import { GenerationCenter } from './GenerationCenter';

it('releases creation after a cancelled open and retries the existing result without creating another draft', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const asset: AssetSnapshot = {
    id: 'outline-1', projectId: 'project-1', name: '学习大纲', mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
    creationKind: 'generated', contentRef: createProjectWorkspaceContentRef('outline.outline'),
    createdTime: 1, updatedTime: 1, contentStatus: { availability: 'available', checkedTime: 1 },
  };
  const source: AssetSnapshot = { ...asset, id: 'mindmap-1', name: '测试导图', mediaType: MIND_MAP_ASSET_MEDIA_TYPE };
  const invoke = vi.fn(async () => ({ asset, conversation: {
    id: 'conversation-1', title: '新对话', messages: [], createdTime: 1, updatedTime: 1,
    modeId: LEARNING_OUTLINE_INTAKE_MODE_ID, boundAssetId: asset.id,
  } }));
  Object.defineProperty(window, 'learningCompanion', { configurable: true, value: { invokeWorkbenchAction: invoke } });
  const selection = (scope: AssetSelection['scope']): AssetSelection => ({
    scope, active: false, selectedAssetIds: new Set(), selectedAssets: [], allSelected: false,
    enter: vi.fn(), exit: vi.fn(), toggle: vi.fn(), toggleAll: vi.fn(), replace: vi.fn(),
  });
  const opening = new WorkbenchOpenCoordinator('project-1');
  const onOpen = vi.fn(async (result) => {
    expect(result).toMatchObject({ asset, conversation: {
      conversationId: 'conversation-1', modeId: LEARNING_OUTLINE_INTAKE_MODE_ID, boundAssetId: asset.id,
    } });
    await opening.waitFor(result.asset.id);
  });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
    expect(button).toBeDefined(); expect(button.disabled).toBe(false);
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(
      <WorkbenchRuntimeProvider onError={vi.fn()}>
        <AssetSelectionCoordinatorProvider coordinator={{ activeScope: null, imported: selection('imported'), generated: selection('generated'), clear: vi.fn() }}>
          <GenerationCenter projectId="project-1" state={{ kind: 'ready', assets: [source] }} selectedAssetId={null}
            busy={false} now={1} mediaLabel={(type) => type} onRetry={vi.fn()} onSelect={vi.fn()}
            onRemoveSelected={vi.fn()} onRename={vi.fn()} onReveal={vi.fn()} onRelink={vi.fn()} onDelete={vi.fn()}
            onRevealSources={vi.fn()} onGenerationToolResult={onOpen} onError={vi.fn()} />
        </AssetSelectionCoordinatorProvider>
      </WorkbenchRuntimeProvider>,
    ));
    await act(async () => container.querySelector<HTMLButtonElement>('button[data-generation-tool="study-outline"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[role="radio"]')!.click());
    await click('创建大纲并开始沟通');
    expect(invoke).toHaveBeenCalledOnce(); expect(onOpen).toHaveBeenCalledOnce();
    await act(async () => opening.cancelExcept('another-asset'));
    expect(container.textContent).toContain('内容已创建，但需求会话尚未打开');
    await click('重新打开');
    expect(onOpen).toHaveBeenCalledTimes(2); expect(invoke).toHaveBeenCalledOnce();
    await act(async () => {
      const lease = { projectId: 'project-1', assetId: asset.id, attempt: Symbol() };
      opening.report({ ...lease, status: 'opening' });
      opening.report({ ...lease, status: 'ready' });
    });
    expect(container.textContent).not.toContain('内容已创建，但需求会话尚未打开');
  } finally {
    opening.dispose(); act(() => root.unmount()); container.remove();
  }
});
