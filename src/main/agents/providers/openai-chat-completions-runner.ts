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

export type OpenAiChatContentPart =
  | {
      readonly type: 'text';
      readonly text: string;
    }
  | {
      readonly type: 'image_url';
      readonly image_url: {
        readonly url: string;
        readonly detail?: 'auto' | 'low' | 'high' | 'original';
      };
    };

export interface OpenAiChatHistoryMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly OpenAiChatContentPart[];
}

export interface OpenAiChatCompletionsRunnerOptions {
  readonly providerId: string;
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** projectId/workspaceKey/instanceKey → 已发送消息。 */
  readonly histories: Map<string, readonly OpenAiChatHistoryMessage[]>;
  readonly now?: () => number;
  readonly fetchImpl?: ChatCompletionsFetch;
  readonly readFileImpl?: (filePath: string) => Promise<Buffer>;
}

export interface ChatCompletionsFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly text: () => Promise<string>;
}

export type ChatCompletionsFetch = (
  url: string,
  init: RequestInit,
) => Promise<ChatCompletionsFetchResponse>;

export interface OpenAiChatCompletionsRunnerDependencies {
  readonly now: () => number;
  readonly fetchImpl: ChatCompletionsFetch;
  readonly readFileImpl: (filePath: string) => Promise<Buffer>;
}

const defaultDependencies: OpenAiChatCompletionsRunnerDependencies = {
  now: Date.now,
  fetchImpl: async (url, init) => {
    const response = await fetch(url, init);
    return {
      ok: response.ok,
      status: response.status,
      body: response.body ?? undefined,
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
  return `openai-chat-${(hash >>> 0).toString(36)}`;
}

function imageMediaTypeFromPath(filePath: string): string | undefined {
  return IMAGE_EXTENSION_MEDIA_TYPES[extname(filePath).toLowerCase()];
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/u, '');
}

async function* ssePayloads(body: unknown): AsyncGenerator<string> {
  if (!body || typeof body !== 'object') return;
  const withReader = body as {
    getReader?(): {
      read(): Promise<{
        readonly done: boolean;
        readonly value?: Uint8Array;
      }>;
    };
  };
  const iterable = body as AsyncIterable<Uint8Array>;
  const reader =
    typeof withReader.getReader === 'function'
      ? withReader.getReader()
      : undefined;
  let iterator: AsyncIterator<Uint8Array> | undefined;
  const decoder = new TextDecoder();
  let buffer = '';
  const nextChunk = async (): Promise<Uint8Array | undefined> => {
    if (reader) {
      const { done, value } = await reader.read();
      return done ? undefined : value;
    }
    iterator ??= iterable[Symbol.asyncIterator]();
    const next = await iterator.next();
    return next.done ? undefined : (next.value as Uint8Array);
  };
  let chunk = await nextChunk();
  while (chunk !== undefined) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload.length > 0 && payload !== '[DONE]') {
          yield payload;
        }
      }
      newline = buffer.indexOf('\n');
    }
    chunk = await nextChunk();
  }
  const remaining = buffer.trim();
  if (remaining.startsWith('data:')) {
    const payload = remaining.slice(5).trim();
    if (payload.length > 0 && payload !== '[DONE]') {
      yield payload;
    }
  }
}

