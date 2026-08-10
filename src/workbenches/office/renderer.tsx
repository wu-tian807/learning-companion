import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import type {
  ContentAnchorTarget,
} from '../../shared/workbench/anchor';
import type {
  WorkbenchInteractionSnapshot,
} from '../../shared/workbench/interaction';
import {
  isIpcErrorPayload,
  userMessageFromError,
} from '../../shared/ipc-error';
import {
  clonePdfWorkbenchState,
  PDF_PAGE_ANCHOR_TYPE,
  PDF_TEXT_RANGE_ANCHOR_TYPE,
} from '../pdf/shared';
import { PdfDocumentWorkbenchView } from '../pdf/renderer';
import {
  createOfficePreparePreviewCommand,
  createOfficeSaveViewStateCommand,
  isOfficePreparePreviewResult,
  isOfficeSaveViewStateResult,
  isOfficeWorkbenchPayload,
  OFFICE_ANCHOR_VERSION,
  OFFICE_PAGE_ANCHOR_TYPE,
  OFFICE_TEXT_RANGE_ANCHOR_TYPE,
  officeWorkbenchManifest,
  type OfficePreparePreviewResult,
} from './shared';

type PreparationState =
  | { readonly kind: 'runtime-required' }
  | { readonly kind: 'conversion-required' }
  | { readonly kind: 'converting' }
  | { readonly kind: 'ready'; readonly payload: OfficePreparePreviewResult }
  | { readonly kind: 'failed'; readonly message: string };

function mapOfficeTarget(
  target: ContentAnchorTarget | undefined,
): ContentAnchorTarget | undefined {
  if (!target) {
    return undefined;
  }

  if (target.anchorType === PDF_TEXT_RANGE_ANCHOR_TYPE) {
    return {
      ...target,
      anchorType: OFFICE_TEXT_RANGE_ANCHOR_TYPE,
      anchorVersion: OFFICE_ANCHOR_VERSION,
    };
  }
  if (target.anchorType === PDF_PAGE_ANCHOR_TYPE) {
    return {
      ...target,
      anchorType: OFFICE_PAGE_ANCHOR_TYPE,
      anchorVersion: OFFICE_ANCHOR_VERSION,
    };
  }
  if (target.anchorType === 'pdf.region') {
    return {
      ...target,
      anchorType: 'office.preview.region',
      anchorVersion: OFFICE_ANCHOR_VERSION,
    };
  }

  return target;
}

export function mapOfficePreviewInteraction(
  interaction: WorkbenchInteractionSnapshot,
): WorkbenchInteractionSnapshot {
  const focus = mapOfficeTarget(interaction.focus);

  return {
    ...(focus ? { focus } : {}),
    inputs: interaction.inputs.map((input) => {
      const target = mapOfficeTarget(input.target);

      return {
        ...input,
        ...(target ? { target } : {}),
      };
    }),
  };
}

function RuntimeRequired({
  onOpenSettings,
  onRetry,
}: {
  readonly onOpenSettings?: () => void;
  readonly onRetry: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-indigo-200/10 bg-indigo-300/[0.07] text-xl">
          ◫
        </span>
        <h3 className="mt-4 text-base font-semibold text-slate-100">
          需要文档预览组件
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Word 和 PowerPoint
          会先在本地转换为 PDF；原文件不会被修改，也不会上传。
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="ui-primary-button h-10 rounded-full bg-slate-50 px-5 text-xs font-semibold text-slate-900"
            >
              打开设置并安装
            </button>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="ui-control h-10 rounded-full border border-white/[0.12] px-4 text-xs text-slate-300"
          >
            重新检查
          </button>
        </div>
      </div>
    </div>
  );
}

