import type { ContentHandle } from './content-handle';

import type {
  AssetContentRef,
  AssetContentStatus,
} from '../../shared/assets';

export interface ResolvedAssetContent {
  readonly contentRef: AssetContentRef;
  readonly contentStatus: AssetContentStatus;
  readonly handle?: ContentHandle;
}

export {
  cloneAssetContentRef,
  cloneAssetContentStatus,
  createAssetContentStatus,
  createLocalFileContentRef,
  createManagedJsonContentRef,
  LOCAL_FILE_CONTENT_KIND,
  MANAGED_JSON_CONTENT_KIND,
} from '../../shared/assets';
export type {
  AssetAvailability as AssetContentAvailability,
  AssetContentKind,
  AssetContentRef,
  AssetContentStatus,
  LocalFileContentRef,
  ManagedJsonContentRef,
} from '../../shared/assets';
