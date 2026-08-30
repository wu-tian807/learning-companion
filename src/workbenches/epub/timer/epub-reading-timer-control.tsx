import { useCallback, useEffect, useRef, useState } from 'react';

import {
  EPUB_READING_TIMER_MAX_MINUTES,
  EPUB_READING_TIMER_MIN_MINUTES,
  formatReadingTimer,
  getRemainingReadingSeconds,
  parseReadingDurationMinutes,
} from './epub-reading-timer';

const DEFAULT_READING_MINUTES = '25';
const READING_TIMER_PRESETS = [15, 25, 30, 45, 60] as const;
const CLOCK_REFRESH_MS = 250;

export function EpubReadingTimerControl() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [durationInput, setDurationInput] = useState(
    DEFAULT_READING_MINUTES,
  );
  const [deadline, setDeadline] = useState<number>();
  const [remainingSeconds, setRemainingSeconds] = useState<number>();
  const [reminderOpen, setReminderOpen] = useState(false);
  const acknowledgeButtonRef = useRef<HTMLButtonElement>(null);
  const durationMinutes = parseReadingDurationMinutes(durationInput);
  const timerRunning = deadline !== undefined;

  const stopTimer = useCallback(() => {
    setDeadline(undefined);
    setRemainingSeconds(undefined);
  }, []);

  useEffect(() => {
    if (deadline === undefined) return;

    const updateClock = () => {
      const nextRemaining = getRemainingReadingSeconds(deadline, Date.now());
      if (nextRemaining === 0) {
        setRemainingSeconds(undefined);
        setDeadline(undefined);
        setPanelOpen(false);
        setReminderOpen(true);
        return;
      }
      setRemainingSeconds(nextRemaining);
    };

    updateClock();
    const timer = window.setInterval(updateClock, CLOCK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [deadline]);

  useEffect(() => {
    if (!reminderOpen) return;
    acknowledgeButtonRef.current?.focus();
  }, [reminderOpen]);

  useEffect(() => {
    if (!panelOpen && !reminderOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (reminderOpen) {
        setReminderOpen(false);
      } else {
        setPanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelOpen, reminderOpen]);

  const startOrUpdateTimer = () => {
    if (durationMinutes === undefined) return;
    setDeadline(Date.now() + durationMinutes * 60_000);
    setRemainingSeconds(durationMinutes * 60);
    setReminderOpen(false);
  };

  const formattedRemaining =
    remainingSeconds === undefined
      ? undefined
      : formatReadingTimer(remainingSeconds);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={
          formattedRemaining
            ? `阅读定时剩余 ${formattedRemaining}，打开设置`
            : '打开 EPUB 阅读定时器'
        }
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((open) => !open)}
        className={`ui-control rounded-md border px-2 py-1 text-[10px] tabular-nums ${
          timerRunning
            ? 'border-emerald-300/20 text-emerald-200/90'
            : 'border-white/[0.08] text-slate-400'
        }`}
      >
        {formattedRemaining ? `定时 ${formattedRemaining}` : '定时'}
      </button>

      {panelOpen && (
        <section
          aria-label="阅读定时设置"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-72 rounded-xl border border-white/10 bg-[#20262e] p-4 text-slate-200 shadow-2xl shadow-black/45"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">本次阅读定时</h2>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                到时后提醒你停下来休息，收起面板不会停止计时。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="ui-icon-button shrink-0 rounded-md px-1.5 py-1 text-[11px] text-slate-400"
            >
              收起
            </button>
          </div>

          {formattedRemaining && (
            <div className="mt-3 rounded-lg border border-emerald-300/10 bg-emerald-300/[0.06] px-3 py-2">
              <p className="text-[10px] text-emerald-100/60">剩余时间</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-emerald-100">
                {formattedRemaining}
              </p>
            </div>
          )}

          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {READING_TIMER_PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={durationInput === String(minutes)}
                onClick={() => setDurationInput(String(minutes))}
                className={`rounded-md border py-1.5 text-[10px] ${
                  durationInput === String(minutes)
                    ? 'border-sky-300/30 bg-sky-300/10 text-sky-100'
                    : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.04]'
                }`}
              >
                {minutes}分
              </button>
            ))}
          </div>

          <label className="mt-3 block text-[11px] text-slate-400">
            自定义分钟数
            <input
              type="number"
              min={EPUB_READING_TIMER_MIN_MINUTES}
              max={EPUB_READING_TIMER_MAX_MINUTES}
              step={1}
              inputMode="numeric"
              aria-label="阅读时长（分钟）"
              value={durationInput}
              onChange={(event) => setDurationInput(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-white/10 bg-[#171c22] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-sky-300/40"
            />
          </label>
          {durationMinutes === undefined && (
            <p className="mt-1.5 text-[10px] text-rose-300">
              请输入 {EPUB_READING_TIMER_MIN_MINUTES}–
              {EPUB_READING_TIMER_MAX_MINUTES} 之间的整数分钟。
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={durationMinutes === undefined}
              onClick={startOrUpdateTimer}
              className="flex-1 rounded-md bg-sky-500/80 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {timerRunning ? '更新计时' : '开始计时'}
            </button>
            {timerRunning && (
              <button
                type="button"
                onClick={stopTimer}
                className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.04]"
              >
                关闭计时
              </button>
            )}
          </div>
        </section>
      )}

      {reminderOpen && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="epub-reading-timer-title"
          aria-describedby="epub-reading-timer-description"
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6"
        >
          <div className="w-full max-w-sm rounded-2xl border border-emerald-200/15 bg-[#20262e] p-6 text-center shadow-2xl shadow-black/60">
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-emerald-300/10 text-xl">
              ☕
            </div>
            <h2
              id="epub-reading-timer-title"
              className="mt-3 text-base font-semibold text-slate-100"
            >
              阅读时间到了，该休息一下了
            </h2>
            <p
              id="epub-reading-timer-description"
              className="mt-2 text-xs leading-5 text-slate-400"
            >
              看看远处、活动一下，再继续阅读会更轻松。
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                ref={acknowledgeButtonRef}
                type="button"
                onClick={() => setReminderOpen(false)}
                className="rounded-md bg-emerald-500/80 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-400/80"
              >
                知道了
              </button>
              <button
                type="button"
                onClick={() => {
                  setReminderOpen(false);
                  setPanelOpen(true);
                }}
                className="rounded-md border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/[0.04]"
              >
                重新定时
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
