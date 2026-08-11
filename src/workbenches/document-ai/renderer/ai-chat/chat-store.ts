/**
 * AI 对话面板的状态管理。
 * 管理对话历史、输入状态，以及用户选中答案片段附着为标注的操作。
 *
 * 使用极简的发布/订阅模式，配合 React 的 useSyncExternalStore，
 * 让组件订阅 store 变化时自动重渲染。
 */

import type { ContentAnchorTarget } from '../../../../shared/workbench/anchor';

export interface AiChatMessage {
  readonly id: string;
  /** 'user' = 用户提问, 'assistant' = AI 回答 */
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /** 时间戳 */
  readonly timestamp: number;
  readonly replyToMessageId?: string;
  readonly modelInfo?: string;
  /** 关联的文档锚点信息（用户提问时附带的选择区域） */
  readonly anchor?: {
    /** 完整的文档内容锚点，可直接用作附件 target */
    readonly target: ContentAnchorTarget;
    readonly pageNumber?: number;
    readonly selectedText?: string;
  };
}

export interface AiChatSession {
  readonly id: string;
  readonly assetId: string;
  readonly projectId: string;
  readonly messages: readonly AiChatMessage[];
  /** 是否正在等待 AI 回复 */
  readonly loading: boolean;
  /** 最近一次请求失败的用户可见提示 */
  readonly error?: string;
  readonly pendingAnchor?: AiChatMessage['anchor'];
}

export interface AiChatState {
  /** 当前活跃的 AI 对话（每个 asset 一个），按 sessionId 索引 */
  readonly sessions: ReadonlyMap<string, AiChatSession>;

  /** 对话框是否展开 */
  readonly panelOpen: boolean;

  /** 当前输入框内容 */
  readonly draft: string;

  /** 用户在当前 AI 回答中选中的文字范围（用于附着功能） */
  readonly selectedAnswerRange: {
    readonly messageId: string;
    readonly text: string;
  } | null;
}

export interface AiChatActions {
  /** 打开/关闭对话面板 */
  setPanelOpen(open: boolean): void;

  /** 更新输入框草稿 */
  setDraft(text: string): void;

  /** 开始一个新的 AI 对话会话 */
  ensureSession(projectId: string, assetId: string): AiChatSession;

  /** 获取当前 asset 的对话会话 */
  getSession(assetId: string): AiChatSession | undefined;

  /** 添加一条用户消息，并设置 loading 状态 */
  addUserMessage(
    assetId: string,
    content: string,
    anchor?: AiChatMessage['anchor'],
  ): AiChatSession;

  /** 添加一条 AI 回复消息，清除 loading 状态 */
  addAssistantMessage(
    assetId: string,
    content: string,
    replyToMessageId: string,
    modelInfo?: string,
  ): AiChatSession;

  setLoading(assetId: string, loading: boolean): void;

  setError(assetId: string, error?: string): void;

  setPendingAnchor(assetId: string, anchor?: AiChatMessage['anchor']): void;

  /** 设置 AI 回答中被用户选中的文字范围 */
  setSelectedAnswerRange(
    range: AiChatState['selectedAnswerRange'],
  ): void;

  /** 清空对话 */
  clearSession(assetId: string): void;

  /** 订阅 store 变化，返回取消订阅函数 */
  subscribe(listener: () => void): () => void;

  /** 获取当前快照（供 useSyncExternalStore 使用） */
  getSnapshot(): AiChatState;
}

export type AiChatStore = AiChatActions;

const SESSION_ID_PREFIX = 'ai-chat-';

/**
 * 全局单例 store。
 * PDF/Office 的 renderer actions 通过它触发 AI 面板，
 * 无需依赖 React context（renderer actions 在 context 之外执行）。
 */
let globalStore: AiChatStore | undefined;

export function getGlobalAiChatStore(): AiChatStore {
  if (!globalStore) {
    globalStore = createAiChatStore();
  }
  return globalStore;
}

export function createSessionId(assetId: string): string {
  return `${SESSION_ID_PREFIX}${assetId}`;
}

