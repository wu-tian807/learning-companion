import type { MainWorkbenchFeatureContribution } from '../../main/workbench/main-workbench-contribution';
import { pdfFunctionTool } from './agent/pdf-function-tool';
import { registerPagedDocumentTargets } from '../document-ai/paged-document-targets';
import {
  PDF_PAGE_ANCHOR_TYPE,
  PDF_PAGE_ANCHOR_VERSION,
  PDF_REGION_ANCHOR_TYPE,
  PDF_TEXT_RANGE_ANCHOR_TYPE,
} from './shared';

export const pdfMainFeature = Object.freeze({
  id: 'builtin.pdf.targets',
  registerAgentFunctionTools({ functionTools }): void {
    functionTools.register(pdfFunctionTool);
  },
  registerAssetTargets({ targets }): void {
    registerPagedDocumentTargets(targets, {
      workbenchId: 'builtin.pdf',
      label: 'PDF',
      types: {
        textRange: PDF_TEXT_RANGE_ANCHOR_TYPE,
        page: PDF_PAGE_ANCHOR_TYPE,
        region: PDF_REGION_ANCHOR_TYPE,
        version: PDF_PAGE_ANCHOR_VERSION,
      },
    });
  },
} satisfies MainWorkbenchFeatureContribution);
