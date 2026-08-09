import type { AssetAttachment } from '../../shared/workbench/attachment';
import type {
  JsonValue,
  WorkbenchCommand,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import type { WorkbenchTransportBinding } from '../../shared/workbench/facilities/transport-binding';
import type { Asset } from '../assets/asset';
import type { ResolvedAssetContent } from '../content/content-ref';
import type { WorkbenchStateRecord } from './workbench-state-database';
import type { MainWorkbenchFacilityAdapter } from './interaction/main-facility-adapter-registry';

export type WorkbenchSelectionReason =
  | 'matched'
  | 'unsupported-media'
  | 'missing-capability'
  | 'content-unavailable';

export interface WorkbenchMaterializationContext {
  readonly asset: Asset;
  readonly content: ResolvedAssetContent;
  readonly signal?: AbortSignal;
}

export interface MaterializedWorkbenchContent {
  readonly absolutePath: string;
  readonly mediaType: string;
}

export interface WorkbenchProviderContext
  extends WorkbenchMaterializationContext {
  readonly sessionId: string;
  readonly attachments: readonly AssetAttachment[];
  readonly state: WorkbenchStateRecord | undefined;
  readonly selectionReason: WorkbenchSelectionReason;
}

export interface WorkbenchProviderOpenResult {
  readonly payload: JsonValue;
  readonly transportBindings?: readonly WorkbenchTransportBinding[];
}

export interface MainWorkbenchProvider<
  TId extends string = string,
> {
  readonly manifest: import('../../shared/workbench/manifest').AssetWorkbenchManifest<TId>;
  readonly facilityAdapters?: readonly MainWorkbenchFacilityAdapter[];
  materializeContent?(
    context: WorkbenchMaterializationContext,
  ): Promise<MaterializedWorkbenchContent>;
  open(
    context: WorkbenchProviderContext,
  ): Promise<WorkbenchProviderOpenResult>;
  command(
    context: WorkbenchProviderContext,
    command: WorkbenchCommand,
  ): Promise<WorkbenchCommandResult>;
  close(context: WorkbenchProviderContext): Promise<void>;
}

export interface AssetWorkbenchSession {
  readonly id: string;
  readonly asset: Asset;
  readonly content: ResolvedAssetContent;
  readonly workbenchId: string;
  readonly attachments: readonly AssetAttachment[];
  readonly state: WorkbenchStateRecord | undefined;
  readonly selectionReason: WorkbenchSelectionReason;
  readonly provider: MainWorkbenchProvider;
  readonly abortController?: AbortController;
}

export function toWorkbenchProviderContext(
  session: AssetWorkbenchSession,
): WorkbenchProviderContext {
  return {
    sessionId: session.id,
    asset: session.asset,
    content: session.content,
    attachments: session.attachments,
    state: session.state,
    selectionReason: session.selectionReason,
    signal: session.abortController?.signal,
  };
}
