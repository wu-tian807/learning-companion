import { describe, expect, it, vi } from 'vitest';

import {
  AgentFunctionToolExecutionError,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import { createHtmlDomTarget } from '../shared';
import { createHtmlEditFunctionTools } from './html-edit-function-tools';
import { HtmlEditValidationError } from './html-fragment-validator';
import { HtmlSourceEditError } from './html-source-editor';

const context: AgentFunctionToolExecutionContext = {
  taskId: 'task-1',
  projectId: 'project-1',
  workspaces: {
    primary: {
      key: 'workbench-conversation',
      instanceKey: 'conversation-1',
      path: 'C:\\workspace',
      permissions: { read: true, write: false },
    },
    secondary: [],
  },
};

describe('HTML edit function tools', () => {
  it('passes a trusted DOM target to the HTML Workbench runtime', async () => {
    const begin = vi.fn(async () => ({ editId: 'edit-1' }));
    const tools = createHtmlEditFunctionTools({
      begin,
      replace: vi.fn(),
    });
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: [1, 0],
        tagName: 'p',
        textQuote: 'Before',
      },
    });

    await tools[0]!.execute(
      {
        locator: { kind: 'dom-anchor', target },
        scope: 'element',
      },
      context,
    );

    expect(begin).toHaveBeenCalledWith(
      {
        locator: {
          kind: 'dom-anchor',
          anchor: target.targetPayload,
        },
        scope: 'element',
      },
      context,
    );
  });

  it('returns controlled locator failures to the model for repair', async () => {
    const tools = createHtmlEditFunctionTools({
      begin: vi.fn(async () => {
        throw new HtmlSourceEditError(
          'TARGET_NOT_UNIQUE',
          'selector 必须唯一匹配一个元素',
        );
      }),
      replace: vi.fn(),
    });

    await expect(tools[0]!.execute(
      {
        locator: { kind: 'selector', selector: '.item' },
        scope: 'contents',
      },
      context,
    )).rejects.toMatchObject({
      name: AgentFunctionToolExecutionError.name,
      modelMessage: 'selector 必须唯一匹配一个元素',
    });
  });

  it('returns an unclosed replacement as a repairable tool failure', async () => {
    const tools = createHtmlEditFunctionTools({
      begin: vi.fn(),
      replace: vi.fn(async () => {
        throw new HtmlEditValidationError(
          'REPLACEMENT_NOT_CLOSED',
          '替换区域未闭合：<span> 必须有显式结束标签',
        );
      }),
    });

    await expect(
      tools[1]!.execute(
        { editId: 'edit-1', html: '<span>broken' },
        context,
      ),
    ).rejects.toMatchObject({
      name: AgentFunctionToolExecutionError.name,
      modelMessage: '替换区域未闭合：<span> 必须有显式结束标签',
    });
  });

  it('turns unexpected runtime errors into a safe repair instruction', async () => {
    const failure = new Error('C:\\private\\secret.html');
    const tools = createHtmlEditFunctionTools({
      begin: vi.fn(async () => {
        throw failure;
      }),
      replace: vi.fn(),
    });

    await expect(
      tools[0]!.execute(
        {
          locator: { kind: 'selector', selector: '#target' },
          scope: 'contents',
        },
        context,
      ),
    ).rejects.toMatchObject({
      name: AgentFunctionToolExecutionError.name,
      modelMessage: 'HTML 编辑失败，请重新 begin 后再试',
    });
  });
});
