import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isAgentFunctionToolContentResult,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import {
  pdfFunctionTool,
} from './pdf-function-tool';

function executionContext(
  workspacePath: string,
): AgentFunctionToolExecutionContext {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    workspaces: {
      primary: {
        key: 'generation-mindmap',
        scope: 'task',
        instanceKey: 'task-1',
        path: workspacePath,
        permissions: { read: true, write: false },
      },
      secondary: [],
    },
  };
}

function minimalPdf(pageTexts: readonly string[]): Uint8Array {
  const pageCount = pageTexts.length;
  const fontObjectId = pageCount + 3;
  const firstContentObjectId = fontObjectId + 1;
  const pageObjectIds = pageTexts.map((_, index) => index + 3);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...pageTexts.map((_, index) => {
      const contentObjectId = firstContentObjectId + index;
      return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageTexts.map((text) => {
      const escaped = text
        .replaceAll('\\', '\\\\')
        .replaceAll('(', '\\(')
        .replaceAll(')', '\\)');
      const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('workspace PDF function tool', () => {
  it('extracts text from an inclusive PDF page range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-pdf-'));
    await writeFile(
      join(root, 'paper.pdf'),
      minimalPdf(['First PDF page', 'Second PDF page']),
    );

    const result = await pdfFunctionTool.execute(
      {
        operation: 'extract_text',
        path: 'paper.pdf',
        startPage: 1,
        endPage: 2,
      },
      executionContext(root),
    );

    expect(result).toEqual(expect.stringContaining('pages=1-2/2'));
    expect(result).toEqual(expect.stringContaining('page 1/2'));
    expect(result).toEqual(expect.stringContaining('First PDF page'));
    expect(result).toEqual(expect.stringContaining('Second PDF page'));
  }, 15_000);

  it('tells the Agent how to handle sparse embedded text and visual details', () => {
    expect(pdfFunctionTool.description).toContain(
      'Sparse, empty, or garbled text does not prove that a page is blank',
    );
    expect(pdfFunctionTool.description).toContain(
      'Use render_pages for every relevant page',
    );

    const schema = pdfFunctionTool.inputSchema as {
      readonly properties: {
        readonly scale: { readonly description: string };
      };
    };
    expect(schema.properties.scale.description).toContain(
      'raise toward 2 only for small text or formulas',
    );
  });

  it('renders one model-visible PNG for every requested PDF page', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-pdf-'));
    await writeFile(
      join(root, 'paper.pdf'),
      minimalPdf(['First PDF page', 'Second PDF page']),
    );

    const result = await pdfFunctionTool.execute(
      {
        operation: 'render_pages',
        path: 'paper.pdf',
        startPage: 1,
        endPage: 2,
        scale: 1,
      },
      executionContext(root),
    );

    expect(isAgentFunctionToolContentResult(result)).toBe(true);
    if (!isAgentFunctionToolContentResult(result)) {
      throw new Error('Expected a rich PDF render result');
    }
    expect(result.items.filter(({ type }) => type === 'image')).toHaveLength(2);
    expect(
      result.items
        .filter((item) => item.type === 'image')
        .every(({ url }) => url.startsWith('data:image/png;base64,')),
    ).toBe(true);
  });

  it('rejects PDF paths outside the selected workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-workspace-pdf-'));

    await expect(
      pdfFunctionTool.execute(
        { operation: 'extract_text', path: '../outside.pdf' },
        executionContext(root),
      ),
    ).rejects.toThrow('相对路径');
  });
});
