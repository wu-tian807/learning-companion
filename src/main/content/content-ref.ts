import type { ContentHandle } from './content-handle';

import type {
  AssetContentRef,
  AssetContentStatus,
} from '../../shared/assets';

export interface ResolvedAssetContent {
  readonly contentRef: AssetContentRef;
  readonly contentStatus: AssetContentStatus;
  readonly location?: ResolvedLocalFileLocation;
  readonly handle?: ContentHandle;
}

export interface ResolvedLocalFileLocation {
  readonly kind: 'local-file';
  readonly absolutePath: string;
}

export {
  ABSOLUTE_CONTENT_BASE,
  cloneAssetContentRef,
  cloneAssetContentStatus,
  createAbsoluteLocalFileContentRef,
  createAssetContentStatus,
  createProjectWorkspaceContentRef,
  LOCAL_FILE_CONTENT_KIND,
  PROJECT_WORKSPACE_CONTENT_BASE,
} from '../../shared/assets';
export type {
  AbsoluteLocalFileContentRef,
  AssetAvailability as AssetContentAvailability,
  AssetContentKind,
  AssetContentRef,
  AssetContentStatus,
  LocalFileContentRef,
  ProjectWorkspaceLocalFileContentRef,
} from '../../shared/assets';
