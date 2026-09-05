import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  GenerationTaskView,
} from '../../shared/generation-tasks';
import { userMessageFromError } from '../../shared/ipc-error';
import type {
  ActiveWorkbenchConversationContribution,
  ConversationContextAttachment,
  ConversationLaunchRequest,
  ConversationHistoryStore,
  ConversationMessageRecord,
  ConversationReanswerBackup,
  ConversationRecord,
  ConversationWorkspaceBinding,
} from './conversation-contracts';
import type { ConversationModeDefinition } from './conversation-mode';
import {
  conversationTaskClient,
  type ConversationTaskClient,
} from './conversation-task-client';
import { createConversationContextSource } from './conversation-task-request';
import {
  activityFromExecutionEvent,
  conversationContextsEqual,
  createConversationMessageId,
  createConversationRecord,
  defaultCreateConversationId,
  failureFromError,
  failureFromTask,
  fallbackConversationTitle,
  taskSnapshotFromEvent,
  type ConversationErrorState,
} from './conversation-controller-model';
import { projectConversationMode } from './project-conversation-mode';

export type { ConversationErrorState } from './conversation-controller-model';

export interface ConversationControllerState {
  readonly tab: 'chat' | 'history';
  readonly conversation: ConversationRecord;
  readonly history: readonly ConversationRecord[];
  readonly draft: string;
  readonly pendingContext?: ConversationContextAttachment;
  readonly busy: boolean;
  readonly activeTaskId?: string;
  readonly activityLabel?: string;
  readonly error?: ConversationErrorState;
  readonly historyLoading: boolean;
}

export interface ConversationControllerActions {
  readonly setTab: (tab: 'chat' | 'history') => void;
  readonly setDraft: (draft: string) => void;
  readonly setPendingContext: (
    context: ConversationContextAttachment | undefined,
  ) => void;
  readonly submit: (
    question?: string,
    context?: ConversationContextAttachment,
  ) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  /** 对已完成的某条回答发起全新任务，重新生成该回答。 */
  readonly reanswer: (answerId: string) => void;
  readonly restore: (record: ConversationRecord) => void;
  readonly remove: (record: ConversationRecord) => void;
  readonly startNew: (
    context?: ConversationContextAttachment,
  ) => void | Promise<void>;
}

interface UseConversationControllerInput {
  readonly open: boolean;
  readonly projectId: string;
  readonly historyStore: ConversationHistoryStore;
  readonly launchRequest?: ConversationLaunchRequest;
  readonly onLaunchConsumed?: (requestId: number) => void;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly mode?: ConversationModeDefinition;
  /** Default immutable workspace binding for conversations created by this host. */
  readonly workspace?: ConversationWorkspaceBinding;
  /** Immutable Asset this mode is working for, when applicable. */
  readonly boundAssetId?: string;
  /** Workbench resolved for the Asset currently selected by the UI. */
  readonly currentAssetSource?: ActiveWorkbenchConversationContribution;
  readonly taskClient?: ConversationTaskClient;
  readonly createId?: () => string;
  readonly now?: () => number;
}

function conversationContextAttachmentsEqual(
  left: ConversationContextAttachment | undefined,
  right: ConversationContextAttachment | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.assetId === right.assetId &&
    left.contribution === right.contribution &&
    conversationContextsEqual(left.context, right.context)
  );
}

function contextlessWorkbenchSource(
  source: ActiveWorkbenchConversationContribution | undefined,
): ActiveWorkbenchConversationContribution | undefined {
  return source?.contribution.contextRequired === true ? undefined : source;
}

function deferConversationTransition(
  operation: () => void | Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        Promise.resolve(operation()).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function reanswerBackupFromMessage(
  message: ConversationMessageRecord,
): ConversationReanswerBackup {
  return Object.freeze({
    text: message.text,
    ...(message.generationTaskId
      ? { generationTaskId: message.generationTaskId }
      : {}),
    ...(message.modelInfo ? { modelInfo: message.modelInfo } : {}),
    ...(message.stopped ? { stopped: true as const } : {}),
  });
}

function conversationMessageBase(message: ConversationMessageRecord) {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdTime: message.createdTime,
    ...(message.replyToMessageId
      ? { replyToMessageId: message.replyToMessageId }
      : {}),
    ...(message.context === undefined ? {} : { context: message.context }),
    ...(message.contextSource === undefined
      ? {}
      : { contextSource: message.contextSource }),
  };
}

