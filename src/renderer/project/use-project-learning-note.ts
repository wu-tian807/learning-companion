import { useCallback, useEffect, useRef, useState } from 'react';

import { userMessageFromError } from '../../shared/ipc-error';
import {
  PROJECT_LEARNING_NOTE_MAX_LENGTH,
  type ProjectLearningNoteSnapshot,
} from '../../shared/project-learning-notes';

export type ProjectLearningNoteLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

export type ProjectLearningNoteSaveState =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'error';

interface NoteSession {
  readonly projectId: string;
  markdown: string;
  savedMarkdown: string;
  revision: number;
  updatedTime: number | null;
  saving: Promise<void> | null;
  active: boolean;
  loaded: boolean;
}

export interface ProjectLearningNoteController {
  readonly loadState: ProjectLearningNoteLoadState;
  readonly saveState: ProjectLearningNoteSaveState;
  readonly markdown: string;
  readonly updatedTime: number | null;
  readonly maxLength: number;
  readonly error: string | null;
  readonly setMarkdown: (markdown: string) => void;
  readonly flush: () => Promise<void>;
  readonly retry: () => Promise<void>;
}

const AUTO_SAVE_DELAY_MS = 650;

export function useProjectLearningNote(
  projectId: string,
): ProjectLearningNoteController {
  const sessionRef = useRef<NoteSession | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadState, setLoadState] =
    useState<ProjectLearningNoteLoadState>({ kind: 'loading' });
  const [saveState, setSaveState] =
    useState<ProjectLearningNoteSaveState>('saved');
  const [markdown, setMarkdownState] = useState('');
  const [updatedTime, setUpdatedTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const persist = useCallback(async (session: NoteSession): Promise<void> => {
    if (session.saving) {
      return session.saving;
    }

    const saving = (async () => {
      while (session.markdown !== session.savedMarkdown) {
        const markdownToSave = session.markdown;
        if (session.active) {
          setSaveState('saving');
          setError(null);
        }

        let saved: ProjectLearningNoteSnapshot;
        try {
          saved = await window.learningCompanion.saveProjectLearningNote({
            projectId: session.projectId,
            markdown: markdownToSave,
            expectedRevision: session.revision,
          });
        } catch (saveError) {
          if (session.active) {
            setSaveState('error');
            setError(
              userMessageFromError(
                saveError,
                '学习笔记没有保存，请重试。',
              ) ?? '学习笔记没有保存，请重试。',
            );
          }
          throw saveError;
        }

        session.savedMarkdown = markdownToSave;
        session.revision = saved.revision;
        session.updatedTime = saved.updatedTime;
        if (session.active) {
          setUpdatedTime(saved.updatedTime);
          setSaveState(
            session.markdown === markdownToSave ? 'saved' : 'dirty',
          );
        }
      }
    })();

    session.saving = saving.finally(() => {
      session.saving = null;
    });
    return session.saving;
  }, []);

  const load = useCallback(async (session: NoteSession): Promise<void> => {
    if (session.active) {
      setLoadState({ kind: 'loading' });
      setError(null);
    }
    try {
      const note = await window.learningCompanion.getProjectLearningNote({
        projectId: session.projectId,
      });
      if (!session.active || sessionRef.current !== session) return;
      session.markdown = note.markdown;
      session.savedMarkdown = note.markdown;
      session.revision = note.revision;
      session.updatedTime = note.updatedTime;
      session.loaded = true;
      setMarkdownState(note.markdown);
      setUpdatedTime(note.updatedTime);
      setSaveState('saved');
      setLoadState({ kind: 'ready' });
    } catch (loadError) {
      if (!session.active || sessionRef.current !== session) return;
      const message =
        userMessageFromError(loadError, '无法读取学习笔记。') ??
        '无法读取学习笔记。';
      setError(message);
      setLoadState({ kind: 'error', message });
    }
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    clearSaveTimer();
    const session = sessionRef.current;
    if (!session) return;
    await persist(session);
  }, [clearSaveTimer, persist]);

  const retry = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if (!session.loaded) {
      await load(session);
      return;
    }
    await persist(session);
  }, [load, persist]);

  const setMarkdown = useCallback(
    (nextMarkdown: string): void => {
      const session = sessionRef.current;
      if (!session || nextMarkdown.length > PROJECT_LEARNING_NOTE_MAX_LENGTH) {
        return;
      }

      session.markdown = nextMarkdown;
      setMarkdownState(nextMarkdown);
      setSaveState(
        nextMarkdown === session.savedMarkdown ? 'saved' : 'dirty',
      );
      setError(null);
      clearSaveTimer();
      if (nextMarkdown !== session.savedMarkdown) {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          void persist(session).catch(() => undefined);
        }, AUTO_SAVE_DELAY_MS);
      }
    },
    [clearSaveTimer, persist],
  );

  useEffect(() => {
    clearSaveTimer();
    const previous = sessionRef.current;
    if (previous) {
      previous.active = false;
      void persist(previous).catch(() => undefined);
    }

    const session: NoteSession = {
      projectId,
      markdown: '',
      savedMarkdown: '',
      revision: 0,
      updatedTime: null,
      saving: null,
      active: true,
      loaded: false,
    };
    sessionRef.current = session;
    queueMicrotask(() => {
      if (!session.active || sessionRef.current !== session) return;
      setLoadState({ kind: 'loading' });
      setSaveState('saved');
      setMarkdownState('');
      setUpdatedTime(null);
      setError(null);
      void load(session);
    });

    return () => {
      session.active = false;
      clearSaveTimer();
      void persist(session).catch(() => undefined);
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, [clearSaveTimer, load, persist, projectId]);

  return {
    loadState,
    saveState,
    markdown,
    updatedTime,
    maxLength: PROJECT_LEARNING_NOTE_MAX_LENGTH,
    error,
    setMarkdown,
    flush,
    retry,
  };
}