function createSession(
  id: string,
  projectId: string,
  assetId: string,
): AiChatSession {
  return {
    id,
    projectId,
    assetId,
    messages: [],
    loading: false,
  };
}

function defaultCreateId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${SESSION_ID_PREFIX}${randomId}`;
}

export function createAiChatStore(
  createId: () => string = defaultCreateId,
): AiChatStore {
  let state: AiChatState = {
    sessions: new Map<string, AiChatSession>(),
    panelOpen: false,
    draft: '',
    selectedAnswerRange: null,
  };

  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setState = (updater: (current: AiChatState) => AiChatState): void => {
    state = updater(state);
    emit();
  };

  const mutateSession = (
    assetId: string,
    updater: (session: AiChatSession) => AiChatSession,
  ): AiChatSession => {
    const sessionId = createSessionId(assetId);
    const existing = state.sessions.get(sessionId);

    // 若会话不存在，使用一个最小占位会话（projectId 留空由调用方补充）
    const base: AiChatSession = existing ?? {
      id: sessionId,
      assetId,
      projectId: '',
      messages: [],
      loading: false,
    };
    const updated = updater(base);
    const next = new Map(state.sessions);
    next.set(sessionId, updated);

    state = { ...state, sessions: next };
    emit();
    return updated;
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): AiChatState {
      return state;
    },

    setPanelOpen(open: boolean): void {
      if (state.panelOpen === open) {
        return;
      }
      setState((current) => ({ ...current, panelOpen: open }));
    },

    setDraft(text: string): void {
      if (state.draft === text) {
        return;
      }
      setState((current) => ({ ...current, draft: text }));
    },

    ensureSession(projectId: string, assetId: string): AiChatSession {
      const sessionId = createSessionId(assetId);
      const existing = state.sessions.get(sessionId);
      if (existing) {
        return existing;
      }

    const session = createSession(createId(), projectId, assetId);
      const next = new Map(state.sessions);
      next.set(sessionId, session);
      state = { ...state, sessions: next };
      emit();
      return session;
    },

    getSession(assetId: string): AiChatSession | undefined {
      return state.sessions.get(createSessionId(assetId));
    },

    addUserMessage(
      assetId: string,
      content: string,
      anchor?: AiChatMessage['anchor'],
    ): AiChatSession {
      const message: AiChatMessage = {
        id: createId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        anchor,
      };

      return mutateSession(assetId, (session) => ({
        ...session,
        messages: [...session.messages, message],
        loading: true,
        error: undefined,
      }));
    },

    addAssistantMessage(
      assetId: string,
      content: string,
      replyToMessageId: string,
      modelInfo?: string,
    ): AiChatSession {
      const message: AiChatMessage = {
        id: createId(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        replyToMessageId,
        modelInfo,
      };

      return mutateSession(assetId, (session) => ({
        ...(session.messages.some(({ id }) => id === replyToMessageId)
          ? {
              ...session,
              messages: [...session.messages, message],
              loading: false,
              error: undefined,
            }
          : session),
      }));
    },

    setLoading(assetId: string, loading: boolean): void {
      mutateSession(assetId, (session) => ({ ...session, loading }));
    },

    setError(assetId: string, error?: string): void {
      mutateSession(assetId, (session) => ({ ...session, error }));
    },

    setPendingAnchor(assetId: string, anchor?: AiChatMessage['anchor']): void {
      mutateSession(assetId, (session) => ({ ...session, pendingAnchor: anchor }));
    },

    setSelectedAnswerRange(
      range: AiChatState['selectedAnswerRange'],
    ): void {
      setState((current) => ({
        ...current,
        selectedAnswerRange: range,
      }));
    },

    clearSession(assetId: string): void {
      const sessionId = createSessionId(assetId);
      if (!state.sessions.has(sessionId)) {
        return;
      }

      const current = state.sessions.get(sessionId)!;
      const next = new Map(state.sessions);
      next.set(sessionId, createSession(createId(), current.projectId, assetId));
      state = { ...state, sessions: next };
      emit();
    },
  };
}
