/**
 * AI 对话面板的状态管理。
 * 管理对话历史、输入状态，以及用户选中答案片段附着为标注的操作。
 *
 * 使用极简的发布/订阅模式，配合 React 的 useSyncExternalStore，
 * 让组件订阅 store 变化时自动重渲染。
 */

import {
  isAssetTarget,
  type ContentAnchorTarget,
} from '../../../../shared/workbench/anchor';

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
    /** A small local preview for image/formula region selections. */
    readonly previewDataUrl?: string;
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
const DOCUMENT_AI_HISTORY_PREFIX = 'learning-companion:document-ai-history:v1';
const MAX_HISTORY_PREVIEW_DATA_URL_LENGTH = 48_000;

export interface AiChatHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function historyKey(projectId: string, assetId: string): string {
  return `${DOCUMENT_AI_HISTORY_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(assetId)}`;
}

function defaultHistoryStorage(): AiChatHistoryStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function loadHistory(
  storage: AiChatHistoryStorage | undefined,
  projectId: string,
  assetId: string,
): readonly AiChatMessage[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(historyKey(projectId, assetId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): AiChatMessage[] => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof (value as AiChatMessage).id !== 'string' ||
        ((value as AiChatMessage).role !== 'user' && (value as AiChatMessage).role !== 'assistant') ||
        typeof (value as AiChatMessage).content !== 'string' ||
        typeof (value as AiChatMessage).timestamp !== 'number'
      ) return [];
      const message = value as AiChatMessage;
      const rawAnchor = message.anchor;
      const anchor = rawAnchor &&
        typeof rawAnchor === 'object' &&
        isAssetTarget(rawAnchor.target) &&
        rawAnchor.target.scope === 'content'
        ? {
            target: rawAnchor.target,
            ...(typeof rawAnchor.pageNumber === 'number' &&
              Number.isSafeInteger(rawAnchor.pageNumber) &&
              rawAnchor.pageNumber > 0
              ? { pageNumber: rawAnchor.pageNumber }
              : {}),
            ...(typeof rawAnchor.selectedText === 'string'
              ? { selectedText: rawAnchor.selectedText.slice(0, 20_000) }
              : {}),
            ...(typeof rawAnchor.previewDataUrl === 'string' &&
              /^data:image\/(?:png|jpe?g);base64,/u.test(
                rawAnchor.previewDataUrl,
              ) &&
              rawAnchor.previewDataUrl.length <=
                MAX_HISTORY_PREVIEW_DATA_URL_LENGTH
              ? { previewDataUrl: rawAnchor.previewDataUrl }
              : {}),
          }
        : undefined;
      return [{
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        ...(typeof message.replyToMessageId === 'string'
          ? { replyToMessageId: message.replyToMessageId }
          : {}),
        ...(typeof message.modelInfo === 'string'
          ? { modelInfo: message.modelInfo }
          : {}),
        ...(anchor ? { anchor } : {}),
      }];
    });
  } catch {
    return [];
  }
}

function persistHistory(
  storage: AiChatHistoryStorage | undefined,
  session: AiChatSession,
): void {
  if (!storage || !session.projectId) return;
  try {
    const messages = session.messages.slice(-100).map((message) => {
      if (
        !message.anchor?.previewDataUrl ||
        message.anchor.previewDataUrl.length <=
          MAX_HISTORY_PREVIEW_DATA_URL_LENGTH
      ) {
        return message;
      }
      const anchor = {
        target: message.anchor.target,
        ...(message.anchor.pageNumber === undefined
          ? {}
          : { pageNumber: message.anchor.pageNumber }),
        ...(message.anchor.selectedText === undefined
          ? {}
          : { selectedText: message.anchor.selectedText }),
      };
      return { ...message, anchor };
    });
    storage.setItem(
      historyKey(session.projectId, session.assetId),
      JSON.stringify(messages),
    );
  } catch {
    // 本地历史不能影响当前问答；例如浏览器存储空间不足时继续使用内存会话。
  }
}

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
  storage: AiChatHistoryStorage | undefined = defaultHistoryStorage(),
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
    persistHistory(storage, updated);
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
        if (existing.projectId) return existing;
        const session = { ...existing, projectId };
        const next = new Map(state.sessions);
        next.set(sessionId, session);
        state = { ...state, sessions: next };
        emit();
        return session;
      }

      const session = {
        ...createSession(createId(), projectId, assetId),
        messages: loadHistory(storage, projectId, assetId),
      };
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
      if (current.projectId) {
        try {
          storage?.removeItem(historyKey(current.projectId, assetId));
        } catch {
          // 清理历史失败不会阻止用户开始新会话。
        }
      }
      emit();
    },
  };
}
