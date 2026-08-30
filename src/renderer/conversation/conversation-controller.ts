import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  GenerationTaskView,
} from '../../shared/generation-tasks';
import { isWorkbenchConversationTaskResult } from '../../shared/workbench-conversation';
import type { JsonValue } from '../../shared/workbench/protocol';
import { userMessageFromError } from '../../shared/ipc-error';
import type {
  ConversationLaunchRequest,
  ConversationMessageRecord,
  ConversationReanswerBackup,
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import {
  conversationTaskClient,
  type ConversationTaskClient,
} from './conversation-task-client';
import { createWorkbenchConversationTaskRequest } from './conversation-task-request';
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

export type { ConversationErrorState } from './conversation-controller-model';

export interface ConversationControllerState {
  readonly tab: 'chat' | 'history';
  readonly conversation: ConversationRecord;
  readonly history: readonly ConversationRecord[];
  readonly draft: string;
  readonly pendingContext?: JsonValue;
  readonly busy: boolean;
  readonly activeTaskId?: string;
  readonly activityLabel?: string;
  readonly error?: ConversationErrorState;
  readonly historyLoading: boolean;
}

export interface ConversationControllerActions {
  readonly setTab: (tab: 'chat' | 'history') => void;
  readonly setDraft: (draft: string) => void;
  readonly setPendingContext: (context: JsonValue | undefined) => void;
  readonly submit: (question?: string, context?: JsonValue) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  /** 对已完成的某条回答发起全新任务，重新生成该回答。 */
  readonly reanswer: (answerId: string) => void;
  readonly restore: (record: ConversationRecord) => void;
  readonly remove: (record: ConversationRecord) => void;
  readonly startNew: (context?: JsonValue) => void;
}

interface UseConversationControllerInput {
  readonly open: boolean;
  readonly projectId: string;
  readonly assetId: string;
  readonly contribution: WorkbenchConversationContribution;
  readonly initialConversation?: ConversationRecord;
  readonly onConversationChange?: (conversation: ConversationRecord) => void;
  readonly launchRequest?: ConversationLaunchRequest;
  readonly onLaunchConsumed?: (requestId: number) => void;
  readonly onPersistenceError?: (error: unknown) => void;
  readonly taskClient?: ConversationTaskClient;
  readonly createId?: () => string;
  readonly now?: () => number;
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
  assetId,
  contribution,
  initialConversation,
  onConversationChange,
  launchRequest,
  onLaunchConsumed,
  onPersistenceError,
  taskClient = conversationTaskClient,
  createId = defaultCreateConversationId,
  now = Date.now,
}: UseConversationControllerInput): {
  readonly state: ConversationControllerState;
  readonly actions: ConversationControllerActions;
} {
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [conversation, setConversationState] = useState<ConversationRecord>(() =>
    initialConversation ?? createConversationRecord(createId(), now()),
  );
  const mountedInitialConversationRef = useRef(initialConversation);
  const [history, setHistory] = useState<readonly ConversationRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingContext, setPendingContextState] = useState<JsonValue>();
  const [busy, setBusy] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [activityLabel, setActivityLabel] = useState<string>();
  const [error, setError] = useState<ConversationErrorState>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const conversationRef = useRef(conversation);
  const observedInitialConversationRef = useRef(initialConversation);
  const pendingContextRef = useRef<JsonValue | undefined>(pendingContext);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const activeAssistantMessageIdRef = useRef<string | undefined>(undefined);
  const pendingCancelRef = useRef(false);
  const mountedRef = useRef(true);
  const initialTaskRecoveryStartedRef = useRef(false);
  const taskRecoveryStartedIdsRef = useRef(new Set<string>());
  const lastLaunchIdRef = useRef<number | undefined>(undefined);
  const contributionRef = useRef(contribution);
  const onConversationChangeRef = useRef(onConversationChange);
  const onPersistenceErrorRef = useRef(onPersistenceError);
  const deletedConversationIdsRef = useRef(new Set<string>());
  const historyMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    contributionRef.current = contribution;
  }, [contribution]);
  useEffect(() => {
    onConversationChangeRef.current = onConversationChange;
  }, [onConversationChange]);
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
    onConversationChangeRef.current?.(next);
    if (mountedRef.current) setConversationState(next);
    return next;
  }, []);

  const updateConversation = useCallback((
    updater: (current: ConversationRecord) => ConversationRecord,
  ) => replaceConversation(updater(conversationRef.current)), [replaceConversation]);

  const writePendingContext = useCallback((next: JsonValue | undefined) => {
    pendingContextRef.current = next;
    if (mountedRef.current) setPendingContextState(next);
  }, []);

  const setPendingContext = useCallback((next: JsonValue | undefined) => {
    const current = pendingContextRef.current;
    const unchanged = current === next || conversationContextsEqual(current, next);
    if (!unchanged && current !== undefined) {
      contributionRef.current.onContextReleased?.(current);
    }
    writePendingContext(next);
  }, [writePendingContext]);

  const clearTransientContext = useCallback(() => {
    contributionRef.current.onContextReleased?.(pendingContextRef.current);
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
        return contribution.historyStore.save(record);
      });
      if (mountedRef.current && records) {
        setHistory(records.filter(
          ({ id }) => !deletedConversationIdsRef.current.has(id),
        ));
      }
    } catch (persistenceError) {
      if (mountedRef.current) {
        setError({ message: '无法保存对话记录，请稍后重试。' });
      }
      onPersistenceErrorRef.current?.(persistenceError);
    }
  }, [contribution.historyStore, enqueueHistoryMutation]);
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
      const result = isWorkbenchConversationTaskResult(task.result)
        ? {
            answer: task.result.answer,
            ...(task.result.title ? { title: task.result.title } : {}),
            modelInfo: `${task.result.providerId}/${task.result.modelId}`,
          }
        : undefined;
      if (!result?.answer.trim()) {
        finishTask();
        setError({ message: 'AI 任务已完成，但最终回答无效，请重试。', retryTaskId: task.id });
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
                  ...(task.status === 'cancelled'
                    ? { stopped: true as const }
                    : {}),
                })
            : message,
        )),
        updatedTime: Math.max(task.updatedTime, current.updatedTime),
      }));
      finishTask();
      setError(failureFromTask(task));
      void persist(next);
      return true;
    }
    return false;
  }, [finishTask, persist, updateConversation]);

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
      void contribution.historyStore.list().then(
        (records) => {
          if (!active) return;
          setHistory(records);
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
  }, [contribution.historyStore, open]);

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

  const resetConversation = useCallback((context?: JsonValue) => {
    if (context === undefined) {
      clearTransientContext();
    } else {
      setPendingContext(context);
    }
    replaceConversation(createConversationRecord(createId(), now()));
    setDraft('');
    setError(undefined);
    setActivityLabel(undefined);
    setTab('chat');
  }, [clearTransientContext, createId, now, replaceConversation, setPendingContext]);

  const startNew = useCallback((context?: JsonValue) => {
    if (activeTaskIdRef.current) return;
    void persistRef.current();
    resetConversation(context);
  }, [resetConversation]);

  const recoverConversationTask = useCallback((record: ConversationRecord) => {
    const candidate = [...record.messages].reverse().find(
      (message) => message.role === 'assistant' && message.generationTaskId,
    );
    const taskId = candidate?.generationTaskId;
    if (!taskId) return;
    if (
      activeTaskIdRef.current ||
      taskRecoveryStartedIdsRef.current.has(taskId)
    ) {
      return;
    }
    taskRecoveryStartedIdsRef.current.add(taskId);
    void taskClient.get(projectId, taskId).then((snapshot) => {
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
      taskRecoveryStartedIdsRef.current.delete(taskId);
      if (!mountedRef.current) return;
      setError({ message: userMessageFromError(taskError, '无法恢复这次回答。') ?? '无法恢复这次回答。' });
    });
  }, [applyTerminalTask, bindTask, projectId, taskClient]);

  const restore = useCallback((record: ConversationRecord) => {
    if (activeTaskIdRef.current) return;
    void persistRef.current();
    clearTransientContext();
    replaceConversation(record);
    setDraft('');
    setError(undefined);
    setTab('chat');
    recoverConversationTask(record);
  }, [clearTransientContext, recoverConversationTask, replaceConversation]);

  useEffect(() => {
    if (initialTaskRecoveryStartedRef.current) return;
    initialTaskRecoveryStartedRef.current = true;
    const mountedInitialConversation = mountedInitialConversationRef.current;
    if (mountedInitialConversation) {
      recoverConversationTask(mountedInitialConversation);
    }
  }, [recoverConversationTask]);

  useEffect(() => {
    const projected = initialConversation;
    if (
      !projected ||
      projected === observedInitialConversationRef.current
    ) {
      return;
    }
    observedInitialConversationRef.current = projected;
    if (
      projected === conversationRef.current ||
      projected.id !== conversationRef.current.id
    ) {
      return;
    }
    replaceConversation(projected);
    recoverConversationTask(projected);
  }, [initialConversation, recoverConversationTask, replaceConversation]);

  const submit = useCallback((question = draft, context = pendingContext) => {
    const normalized = question.trim();
    if (!normalized || activeTaskIdRef.current) return;
    setError(undefined);
    setActivityLabel('正在创建回答任务…');
    const current = conversationRef.current;
    const userMessageId = createConversationMessageId(createId());
    const assistantMessageId = createConversationMessageId(createId());
    const firstQuestion = current.messages.every((message) => message.role !== 'user');
    const timestamp = now();
    const userMessage: ConversationMessageRecord = Object.freeze({
      id: userMessageId,
      role: 'user',
      text: normalized,
      createdTime: timestamp,
      ...(context === undefined ? {} : { context }),
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

    const rollback = (nextError: ConversationErrorState) => {
      pendingCancelRef.current = false;
      replaceConversation(current);
      if (!mountedRef.current) return;
      setDraft(normalized);
      writePendingContext(context);
      setBusy(false);
      setActivityLabel(undefined);
      setError(nextError);
    };

    let request;
    try {
      request = createWorkbenchConversationTaskRequest(contribution, {
        projectId,
        assetId,
        conversationId: current.id,
        question: normalized,
        ...(context === undefined ? {} : { context }),
        generateTitle: firstQuestion,
      });
    } catch (requestError) {
      rollback(failureFromError(requestError, '无法准备 AI 问答任务。'));
      return;
    }

    void taskClient.start(request).then(
      (started) => {
        bindTask(started.taskId, assistantMessageId);
        if (context !== undefined) {
          contributionRef.current.onContextReleased?.(context);
        }
        if (started.snapshot && applyTerminalTask(started.snapshot)) return;
        if (pendingCancelRef.current) {
          pendingCancelRef.current = false;
          void taskClient.cancel(projectId, started.taskId);
        }
      },
      (startError: unknown) => {
        rollback(failureFromError(startError, '无法发起 AI 对话。'));
      },
    );
  }, [
    applyTerminalTask,
    assetId,
    bindTask,
    contribution,
    createId,
    draft,
    now,
    pendingContext,
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
    const launchContext = matching ? undefined : request.context;
    if (request.conversationId !== undefined) {
      if (matching) {
        restore(matching);
      } else {
        startNew(launchContext);
      }
    } else if (request.fallbackToNewConversation === true) {
      startNew(launchContext);
    }
    if (
      request.conversationId === undefined &&
      request.fallbackToNewConversation !== true &&
      launchContext !== undefined
    ) {
      setPendingContext(launchContext);
    }

    if (request.question?.trim()) {
      if (request.submit) {
        queueMicrotask(() => submitRef.current(request.question, launchContext));
      } else {
        setDraft(request.question);
      }
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

    setError(undefined);
    setActivityLabel('正在重新回答…');
    setBusy(true);

    let request;
    try {
      request = createWorkbenchConversationTaskRequest(contribution, {
        projectId,
        assetId,
        conversationId: current.id,
        question: normalized,
        ...(question?.context === undefined
          ? {}
          : { context: question.context }),
        generateTitle: false,
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
    assetId,
    bindTask,
    contribution,
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
    if (record.id === conversationRef.current.id) {
      resetConversation();
    }
    void enqueueHistoryMutation(async () => {
      const records = await contribution.historyStore.remove(record.id);
      if (records.some(({ id }) => id === record.id)) {
        throw new Error('Conversation 删除后仍存在');
      }
      return records;
    }).then(
      (records) => {
        if (!mountedRef.current) return;
        setHistory(records.filter(
          ({ id }) => !deletedConversationIdsRef.current.has(id),
        ));
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
  }, [contribution.historyStore, enqueueHistoryMutation, resetConversation]);

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
