import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveWorkbenchAnchorPreview,
  WORKBENCH_RESOLVE_ANCHOR_PREVIEW_EVENT,
  type ResolveWorkbenchAnchorPreviewDetail,
} from './workbench-anchor-bridge';

class TestCustomEvent<T> extends Event {
  readonly detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail as T;
  }
}

describe('workbench anchor preview bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets the owning Workbench synchronously provide a local preview', () => {
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    vi.stubGlobal('window', {
      dispatchEvent: (event: TestCustomEvent<ResolveWorkbenchAnchorPreviewDetail>) => {
        if (event.type === WORKBENCH_RESOLVE_ANCHOR_PREVIEW_EVENT) {
          const detail = (
            event as TestCustomEvent<ResolveWorkbenchAnchorPreviewDetail>
          ).detail;
          if (detail.assetId === 'asset') {
            detail.respond('data:image/jpeg;base64,cHJldmlldw==');
          }
        }
        return true;
      },
    });

    expect(resolveWorkbenchAnchorPreview('asset', {
      scope: 'content',
      anchorType: 'pdf.region',
      anchorVersion: 1,
      anchorPayload: { pageNumber: 6 },
    })).toBe('data:image/jpeg;base64,cHJldmlldw==');
  });
});
