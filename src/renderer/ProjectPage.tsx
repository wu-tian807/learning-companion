import type { ProjectSummary } from '../shared/ipc';

interface ProjectPageProps {
  readonly project: ProjectSummary;
  readonly onBack: () => void;
}

interface DisplayAsset {
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  readonly mediaType: string;
  readonly lastUsed: string;
  readonly accent: string;
}

interface DisplayTool {
  readonly icon: string;
  readonly name: string;
  readonly description?: string;
}

const DISPLAY_ASSETS: readonly DisplayAsset[] = [
  {
    id: 'markdown-notes',
    icon: 'M↓',
    name: 'Transformer 学习笔记.md',
    mediaType: 'Markdown',
    lastUsed: '刚刚使用',
    accent: '#8c8fce',
  },
  {
    id: 'attention-paper',
    icon: 'PDF',
    name: 'Attention Is All You Need',
    mediaType: 'PDF',
    lastUsed: '18 分钟前',
    accent: '#ad7e79',
  },
  {
    id: 'attention-map',
    icon: '⌘',
    name: '注意力机制知识图谱',
    mediaType: '思维导图',
    lastUsed: '昨天',
    accent: '#9f85bf',
  },
  {
    id: 'concept-cards',
    icon: '✦',
    name: '核心概念补充',
    mediaType: '知识卡片',
    lastUsed: '3 天前',
    accent: '#79a68e',
  },
];

const GLOBAL_TOOLS: readonly DisplayTool[] = [
  { icon: '⌘', name: '思维导图' },
  { icon: '▤', name: '学习提纲' },
  { icon: '◫', name: '知识卡片' },
  { icon: '?', name: '测验' },
  { icon: '✎', name: '摘要' },
  { icon: '▣', name: '演示文稿' },
];

const MARKDOWN_TOOLS: readonly DisplayTool[] = [
  {
    icon: '＋',
    name: '插入知识补充',
    description: '在当前位置扩展一个知识点',
  },
  {
    icon: '≡',
    name: '生成章节摘要',
    description: '总结当前 Markdown 章节',
  },
  {
    icon: '✎',
    name: '优化当前段落',
    description: '保持原意并改善表达',
  },
];

function BackIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="m12.5 4.5-5.5 5.5 5.5 5.5M7.5 10h7" />
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
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="2.4" />
      <path d="M16.1 11.4v-2.8l-1.8-.6a5 5 0 0 0-.5-1.1l.8-1.7-2-2-1.7.8a5 5 0 0 0-1.1-.5L9.2 1.7H6.4l-.6 1.8a5 5 0 0 0-1.1.5L3 3.2l-2 2L1.8 7a5 5 0 0 0-.5 1.1l-1.8.6v2.8l1.8.6a5 5 0 0 0 .5 1.1L1 14.8l2 2 1.7-.8a5 5 0 0 0 1.1.5l.6 1.8h2.8l.6-1.8a5 5 0 0 0 1.1-.5l1.7.8 2-2-.8-1.7a5 5 0 0 0 .5-1.1l1.8-.6Z" />
    </svg>
  );
}

