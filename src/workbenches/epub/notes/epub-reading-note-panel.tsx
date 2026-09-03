import { useEffect, useState, type FormEvent } from 'react';

import type { EpubCfiRangeTarget } from '../shared';
import { EpubMarkerColorPicker } from '../epub-marker-color-picker';
import {
  EPUB_MARKER_COLOR_VALUES,
  type EpubMarkerColor,
} from '../epub-marker-style';
import {
  EPUB_READING_NOTE_MAX_LENGTH,
  type EpubReadingNoteView,
} from './shared';

export function EpubReadingNotePanel({
  notes,
  activeNote,
  draftTarget,
  onActivate,
  onStartNew,
  onSave,
  onDelete,
  onClose,
}: {
  readonly notes: readonly EpubReadingNoteView[];
  readonly activeNote?: EpubReadingNoteView;
  readonly draftTarget?: EpubCfiRangeTarget;
  readonly onActivate: (note: EpubReadingNoteView) => void;
  readonly onStartNew: () => void;
  readonly onSave: (
    text: string,
    markerColor: EpubMarkerColor,
    note?: EpubReadingNoteView,
  ) => Promise<void>;
  readonly onDelete: (note: EpubReadingNoteView) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(activeNote?.text ?? '');
  const [markerColor, setMarkerColor] = useState<EpubMarkerColor>(
    activeNote?.markerColor ?? 'yellow',
  );
  const [saving, setSaving] = useState(false);
  const target = activeNote?.target ?? draftTarget;

  useEffect(() => {
    setDraft(activeNote?.text ?? '');
    setMarkerColor(activeNote?.markerColor ?? 'yellow');
  }, [activeNote]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!target || !draft.trim() || saving) return;
    setSaving(true);
    void onSave(draft, markerColor, activeNote).finally(() =>
      setSaving(false),
    );
  };

  return (
    <aside
      aria-label="EPUB 阅读笔记"
      className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-amber-200/[0.12] bg-[#171c22]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <div>
          <p className="text-[11px] font-semibold text-amber-100">阅读笔记</p>
          <p className="mt-0.5 text-[10px] text-slate-600">
            {notes.length > 0 ? `${notes.length} 条个人感想` : '还没有笔记'}
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭 EPUB 阅读笔记"
          onClick={onClose}
          className="ui-icon-button grid size-7 place-items-center rounded-md text-sm text-slate-500"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          type="button"
          onClick={onStartNew}
          className="ui-control mb-2 w-full rounded-lg border border-amber-200/15 bg-amber-200/[0.05] px-3 py-2 text-left text-[11px] text-amber-100"
        >
          ＋ 给当前选区写笔记
        </button>
        {notes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-5 text-center text-[10px] leading-5 text-slate-600">
            选中书中的文字，然后在下方写下自己的感想。
          </p>
        ) : (
          <ol className="space-y-1.5">
            {notes.map((note, index) => (
              <li key={note.id}>
                <button
                  type="button"
                  aria-current={activeNote?.id === note.id ? 'location' : undefined}
                  onClick={() => onActivate(note)}
                  className={`ui-menu-item w-full rounded-lg border px-2.5 py-2 text-left ${
                    activeNote?.id === note.id
                      ? 'border-amber-200/20 bg-amber-200/[0.06]'
                      : 'border-transparent bg-white/[0.02]'
                  }`}
                >
                  <span className="text-[10px] text-amber-200/60">笔记 {index + 1}</span>
                  <span
                    aria-label={`${note.markerColor} 波浪线`}
                    className="ml-1 inline-block size-2 rounded-full border border-white/20"
                    style={{
                      backgroundColor: EPUB_MARKER_COLOR_VALUES[note.markerColor],
                    }}
                  />
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-5 text-slate-300">
                    {note.text}
                  </span>
                  <span className="mt-1 line-clamp-1 block text-[10px] text-slate-600">
                    “{note.target.targetPayload.quote.exact}”
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <form onSubmit={submit} className="border-t border-white/[0.07] p-3">
        {target ? (
          <p className="mb-2 line-clamp-2 text-[10px] leading-4 text-amber-100/60">
            关联原文：“{target.targetPayload.quote.exact}”
          </p>
        ) : (
          <p className="mb-2 text-[10px] leading-4 text-amber-200/70">
            请先在正文中选中一段文字。
          </p>
        )}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-600">波浪线颜色</span>
          <EpubMarkerColorPicker
            value={markerColor}
            onChange={setMarkerColor}
            disabled={!target || saving}
          />
        </div>
        <textarea
          aria-label="阅读笔记内容"
          value={draft}
          maxLength={EPUB_READING_NOTE_MAX_LENGTH}
          disabled={!target || saving}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="写下此刻的理解、疑问或联想…"
          className="h-28 w-full resize-none rounded-lg border border-white/[0.08] bg-[#20262e] p-2.5 text-xs leading-5 text-slate-200 outline-none placeholder:text-slate-600 focus:border-amber-200/25 disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          {activeNote ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onDelete(activeNote)}
              className="ui-control rounded-md px-2 py-1.5 text-[10px] text-rose-300/80"
            >
              删除笔记
            </button>
          ) : (
            <span className="text-[9px] text-slate-700">最多 4000 字</span>
          )}
          <button
            type="submit"
            disabled={!target || !draft.trim() || saving}
            className="ui-control rounded-md bg-amber-300/10 px-3 py-1.5 text-[11px] text-amber-100 disabled:opacity-40"
          >
            {saving ? '保存中…' : activeNote ? '保存修改' : '添加笔记'}
          </button>
        </div>
      </form>
    </aside>
  );
}
