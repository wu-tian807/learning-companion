import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

interface HeaderActionButtonProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'children' | 'title'
  > {
  readonly label: string;
  readonly children: ReactNode;
}

const HeaderActionButton = forwardRef<
  HTMLButtonElement,
  HeaderActionButtonProps
>(function HeaderActionButton(
  { label, children, className = '', ...buttonProps },
  ref,
) {
  return (
    <span className="group relative">
      <button
        {...buttonProps}
        ref={ref}
        type="button"
        aria-label={label}
        className={[
          'ui-icon-button grid size-[32px] place-items-center rounded-[10px] border border-white/10 text-slate-400 outline-none focus-visible:border-indigo-300/55 focus-visible:ring-2 focus-visible:ring-indigo-300/25',
          className,
        ].join(' ')}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-[calc(100%+7px)] right-0 z-50 w-max max-w-48 rounded-md border border-white/10 bg-[#282d35] px-2 py-1 text-[9px] font-medium text-slate-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
});

function AssetsIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 4.5h5l1.5 2h6.5v9h-13v-11Z" />
      <path d="M7 10h6M7 13h4" />
    </svg>
  );
}

function GenerationIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10 2 .9 3.1L14 6l-3.1.9L10 10l-.9-3.1L6 6l3.1-.9L10 2Z" />
      <path d="m15.5 11 .6 2.1 2.1.6-2.1.6-.6 2.2-.6-2.2-2.1-.6 2.1-.6.6-2.1Z" />
      <path d="M4.5 11.5v5M2 14h5" />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.8 5.5h5l1.5 1.8h7.9v8.2H2.8v-10Z" />
      <path d="M10 10.2h4.5M12.5 8l2.2 2.2-2.2 2.2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.2 11.4v-2.8l-1.8-.5a5 5 0 0 0-.5-1.1l.9-1.7-2-2-1.7.9a5 5 0 0 0-1.1-.5L9.4 2H6.6l-.5 1.8a5 5 0 0 0-1.1.5l-1.7-.9-2 2 .9 1.7a5 5 0 0 0-.5 1.1L0 8.6v2.8l1.8.5a5 5 0 0 0 .5 1.1l-.9 1.7 2 2 1.7-.9a5 5 0 0 0 1.1.5l.5 1.8h2.8l.5-1.8a5 5 0 0 0 1.1-.5l1.7.9 2-2-.9-1.7a5 5 0 0 0 .5-1.1l1.8-.5Z" transform="translate(2 0) scale(.8 1)" />
    </svg>
  );
}

function AiQuestionIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 4.5h13v8.2h-7l-3.8 2.8v-2.8h-2.2v-8.2Z" />
      <path d="M7 8.5h.01M10 8.5h.01M13 8.5h.01" />
    </svg>
  );
}

export interface ProjectHeaderActionsProps {
  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
  readonly leftButtonRef?: Ref<HTMLButtonElement>;
  readonly rightButtonRef?: Ref<HTMLButtonElement>;
  readonly onToggleLeft: () => void;
  readonly onToggleRight: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenAiQuestion: () => void;
  readonly onOpenSettings: () => void;
}

export function ProjectHeaderActions({
  leftOpen,
  rightOpen,
  leftButtonRef,
  rightButtonRef,
  onToggleLeft,
  onToggleRight,
  onOpenWorkspace,
  onOpenAiQuestion,
  onOpenSettings,
}: ProjectHeaderActionsProps) {
  const leftLabel = leftOpen ? '收起学习资料' : '展开学习资料';
  const rightLabel = rightOpen
    ? '收起生成中心'
    : '展开生成中心';

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <div
        data-project-ai-context-actions
        className="flex items-center gap-2"
      />
      <HeaderActionButton
        label="打开 AI 问答"
        onClick={onOpenAiQuestion}
      >
        <AiQuestionIcon />
      </HeaderActionButton>
      <HeaderActionButton
        ref={leftButtonRef}
        label={leftLabel}
        aria-controls="project-assets-panel"
        aria-expanded={leftOpen}
        onClick={onToggleLeft}
      >
        <AssetsIcon />
      </HeaderActionButton>
      <HeaderActionButton
        ref={rightButtonRef}
        label={rightLabel}
        aria-controls="project-generation-center"
        aria-expanded={rightOpen}
        onClick={onToggleRight}
      >
        <GenerationIcon />
      </HeaderActionButton>
      <HeaderActionButton
        label="打开 Project 工作区"
        onClick={onOpenWorkspace}
      >
        <WorkspaceIcon />
      </HeaderActionButton>
      <HeaderActionButton
        label="打开设置"
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </HeaderActionButton>
    </div>
  );
}
