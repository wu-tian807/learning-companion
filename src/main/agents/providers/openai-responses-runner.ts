import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { AppError } from '../../errors/app-error';
import type {
  GenerationAgentEvent,
  GenerationAgentRunner,
  GenerationAgentTurnRequest,
  GenerationAgentTurnResult,
} from '../../generation/generation-agent-runner';
import type { AgentSessionLocator } from '../sessions/agent-session';

const IMAGE_EXTENSION_MEDIA_TYPES: Readonly<Record<string, string>> =
  Object.freeze({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  });

export interface OpenAiResponsesRunnerOptions {
  readonly providerId: string;
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** projectId/workspaceKey/instanceKey → previous response id。 */
  readonly previousResponses: Map<string, string>;
  readonly now?: () => number;
  readonly fetchImpl?: OpenAiResponsesFetch;
  readonly readFileImpl?: (filePath: string) => Promise<Buffer>;
}

export interface OpenAiResponsesFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

export type OpenAiResponsesFetch = (
  url: string,
  init: RequestInit,
) => Promise<OpenAiResponsesFetchResponse>;

export interface OpenAiResponsesRunnerDependencies {
  readonly now: () => number;
  readonly fetchImpl: OpenAiResponsesFetch;
  readonly readFileImpl: (filePath: string) => Promise<Buffer>;
}

const defaultDependencies: OpenAiResponsesRunnerDependencies = {
  now: Date.now,
  fetchImpl: async (url, init) => {
    const response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
    };
  },
  readFileImpl: readFile,
};

function historyKey(locator: AgentSessionLocator): string {
  return JSON.stringify([
    locator.projectId,
    locator.workspaceKey,
    locator.instanceKey,
  ]);
}

function sessionIdFor(
  providerId: string,
  connectionId: string,
  key: string,
): string {
  let hash = 0;
  const input = `${providerId}:${connectionId}:${key}`;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return `openai-responses-${(hash >>> 0).toString(36)}`;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/u, '');
}

interface ResponseContentPart {
  readonly type: string;
  readonly text?: string;
  readonly image_url?: string;
}

export class OpenAiResponsesRunner implements GenerationAgentRunner {
  readonly providerId: string;
  readonly connectionId: string;
  private readonly options: OpenAiResponsesRunnerOptions;
  private readonly dependencies: OpenAiResponsesRunnerDependencies;

  constructor(
    options: OpenAiResponsesRunnerOptions,
    dependencies: Partial<OpenAiResponsesRunnerDependencies> = {},
  ) {
    this.options = options;
    this.providerId = options.providerId;
    this.connectionId = options.connectionId;
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
  }

  async *runTurn(
    request: GenerationAgentTurnRequest,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult> {
    if (
      request.toolRequirements.length > 0 ||
      request.skills.length > 0 ||
      request.mcpServers.length > 0
    ) {
      throw new AppError('FEATURE_NOT_SUPPORTED', {
        cause: new Error('Responses 视觉通道暂不支持工具/Skill/MCP 调用'),
      });
    }
    const modelId = request.modelId?.trim();
    if (!modelId) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error('Responses 通道必须指定模型 ID'),
      });
    }
    const startedTime = this.dependencies.now();
    const key = historyKey(request.sessionLocator);
    const sessionId = sessionIdFor(
      this.providerId,
      this.connectionId,
      key,
    );
    yield { type: 'session-resolved', sessionId };

    const content = await this.toResponsesParts(request);
    const previousResponseId = this.options.previousResponses.get(key);
    const endpoint = `${trimBaseUrl(this.options.baseUrl)}/responses`;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal?.addEventListener('abort', abort, { once: true });

    try {
      const response = await this.dependencies.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          instructions: request.systemInstruction,
          input: [
            {
              role: 'user',
              content,
            },
          ],
          ...(previousResponseId
            ? { previous_response_id: previousResponseId }
            : {}),
          stream: false,
        }),
        signal: abortController.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new AppError('GENERATION_OUTPUT_INVALID', {
          cause: new Error(
            `Responses 接口返回 ${response.status}${
              body ? `：${body.slice(0, 500)}` : ''
            }`,
          ),
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new AppError('GENERATION_OUTPUT_INVALID', {
          cause: new Error('Responses 接口返回了无效 JSON'),
        });
      }
      const record = parsed as Record<string, unknown>;
      const executionId =
        typeof record.id === 'string' ? record.id : undefined;
      const output = Array.isArray(record.output)
        ? (record.output as readonly Record<string, unknown>[])
        : [];
      const assistantText = output
        .filter((item) => item.type === 'message')
        .flatMap((item) =>
          Array.isArray(item.content)
            ? (item.content as readonly Record<string, unknown>[])
            : [],
        )
        .filter((part) => part.type === 'output_text')
        .map((part) =>
          typeof part.text === 'string' ? part.text : '',
        )
        .join('');
      const normalized = assistantText.trim();
      if (!normalized) {
        throw new AppError('GENERATION_OUTPUT_INVALID', {
          cause: new Error('Responses 返回了空回答'),
        });
      }

      if (executionId) {
        this.options.previousResponses.set(key, executionId);
      }
      const usageRecord = record.usage as Record<string, unknown> | undefined;
      const usage =
        usageRecord && typeof usageRecord === 'object'
          ? {
              ...(typeof usageRecord.input_tokens === 'number'
                ? { inputTokens: usageRecord.input_tokens }
                : {}),
              ...(typeof usageRecord.output_tokens === 'number'
                ? { outputTokens: usageRecord.output_tokens }
                : {}),
              ...(typeof usageRecord.total_tokens === 'number'
                ? { totalTokens: usageRecord.total_tokens }
                : {}),
            }
          : undefined;

      yield { type: 'assistant-completed', text: normalized };
      const completedTime = this.dependencies.now();
      return Object.freeze({
        sessionId,
        providerId: this.providerId,
        connectionId: this.connectionId,
        modelId,
        ...(executionId ? { providerExecutionId: executionId } : {}),
        startedTime,
        completedTime,
        activeDurationMs: Math.max(0, completedTime - startedTime),
        assistantOutput: normalized,
        ...(usage ? { usage } : {}),
      });
    } finally {
      request.signal?.removeEventListener('abort', abort);
    }
  }

  private async toResponsesParts(
    request: GenerationAgentTurnRequest,
  ): Promise<readonly ResponseContentPart[]> {
    const parts: ResponseContentPart[] = [];
    for (const part of request.userMessage.content) {
      if (part.type === 'text') {
        const text = part.text.trim();
        if (text) parts.push({ type: 'input_text', text });
        continue;
      }
      if (part.type === 'local-audio') {
        throw new AppError('FEATURE_NOT_SUPPORTED', {
          cause: new Error('Responses 视觉通道暂不支持音频输入'),
        });
      }
      const mediaType =
        IMAGE_EXTENSION_MEDIA_TYPES[extname(part.path).toLowerCase()];
      const bytes = await this.dependencies.readFileImpl(part.path);
      if (!mediaType || bytes.byteLength === 0) {
        throw new AppError('DATA_INTEGRITY_ERROR', {
          cause: new Error('图片文件缺失或类型不受支持'),
        });
      }
      parts.push({
        type: 'input_image',
        image_url: `data:${mediaType};base64,${bytes.toString('base64')}`,
      });
    }
    if (parts.length === 0) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error('用户消息没有可发送内容'),
      });
    }
    return parts;
  }
}