export class OpenAiChatCompletionsRunner
  implements GenerationAgentRunner
{
  readonly providerId: string;
  readonly connectionId: string;
  private readonly options: OpenAiChatCompletionsRunnerOptions;
  private readonly dependencies: OpenAiChatCompletionsRunnerDependencies;

  constructor(
    options: OpenAiChatCompletionsRunnerOptions,
    dependencies: Partial<OpenAiChatCompletionsRunnerDependencies> = {},
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
        cause: new Error(
          'Chat Completions 通道暂不支持工具/Skill/MCP 调用',
        ),
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

    const userParts = await this.toChatParts(request);
    const previous = this.options.histories.get(key) ?? [];
    const messages: OpenAiChatHistoryMessage[] = [
      {
        role: 'system',
        content: request.systemInstruction,
      },
      ...previous.map((message) => ({ ...message })),
      {
        role: 'user',
        content: userParts,
      },
    ];
    const endpoint = `${trimBaseUrl(this.options.baseUrl)}/chat/completions`;
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    const modelId = request.modelId?.trim();
    if (!modelId) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error('Chat Completions 通道必须指定模型 ID'),
      });
    }

    try {
      const response = await this.dependencies.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          stream: true,
          messages,
        }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new AppError('GENERATION_OUTPUT_INVALID', {
          cause: new Error(
            `Chat Completions 接口返回 ${response.status}${
              detail ? `：${detail.slice(0, 500)}` : ''
            }`,
          ),
        });
      }

      let text = '';
      let executionId: string | undefined;
      let usage:
        | {
            readonly inputTokens?: number;
            readonly outputTokens?: number;
            readonly totalTokens?: number;
          }
        | undefined;
      for await (const payload of ssePayloads(response.body)) {
        request.signal?.throwIfAborted();
        let event: unknown;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (!event || typeof event !== 'object') continue;
        const record = event as Record<string, unknown>;
        if (typeof record.id === 'string') {
          executionId = record.id;
        }
        const choices = Array.isArray(record.choices)
          ? (record.choices as readonly Record<string, unknown>[])
          : [];
        const delta = choices[0]?.delta as Record<string, unknown> | undefined;
        const deltaText =
          typeof delta?.content === 'string' ? delta.content : '';
        if (deltaText) {
          text += deltaText;
          yield { type: 'assistant-delta', delta: deltaText };
        }
        const usageRecord = record.usage as Record<string, unknown> | undefined;
        if (usageRecord && typeof usageRecord === 'object') {
          const inputTokens =
            typeof usageRecord.prompt_tokens === 'number'
              ? usageRecord.prompt_tokens
              : undefined;
          const outputTokens =
            typeof usageRecord.completion_tokens === 'number'
              ? usageRecord.completion_tokens
              : undefined;
          const totalTokens =
            typeof usageRecord.total_tokens === 'number'
              ? usageRecord.total_tokens
              : undefined;
          if (
            inputTokens !== undefined ||
            outputTokens !== undefined ||
            totalTokens !== undefined
          ) {
            usage = {
              ...(inputTokens === undefined ? {} : { inputTokens }),
              ...(outputTokens === undefined ? {} : { outputTokens }),
              ...(totalTokens === undefined ? {} : { totalTokens }),
            };
            yield { type: 'usage-updated', usage };
          }
        }
      }

      const normalized = text.trim();
      if (!normalized) {
        throw new AppError('GENERATION_OUTPUT_INVALID', {
          cause: new Error('Chat Completions 返回了空回答'),
        });
      }
      this.options.histories.set(key, [
        ...previous.slice(-40),
        { role: 'user', content: userParts },
        { role: 'assistant', content: normalized },
      ]);
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

  private async toChatParts(
    request: GenerationAgentTurnRequest,
  ): Promise<readonly OpenAiChatContentPart[]> {
    const parts: OpenAiChatContentPart[] = [];
    for (const part of request.userMessage.content) {
      if (part.type === 'text') {
        const text = part.text.trim();
        if (text) {
          parts.push({ type: 'text', text });
        }
        continue;
      }
      if (part.type === 'local-audio') {
        throw new AppError('FEATURE_NOT_SUPPORTED', {
          cause: new Error('Chat Completions 通道暂不支持音频输入'),
        });
      }
      const mediaType = imageMediaTypeFromPath(part.path);
      const bytes = await this.dependencies.readFileImpl(part.path);
      if (!mediaType || bytes.byteLength === 0) {
        throw new AppError('DATA_INTEGRITY_ERROR', {
          cause: new Error('图片文件缺失或类型不受支持'),
        });
      }
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${bytes.toString('base64')}`,
          ...(part.detail ? { detail: part.detail } : {}),
        },
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