function startReanswerMessage(
  message: ConversationMessageRecord,
  taskId: string,
): ConversationMessageRecord {
  const backup =
    message.reanswerBackup ?? reanswerBackupFromMessage(message);
  return Object.freeze({
    ...conversationMessageBase(message),
    text: '',
    generationTaskId: taskId,
    reanswerBackup: backup,
  });
}

function completeAnswerMessage(
  message: ConversationMessageRecord,
  text: string,
  modelInfo: string | undefined,
): ConversationMessageRecord {
  return Object.freeze({
    ...conversationMessageBase(message),
    text,
    ...(message.generationTaskId
      ? { generationTaskId: message.generationTaskId }
      : {}),
    ...(modelInfo ? { modelInfo } : {}),
  });
}

function restoreReanswerMessage(
  message: ConversationMessageRecord,
  taskId: string,
  keepBackup: boolean,
): ConversationMessageRecord {
  const backup = message.reanswerBackup;
  if (!backup) return message;
  return Object.freeze({
    ...conversationMessageBase(message),
    text: backup.text,
    generationTaskId: taskId,
    ...(backup.modelInfo ? { modelInfo: backup.modelInfo } : {}),
    ...(backup.stopped ? { stopped: true as const } : {}),
    ...(keepBackup ? { reanswerBackup: backup } : {}),
  });
}