function AssetPanel() {
  return (
    <aside
      aria-label="Project Assets"
      className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold text-slate-100">Assets</h2>
        <span className="text-[11px] text-slate-500">{DISPLAY_ASSETS.length} 项</span>
      </div>

      <button
        type="button"
        disabled
        className="mx-3.5 mt-3.5 flex shrink-0 items-center justify-center gap-2 rounded-[11px] border border-dashed border-indigo-200/20 bg-indigo-400/[0.045] px-3 py-2.5 text-xs font-medium text-indigo-100/85 disabled:cursor-default"
      >
        <span aria-hidden="true">＋</span>
        添加资料
      </button>

      <div className="mx-3.5 mt-2.5 shrink-0 rounded-[10px] border border-white/[0.07] px-3 py-2.5 text-xs text-slate-500">
        <span aria-hidden="true">⌕</span>
        <span className="ml-2">搜索当前 Project</span>
      </div>

      <div className="flex shrink-0 items-center justify-between px-[17px] pt-3 pb-1.5 text-[10px] font-bold tracking-[0.09em] text-slate-500">
        <span>全部内容</span>
        <span className="text-[9px] font-medium tracking-normal text-slate-400/70">
          最近使用 ↓
        </span>
      </div>

      <div className="min-h-0 overflow-y-auto px-2 pb-3">
        {DISPLAY_ASSETS.map((asset, index) => (
          <div
            key={asset.id}
            className={[
              'my-0.5 grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[11px] border p-2.5',
              index === 0
                ? 'border-indigo-300/15 bg-indigo-500/[0.12]'
                : 'border-transparent',
            ].join(' ')}
          >
            <span className="grid size-[34px] place-items-center rounded-[9px] bg-white/[0.055] text-[11px] font-semibold text-slate-300">
              {asset.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-slate-200">
                {asset.name}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                {asset.mediaType} · {asset.lastUsed}
              </span>
            </span>
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: asset.accent }}
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
    </aside>
  );
}

function ReaderPanel() {
  const selectedAsset = DISPLAY_ASSETS[0];

  return (
    <article
      aria-label="Asset 阅读器"
      className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#1c2127] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between gap-4 border-b border-white/[0.075] px-[17px]">
        <h2 className="truncate text-sm font-semibold text-slate-100">
          {selectedAsset.name}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-slate-400">
            {selectedAsset.mediaType}
          </span>
          <button
            type="button"
            disabled
            aria-label="预览器操作"
            className="grid h-[26px] min-w-[30px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.08em] text-slate-400 disabled:cursor-default"
          >
            •••
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1" aria-label="预览器内容区域" />
    </article>
  );
}

function GenerationPanel() {
  return (
    <aside
      aria-label="生成中心"
      className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold text-slate-100">生成中心</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>生成新的 Asset</span>
          <span className="text-[9px] font-medium text-slate-600">全局工具</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {GLOBAL_TOOLS.map((tool) => (
            <button
              key={tool.name}
              type="button"
              disabled
              className="min-h-[83px] rounded-[11px] border border-white/[0.07] bg-indigo-300/[0.07] p-2.5 text-left disabled:cursor-default"
            >
              <span className="text-[15px] text-indigo-200/80">{tool.icon}</span>
              <strong className="mt-4 block text-[10px] font-semibold text-slate-300">
                {tool.name}
              </strong>
            </button>
          ))}
        </div>

        <div className="mt-[18px] mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>当前 Asset 工具</span>
          <span className="text-[9px] font-medium text-slate-600">Markdown</span>
        </div>

        <div className="grid gap-1.5">
          {MARKDOWN_TOOLS.map((tool) => (
            <button
              key={tool.name}
              type="button"
              disabled
              className="grid grid-cols-[31px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-white/[0.07] bg-white/[0.025] p-2.5 text-left disabled:cursor-default"
            >
              <span className="grid size-[31px] place-items-center rounded-lg bg-indigo-300/10 text-xs text-indigo-100/75">
                {tool.icon}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-[11px] font-semibold text-slate-300">
                  {tool.name}
                </strong>
                <small className="mt-0.5 block truncate text-[9px] text-slate-600">
                  {tool.description}
                </small>
              </span>
              <span className="text-sm text-slate-600" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>

        <p className="mt-3 rounded-[10px] border border-white/[0.055] p-2.5 text-[9px] leading-relaxed text-slate-500">
          这一组能力会随着当前 Asset 的媒体类型变化。
        </p>
      </div>
    </aside>
  );
}

export function ProjectPage({ project, onBack }: ProjectPageProps) {
  return (
    <main className="h-screen min-w-[1080px] overflow-hidden bg-[radial-gradient(circle_at_50%_-20%,rgba(121,119,190,0.16),transparent_38%),#15191f] p-[15px] text-slate-100">
      <header className="flex h-[46px] items-center justify-between px-2 pb-1.5">
        <div className="flex min-w-0 items-center gap-[11px]">
          <button
            type="button"
            aria-label="返回首页"
            onClick={onBack}
            className="ui-icon-button grid size-[30px] shrink-0 place-items-center rounded-[10px] border border-white/10 text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          >
            <BackIcon />
          </button>
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[#34384a] text-lg">
            {project.icon}
          </span>
          <span className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-[-0.015em]">
              {project.name}
            </h1>
            <span className="mt-0.5 block text-[10px] text-slate-500">
              {DISPLAY_ASSETS.length} 个 Asset · 最近学习 18 分钟前
            </span>
          </span>
        </div>

        <button
          type="button"
          disabled
          className="flex min-w-24 shrink-0 items-center justify-center gap-2 rounded-full border border-white/[0.11] bg-white/[0.035] px-5 py-2 text-xs text-slate-400 disabled:cursor-default"
        >
          <SettingsIcon />
          设置
        </button>
      </header>

      <section className="grid h-[calc(100vh-76px)] min-h-[560px] grid-cols-[minmax(220px,2fr)_minmax(560px,6fr)_minmax(220px,2fr)] gap-3">
        <AssetPanel />
        <ReaderPanel />
        <GenerationPanel />
      </section>
    </main>
  );
}
