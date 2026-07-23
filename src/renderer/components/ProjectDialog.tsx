import { useEffect, useRef, useState } from 'react';

import { PROJECT_NAME_MAX_LENGTH } from '../../shared/ipc';

export interface ProjectDialogValues {
  name: string;
}

interface ProjectDialogProps {
  mode: 'create' | 'rename';
  initialName?: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: ProjectDialogValues) => void;
}

export function ProjectDialog({
  mode,
  initialName = '',
  busy,
  error,
  onClose,
  onSubmit,
}: ProjectDialogProps) {
  const [name, setName] = useState(initialName);
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
    onSubmit({ name: normalizedName });
  };

  const title = mode === 'create' ? '新建 Project' : '编辑标题';

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
                ? '先创建一个空 Project，之后再添加学习资料。'
                : '只修改当前 Project 的显示名称。'}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-lg text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
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

          {(validationError ?? error) && (
            <p role="alert" className="mt-3 text-xs text-rose-300">
              {validationError ?? error}
            </p>
          )}

          <div className="mt-7 flex justify-end gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-10 rounded-full border border-white/[0.12] px-4 text-sm text-slate-300 hover:bg-white/[0.05] disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-10 min-w-24 rounded-full bg-slate-50 px-5 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? '处理中…' : mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