export function useConversationController({
  open,
  projectId,
  historyStore,
  launchRequest,
  onLaunchConsumed,
  onPersistenceError,
  mode: conversationMode = projectConversationMode,
  workspace,
  boundAssetId,
  currentAssetSource,
  taskClient = conversationTaskClient,
  createId = defaultCreateConversationId,
  now = Date.now,
}: UseConversationControllerInput): {
  readonly state: ConversationControllerState;
  readonly actions: ConversationControllerActions;
} {
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [conversation, setConversationState] = useState<ConversationRecord>(() =>
    createConversationRecord(createId(), now(), {
      modeId: conversationMode.id,
      ...(boundAssetId ? { boundAssetId } : {}),
      ...(workspace ? { workspace } : {}),
    }),
  );
  const [history, setHistory] = useState<readonly ConversationRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingContext, setPendingContextState] =
    useState<ConversationContextAttachment>();
  const [busy, setBusy] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [activityLabel, setActivityLabel] = useState<string>();
  const [error, setError] = useState<ConversationErrorState>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const conversationRef = useRef(conversation);
  const pendingContextRef = useRef<
    ConversationContextAttachment | undefined
  >(pendingContext);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const activeAssistantMessageIdRef = useRef<string | undefined>(undefined);
  const pendingCancelRef = useRef(false);
  const mountedRef = useRef(true);
  const lastLaunchIdRef = useRef<number | undefined>(undefined);
  const onPersistenceErrorRef = useRef(onPersistenceError);
  const deletedConversationIdsRef = useRef(new Set<string>());
  const historyMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const [initialModeId] = useState(conversationMode.id);
  const [initialBoundAssetId] = useState(boundAssetId);
  if (initialModeId !== conversationMode.id) {
    throw new Error('已有 Conversation Controller 不能切换 Mode');
  }
  if (initialBoundAssetId !== boundAssetId) {
    throw new Error('已有 Conversation Controller 不能切换绑定 Asset');
  }

  const visibleHistory = useCallback(
    (records: readonly ConversationRecord[]) =>
      records.filter(
        (record) =>
          record.modeId === conversationMode.id &&
          record.boundAssetId === initialBoundAssetId &&
          !deletedConversationIdsRef.current.has(record.id),
      ),
    [conversationMode.id, initialBoundAssetId],
  );
  useEffect(() => {
    onPersistenceErrorRef.current = onPersistenceError;
  }, [onPersistenceError]);

  const enqueueHistoryMutation = useCallback(<T,>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    const result = historyMutationTailRef.current.then(operation, operation);
    historyMutationTailRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const replaceConversation = useCallback((next: ConversationRecord) => {
    conversationRef.current = next;
    if (mountedRef.current) setConversationState(next);
    return next;
  }, []);

  const updateConversation = useCallback((
    updater: (current: ConversationRecord) => ConversationRecord,
  ) => replaceConversation(updater(conversationRef.current)), [replaceConversation]);

  const writePendingContext = useCallback(
    (next: ConversationContextAttachment | undefined) => {
      pendingContextRef.current = next;
      if (mountedRef.current) setPendingContextState(next);
    },
    [],
  );

  const setPendingContext = useCallback((
    next: ConversationContextAttachment | undefined,
  ) => {
    const current = pendingContextRef.current;
    const unchanged = conversationContextAttachmentsEqual(current, next);
    if (!unchanged && current !== undefined) {
      current.contribution.onContextReleased?.(current.context);
    }
    writePendingContext(next);
  }, [writePendingContext]);

  const clearTransientContext = useCallback(() => {
    const current = pendingContextRef.current;
    current?.contribution.onContextReleased?.(current.context);
    writePendingContext(undefined);
  }, [writePendingContext]);

  const persist = useCallback(async (record = conversationRef.current) => {
    if (
      record.messages.length === 0 ||
      deletedConversationIdsRef.current.has(record.id)
    ) {
      return;
    }
    try {
      const records = await enqueueHistoryMutation(() => {
        if (deletedConversationIdsRef.current.has(record.id)) {
          return Promise.resolve<readonly ConversationRecord[] | undefined>(
            undefined,
          );
        }
        return historyStore.save(record);
      });
      if (mountedRef.current && records) {
        setHistory(visibleHistory(records));
      }
    } catch (persistenceError) {
      if (mountedRef.current) {
        setError({ message: '无法保存对话记录，请稍后重试。' });
      }
      onPersistenceErrorRef.current?.(persistenceError);
    }
  }, [enqueueHistoryMutation, historyStore, visibleHistory]);
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const finishTask = useCallback(() => {
    activeTaskIdRef.current = undefined;
    activeAssistantMessageIdRef.current = undefined;
    pendingCancelRef.current = false;
    if (mountedRef.current) {
      setActiveTaskId(undefined);
      setBusy(false);
      setActivityLabel(undefined);
    }
  }, []);

  const applyTerminalTask = useCallback((task: GenerationTaskView) => {
    const taskId = activeTaskIdRef.current;
    const messageId = activeAssistantMessageIdRef.current;
    if (!taskId || task.id !== taskId || !messageId) return false;

    if (task.status === 'completed') {
      const result = conversationMode.task.readCompletion(task);
      if (!result?.answer.trim()) {
        const failure = 'AI 任务已完成，但最终回答无效，请重试。';
        const next = updateConversation((current) => Object.freeze({
          ...current,
          messages: Object.freeze(current.messages.map((message) =>
            message.id === messageId
              ? Object.freeze({ ...message, text: `回答失败：${failure}`, stopped: true as const })
              : message,
          )),
          updatedTime: Math.max(task.updatedTime, current.updatedTime),
        }));
        finishTask();
        setError({ message: failure, retryTaskId: task.id });
        void persist(next);
        return true;
      }
      const next = updateConversation((current) => Object.freeze({
        ...current,
        title: result.title?.trim().slice(0, 128) || current.title,
        messages: Object.freeze(current.messages.map((message) =>
          message.id === messageId
            ? completeAnswerMessage(
                message,
                result.answer,
                result.modelInfo,
              )
            : message,
        )),
        updatedTime: Math.max(task.updatedTime, current.updatedTime),
      }));
      finishTask();
      setError(undefined);
      void persist(next);
      return true;
    }

    if (task.status === 'failed' || task.status === 'cancelled') {
      const terminalFailure = failureFromTask(task);
      const next = updateConversation((current) => Object.freeze({
        ...current,
        messages: Object.freeze(current.messages.map((message) =>
          message.id === messageId
            ? message.reanswerBackup
              ? restoreReanswerMessage(
                  message,
                  task.id,
                  task.status === 'failed',
                )
              : Object.freeze({
                  ...message,
                  text: task.status === 'cancelled'
                    ? '本次回答已停止。'
                    : `回答失败：${terminalFailure.message}`,
                  stopped: true as const,
                })
            : message,
        )),
        updatedTime: Math.max(task.updatedTime, current.updatedTime),
      }));
      finishTask();
      setError(terminalFailure);
      void persist(next);
      return true;
    }
    return false;
  }, [conversationMode.task, finishTask, persist, updateConversation]);

  const bindTask = useCallback(
    (
      taskId: string,
      assistantMessageId: string,
      mode: 'answer' | 'reanswer' = 'answer',
    ) => {
      activeTaskIdRef.current = taskId;
      activeAssistantMessageIdRef.current = assistantMessageId;
      if (mountedRef.current) {
        setActiveTaskId(taskId);
        setBusy(true);
      }
      const next = updateConversation((current) => Object.freeze({
        ...current,
        messages: Object.freeze(current.messages.map((message) =>
          message.id === assistantMessageId
            ? mode === 'reanswer'
              ? startReanswerMessage(message, taskId)
              : Object.freeze({ ...message, generationTaskId: taskId })
            : message,
        )),
      }));
      void persist(next);
    },
    [persist, updateConversation],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void persistRef.current();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setHistoryLoading(true);
      void historyStore.list().then(
        (records) => {
          if (!active) return;
          setHistory(visibleHistory(records));
          setHistoryLoading(false);
          setHistoryReady(true);
        },
        (historyError: unknown) => {
          if (!active) return;
          setHistoryLoading(false);
          setHistoryReady(true);
          setError({ message: '无法读取对话记录。' });
          onPersistenceErrorRef.current?.(historyError);
        },
      );
    });
    return () => { active = false; };
  }, [historyStore, open, visibleHistory]);

  useEffect(() => taskClient.subscribe((event) => {
    const taskId = activeTaskIdRef.current;
    if (!taskId) return;
    if (event.type === 'execution-event') {
      if (event.projectId !== projectId || event.taskId !== taskId) return;
      const executionEvent = event.event;
      if (executionEvent.type === 'assistant-delta') {
        const messageId = activeAssistantMessageIdRef.current;
        if (!messageId) return;
        updateConversation((current) => Object.freeze({
          ...current,
          messages: Object.freeze(current.messages.map((message) =>
            message.id === messageId
              ? Object.freeze({ ...message, text: message.text + executionEvent.delta })
              : message,
          )),
        }));
        return;
      }
      const label = activityFromExecutionEvent(executionEvent);
      if (label) setActivityLabel(label);
      return;
    }
    const snapshot = taskSnapshotFromEvent(event);
    if (snapshot?.projectId === projectId && snapshot.id === taskId) {
      applyTerminalTask(snapshot);
    }
  }), [applyTerminalTask, projectId, taskClient, updateConversation]);

  const applyNewConversation = useCallback((
    context?: ConversationContextAttachment,
    next: ConversationRecord = createConversationRecord(createId(), now(), {
      modeId: conversationMode.id,
      ...(boundAssetId ? { boundAssetId } : {}),
      ...(workspace ? { workspace } : {}),
    }),
  ) => {
    if (context === undefined) {
      clearTransientContext();
    } else {
      setPendingContext(context);
    }
    replaceConversation(next);
    setDraft('');
    setError(undefined);
    setActivityLabel(undefined);
    setTab('chat');
  }, [
    clearTransientContext,
    conversationMode.id,
    boundAssetId,
    createId,
    now,
    replaceConversation,
    setPendingContext,
    workspace,
  ]);

  const resetConversation = useCallback((
    context?: ConversationContextAttachment,
  ) => applyNewConversation(context), [applyNewConversation]);

  const startNew = useCallback((
    context?: ConversationContextAttachment,
  ): void | Promise<void> => {
    if (activeTaskIdRef.current) return;
    if (initialBoundAssetId) {
      const rebuild = historyStore.rebuildBoundConversation;
      if (!rebuild) {
        const error = new Error('绑定对话必须通过 Main 重建');
        setError({ message: error.message });
        onPersistenceErrorRef.current?.(error);
        return Promise.reject(error);
      }
      return (async () => {
        await persistRef.current();
        const next = await rebuild(initialBoundAssetId, conversationMode.id);
        if (!mountedRef.current) return;
        applyNewConversation(context, next);
      })().catch((error: unknown) => {
        if (mountedRef.current) {
          setError({ message: '无法创建新的绑定对话，请稍后重试。' });
        }
        onPersistenceErrorRef.current?.(error);
        throw error;
      });
    }
    void persistRef.current();
    resetConversation(context);
  }, [
    applyNewConversation,
    conversationMode.id,
    historyStore.rebuildBoundConversation,
    initialBoundAssetId,
    resetConversation,
  ]);

  const restore = useCallback((record: ConversationRecord) => {
    if (
      activeTaskIdRef.current ||
      record.modeId !== conversationMode.id ||
      record.boundAssetId !== initialBoundAssetId
    ) return;
    void persistRef.current();
    clearTransientContext();
    replaceConversation(record);
    setDraft('');
    setError(undefined);
    setTab('chat');

    const candidate = [...record.messages].reverse().find(
      (message) => message.role === 'assistant' && message.generationTaskId,
    );
    if (!candidate?.generationTaskId) return;
    void taskClient.get(projectId, candidate.generationTaskId).then((snapshot) => {
      if (!mountedRef.current || conversationRef.current.id !== record.id || !snapshot) return;
      if (snapshot.status === 'created' || snapshot.status === 'prepared' || snapshot.status === 'processing') {
        bindTask(snapshot.id, candidate.id);
        setActivityLabel('正在恢复回答进度…');
      } else {
        activeTaskIdRef.current = snapshot.id;
        activeAssistantMessageIdRef.current = candidate.id;
        applyTerminalTask(snapshot);
      }
    }).catch((taskError: unknown) => {
      setError({ message: userMessageFromError(taskError, '无法恢复这次回答。') ?? '无法恢复这次回答。' });
    });
  }, [
    applyTerminalTask,
    bindTask,
    clearTransientContext,
    conversationMode.id,
    initialBoundAssetId,
    projectId,
    replaceConversation,
    taskClient,
  ]);

  const submit = useCallback((question = draft, context = pendingContext) => {
    const normalized = question.trim();
    if (!normalized || activeTaskIdRef.current) return;
    setError(undefined);
    setActivityLabel('正在创建回答任务…');
    const current = conversationRef.current;
    const firstQuestion = current.messages.every(
      (message) => message.role !== 'user',
    );
    const taskSource =
      context ?? contextlessWorkbenchSource(currentAssetSource);
    const taskInput = {
      projectId,
      ...(current.boundAssetId
        ? { boundAssetId: current.boundAssetId }
        : boundAssetId
          ? { boundAssetId }
          : {}),
      ...(taskSource ? { assetId: taskSource.assetId } : {}),
      conversationId: current.id,
      ...(current.workspace ? { workspace: current.workspace } : {}),
      question: normalized,
      ...(context?.context === undefined
        ? {}
        : { context: context.context }),
      generateTitle: firstQuestion,
    };
    const userMessageId = createConversationMessageId(createId());
    const assistantMessageId = createConversationMessageId(createId());
    const timestamp = now();
    let contextSource:
      | ReturnType<typeof createConversationContextSource>
      | undefined;
    let request: ReturnType<ConversationModeDefinition['task']['createRequest']>;
    try {
      contextSource = taskSource
        ? createConversationContextSource(
            taskSource.contribution,
            taskInput,
          )
        : undefined;
      request = conversationMode.task.createRequest({
        ...taskInput,
        ...(contextSource ? { contextSource } : {}),
      });
    } catch (requestError) {
      const preparationFailure = failureFromError(
        requestError,
        '无法准备 AI 问答任务。',
      );
      const failedRecord = Object.freeze({
        ...current,
        title: firstQuestion ? fallbackConversationTitle(normalized) : current.title,
        messages: Object.freeze([
          ...current.messages,
          Object.freeze({
            id: userMessageId,
            role: 'user' as const,
            text: normalized,
            createdTime: timestamp,
            ...(context?.context === undefined ? {} : { context: context.context }),
          }),
          Object.freeze({
            id: assistantMessageId,
            role: 'assistant' as const,
            text: `回答失败：${preparationFailure.message}`,
            createdTime: timestamp,
            replyToMessageId: userMessageId,
            stopped: true as const,
          }),
        ]),
        updatedTime: timestamp,
      });
      replaceConversation(failedRecord);
      void persist(failedRecord);
      setDraft('');
      writePendingContext(undefined);
      setActivityLabel(undefined);
      setError(preparationFailure);
      return;
    }

    const userMessage: ConversationMessageRecord = Object.freeze({
      id: userMessageId,
      role: 'user',
      text: normalized,
      createdTime: timestamp,
      ...(context?.context === undefined
        ? {}
        : { context: context.context }),
      ...(context?.context !== undefined && contextSource
        ? { contextSource }
        : {}),
    });
    const assistantMessage: ConversationMessageRecord = Object.freeze({
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      createdTime: timestamp,
      replyToMessageId: userMessageId,
    });
    const next = Object.freeze({
      ...current,
      title: firstQuestion ? fallbackConversationTitle(normalized) : current.title,
      messages: Object.freeze([...current.messages, userMessage, assistantMessage]),
      updatedTime: timestamp,
    });
    replaceConversation(next);
    setDraft('');
    writePendingContext(undefined);
    setBusy(true);

    // A sent question belongs to local history immediately. Persistence must
    // not depend on Provider startup, Assistant completion, or the optional
    // action that attaches an answer back to a document.
    void persist(next);

    const retainFailedQuestion = (nextError: ConversationErrorState) => {
      pendingCancelRef.current = false;
      if (!mountedRef.current) return;
      const failedRecord = Object.freeze({
        ...next,
        messages: Object.freeze([
          ...current.messages,
          userMessage,
          Object.freeze({
            ...assistantMessage,
            text: `回答失败：${nextError.message}`,
            stopped: true as const,
          }),
        ]),
      });
      replaceConversation(failedRecord);
      void persist(failedRecord);
      setDraft('');
      writePendingContext(undefined);
      setBusy(false);
      setActivityLabel(undefined);
      setError(nextError);
      if (context !== undefined) {
        context.contribution.onContextReleased?.(context.context);
      }
    };

    void taskClient.start(request).then(
      (started) => {
        bindTask(started.taskId, assistantMessageId);
        if (context !== undefined) {
          context.contribution.onContextReleased?.(context.context);
        }
        if (started.snapshot && applyTerminalTask(started.snapshot)) return;
        if (pendingCancelRef.current) {
          pendingCancelRef.current = false;
          void taskClient.cancel(projectId, started.taskId);
        }
      },
      (startError: unknown) => {
        retainFailedQuestion(
          failureFromError(startError, '无法发起 AI 对话。'),
        );
      },
    );
  }, [
    applyTerminalTask,
    bindTask,
    boundAssetId,
    createId,
    currentAssetSource,
    conversationMode.task,
    draft,
    now,
    pendingContext,
    persist,
    projectId,
    replaceConversation,
    taskClient,
    writePendingContext,
  ]);

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    const request = launchRequest;
    if (!open || !request || request.id === lastLaunchIdRef.current) return;
    if (!historyReady && request.conversationId !== undefined) {
      return;
    }
    if (
      (request.conversationId !== undefined ||
        request.fallbackToNewConversation === true) &&
      busy
    ) {
      return;
    }
    lastLaunchIdRef.current = request.id;

    const currentConversation = conversationRef.current;
    const matching = request.conversationId
      ? currentConversation.id === request.conversationId
        ? currentConversation
        : history.find((record) => record.id === request.conversationId)
      : undefined;
    // Selecting an existing conversation and attaching this launch's context
    // are independent operations. A Workbench may intentionally address the
    // current conversation while adding a new node/selection reference.
    const launchContext = request.contextSource
      ? Object.freeze({
          ...request.contextSource,
          ...(request.context === undefined
            ? {}
            : { context: request.context }),
        })
      : undefined;
    let conversationTransition: void | Promise<void> = undefined;
    if (request.conversationId !== undefined) {
      if (matching) {
        conversationTransition = restore(matching);
      } else {
        conversationTransition = deferConversationTransition(() =>
          startNew(launchContext),
        );
      }
    } else if (request.fallbackToNewConversation === true) {
      conversationTransition = deferConversationTransition(() =>
        startNew(launchContext),
      );
    }
    if (launchContext !== undefined) {
      setPendingContext(launchContext);
    } else if (request.clearContext) {
      setPendingContext(undefined);
    }

    if (request.question?.trim()) {
      if (request.submit) {
        const submitAfterTransition = () => {
          queueMicrotask(() =>
            submitRef.current(request.question!, launchContext),
          );
        };
        if (conversationTransition instanceof Promise) {
          void conversationTransition.then(submitAfterTransition, () => undefined);
        } else {
          submitAfterTransition();
        }
      } else {
        if (conversationTransition instanceof Promise) {
          void conversationTransition.then(
            () => setDraft(request.question!),
            () => undefined,
          );
        } else {
          setDraft(request.question);
        }
      }
    }
    if (
      conversationTransition instanceof Promise &&
      !(request.question?.trim() && request.submit)
    ) {
      void conversationTransition.catch(() => undefined);
    }
    setTab('chat');
    onLaunchConsumed?.(request.id);
  }, [
    busy,
    history,
    historyReady,
    launchRequest,
    onLaunchConsumed,
    open,
    restore,
    setPendingContext,
    startNew,
  ]);

  const cancel = useCallback(() => {
    const taskId = activeTaskIdRef.current;
    if (!busy) return;
    if (!taskId) {
      pendingCancelRef.current = true;
      setActivityLabel('正在停止…');
      return;
    }
    setActivityLabel('正在停止…');
    void taskClient.cancel(projectId, taskId).catch((cancelError: unknown) => {
      setError({
        message: userMessageFromError(cancelError, '无法停止当前回答。') ?? '无法停止当前回答。',
      });
    });
  }, [busy, projectId, taskClient]);

  const retry = useCallback(() => {
    const retryTaskId = error?.retryTaskId;
    const assistant = [...conversationRef.current.messages].reverse().find(
      (message) => message.generationTaskId === retryTaskId,
    );
    if (!retryTaskId || !assistant || activeTaskIdRef.current) return;
    setError(undefined);
    setActivityLabel('正在重试…');
    setBusy(true);
    void taskClient.retry(projectId, retryTaskId).then(
      (started) => {
        bindTask(
          started.taskId,
          assistant.id,
          assistant.reanswerBackup ? 'reanswer' : 'answer',
        );
        if (started.snapshot && applyTerminalTask(started.snapshot)) return;
        if (pendingCancelRef.current) {
          pendingCancelRef.current = false;
          void taskClient.cancel(projectId, started.taskId);
        }
      },
      (retryError: unknown) => {
        pendingCancelRef.current = false;
        setBusy(false);
        setActivityLabel(undefined);
        setError({
          message: userMessageFromError(retryError, '无法重试当前回答。') ?? '无法重试当前回答。',
          retryTaskId,
        });
      },
    );
  }, [applyTerminalTask, bindTask, error?.retryTaskId, projectId, taskClient]);

  const reanswer = useCallback((answerId: string) => {
    if (activeTaskIdRef.current) return;
    const current = conversationRef.current;
    const assistant = current.messages.find(
      (message) => message.id === answerId && message.role === 'assistant',
    );
    if (!assistant) return;
    const question = assistant.replyToMessageId
      ? current.messages.find(
          (message) => message.id === assistant.replyToMessageId,
        )
      : undefined;
    const normalized = (question?.text ?? '').trim();
    if (!normalized) return;
    if (
      question?.context !== undefined &&
      question.contextSource === undefined
    ) {
      setError({
        message: '这条旧问答缺少上下文来源，请从原文重新发起。',
      });
      return;
    }

    setError(undefined);
    setActivityLabel('正在重新回答…');
    setBusy(true);

    let request: ReturnType<ConversationModeDefinition['task']['createRequest']>;
    try {
      const taskSource =
        question?.contextSource === undefined
          ? contextlessWorkbenchSource(currentAssetSource)
          : undefined;
      const taskInput = {
        projectId,
        ...(current.boundAssetId
          ? { boundAssetId: current.boundAssetId }
          : boundAssetId
            ? { boundAssetId }
            : {}),
        conversationId: current.id,
        ...(taskSource ? { assetId: taskSource.assetId } : {}),
        ...(current.workspace ? { workspace: current.workspace } : {}),
        question: normalized,
        ...(question?.context === undefined
          ? {}
          : { context: question.context }),
        generateTitle: false,
      };
      const contextSource =
        question?.contextSource ??
        (taskSource
          ? createConversationContextSource(
              taskSource.contribution,
              taskInput,
            )
          : undefined);
      request = conversationMode.task.createRequest({
        ...taskInput,
        ...(contextSource ? { contextSource } : {}),
      });
    } catch (requestError) {
      pendingCancelRef.current = false;
      setBusy(false);
      setActivityLabel(undefined);
      setError(failureFromError(requestError, '无法准备重新回答。'));
      return;
    }

    void taskClient.start(request).then(
      (started) => {
        bindTask(started.taskId, assistant.id, 'reanswer');
        if (started.snapshot && applyTerminalTask(started.snapshot)) return;
        if (pendingCancelRef.current) {
          pendingCancelRef.current = false;
          void taskClient.cancel(projectId, started.taskId);
        }
      },
      (reanswerError: unknown) => {
        pendingCancelRef.current = false;
        setBusy(false);
        setActivityLabel(undefined);
        setError({
          message:
            userMessageFromError(reanswerError, '无法重新回答。') ??
            '无法重新回答。',
        });
      },
    );
  }, [
    applyTerminalTask,
    bindTask,
    conversationMode.task,
    boundAssetId,
    currentAssetSource,
    projectId,
    taskClient,
  ]);

  const remove = useCallback((record: ConversationRecord) => {
    if (
      deletedConversationIdsRef.current.has(record.id) ||
      (record.id === conversationRef.current.id && activeTaskIdRef.current)
    ) {
      return;
    }
    deletedConversationIdsRef.current.add(record.id);
    setHistory((current) => current.filter(({ id }) => id !== record.id));
    const removingCurrent = record.id === conversationRef.current.id;
    if (removingCurrent && !initialBoundAssetId) {
      resetConversation();
    }
    void enqueueHistoryMutation(async () => {
      const records = await historyStore.remove(record.id);
      if (records.some(({ id }) => id === record.id)) {
        throw new Error('Conversation 删除后仍存在');
      }
      return records;
    }).then(
      async (records) => {
        let nextRecords = records;
        if (removingCurrent && initialBoundAssetId) {
          const getOrCreate = historyStore.getOrCreateBoundConversation;
          if (!getOrCreate) {
            const error = new Error('绑定对话删除后必须通过 Main 重建');
            onPersistenceErrorRef.current?.(error);
            if (mountedRef.current) setError({ message: error.message });
            return;
          }
          try {
            const next = await getOrCreate(
              initialBoundAssetId,
              conversationMode.id,
            );
            nextRecords = await historyStore.list();
            if (mountedRef.current) applyNewConversation(undefined, next);
          } catch (rebuildError: unknown) {
            onPersistenceErrorRef.current?.(rebuildError);
            if (mountedRef.current) {
              setError({ message: '无法恢复绑定对话，请稍后重试。' });
            }
            return;
          }
        }
        if (mountedRef.current) setHistory(visibleHistory(nextRecords));
      },
      (removeError: unknown) => {
        deletedConversationIdsRef.current.delete(record.id);
        if (!mountedRef.current) return;
        setHistory((current) => current.some(({ id }) => id === record.id)
          ? current
          : [...current, record]);
        setError({ message: '无法删除对话记录，请稍后重试。' });
        onPersistenceErrorRef.current?.(removeError);
      },
    );
  }, [
    enqueueHistoryMutation,
    applyNewConversation,
    conversationMode.id,
    historyStore,
    initialBoundAssetId,
    resetConversation,
    visibleHistory,
  ]);

  return {
    state: {
      tab,
      conversation,
      history,
      draft,
      pendingContext,
      busy,
      activeTaskId,
      activityLabel,
      error,
      historyLoading,
    },
    actions: {
      setTab,
      setDraft,
      setPendingContext,
      submit,
      cancel,
      retry,
      reanswer,
      restore,
      remove,
      startNew,
    },
  };
}
