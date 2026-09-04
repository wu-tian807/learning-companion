import { useCallback, useEffect, useReducer } from 'react';

export const PROJECT_WIDE_LAYOUT_QUERY = '(min-width: 1180px)';
export const PROJECT_SMALL_LAYOUT_QUERY = '(max-width: 719px)';

export type ProjectLayoutMode = 'wide' | 'medium' | 'small';
export type ProjectRightPanelKind =
  | 'generation'
  | 'conversation'
  | 'learning-note';

export interface ProjectLayoutState {
  readonly mode: ProjectLayoutMode;
  readonly leftOpen: boolean;
  readonly rightPanel: ProjectRightPanelKind | null;
}

type ProjectLayoutAction =
  | {
      readonly type: 'mode-changed';
      readonly mode: ProjectLayoutMode;
    }
  | { readonly type: 'toggle-left' }
  | {
      readonly type: 'toggle-right';
      readonly panel: ProjectRightPanelKind;
    }
  | {
      readonly type: 'open-right';
      readonly panel: ProjectRightPanelKind;
    }
  | { readonly type: 'close-right' }
  | { readonly type: 'open-left' }
  | { readonly type: 'close-overlays' };

export interface ProjectLayout extends ProjectLayoutState {
  readonly leftInline: boolean;
  readonly rightInline: boolean;
  readonly openOverlay: 'left' | 'right' | null;
  readonly toggleLeft: () => void;
  readonly toggleRight: (panel: ProjectRightPanelKind) => void;
  readonly openRight: (panel: ProjectRightPanelKind) => void;
  readonly closeRight: () => void;
  readonly openLeft: () => void;
  readonly closeOverlays: () => void;
}

export function createDefaultProjectLayoutState(
  mode: ProjectLayoutMode,
): ProjectLayoutState {
  switch (mode) {
    case 'wide':
      return { mode, leftOpen: true, rightPanel: 'generation' };
    case 'medium':
      return { mode, leftOpen: true, rightPanel: null };
    case 'small':
      return { mode, leftOpen: false, rightPanel: null };
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
        rightPanel:
          state.mode === 'small' && leftOpen
            ? null
            : state.rightPanel,
      };
    }
    case 'toggle-right': {
      const rightPanel =
        state.rightPanel === action.panel ? null : action.panel;

      return {
        ...state,
        leftOpen:
          state.mode === 'small' && rightPanel !== null
            ? false
            : state.leftOpen,
        rightPanel,
      };
    }
    case 'open-right':
      if (
        state.rightPanel === action.panel &&
        (state.mode !== 'small' || !state.leftOpen)
      ) {
        return state;
      }

      return {
        ...state,
        leftOpen: state.mode === 'small' ? false : state.leftOpen,
        rightPanel: action.panel,
      };
    case 'close-right':
      return state.rightPanel === null
        ? state
        : { ...state, rightPanel: null };
    case 'open-left':
      if (
        state.leftOpen &&
        (state.mode !== 'small' || state.rightPanel === null)
      ) {
        return state;
      }

      return {
        ...state,
        leftOpen: true,
        rightPanel: state.mode === 'small' ? null : state.rightPanel,
      };
    case 'close-overlays':
      if (state.mode === 'wide') {
        return state;
      }

      return {
        ...state,
        leftOpen:
          state.mode === 'small' ? false : state.leftOpen,
        rightPanel: null,
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
  const toggleRight = useCallback((panel: ProjectRightPanelKind) => {
    dispatch({ type: 'toggle-right', panel });
  }, []);
  const openRight = useCallback((panel: ProjectRightPanelKind) => {
    dispatch({ type: 'open-right', panel });
  }, []);
  const closeRight = useCallback(() => {
    dispatch({ type: 'close-right' });
  }, []);
  const openLeft = useCallback(() => {
    dispatch({ type: 'open-left' });
  }, []);
  const closeOverlays = useCallback(() => {
    dispatch({ type: 'close-overlays' });
  }, []);
  const leftInline = state.mode !== 'small';
  const rightInline = state.mode === 'wide';
  const rightOpen = state.rightPanel !== null;
  const openOverlay =
    state.mode === 'small' && state.leftOpen
      ? 'left'
      : state.mode !== 'wide' && rightOpen
        ? 'right'
        : null;

  return {
    ...state,
    leftInline,
    rightInline,
    openOverlay,
    toggleLeft,
    toggleRight,
    openRight,
    closeRight,
    openLeft,
    closeOverlays,
  };
}
