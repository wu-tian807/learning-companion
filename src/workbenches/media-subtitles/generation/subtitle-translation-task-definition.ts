import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
} from '../../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type {
  GenerationTaskProcessContext,
  TaskDefinition,
} from '../../../main/generation/contracts/task-definition';
import {
  GenerationOutputValidationError,
  type GenerationValidationIssue,
} from '../../../main/generation/contracts/generation-validation';
import { AppError } from '../../../main/errors/app-error';
import type { ProjectLookup } from '../../../main/projects/project-database';
import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../shared/agent-provider-selectors';
import type { JsonValue } from '../../../shared/workbench/protocol';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  type SubtitleCueV1,
  type SubtitleTranslationCueV1,
  type SubtitleTranslationTrackV1,
  type TranslatableSubtitleLanguage,
} from '../contracts';
import { resolveCachedMediaSubtitleSource } from '../subtitle-source-artifact';
import {
  createSubtitleTranslationArtifactKey,
  MediaSubtitleTranslationProducer,
  SubtitleTranslationProgressHub,
} from '../translation-producer';
import {
  SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
  SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
  SubtitleTranslationInstruction,
  subtitleTranslationInstructionFactory,
} from './subtitle-translation-instruction';

const MAXIMUM_TARGET_CUES = 16;
const MAXIMUM_TARGET_CHARACTERS = 1_400;
const CONTEXT_CUE_COUNT = 3;

export type SubtitleTranslationTaskResult = JsonValue & {
  readonly assetId: string;
  readonly sourceTrackRevision: string;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly artifactRevision: string;
};

export interface SubtitleTranslationChunk {
  readonly index: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly previous: readonly SubtitleCueV1[];
  readonly targets: readonly SubtitleCueV1[];
  readonly next: readonly SubtitleCueV1[];
}

export interface SubtitleTranslationTaskDefinitionDependencies {
  readonly assets: AssetServiceApi;
  readonly artifacts: AssetArtifactServiceApi;
  readonly projects: ProjectLookup;
  readonly producer: MediaSubtitleTranslationProducer;
  readonly progress: SubtitleTranslationProgressHub;
  readonly now?: () => number;
}

function languageName(language: TranslatableSubtitleLanguage): string {
  return language === 'en' ? 'English' : '简体中文';
}

export function splitSubtitleTranslationChunks(
  cues: readonly SubtitleCueV1[],
): readonly SubtitleTranslationChunk[] {
  const chunks: SubtitleTranslationChunk[] = [];
  let startIndex = 0;
  while (startIndex < cues.length) {
    let endIndex = startIndex;
    let characters = 0;
    while (
      endIndex < cues.length &&
      endIndex - startIndex < MAXIMUM_TARGET_CUES
    ) {
      const cue = cues[endIndex]!;
      if (
        endIndex > startIndex &&
        characters + cue.text.length > MAXIMUM_TARGET_CHARACTERS
      ) {
        break;
      }
      characters += cue.text.length;
      endIndex += 1;
    }
    chunks.push(
      Object.freeze({
        index: chunks.length,
        startIndex,
        endIndex,
        previous: Object.freeze(
          cues.slice(Math.max(0, startIndex - CONTEXT_CUE_COUNT), startIndex),
        ),
        targets: Object.freeze(cues.slice(startIndex, endIndex)),
        next: Object.freeze(cues.slice(endIndex, endIndex + CONTEXT_CUE_COUNT)),
      }),
    );
    startIndex = endIndex;
  }
  return Object.freeze(chunks);
}

function promptCues(cues: readonly SubtitleCueV1[]) {
  return cues.map(({ id, text }) => ({ id, text }));
}

