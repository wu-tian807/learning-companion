import {
  AgentFunctionToolExecutionError,
  type AgentFunctionToolDefinition,
  type AgentFunctionToolExecutionContext,
} from '../../../main/agents/function-tools/agent-function-tool';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  HTML_DOM_ANCHOR_TYPE,
  HTML_DOM_ANCHOR_VERSION,
  isHtmlDomTarget,
  type HtmlDomAnchorV1,
} from '../shared';
import { HtmlEditValidationError } from './html-fragment-validator';
import {
  HTML_EDIT_LIMITS,
  HtmlSourceEditError,
} from './html-source-editor';

export const HTML_BEGIN_EDIT_TOOL_ID = 'html_begin_edit';
export const HTML_REPLACE_EDIT_TOOL_ID = 'html_replace_edit';

export interface HtmlEditToolRuntime {
  canEdit?(projectId: string, assetId: string): Promise<boolean>;
  begin(
    request: {
      readonly locator:
        | { readonly kind: 'selector'; readonly selector: string }
        | { readonly kind: 'dom-anchor'; readonly anchor: HtmlDomAnchorV1 };
      readonly scope: 'contents' | 'element';
    },
    context: AgentFunctionToolExecutionContext,
  ): Promise<JsonValue>;
  replace(
    editId: string,
    html: string,
    context: AgentFunctionToolExecutionContext,
  ): Promise<JsonValue>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asModelError(error: unknown): never {
  if (
    error instanceof HtmlEditValidationError ||
    error instanceof HtmlSourceEditError
  ) {
    throw new AgentFunctionToolExecutionError(error.message);
  }
  throw new AgentFunctionToolExecutionError(
    'HTML 编辑失败，请重新 begin 后再试',
  );
}

const beginInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['locator', 'scope'],
  properties: {
    locator: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'selector'],
          properties: {
            kind: { const: 'selector' },
            selector: {
              type: 'string',
              minLength: 1,
              maxLength: HTML_EDIT_LIMITS.selectorLength,
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'target'],
          properties: {
            kind: { const: 'dom-anchor' },
            target: {
              type: 'object',
              additionalProperties: false,
              required: [
                'scope',
                'targetType',
                'targetVersion',
                'targetPayload',
              ],
              properties: {
                scope: { const: 'content' },
                targetType: { const: HTML_DOM_ANCHOR_TYPE },
                targetVersion: { const: HTML_DOM_ANCHOR_VERSION },
                targetPayload: { type: 'object' },
              },
            },
          },
        },
      ],
    },
    scope: { type: 'string', enum: ['contents', 'element'] },
  },
} as const satisfies JsonValue;

const replaceInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['editId', 'html'],
  properties: {
    editId: { type: 'string', minLength: 1, maxLength: 256 },
    html: {
      type: 'string',
      maxLength: HTML_EDIT_LIMITS.replacementLength,
    },
  },
} as const satisfies JsonValue;

export function createHtmlEditFunctionTools(
  runtime: HtmlEditToolRuntime,
): readonly AgentFunctionToolDefinition[] {
  return [
    {
      id: HTML_BEGIN_EDIT_TOOL_ID,
      version: 1,
      description:
        '在当前 HTML 草稿中定位一个元素并冻结其内部内容或完整元素。修改前必须先调用此工具。',
      inputSchema: beginInputSchema,
      async execute(input, context) {
        const locator = isRecord(input) ? input.locator : undefined;
        const parsedLocator =
          isRecord(locator) &&
          locator.kind === 'selector' &&
          typeof locator.selector === 'string' &&
          locator.selector.trim().length > 0 &&
          locator.selector.length <= HTML_EDIT_LIMITS.selectorLength &&
          Object.keys(locator).every(
            (key) => key === 'kind' || key === 'selector',
          )
            ? { kind: 'selector' as const, selector: locator.selector }
            : isRecord(locator) &&
                locator.kind === 'dom-anchor' &&
                isHtmlDomTarget(locator.target) &&
                Object.keys(locator).every(
                  (key) => key === 'kind' || key === 'target',
                )
              ? {
                  kind: 'dom-anchor' as const,
                  anchor: locator.target.targetPayload as unknown as HtmlDomAnchorV1,
                }
              : undefined;
        if (
          !isRecord(input) ||
          Object.keys(input).some(
            (key) => key !== 'locator' && key !== 'scope',
          ) ||
          !parsedLocator ||
          (input.scope !== 'contents' && input.scope !== 'element')
        ) {
          throw new AgentFunctionToolExecutionError('html_begin_edit 输入无效');
        }
        try {
          return await runtime.begin(
            { locator: parsedLocator, scope: input.scope },
            context,
          );
        } catch (error) {
          return asModelError(error);
        }
      },
    },
    {
      id: HTML_REPLACE_EDIT_TOOL_ID,
      version: 1,
      description:
        '替换 html_begin_edit 已冻结的区域。所有非 void HTML 元素必须显式闭合；成功后页面会刷新。',
      inputSchema: replaceInputSchema,
      async execute(input, context) {
        if (
          !isRecord(input) ||
          Object.keys(input).some(
            (key) => key !== 'editId' && key !== 'html',
          ) ||
          typeof input.editId !== 'string' ||
          input.editId.trim().length === 0 ||
          input.editId.length > 256 ||
          typeof input.html !== 'string' ||
          input.html.length > HTML_EDIT_LIMITS.replacementLength
        ) {
          throw new AgentFunctionToolExecutionError(
            'html_replace_edit 输入无效',
          );
        }
        try {
          return await runtime.replace(
            input.editId,
            input.html,
            context,
          );
        } catch (error) {
          return asModelError(error);
        }
      },
    },
  ];
}
