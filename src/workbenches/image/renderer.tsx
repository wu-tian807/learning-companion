import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import OpenSeadragon from 'openseadragon';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  cloneImageViewState,
  createImageSaveViewStateCommand,
  DEFAULT_IMAGE_VIEW_STATE,
  imageWorkbenchManifest,
  isImageSaveViewStateResult,
  isImageWorkbenchPayload,
  type ImageWorkbenchRotation,
  type ImageWorkbenchViewMode,
  type ImageWorkbenchViewState,
} from './shared';
import { ImageWorkbenchMenu } from './workbench-menu';

type ImageLoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'failed'; readonly message: string };

const MIN_IMAGE_SCALE = 0.01;
const MAX_IMAGE_SCALE = 64;
const ZOOM_STEP = 1.25;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeRotation(value: number): ImageWorkbenchRotation {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;

  if (
    normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270
  ) {
    return normalized;
  }

  return 0;
}

function formatImageType(mediaType: string): string {
  const labels: Record<string, string> = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'image/webp': 'WebP',
    'image/bmp': 'BMP',
  };

  return labels[mediaType] ?? mediaType;
}

function getImageItem(
  viewer: OpenSeadragon.Viewer,
): OpenSeadragon.TiledImage | undefined {
  return viewer.world.getItemCount() > 0
    ? viewer.world.getItemAt(0)
    : undefined;
}

function readViewState(
  viewer: OpenSeadragon.Viewer,
  mode: ImageWorkbenchViewMode,
): ImageWorkbenchViewState | undefined {
  const item = getImageItem(viewer);

  if (!item) {
    return undefined;
  }

  const size = item.getContentSize();
  const imageCenter = item.viewportToImageCoordinates(
    viewer.viewport.getCenter(true),
    true,
  );
  const imageScale = item.viewportToImageZoom(
    viewer.viewport.getZoom(true),
  );

  return {
    mode,
    centerX: clamp(imageCenter.x / size.x, -10, 10),
    centerY: clamp(imageCenter.y / size.y, -10, 10),
    scale: clamp(imageScale, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE),
    rotation: normalizeRotation(viewer.viewport.getRotation()),
  };
}

function applyCenteredScale(
  viewer: OpenSeadragon.Viewer,
  scale: number,
  immediately: boolean,
): void {
  const item = getImageItem(viewer);

  if (!item) {
    return;
  }

  viewer.viewport.zoomTo(
    item.imageToViewportZoom(
      clamp(scale, MIN_IMAGE_SCALE, MAX_IMAGE_SCALE),
    ),
    undefined,
    immediately,
  );
  viewer.viewport.applyConstraints(immediately);
}

function applyFit(
  viewer: OpenSeadragon.Viewer,
  rotation: ImageWorkbenchRotation,
): void {
  const item = getImageItem(viewer);

  if (!item) {
    return;
  }

  viewer.viewport.setRotation(rotation, true);
  viewer.viewport.goHome(true);

  if (item.viewportToImageZoom(viewer.viewport.getZoom(true)) > 1) {
    const size = item.getContentSize();
    viewer.viewport.panTo(
      item.imageToViewportCoordinates(size.x / 2, size.y / 2),
      true,
    );
    applyCenteredScale(viewer, 1, true);
  }
}

function applyStoredState(
  viewer: OpenSeadragon.Viewer,
  state: ImageWorkbenchViewState,
): void {
  const item = getImageItem(viewer);

  if (!item) {
    return;
  }

  if (state.mode === 'fit') {
    applyFit(viewer, state.rotation);
    return;
  }

  const size = item.getContentSize();
  viewer.viewport.setRotation(state.rotation, true);
  viewer.viewport.panTo(
    item.imageToViewportCoordinates(
      state.centerX * size.x,
      state.centerY * size.y,
    ),
    true,
  );
  applyCenteredScale(
    viewer,
    state.mode === 'actual-size' ? 1 : state.scale,
    true,
  );
}

function ZoomOutIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 10h10" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 10h10M10 5v10" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 4H4v3.5M12.5 4H16v3.5M7.5 16H4v-3.5M12.5 16H16v-3.5" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 7A6 6 0 1 0 16 12" />
      <path d="M15.5 3v4h-4" />
    </svg>
  );
}

