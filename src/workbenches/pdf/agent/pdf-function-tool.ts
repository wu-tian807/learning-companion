import { lstat, readFile } from 'node:fs/promises';

import type {
  PDFDocumentProxy,
  TextItem,
} from 'pdfjs-dist/types/src/display/api';

import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  AgentFunctionToolExecutionError,
  type AgentFunctionToolContentResult,
  type AgentFunctionToolDefinition,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import {
  optionalWorkspaceToolString,
  requireWorkspaceToolObject,
  resolveReadableWorkspaceToolPath,
  workspaceToolInteger,
} from '../../../main/agents/function-tools/workspace/workspace-tool-paths';

export const PDF_READ_FUNCTION_TOOL_ID = 'workspace_read_pdf';

const maximumPdfBytes = 200 * 1024 * 1024;
const maximumTextPagesPerCall = 20;
const maximumRenderedPagesPerCall = 6;
const maximumRenderDimension = 2_400;
const defaultRenderScale = 1.5;

type PdfOperation = 'extract_text' | 'render_pages';

function requireOperation(
  input: Readonly<Record<string, unknown>>,
): PdfOperation {
  const operation = optionalWorkspaceToolString(input, 'operation');

  if (operation !== 'extract_text' && operation !== 'render_pages') {
    throw new AgentFunctionToolExecutionError(
      'operation 必须是 extract_text 或 render_pages。',
    );
  }

  return operation;
}

function renderScale(input: Readonly<Record<string, unknown>>): number {
  const value = input.scale;

  if (value === undefined) {
    return defaultRenderScale;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0.5 ||
    value > 2
  ) {
    throw new AgentFunctionToolExecutionError(
      'scale 必须是 0.5 到 2 之间的数字。',
    );
  }

  return value;
}

function isTextItem(value: unknown): value is TextItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'str' in value &&
    typeof (value as { readonly str?: unknown }).str === 'string'
  );
}

function pageText(items: readonly unknown[]): string {
  let result = '';

  for (const item of items) {
    if (!isTextItem(item)) {
      continue;
    }

    result += item.str;
    result += item.hasEOL ? '\n' : ' ';
  }

  return result
    .replaceAll(/[^\S\r\n]+\n/gu, '\n')
    .replaceAll(/\n{3,}/gu, '\n\n')
    .trim();
}

function validatePageRange(
  input: Readonly<Record<string, unknown>>,
  pageCount: number,
  operation: PdfOperation,
): { readonly startPage: number; readonly endPage: number } {
  const startPage = workspaceToolInteger(input, 'startPage', 1, 1, pageCount);
  const endPage = workspaceToolInteger(
    input,
    'endPage',
    startPage,
    1,
    pageCount,
  );

  if (endPage < startPage) {
    throw new AgentFunctionToolExecutionError(
      'endPage 不能小于 startPage。',
    );
  }

  const requestedPages = endPage - startPage + 1;
  const maximumPages =
    operation === 'extract_text'
      ? maximumTextPagesPerCall
      : maximumRenderedPagesPerCall;

  if (requestedPages > maximumPages) {
    throw new AgentFunctionToolExecutionError(
      `${operation} 每次最多处理 ${maximumPages} 页，请把页段拆成多次调用。`,
    );
  }

  return { startPage, endPage };
}

async function extractText(
  document: PDFDocumentProxy,
  target: { readonly workspace: { readonly key: string }; readonly relativePath: string },
  input: Readonly<Record<string, unknown>>,
  context: AgentFunctionToolExecutionContext,
  startPage: number,
  endPage: number,
): Promise<string> {
  const maximumCharacters = workspaceToolInteger(
    input,
    'maxCharacters',
    30_000,
    1_000,
    80_000,
  );
  const output: string[] = [];
  let characterCount = 0;
  let truncated = false;

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    context.signal?.throwIfAborted();
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const extracted = pageText(content.items);
    const header = `--- page ${pageNumber}/${document.numPages} ---\n`;
    const remaining = maximumCharacters - characterCount - header.length;

    if (remaining <= 0) {
      truncated = true;
      break;
    }

    output.push(header);
    if (extracted.length > remaining) {
      output.push(extracted.slice(0, remaining));
      truncated = true;
      break;
    }

    output.push(extracted);
    characterCount += header.length + extracted.length;
  }

  return [
    `workspace=${target.workspace.key} path=${target.relativePath} pages=${startPage}-${endPage}/${document.numPages} operation=extract_text truncated=${truncated}`,
    ...output,
  ].join('\n');
}

