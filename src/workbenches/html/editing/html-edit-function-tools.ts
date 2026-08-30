import {
  AgentFunctionToolExecutionError,
  type AgentFunctionToolDefinition,
} from '../../../main/agents/function-tools/agent-function-tool';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { HtmlEditError } from './html-document-parser';
import { HtmlEditingRecoveryError } from './html-editing-session-file';
import type { HtmlAgentEditingService } from './html-agent-editing-service';
import {
  HTML_BEGIN_EDIT_INPUT_SCHEMA,
  HTML_BEGIN_EDIT_TOOL_ID,
  HTML_REPLACE_EDIT_INPUT_SCHEMA,
  HTML_REPLACE_EDIT_TOOL_ID,
  htmlDomAnchorFromTarget,
  parseHtmlBeginEditInput,
  parseHtmlReplaceEditInput,
} from './html-edit-tool-contracts';

function modelError(error: unknown): AgentFunctionToolExecutionError {
  if (error instanceof HtmlEditError) {
    return new AgentFunctionToolExecutionError(error.message);
  }
  if (error instanceof HtmlEditingRecoveryError) {
    return new AgentFunctionToolExecutionError(error.message);
  }
  return new AgentFunctionToolExecutionError('HTML 编辑失败，请重新 begin 后再试');
}

export function createHtmlEditFunctionTools(
  service: HtmlAgentEditingService,
): readonly AgentFunctionToolDefinition[] {
  return [
    {
      id: HTML_BEGIN_EDIT_TOOL_ID,
      version: 1,
      description:
        '在当前 HTML 草稿中定位一个元素并冻结其 contents 或完整 element 源码区域。修改前必须先调用此工具。',
      inputSchema: HTML_BEGIN_EDIT_INPUT_SCHEMA,
      async execute(input, context) {
        const parsed = parseHtmlBeginEditInput(input);
        if (!parsed) {
          throw new AgentFunctionToolExecutionError('html_begin_edit 输入无效');
        }
        try {
          return (await service.begin(
            {
              scope: parsed.scope,
              locator:
                parsed.locator.kind === 'selector'
                  ? parsed.locator
                  : {
                      kind: 'dom-anchor',
                      anchor: htmlDomAnchorFromTarget(parsed.locator.target),
                    },
            },
            context,
          )) as unknown as JsonValue;
        } catch (error) {
          throw modelError(error);
        }
      },
    },
    {
      id: HTML_REPLACE_EDIT_TOOL_ID,
      version: 1,
      description:
        '替换 html_begin_edit 已冻结的区域。所有非 void HTML 元素必须显式闭合；成功后页面会刷新。',
      inputSchema: HTML_REPLACE_EDIT_INPUT_SCHEMA,
      async execute(input, context) {
        const parsed = parseHtmlReplaceEditInput(input);
        if (!parsed) {
          throw new AgentFunctionToolExecutionError('html_replace_edit 输入无效');
        }
        try {
          return (await service.replace(
            parsed.editId,
            parsed.html,
            context,
          )) as unknown as JsonValue;
        } catch (error) {
          throw modelError(error);
        }
      },
    },
  ];
}