export function ImageWorkbenchView({
  bootstrap,
  headerActionsTarget,
  executeCommand,
  onRelink,
  onRefresh,
  onReveal,
  onError,
}: RendererWorkbenchViewProps) {
  const payload = isImageWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const viewerHostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const modeRef = useRef<ImageWorkbenchViewMode>(
    payload?.viewState.mode ?? 'fit',
  );
  const latestViewStateRef = useRef<ImageWorkbenchViewState>(
    payload?.viewState ?? cloneImageViewState(DEFAULT_IMAGE_VIEW_STATE),
  );
  const loadStateRef = useRef<ImageLoadState>({ kind: 'loading' });
  const [loadState, setLoadState] = useState<ImageLoadState>({
    kind: 'loading',
  });
  const [zoomPercent, setZoomPercent] = useState(
    Math.round((payload?.viewState.scale ?? 1) * 100),
  );
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  const updateLoadState = useCallback((state: ImageLoadState) => {
    loadStateRef.current = state;
    setLoadState(state);
  }, []);

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = userMessageFromError(error, fallback);

      if (message) {
        console.error(message, error);
        onError(message);
      }
    },
    [onError],
  );

  const persistViewState = useCallback(
    async (state: ImageWorkbenchViewState) => {
      try {
        const result = await executeCommand(
          createImageSaveViewStateCommand(state),
        );

        if (!isImageSaveViewStateResult(result.payload)) {
          throw new Error('Image Workbench 视图状态响应无效');
        }
      } catch (error) {
        reportError(error, '无法保存图片查看位置。');
      }
    },
    [executeCommand, reportError],
  );

  const captureViewState = useCallback(
    (immediate: boolean) => {
      const viewer = viewerRef.current;

      if (!viewer || loadStateRef.current.kind !== 'ready') {
        return;
      }

      const state = readViewState(viewer, modeRef.current);

      if (!state) {
        return;
      }

      latestViewStateRef.current = state;
      setZoomPercent(Math.round(state.scale * 100));
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }

      if (immediate) {
        void persistViewState(state);
      } else {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = undefined;
          void persistViewState(latestViewStateRef.current);
        }, 500);
      }
    },
    [persistViewState],
  );

  const fit = useCallback(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    modeRef.current = 'fit';
    applyFit(
      viewer,
      normalizeRotation(viewer.viewport.getRotation()),
    );
    captureViewState(true);
    setZoomMenuOpen(false);
  }, [captureViewState]);

  const actualSize = useCallback(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    modeRef.current = 'actual-size';
    applyCenteredScale(viewer, 1, true);
    captureViewState(true);
    setZoomMenuOpen(false);
  }, [captureViewState]);

  const setManualScale = useCallback(
    (scale: number, immediately = false) => {
      const viewer = viewerRef.current;

      if (!viewer) {
        return;
      }

      modeRef.current = 'manual';
      applyCenteredScale(viewer, scale, immediately);
      if (immediately) {
        captureViewState(true);
      }
      setZoomMenuOpen(false);
    },
    [captureViewState],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const viewer = viewerRef.current;

      if (!viewer) {
        return;
      }

      modeRef.current = 'manual';
      viewer.viewport.zoomBy(factor);
      viewer.viewport.applyConstraints();
    },
    [],
  );

  const rotate = useCallback(
    (delta: 90 | -90) => {
      const viewer = viewerRef.current;

      if (!viewer) {
        return;
      }

      const rotation = normalizeRotation(
        viewer.viewport.getRotation() + delta,
      );
      viewer.viewport.setRotation(rotation, true);

      if (modeRef.current === 'fit') {
        applyFit(viewer, rotation);
      } else if (modeRef.current === 'actual-size') {
        applyCenteredScale(viewer, 1, true);
      } else {
        viewer.viewport.applyConstraints(true);
      }

      captureViewState(true);
    },
    [captureViewState],
  );

  const reset = useCallback(() => {
    const viewer = viewerRef.current;

    if (!viewer) {
      return;
    }

    modeRef.current = 'fit';
    applyFit(viewer, 0);
    captureViewState(true);
  }, [captureViewState]);

  useEffect(() => {
    const host = viewerHostRef.current;

    if (!payload || !host) {
      return;
    }

    let disposed = false;
    updateLoadState({ kind: 'loading' });
    modeRef.current = payload.viewState.mode;
    latestViewStateRef.current = cloneImageViewState(
      payload.viewState,
    );
    const viewer = OpenSeadragon({
      element: host,
      showNavigationControl: false,
      showNavigator: false,
      keyboardNavEnabled: false,
      mouseNavEnabled: true,
      autoResize: true,
      preserveImageSizeOnResize: true,
      animationTime: 0.28,
      springStiffness: 10,
      blendTime: 0.08,
      immediateRender: true,
      minZoomImageRatio: 0.01,
      maxZoomPixelRatio: 64,
      visibilityRatio: 0.05,
      constrainDuringPan: false,
      zoomPerScroll: 1.18,
      zoomPerClick: 1.5,
      crossOriginPolicy: 'Anonymous',
      ajaxWithCredentials: false,
      gestureSettingsMouse: {
        dragToPan: true,
        scrollToZoom: true,
        clickToZoom: false,
        dblClickToZoom: true,
        zoomToRefPoint: true,
        flickEnabled: true,
      },
      gestureSettingsTouch: {
        dragToPan: true,
        scrollToZoom: false,
        clickToZoom: false,
        dblClickToZoom: true,
        pinchToZoom: true,
        zoomToRefPoint: true,
        flickEnabled: true,
        pinchRotate: false,
      },
    });
    viewerRef.current = viewer;

    const markManual = () => {
      modeRef.current = 'manual';
    };
    viewer.addHandler('canvas-drag-end', () => {
      markManual();
      captureViewState(false);
    });
    viewer.addHandler('canvas-scroll', markManual);
    viewer.addHandler('canvas-pinch', markManual);
    viewer.addHandler('canvas-double-click', markManual);
    viewer.addHandler('animation-finish', () => {
      captureViewState(false);
    });
    viewer.addHandler('viewport-change', () => {
      const state = readViewState(viewer, modeRef.current);
      if (state) {
        latestViewStateRef.current = state;
        setZoomPercent(Math.round(state.scale * 100));
      }
    });
    viewer.addHandler('after-resize', () => {
      if (modeRef.current === 'fit') {
        applyFit(
          viewer,
          normalizeRotation(viewer.viewport.getRotation()),
        );
      }
    });
    viewer.addHandler('add-item-failed', (event) => {
      if (disposed) {
        return;
      }
      updateLoadState({
        kind: 'failed',
        message: event.message || '浏览器无法解码这张图片。',
      });
    });

    viewer.addSimpleImage({
      url: payload.contentUrl,
      crossOriginPolicy: 'Anonymous',
      ajaxWithCredentials: false,
      success: () => {
        if (disposed) {
          return;
        }

        const item = getImageItem(viewer);

        if (!item) {
          updateLoadState({
            kind: 'failed',
            message: '图片内容没有正确载入。',
          });
          return;
        }

        const size = item.getContentSize();
        applyStoredState(viewer, payload.viewState);
        const restoredState = readViewState(
          viewer,
          payload.viewState.mode,
        );
        if (restoredState) {
          latestViewStateRef.current = restoredState;
          setZoomPercent(Math.round(restoredState.scale * 100));
        }
        updateLoadState({
          kind: 'ready',
          width: Math.round(size.x),
          height: Math.round(size.y),
        });
      },
      error: (error) => {
        if (!disposed) {
          updateLoadState({
            kind: 'failed',
            message: error.message || '图片资源读取失败。',
          });
        }
      },
    });

    return () => {
      disposed = true;
      const finalState =
        loadStateRef.current.kind === 'ready'
          ? readViewState(viewer, modeRef.current)
          : undefined;

      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      if (finalState) {
        latestViewStateRef.current = finalState;
        void persistViewState(finalState);
      }
      viewerRef.current = undefined;
      viewer.destroy();
    };
  }, [
    captureViewState,
    payload,
    persistViewState,
    updateLoadState,
  ]);

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          Image Workbench 数据无效
        </p>
      </div>
    );
  }

  const ready = loadState.kind === 'ready';

  return (
    <div
      tabIndex={0}
      className="relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(79,88,112,0.16),transparent_54%),#12161b] outline-none"
      onPointerDown={(event) => event.currentTarget.focus()}
      onKeyDown={(event) => {
        if (!ready) {
          return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === '0') {
          event.preventDefault();
          fit();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === '1') {
          event.preventDefault();
          actualSize();
          return;
        }
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          zoomBy(ZOOM_STEP);
          return;
        }
        if (event.key === '-') {
          event.preventDefault();
          zoomBy(1 / ZOOM_STEP);
          return;
        }
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault();
          rotate(event.shiftKey ? -90 : 90);
        }
      }}
    >
      <div
        ref={viewerHostRef}
        aria-label="图片查看画布"
        className="h-full min-h-0 w-full"
      />

      {loadState.kind === 'loading' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#12161b]/72">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/80 px-4 py-2 text-xs text-slate-400 shadow-xl backdrop-blur-sm">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            正在载入图片…
          </div>
        </div>
      )}

      {loadState.kind === 'failed' && (
        <div className="absolute inset-0 grid place-items-center bg-[#12161b]/88 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">
              无法显示这张图片
            </p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
              {loadState.message}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
              >
                刷新
              </button>
              <button
                type="button"
                onClick={onRelink}
                className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
              >
                重新定位
              </button>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <>
          <div className="absolute bottom-3 left-3 rounded-lg border border-white/[0.06] bg-[#171c22]/78 px-2.5 py-1.5 text-[10px] text-slate-500 shadow-lg backdrop-blur-md">
            {loadState.width.toLocaleString()} ×{' '}
            {loadState.height.toLocaleString()} ·{' '}
            {formatImageType(bootstrap.mediaType)}
          </div>

          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/[0.09] bg-[#20262e]/88 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <button
              type="button"
              aria-label="缩小"
              title="缩小"
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              className="ui-icon-button grid size-8 place-items-center rounded-lg text-slate-400"
            >
              <ZoomOutIcon />
            </button>

            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={zoomMenuOpen}
                onClick={() => setZoomMenuOpen((current) => !current)}
                className="ui-control min-w-[62px] rounded-lg px-2 py-1.5 text-[11px] tabular-nums text-slate-300"
              >
                {zoomPercent}%
              </button>
              {zoomMenuOpen && (
                <div
                  role="menu"
                  aria-label="图片缩放比例"
                  className="absolute bottom-10 left-1/2 w-32 -translate-x-1/2 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.48)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={fit}
                    className="ui-menu-item w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300"
                  >
                    适应窗口
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={actualSize}
                    className="ui-menu-item w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300"
                  >
                    实际大小
                  </button>
                  <div className="my-1 h-px bg-white/[0.08]" />
                  {[25, 50, 100, 200, 400].map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        setManualScale(percent / 100, true)
                      }
                      className="ui-menu-item w-full rounded-lg px-3 py-2 text-left text-xs text-slate-300"
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              aria-label="放大"
              title="放大"
              onClick={() => zoomBy(ZOOM_STEP)}
              className="ui-icon-button grid size-8 place-items-center rounded-lg text-slate-400"
            >
              <ZoomInIcon />
            </button>
            <span className="mx-0.5 h-4 w-px bg-white/[0.08]" />
            <button
              type="button"
              aria-label="适应窗口"
              title="适应窗口（⌘/Ctrl + 0）"
              onClick={fit}
              className="ui-icon-button grid size-8 place-items-center rounded-lg text-slate-400"
            >
              <FitIcon />
            </button>
            <button
              type="button"
              aria-label="顺时针旋转"
              title="顺时针旋转（R）"
              onClick={() => rotate(90)}
              className="ui-icon-button grid size-8 place-items-center rounded-lg text-slate-400"
            >
              <RotateIcon />
            </button>
          </div>
        </>
      )}

      {headerActionsTarget &&
        createPortal(
          <ImageWorkbenchMenu
            disabled={!ready}
            onFit={fit}
            onActualSize={actualSize}
            onRotateClockwise={() => rotate(90)}
            onRotateCounterclockwise={() => rotate(-90)}
            onReset={reset}
            onReveal={onReveal}
          />,
          headerActionsTarget,
        )}
    </div>
  );
}

export const imageRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: imageWorkbenchManifest,
  View: ImageWorkbenchView,
};
