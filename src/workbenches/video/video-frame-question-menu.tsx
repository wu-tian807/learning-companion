export const VIDEO_FRAME_EXPLAIN_QUESTION =
  '请用通俗易懂的语言解释我框选的视频画面区域。';

export const VIDEO_FRAME_QUICK_QUESTIONS = [
  ['解释', VIDEO_FRAME_EXPLAIN_QUESTION],
  ['举例', '请结合我框选的视频画面区域，给出一个具体、容易理解的例子。'],
  [
    '翻译',
    '请识别并翻译我框选画面区域中的可见文字；如果主要是中文则翻译成英文，否则翻译成中文。若没有可辨认文字，请直接说明。',
  ],
  ['总结', '请简洁总结我框选的视频画面区域所表达的核心信息。'],
] as const;

export interface VideoFrameQuestionMenuProps {
  readonly disabled: boolean;
  readonly onQuestion: (question: string) => void;
  readonly onFreeQuestion: () => void;
  readonly onClose: () => void;
}

export function VideoFrameQuestionMenu({
  disabled,
  onQuestion,
  onFreeQuestion,
  onClose,
}: VideoFrameQuestionMenuProps) {
  return (
    <div
      data-video-frame-question-menu="true"
      aria-label="视频画面快捷提问"
      className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/15 bg-[#171c25]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.45)] backdrop-blur [scrollbar-width:none]"
    >
      {VIDEO_FRAME_QUICK_QUESTIONS.map(([label, question]) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => onQuestion(question)}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-indigo-400/20 hover:text-white disabled:opacity-40"
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={onFreeQuestion}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-400/20 hover:text-white disabled:opacity-40"
      >
        自由提问
      </button>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 hover:bg-white/5 hover:text-slate-200"
        aria-label="关闭快捷提问"
      >
        ×
      </button>
    </div>
  );
}