function OfficePdfPreview({
  payload,
  ...props
}: RendererWorkbenchViewProps & {
  readonly payload: OfficePreparePreviewResult;
}) {
  const pdfBootstrap = useMemo(
    () => ({
      ...props.bootstrap,
      payload: {
        contentUrl: payload.contentUrl,
        viewState: clonePdfWorkbenchState(payload.viewState),
      },
    }),
    [payload, props.bootstrap],
  );

  return (
    <PdfDocumentWorkbenchView
      {...props}
      bootstrap={pdfBootstrap}
      contributionOwnerId={officeWorkbenchManifest.id}
      createSaveViewStateCommand={
        createOfficeSaveViewStateCommand
      }
      isSaveViewStateResult={isOfficeSaveViewStateResult}
      mapInteraction={mapOfficePreviewInteraction}
    />
  );
}

export function OfficeWorkbenchView({
  bootstrap,
  executeCommand,
  onOpenSettings,
  onError,
  ...pdfProps
}: RendererWorkbenchViewProps) {
  const initialPayload = isOfficeWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const [state, setState] = useState<PreparationState>(() => {
    if (!initialPayload) {
      return {
        kind: 'failed',
        message: 'Office Workbench 数据无效。',
      };
    }
    if (initialPayload.status === 'ready') {
      return { kind: 'ready', payload: initialPayload };
    }
    return { kind: initialPayload.status };
  });
  const preparingRef = useRef(false);

  const prepare = useCallback(async () => {
    if (preparingRef.current) {
      return;
    }

    preparingRef.current = true;
    setState({ kind: 'converting' });

    try {
      const result = await executeCommand(
        createOfficePreparePreviewCommand(),
      );

      if (!isOfficePreparePreviewResult(result.payload)) {
        throw new Error('Office 预览响应无效');
      }

      setState({ kind: 'ready', payload: result.payload });
    } catch (error) {
      if (
        isIpcErrorPayload(error) &&
        error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED'
      ) {
        setState({ kind: 'runtime-required' });
        return;
      }

      const message = userMessageFromError(
        error,
        '无法生成 Office 预览，请重试。',
      );

      if (message) {
        setState({ kind: 'failed', message });
        onError(message);
      }
    } finally {
      preparingRef.current = false;
    }
  }, [executeCommand, onError]);

  useEffect(() => {
    if (state.kind === 'converting' || state.kind === 'ready') {
      return;
    }
    if (
      initialPayload?.status === 'conversion-required' &&
      state.kind !== 'failed'
    ) {
      void prepare();
    }
  }, [initialPayload?.status, prepare, state.kind]);

  useEffect(() => {
    if (state.kind !== 'runtime-required') {
      return;
    }

    return window.learningCompanion.onExternalLibraryChanged(
      (library) => {
        if (
          library.id === 'libreoffice' &&
          library.status === 'available'
        ) {
          void prepare();
        }
      },
    );
  }, [prepare, state.kind]);

  if (state.kind === 'runtime-required') {
    return (
      <RuntimeRequired
        onOpenSettings={onOpenSettings}
        onRetry={() => void prepare()}
      />
    );
  }

  if (
    state.kind === 'conversion-required' ||
    state.kind === 'converting'
  ) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <span className="mx-auto block size-8 animate-spin rounded-full border-2 border-white/[0.1] border-t-indigo-300/80" />
          <p className="mt-4 text-sm font-medium text-slate-300">
            正在生成文档预览…
          </p>
          <p className="mt-2 text-xs text-slate-500">
            大型文档或演示文稿可能需要一些时间
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-md">
          <p className="text-sm font-medium text-rose-300">
            {state.message}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            原 Office 文件没有被修改。
          </p>
          <button
            type="button"
            onClick={() => void prepare()}
            className="ui-control mt-5 h-10 rounded-full border border-white/[0.12] px-5 text-xs text-slate-300"
          >
            重试生成预览
          </button>
        </div>
      </div>
    );
  }

  return (
    <OfficePdfPreview
      {...pdfProps}
      bootstrap={bootstrap}
      payload={state.payload}
      executeCommand={executeCommand}
      onOpenSettings={onOpenSettings}
      onError={onError}
    />
  );
}

const officeRendererWorkbenchModule: RendererWorkbenchModule<
  typeof officeWorkbenchManifest.id
> = {
  manifest: officeWorkbenchManifest,
  View: OfficeWorkbenchView,
};

export default officeRendererWorkbenchModule;
