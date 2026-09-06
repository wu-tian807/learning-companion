// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createEmptyLearningBrief, type LearningOutlineBriefState } from '../shared';
import { LearningOutlineIntakeStatus } from './intake-status';

function completeState(): LearningOutlineBriefState {
  return { valid: true, ready: true, brief: { ...createEmptyLearningBrief(),
    goal: '原大纲的目标', currentLevel: '有基础', difficulties: '暂无', constraints: '不限',
    preferences: '实践', scope: '核心方法', roadmap: [{ id: 'week-1', title: '第一周' }],
  } };
}

let container: HTMLDivElement;
let root: Root;
const invoke = vi.fn();
const startGenerationTask = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('learningCompanion', { invokeWorkbenchAction: invoke, startGenerationTask });
  invoke.mockReset(); startGenerationTask.mockReset();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
async function render(asset = 'outline-1', refreshKey = 1) {
  await act(async () => root.render(<LearningOutlineIntakeStatus projectId="project-1" boundAssetId={asset} refreshKey={refreshKey} />));
}

it('shows required gaps and hides generation even if the model marks an empty brief ready', async () => {
  invoke.mockResolvedValue({ valid: true, ready: true, brief: { ...createEmptyLearningBrief(), readiness: 'ready' } });
  await render();
  expect(container.textContent).toContain('待确认：学习目标');
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.querySelectorAll('dt')).toHaveLength(0);
  expect(container.textContent).toContain('路线：未填写');
  expect(container.querySelector('button')).toBeNull();
});

it('announces completion without detailed and shows only a disabled generation placeholder', async () => {
  invoke.mockResolvedValue(completeState());
  await render();
  expect(container.textContent).toContain('所有必填项已填写完成');
  expect(container.querySelectorAll('dt')).toHaveLength(0);
  expect(container.textContent).toContain('目标：原大纲的目标');
  expect(container.textContent).toContain('路线：第一周');
  expect(container.textContent).not.toContain('额外补充');
  const button = container.querySelector('button')!;
  expect(button.textContent?.trim()).toBe('生成大纲');
  expect(button.disabled).toBe(true);
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('即将开放');
  await act(async () => button.click());
  expect(startGenerationTask).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledOnce();
});

it('displays later optional supplements while keeping the brief complete', async () => {
  const state = completeState();
  invoke.mockResolvedValue({ ...state, brief: { ...state.brief!, detailed: '希望有可运行的例子。' } });
  await render();
  expect(container.textContent).toContain('希望有可运行的例子。');
  expect(container.querySelector('button')).not.toBeNull();
});

it('hides the button for an invalid rewrite even with a complete last-valid snapshot', async () => {
  invoke.mockResolvedValue({ ...completeState(), valid: false, error: '路线格式无效' });
  await render();
  expect(container.textContent).toContain('当前文件无效');
  expect(container.textContent).toContain('路线格式无效');
  expect(container.querySelector('button')).toBeNull();
});

it('does not show the previous outline completion while another outline is loading', async () => {
  invoke.mockResolvedValueOnce(completeState());
  await render();
  let resolve!: (value: LearningOutlineBriefState) => void;
  invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render('outline-2');
  expect(container.querySelector('button')).toBeNull();
  expect(container.textContent).not.toContain('原大纲的目标');
  await act(async () => resolve({ valid: true, brief: createEmptyLearningBrief() }));
  expect(container.querySelector('button')).toBeNull();
});

it('ignores a late response from the old outline', async () => {
  let resolve!: (value: LearningOutlineBriefState) => void;
  invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render();
  invoke.mockResolvedValueOnce({ valid: true, brief: createEmptyLearningBrief() });
  await render('outline-2');
  await act(async () => resolve(completeState()));
  expect(container.querySelector('button')).toBeNull();
  expect(container.textContent).not.toContain('原大纲的目标');
});
