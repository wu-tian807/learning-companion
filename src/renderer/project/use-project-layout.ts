import { useCallback, useEffect, useReducer } from 'react';

export const PROJECT_WIDE_LAYOUT_QUERY = '(min-width: 1180px)';
export const PROJECT_SMALL_LAYOUT_QUERY = '(max-width: 719px)';

export type ProjectLayoutMode = 'wide' | 'medium' | 'small';

export interface ProjectLayoutState {
  readonly mode: ProjectLayoutMode;
  readonly leftOpen: boolean;
  readonly rightOpen: boolean;
}

type ProjectLayoutAction =
  | {
      readonly type: 'mode-changed';
      readonly mode: ProjectLayoutMode;
    }
  | { readonly type: 'toggle-left' }
  | { readonly type: 'toggle-right' }
  | { readonly type: 'open-left' }
  | { readonly type: 'close-overlays' };

export interface ProjectLayout extends ProjectLayoutState {
  readonly leftInline: boolean;
  readonly rightInline: boolean;
  readonly openOverlay: 'left' | 'right' | null;
  readonly toggleLeft: () => void;
  readonly toggleRight: () => void;
  readonly openLeft: () => void;
  readonly closeOverlays: () => void;
}

export function createDefaultProjectLayoutState(
  mode: ProjectLayoutMode,
): ProjectLayoutState {
  switch (mode) {
    case 'wide':
      return { mode, leftOpen: true, rightOpen: true };
    case 'medium':
      return { mode, leftOpen: true, rightOpen: false };
    case 'small':
      return { mode, leftOpen: false, rightOpen: false };
  }
}

export function resolveProjectLayoutMode(
  matchMedia: (query: string) => Pick<MediaQueryList, 'matches'>,
): ProjectLayoutMode {
  if (matchMedia(PROJECT_WIDE_LAYOUT_QUERY).matches) {
    return 'wide';
  }

  if (matchMedia(PROJECT_SMALL_LAYOUT_QUERY).matches) {
    return 'small';
  }

  return 'medium';
}

export function reduceProjectLayout(
  state: ProjectLayoutState,
  action: ProjectLayoutAction,
): ProjectLayoutState {
  switch (action.type) {
    case 'mode-changed':
      return action.mode === state.mode
        ? state
        : createDefaultProjectLayoutState(action.mode);
    case 'toggle-left': {
      const leftOpen = !state.leftOpen;

      return {
        ...state,
        leftOpen,
        rightOpen:
          state.mode === 'small' && leftOpen
            ? false
            : state.rightOpen,
      };
    }
    case 'toggle-right': {
      const rightOpen = !state.rightOpen;

      return {
        ...state,
        leftOpen:
          state.mode === 'small' && rightOpen
            ? false
            : state.leftOpen,
        rightOpen,
      };
    }
    case 'open-left':
      if (
        state.leftOpen &&
        (state.mode !== 'small' || !state.rightOpen)
      ) {
        return state;
      }

      return {
        ...state,
        leftOpen: true,
        rightOpen: state.mode === 'small' ? false : state.rightOpen,
      };
    case 'close-overlays':
      if (state.mode === 'wide') {
        return state;
      }

      return {
        ...state,
        leftOpen:
          state.mode === 'small' ? false : state.leftOpen,
        rightOpen: false,
      };
  }
}

function readInitialMode(): ProjectLayoutMode {
  return typeof window === 'undefined'
    ? 'wide'
    : resolveProjectLayoutMode(window.matchMedia.bind(window));
}

export function useProjectLayout(): ProjectLayout {
  const [state, dispatch] = useReducer(
    reduceProjectLayout,
    undefined,
    () => createDefaultProjectLayoutState(readInitialMode()),
  );

  useEffect(() => {
    const wideQuery = window.matchMedia(PROJECT_WIDE_LAYOUT_QUERY);
    const smallQuery = window.matchMedia(
      PROJECT_SMALL_LAYOUT_QUERY,
    );
    const updateMode = () => {
      dispatch({
        type: 'mode-changed',
        mode: resolveProjectLayoutMode(
          window.matchMedia.bind(window),
        ),
      });
    };

    wideQuery.addEventListener('change', updateMode);
    smallQuery.addEventListener('change', updateMode);

    return () => {
      wideQuery.removeEventListener('change', updateMode);
      smallQuery.removeEventListener('change', updateMode);
    };
  }, []);

  const toggleLeft = useCallback(() => {
    dispatch({ type: 'toggle-left' });
  }, []);
  const toggleRight = useCallback(() => {
    dispatch({ type: 'toggle-right' });
  }, []);
  const openLeft = useCallback(() => {
    dispatch({ type: 'open-left' });
  }, []);
  const closeOverlays = useCallback(() => {
    dispatch({ type: 'close-overlays' });
  }, []);
  const leftInline = state.mode !== 'small';
  const rightInline = state.mode === 'wide';
  const openOverlay =
    state.mode === 'small' && state.leftOpen
      ? 'left'
      : state.mode !== 'wide' && state.rightOpen
        ? 'right'
        : null;

  return {
    ...state,
    leftInline,
    rightInline,
    openOverlay,
    toggleLeft,
    toggleRight,
    openLeft,
    closeOverlays,
  };
}