export function createSubtitleTranslationChunkPrompt(
  chunk: SubtitleTranslationChunk,
  sourceLanguage: TranslatableSubtitleLanguage,
  targetLanguage: TranslatableSubtitleLanguage,
): string {
  return [
    `把 target 中的字幕从 ${languageName(sourceLanguage)} 翻译为 ${languageName(targetLanguage)}。`,
    'previous 和 next 只用于理解代词、术语、语气和句间关系，禁止翻译或输出它们。',
    '保持口语自然、前后连贯、信息完整；不要增添解释。',
    '必须只输出一个 JSON 对象，格式为 {"translations":[{"id":"原 Cue ID","text":"译文"}]}。',
    'translations 必须与 target 数量、ID 和顺序完全一致。',
    '',
    JSON.stringify(
      {
        previous: promptCues(chunk.previous),
        target: promptCues(chunk.targets),
        next: promptCues(chunk.next),
      },
      null,
      2,
    ),
  ].join('\n');
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function outputIssues(
  value: string | undefined,
  targets: readonly SubtitleCueV1[],
): {
  readonly cues?: readonly SubtitleTranslationCueV1[];
  readonly issues: readonly GenerationValidationIssue[];
} {
  if (!value?.trim()) {
    return {
      issues: [{ path: 'assistantOutput', message: '模型没有返回字幕译文' }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(value));
  } catch {
    return {
      issues: [
        { path: 'assistantOutput', message: '模型返回的内容不是合法 JSON' },
      ],
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      issues: [
        { path: 'assistantOutput', message: '模型返回值必须是 JSON 对象' },
      ],
    };
  }
  const translations = (parsed as Record<string, unknown>).translations;
  if (!Array.isArray(translations) || translations.length !== targets.length) {
    return {
      issues: [
        {
          path: 'translations',
          message: `译文必须恰好包含 ${targets.length} 个 Cue`,
        },
      ],
    };
  }
  const issues: GenerationValidationIssue[] = [];
  const cues = translations.flatMap((entry, index) => {
    const target = targets[index]!;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push({
        path: `translations[${index}]`,
        message: 'Cue 必须是对象',
      });
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (record.id !== target.id) {
      issues.push({
        path: `translations[${index}].id`,
        message: `必须为 ${target.id}`,
      });
      return [];
    }
    if (typeof record.text !== 'string' || !record.text.trim()) {
      issues.push({
        path: `translations[${index}].text`,
        message: '译文不能为空',
      });
      return [];
    }
    return [
      Object.freeze({ sourceCueId: target.id, text: record.text.trim() }),
    ];
  });
  return issues.length > 0
    ? { issues: Object.freeze(issues) }
    : { cues: Object.freeze(cues), issues: Object.freeze([]) };
}

async function translateChunk(
  context: GenerationTaskProcessContext<SubtitleTranslationInstruction>,
  chunk: SubtitleTranslationChunk,
  chunkCount: number,
): Promise<readonly SubtitleTranslationCueV1[]> {
  const callKey = `translate-${String(chunk.index + 1).padStart(4, '0')}`;
  const prompt = createSubtitleTranslationChunkPrompt(
    chunk,
    context.instruction.sourceLanguage,
    context.instruction.targetLanguage,
  );
  const call = await context.agent.call({
    callKey,
    purpose: `翻译字幕第 ${chunk.index + 1}/${chunkCount} 段`,
    systemInstruction:
      '你是专业的中英双向字幕翻译员。严格保持输入 Cue 的身份和顺序，只翻译明确标记的 target。',
    userMessage: createTextAgentUserMessage(prompt),
    toolRequirements: Object.freeze([]),
    skills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    assistantEvents: 'none',
  });
  let parsed = outputIssues(call.assistantOutput, chunk.targets);
  if (parsed.cues) return parsed.cues;

  context.reportOutputRejected(1, parsed.issues);
  const repair = await context.agent.call({
    callKey: `${callKey}-repair`,
    purpose: `修复字幕第 ${chunk.index + 1}/${chunkCount} 段格式`,
    systemInstruction:
      '你只负责修复字幕翻译 JSON。不要解释，不要输出 Markdown。',
    userMessage: createTextAgentUserMessage(
      [
        prompt,
        '',
        '[上一次无效输出]',
        call.assistantOutput ?? '(empty)',
        '',
        '[校验问题]',
        ...parsed.issues.map((issue) => `${issue.path}: ${issue.message}`),
      ].join('\n'),
    ),
    toolRequirements: Object.freeze([]),
    skills: Object.freeze([]),
    mcpServers: Object.freeze([]),
    assistantEvents: 'none',
  });
  parsed = outputIssues(repair.assistantOutput, chunk.targets);
  if (!parsed.cues) throw new GenerationOutputValidationError(parsed.issues);
  return parsed.cues;
}

export function createSubtitleTranslationTaskDefinition(
  dependencies: SubtitleTranslationTaskDefinitionDependencies,
): TaskDefinition<
  SubtitleTranslationInstruction,
  SubtitleTranslationTaskResult
> {
  const now = dependencies.now ?? Date.now;
  return Object.freeze({
    id: SUBTITLE_TRANSLATION_TASK_DEFINITION_ID,
    version: SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION,
    providerSelectorId: WORKBENCH_AGENT_PROVIDER_SELECTOR_ID,
    primaryWorkspaceConfig: Object.freeze({
      key: 'media-subtitle-translation',
      permissions: Object.freeze({ read: false, write: false }),
    }),
    secondaryWorkspaceConfigs: Object.freeze([]),
    assetReferenceSchema: Object.freeze({}),
    instruction: subtitleTranslationInstructionFactory,
    async process(
      context: GenerationTaskProcessContext<SubtitleTranslationInstruction>,
    ) {
      context.signal?.throwIfAborted();
      const source = await resolveCachedMediaSubtitleSource(
        dependencies.assets,
        dependencies.artifacts,
        dependencies.projects,
        context.projectId,
        context.instruction.assetId,
        context.signal,
      );
      if (
        !source ||
        source.artifact.artifact.artifactRevision !==
          context.instruction.sourceTrackRevision ||
        source.track.language !== context.instruction.sourceLanguage
      ) {
        throw new AppError('OPERATION_SUPERSEDED');
      }
      const chunks = splitSubtitleTranslationChunks(source.track.cues);
      const translated: SubtitleTranslationCueV1[] = [];
      for (const chunk of chunks) {
        context.signal?.throwIfAborted();
        context.reportStatus(
          `正在翻译字幕 ${translated.length}/${source.track.cues.length}`,
        );
        const cues = await translateChunk(context, chunk, chunks.length);
        for (const cue of cues) {
          translated.push(cue);
          dependencies.progress.publish({
            assetId: context.instruction.assetId,
            sourceTrackRevision: context.instruction.sourceTrackRevision,
            cue,
            completedCues: translated.length,
            totalCues: source.track.cues.length,
          });
        }
      }
      const execution = context.agent.completedCalls.at(-1)?.metrics;
      if (!execution) throw new AppError('GENERATION_OUTPUT_INVALID');
      const track: SubtitleTranslationTrackV1 = Object.freeze({
        version: 1,
        kind: 'subtitle-translation',
        sourceTrackRevision: context.instruction.sourceTrackRevision,
        sourceLanguage: context.instruction.sourceLanguage,
        targetLanguage: context.instruction.targetLanguage,
        profile: 'quality',
        engine: Object.freeze({
          id: execution.providerId,
          version: String(SUBTITLE_TRANSLATION_TASK_DEFINITION_VERSION),
          model: execution.modelId,
          backend: 'agent',
        }),
        generatedTime: now(),
        cues: Object.freeze(translated),
      });
      const request: AssetArtifactRequest = {
        assetId: context.instruction.assetId,
        producerId: dependencies.producer.id,
        artifactKey: createSubtitleTranslationArtifactKey(
          context.instruction.sourceLanguage,
          context.instruction.targetLanguage,
        ),
        workspacePath: source.request.workspacePath,
        source: {
          assetId: context.instruction.assetId,
          mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
          absolutePath: source.artifact.absolutePath,
          revision: context.instruction.sourceTrackRevision,
        },
      };
      context.reportStatus('正在保存字幕译文…');
      const artifact = await dependencies.producer.materialize(
        dependencies.artifacts,
        request,
        track,
        context.signal,
      );
      return Object.freeze({
        assetId: context.instruction.assetId,
        sourceTrackRevision: context.instruction.sourceTrackRevision,
        targetLanguage: context.instruction.targetLanguage,
        artifactRevision: artifact.artifact.artifactRevision,
      });
    },
  });
}
