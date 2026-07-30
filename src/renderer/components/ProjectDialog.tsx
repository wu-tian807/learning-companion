import { useEffect, useRef, useState } from 'react';

import { PROJECT_NAME_MAX_LENGTH } from '../../shared/projects';

export interface ProjectDialogValues {
  name: string;
  workspacePath?: string;
}

interface ProjectDialogProps {
  mode: 'create' | 'edit';
  initialName?: string;
  initialWorkspacePath?: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSelectWorkspace: () => Promise<string | undefined>;
  onOpenWorkspace?: () => Promise<void>;
  onSubmit: (values: ProjectDialogValues) => void;
}

export function ProjectDialog({
  mode,
  initialName = '',
  initialWorkspacePath,
  busy,
  error,
  onClose,
  onSelectWorkspace,
  onOpenWorkspace,
  onSubmit,
}: ProjectDialogProps) {
  const [name, setName] = useState(initialName);
  const [workspacePath, setWorkspacePath] = useState(
    initialWorkspacePath,
  );
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(
    null,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  const submit = () => {
    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      setValidationError('请输入 Project 名称。');
      return;
    }

    setValidationError(null);
    onSubmit({ name: normalizedName, workspacePath });
  };

  const title = mode === 'create' ? '新建 Project' : '编辑 Project';
  const selectWorkspace = async () => {
    setSelectingWorkspace(true);
    setWorkspaceError(null);

    try {
      const selected = await onSelectWorkspace();

      if (selected) {
        setWorkspacePath(selected);
      }
    } catch (selectionError) {
      console.error('选择 Project Workspace 失败', selectionError);
      setWorkspaceError('无法选择工作区，请重试。');
    } finally {
      setSelectingWorkspace(false);
    }
  };
  const openWorkspace = async () => {
    if (!onOpenWorkspace) {
      return;
    }

    setWorkspaceError(null);

    try {
      await onOpenWorkspace();
    } catch (openError) {
      console.error('打开 Project Workspace 失败', openError);
      setWorkspaceError('无法打开当前工作区，请检查目录是否可用。');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="project-dialog-title" className="text-xl font-semibold text-slate-100">
              {title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {mode === 'create'
                ? '资料与生成内容会整理到 Project 工作区中。'
                : '可修改标题或更换 Project 工作区。'}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
            className="ui-icon-button grid size-8 place-items-center rounded-full text-lg text-slate-500 disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-slate-400">名称</span>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              maxLength={PROJECT_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：大模型工程化学习"
              aria-label="Project 名称"
              className="h-11 w-full rounded-xl border border-white/[0.12] bg-black/15 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-300/55 focus:ring-2 focus:ring-indigo-300/10"
            />
          </label>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-400">
                Project 工作区
              </span>
              <div className="flex items-center gap-2">
                {mode === 'edit' && onOpenWorkspace && (
                  <button
                    type="button"
                    disabled={busy || selectingWorkspace}
                    onClick={() => {
                      void openWorkspace();
                    }}
                    className="ui-control rounded-full px-2.5 py-1 text-[11px] text-slate-400 disabled:opacity-40"
                  >
                    打开
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || selectingWorkspace}
                  onClick={() => {
                    void selectWorkspace();
                  }}
                  className="ui-control rounded-full border border-white/[0.12] px-3 py-1 text-[11px] text-slate-300 disabled:opacity-40"
                >
                  {selectingWorkspace
                    ? '选择中…'
                    : workspacePath
                      ? '更换'
                      : '选择'}
                </button>
              </div>
            </div>
            <div className="min-h-12 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2.5 text-xs leading-5 text-slate-400">
              {workspacePath ??
                '未手动选择时，将在 Documents 的默认位置自动创建。'}
            </div>
            {mode === 'create' && workspacePath && (
              <button
                type="button"
                disabled={busy || selectingWorkspace}
                onClick={() => setWorkspacePath(undefined)}
                className="mt-2 text-[11px] text-slate-500 transition hover:text-slate-300"
              >
                恢复默认位置
              </button>
            )}
          </div>

          {(validationError ?? workspaceError ?? error) && (
            <p role="alert" className="mt-3 text-xs text-rose-300">
              {validationError ?? workspaceError ?? error}
            </p>
          )}

          <div className="mt-7 flex justify-end gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="ui-control h-10 rounded-full border border-white/[0.12] px-4 text-sm text-slate-300 disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="ui-primary-button h-10 min-w-24 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? '处理中…' : mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