async function renderPages(
  document: PDFDocumentProxy,
  target: { readonly workspace: { readonly key: string }; readonly relativePath: string },
  input: Readonly<Record<string, unknown>>,
  context: AgentFunctionToolExecutionContext,
  startPage: number,
  endPage: number,
): Promise<AgentFunctionToolContentResult> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const requestedScale = renderScale(input);
  const items: AgentFunctionToolContentResult['items'][number][] = [
    {
      type: 'text',
      text: `workspace=${target.workspace.key} path=${target.relativePath} pages=${startPage}-${endPage}/${document.numPages} operation=render_pages`,
    },
  ];

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    context.signal?.throwIfAborted();
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const boundedScale = Math.min(
      requestedScale,
      maximumRenderDimension / Math.max(baseViewport.width, baseViewport.height),
    );
    const viewport = page.getViewport({ scale: boundedScale });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );

    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      background: '#ffffff',
    }).promise;
    context.signal?.throwIfAborted();

    const image = await canvas.encode('png');
    items.push(
      {
        type: 'text',
        text: `--- page ${pageNumber}/${document.numPages} ---`,
      },
      {
        type: 'image',
        url: `data:image/png;base64,${image.toString('base64')}`,
      },
    );
  }

  return { kind: 'content', items };
}

async function executeReadPdf(
  value: JsonValue,
  context: AgentFunctionToolExecutionContext,
) {
  const input = requireWorkspaceToolObject(value);
  const operation = requireOperation(input);
  const target = await resolveReadableWorkspaceToolPath(context, input);
  const stats = await lstat(target.absolutePath);

  if (!stats.isFile() || !target.relativePath.toLocaleLowerCase().endsWith('.pdf')) {
    throw new AgentFunctionToolExecutionError(
      'workspace_read_pdf 的 path 必须指向 PDF 文件。',
    );
  }

  if (stats.size > maximumPdfBytes) {
    throw new AgentFunctionToolExecutionError('PDF 文件超过 200 MiB 上限。');
  }

  context.signal?.throwIfAborted();
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = new Uint8Array(await readFile(target.absolutePath));
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      useSystemFonts: true,
    });

    try {
      const document = await loadingTask.promise;
      const { startPage, endPage } = validatePageRange(
        input,
        document.numPages,
        operation,
      );

      return operation === 'extract_text'
        ? await extractText(
            document,
            target,
            input,
            context,
            startPage,
            endPage,
          )
        : await renderPages(
            document,
            target,
            input,
            context,
            startPage,
            endPage,
          );
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof AgentFunctionToolExecutionError) {
      throw error;
    }

    throw new AgentFunctionToolExecutionError(
      'PDF 无法处理；文件可能已损坏、加密或使用了不受支持的编码。',
    );
  }
}

export const pdfFunctionTool: AgentFunctionToolDefinition =
  Object.freeze({
    id: PDF_READ_FUNCTION_TOOL_ID,
    version: 4,
    description:
      'Read a PDF inside an authorized Learning Companion workspace. Start with extract_text on manageable page ranges to locate relevant sections. It reads embedded PDF text only and is not OCR. Sparse, empty, or garbled text does not prove that a page is blank. Use render_pages for every relevant page and whenever formulas, tables, figures, layout, or missing text matter; do not form the final answer from extracted text alone. Page ranges are inclusive.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['extract_text', 'render_pages'],
          description:
            'extract_text returns embedded PDF text only and is not OCR; render_pages returns one model-visible image per page for visual verification.',
        },
        workspaceKey: {
          type: 'string',
          description: 'Workspace key. Omit to use the primary workspace.',
        },
        path: { type: 'string', description: 'Relative PDF file path.' },
        startPage: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description: 'First page, inclusive.',
        },
        endPage: {
          type: 'integer',
          minimum: 1,
          description:
            'Last page, inclusive. Defaults to startPage. Text allows 20 pages; rendering allows 6 pages per call.',
        },
        maxCharacters: {
          type: 'integer',
          minimum: 1_000,
          maximum: 80_000,
          default: 30_000,
          description:
            'Maximum returned characters for extract_text. The result reports truncated=true when this limit is reached.',
        },
        scale: {
          type: 'number',
          minimum: 0.5,
          maximum: 2,
          default: 1.5,
          description:
            'Raster scale for render_pages. Use the 1.5 default for normal pages, raise toward 2 only for small text or formulas, and lower it only when speed and image size matter more than fine detail.',
        },
      },
      required: ['operation', 'path'],
      additionalProperties: false,
    },
    deferLoading: true,
    execute: executeReadPdf,
  });
