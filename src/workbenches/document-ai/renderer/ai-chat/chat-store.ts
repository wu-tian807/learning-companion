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
  readonly conversationId?: string;
  readonly conversationTitle?: string;
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
  readonly activeConversationId?: string;
}

export interface AiChatConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedTime: number;
  readonly anchor?: AiChatMessage['anchor'];
  readonly messageCount: number;
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

  getConversations(assetId: string): readonly AiChatConversationSummary[];

  selectConversation(assetId: string, conversationId: string): void;

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
    conversationTitle?: string,
  ): AiChatSession;

  setLoading(assetId: string, loading: boolean): void;

  setError(assetId: string, error?: string): void;

  setPendingAnchor(assetId: string, anchor?: AiChatMessage['anchor']): void;

  setMessageAnchorPreview(
    assetId: string,
    messageId: string,
    previewDataUrl: string,
  ): void;

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
        ...(typeof message.conversationId === 'string'
          ? { conversationId: message.conversationId }
          : {}),
        ...(typeof message.conversationTitle === 'string'
          ? { conversationTitle: message.conversationTitle }
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

function legacyConversationId(message: AiChatMessage): string {
  return `legacy-${message.id}`;
}

function messagesWithConversationIds(
  session: AiChatSession,
): readonly AiChatMessage[] {
  let currentId: string | undefined;
  const byMessageId = new Map<string, string>();
  return session.messages.map((message) => {
    let conversationId = message.conversationId;
    if (!conversationId && message.role === 'assistant' && message.replyToMessageId) {
      conversationId = byMessageId.get(message.replyToMessageId);
    }
    if (!conversationId && message.role === 'user' && message.anchor) {
      conversationId = legacyConversationId(message);
    }
    conversationId ??= currentId ?? legacyConversationId(message);
    currentId = conversationId;
    byMessageId.set(message.id, conversationId);
    return message.conversationId ? message : { ...message, conversationId };
  });
}

export function createLegacyConversationTitle(content: string): string {
  const firstLine = content
    .replace(/^\s*Question\s*[:：]\s*/iu, '')
    .split(/\r?\n|Document\s+path\s*[:：]/iu, 1)[0]
    ?.trim() ?? '';
  const normalized = firstLine
    .replace(/^(?:请问|麻烦|请你|帮我|请帮我)\s*/u, '')
    .replace(/^请用通俗易懂的语言解释(?:一下)?(?:我)?框选的内容[？?。！!]*$/u, '框选内容通俗解释')
    .replace(/^详细(?:点|一下)?(?:讲讲|解释)?(?:这个)?过程[？?。！!]*$/u, '详细推导过程')
    .replace(/^怎么算的[？?。！!]*$/u, '计算过程')
    .replace(/^(.+?)是什么意思[？?。！!]*$/u, '$1的含义')
    .replace(/^为什么(.+?)(?:更好|较好)[？?。！!]*$/u, '$1的优势')
    .replace(/^为什么(.+?)[？?。！!]*$/u, '$1的原因')
    .replace(/[？?。！!]+$/u, '')
    .trim();
  return normalized.slice(0, 18) || '历史问答';
}

function conversationSummaries(
  session: AiChatSession,
): readonly AiChatConversationSummary[] {
  const groups = new Map<string, AiChatMessage[]>();
  for (const message of messagesWithConversationIds(session)) {
    const group = groups.get(message.conversationId!) ?? [];
    group.push(message);
    groups.set(message.conversationId!, group);
  }
  return [...groups.entries()].map(([id, messages], order) => {
    const firstQuestion = messages.find(({ role }) => role === 'user');
    return {
      id,
      title: messages.find(({ conversationTitle }) => conversationTitle)?.conversationTitle ??
        createLegacyConversationTitle(firstQuestion?.content ?? ''),
      updatedTime: messages.at(-1)?.timestamp ?? 0,
      anchor: firstQuestion?.anchor,
      messageCount: messages.length,
      order,
    };
  }).sort((left, right) =>
    right.updatedTime - left.updatedTime || right.order - left.order,
  );
}

function sessionConversationId(
  session: AiChatSession | undefined,
  messageId: string,
): string | undefined {
  return session
    ? messagesWithConversationIds(session).find(({ id }) => id === messageId)
        ?.conversationId
    : undefined;
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

      const baseSession = {
        ...createSession(createId(), projectId, assetId),
        messages: loadHistory(storage, projectId, assetId),
      };
      const messages = messagesWithConversationIds(baseSession);
      const session = {
        ...baseSession,
        messages,
        activeConversationId: messages.at(-1)?.conversationId,
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

    getConversations(assetId: string): readonly AiChatConversationSummary[] {
      const session = state.sessions.get(createSessionId(assetId));
      return session ? conversationSummaries(session) : [];
    },

    selectConversation(assetId: string, conversationId: string): void {
      mutateSession(assetId, (session) => ({
        ...session,
        activeConversationId: conversationId,
        pendingAnchor: undefined,
        error: undefined,
      }));
    },

    addUserMessage(
      assetId: string,
      content: string,
      anchor?: AiChatMessage['anchor'],
    ): AiChatSession {
      const existing = state.sessions.get(createSessionId(assetId));
      const matchingConversation = anchor
        ? conversationSummaries(existing ?? createSession('', '', assetId))
            .find((conversation) =>
              JSON.stringify(conversation.anchor?.target) ===
              JSON.stringify(anchor.target),
            )?.id
        : existing?.activeConversationId;
      const conversationId = matchingConversation ?? createId();
      const message: AiChatMessage = {
        id: createId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        anchor,
        conversationId,
      };

      return mutateSession(assetId, (session) => ({
        ...session,
        messages: [...session.messages, message],
        loading: true,
        error: undefined,
        activeConversationId: conversationId,
      }));
    },

    addAssistantMessage(
      assetId: string,
      content: string,
      replyToMessageId: string,
      modelInfo?: string,
      conversationTitle?: string,
    ): AiChatSession {
      const message: AiChatMessage = {
        id: createId(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        replyToMessageId,
        modelInfo,
        ...(conversationTitle?.trim()
          ? { conversationTitle: conversationTitle.trim().slice(0, 32) }
          : {}),
        conversationId: sessionConversationId(
          state.sessions.get(createSessionId(assetId)),
          replyToMessageId,
        ),
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
      mutateSession(assetId, (session) => ({
        ...session,
        pendingAnchor: anchor,
        ...(anchor
          ? {
              activeConversationId: conversationSummaries(session).find(
                (conversation) =>
                  JSON.stringify(conversation.anchor?.target) ===
                  JSON.stringify(anchor.target),
              )?.id,
            }
          : {}),
      }));
    },

    setMessageAnchorPreview(
      assetId: string,
      messageId: string,
      previewDataUrl: string,
    ): void {
      if (
        !/^data:image\/(?:png|jpe?g);base64,/u.test(previewDataUrl) ||
        previewDataUrl.length > MAX_HISTORY_PREVIEW_DATA_URL_LENGTH
      ) {
        return;
      }
      mutateSession(assetId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === messageId && message.anchor
            ? {
                ...message,
                anchor: { ...message.anchor, previewDataUrl },
              }
            : message,
        ),
      }));
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
      const activeConversationId = current.activeConversationId;
      if (activeConversationId) {
        const messages = messagesWithConversationIds(current).filter(
          (message) => message.conversationId !== activeConversationId,
        );
        if (messages.length > 0) {
          const updated = {
            ...current,
            messages,
            activeConversationId: messages.at(-1)?.conversationId,
            loading: false,
            error: undefined,
          };
          const next = new Map(state.sessions);
          next.set(sessionId, updated);
          state = { ...state, sessions: next };
          persistHistory(storage, updated);
          emit();
          return;
        }
      }
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
