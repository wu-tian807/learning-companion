import { describe, expect, it, vi } from 'vitest';

import { CORE_HEADER_SURFACE_FACILITY_ID } from '../../shared/workbench/facilities/core-facilities';
import { markdownWorkbenchManifest } from '../markdown/shared';
import { officeWorkbenchManifest } from '../office/shared';
import { pdfWorkbenchManifest } from '../pdf/shared';
import { plainTextWorkbenchManifest } from '../plain-text/shared';
import { WorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime';
import { createDocumentAnnotationActions } from './renderer/document-annotation-actions';

describe('document Workbench facilities', () => {
  it.each([
    ['PDF', pdfWorkbenchManifest],
    ['Office', officeWorkbenchManifest],
    ['Markdown', markdownWorkbenchManifest],
    ['plain text', plainTextWorkbenchManifest],
  ])('%s declares the header surface used by document annotation actions', (_name, manifest) => {
    expect(manifest.facilities).toContainEqual(expect.objectContaining({
      id: CORE_HEADER_SURFACE_FACILITY_ID,
      version: 1,
    }));
  });

  it.each([
    pdfWorkbenchManifest,
    officeWorkbenchManifest,
    markdownWorkbenchManifest,
    plainTextWorkbenchManifest,
  ])('accepts document annotation actions in $id at runtime', (manifest) => {
    const runtime = new WorkbenchRuntime(vi.fn());
    runtime.activate({
      projectId: 'project',
      assetId: 'asset',
      workbenchId: manifest.id,
      sessionId: 'session',
    }, manifest);
    const bundle = createDocumentAnnotationActions({
      attachmentCount: 1,
      questionAnchorsVisible: true,
      attachmentsVisible: true,
      indexOpen: false,
      onToggleQuestionAnchors: vi.fn(),
      onToggleAttachments: vi.fn(),
      onToggleIndex: vi.fn(),
    });

    expect(() => runtime.registerContributions('document.annotations:asset', bundle)).not.toThrow();
  });
});
