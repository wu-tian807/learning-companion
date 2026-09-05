import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { AssetArtifactProduceRequest } from '../../main/artifacts/asset-artifact-registry';
import { AppError } from '../../main/errors/app-error';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  isSubtitleSourceTrackV1,
  isSubtitleTranslationTrackV1,
  type SubtitleCueV1,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';
import { repairZeroDurationSubtitleCues } from './subtitle-cue-segmenter';

export type SubtitleTrackValidationKind =
  | 'malformed'
  | 'zero-duration'
  | 'unrepairable';

export class SubtitleTrackValidationError extends Error {
  readonly name = 'SubtitleTrackValidationError';

  constructor(
    readonly kind: SubtitleTrackValidationKind,
    readonly field: string,
    readonly cueId: string | undefined,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

interface SourceTrackIssue {
  readonly kind?: SubtitleTrackValidationKind;
  readonly field: string;
  readonly cueId?: string;
  readonly message: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceTrackIssue(value: unknown): SourceTrackIssue {
  if (!record(value)) {
    return { field: '$', message: '字幕文件根节点不是对象' };
  }
  if (value.version !== 1) {
    return { field: 'version', message: '字幕文件版本无效' };
  }
  if (value.kind !== 'subtitle-source') {
    return { field: 'kind', message: '字幕文件类型无效' };
  }
  if (
    typeof value.sourceRevision !== 'string' ||
    value.sourceRevision.trim().length === 0
  ) {
    return { field: 'sourceRevision', message: '字幕来源修订号无效' };
  }
  if (
    value.language !== 'en' &&
    value.language !== 'zh-Hans' &&
    value.language !== 'unknown'
  ) {
    return { field: 'language', message: '字幕语言无效' };
  }
  if (value.origin !== 'asr') {
    return { field: 'origin', message: '字幕来源类型无效' };
  }
  if (!record(value.engine)) {
    return { field: 'engine', message: '字幕引擎信息无效' };
  }
  for (const field of ['id', 'version', 'model', 'backend']) {
    const engineValue = value.engine[field];
    if (
      typeof engineValue !== 'string' ||
      engineValue.trim().length === 0
    ) {
      return {
        field: `engine.${field}`,
        message: `字幕引擎的 ${field} 无效`,
      };
    }
  }
  if (
    typeof value.generatedTime !== 'number' ||
    !Number.isSafeInteger(value.generatedTime) ||
    value.generatedTime < 0
  ) {
    return { field: 'generatedTime', message: '字幕生成时间无效' };
  }
  if (!Array.isArray(value.cues) || value.cues.length === 0) {
    return { field: 'cues', message: '字幕文件缺少 Cue' };
  }
  const cueIds = new Set<string>();
  const sourceCueIds = new Set<string>();
  let previousStartMs = -1;
  for (const [index, candidate] of value.cues.entries()) {
    const cue = record(candidate) ? candidate : undefined;
    const cueId = typeof cue?.id === 'string' ? cue.id : undefined;
    const prefix = cueId ? `Cue ${cueId}` : `cues[${index}]`;
    if (!cue) {
      return {
        field: `cues[${index}]`,
        message: `${prefix} 不是对象`,
      };
    }
    if (typeof cue.id !== 'string' || cue.id.trim().length === 0) {
      return {
        field: `cues[${index}].id`,
        message: `${prefix} 的 id 无效`,
      };
    }
    if (cueIds.has(cue.id)) {
      return {
        field: `${cue.id}.id`,
        cueId: cue.id,
        message: `${prefix} 的 id 重复`,
      };
    }
    cueIds.add(cue.id);
    if (typeof cue?.startMs !== 'number' || !Number.isSafeInteger(cue.startMs)) {
      return {
        field: `${cueId ?? `cues[${index}]`}.startMs`,
        ...(cueId ? { cueId } : {}),
        message: `${prefix} 的 startMs 无效`,
      };
    }
    if (typeof cue.endMs !== 'number' || !Number.isSafeInteger(cue.endMs)) {
      return {
        field: `${cueId ?? `cues[${index}]`}.endMs`,
        ...(cueId ? { cueId } : {}),
        message: `${prefix} 的 endMs 无效`,
      };
    }
    if (cue.endMs < cue.startMs) {
      return {
        field: `${cueId ?? `cues[${index}]`}.endMs`,
        ...(cueId ? { cueId } : {}),
        message: `${prefix} 的 endMs 早于 startMs`,
      };
    }
    if (cue.endMs === cue.startMs) {
      return {
        kind: 'zero-duration',
        field: `${cueId ?? `cues[${index}]`}.endMs`,
        ...(cueId ? { cueId } : {}),
        message: `${prefix} 的 endMs 必须大于 startMs`,
      };
    }
    if (cue.startMs < previousStartMs) {
      return {
        field: `${cue.id}.startMs`,
        cueId: cue.id,
        message: `${prefix} 的 startMs 打乱了 Cue 顺序`,
      };
    }
    previousStartMs = cue.startMs;
    if (typeof cue.text !== 'string' || cue.text.trim().length === 0) {
      return {
        field: `${cueId ?? `cues[${index}]`}.text`,
        ...(cueId ? { cueId } : {}),
        message: `${prefix} 的文本为空`,
      };
    }
    if (
      !Array.isArray(cue.sourceCueIds) ||
      cue.sourceCueIds.length === 0
    ) {
      return {
        field: `${cue.id}.sourceCueIds`,
        cueId: cue.id,
        message: `${prefix} 缺少来源 Cue ID`,
      };
    }
    for (const [sourceIndex, sourceCueId] of cue.sourceCueIds.entries()) {
      if (
        typeof sourceCueId !== 'string' ||
        sourceCueId.trim().length === 0
      ) {
        return {
          field: `${cue.id}.sourceCueIds[${sourceIndex}]`,
          cueId: cue.id,
          message: `${prefix} 的来源 Cue ID 无效`,
        };
      }
      if (sourceCueIds.has(sourceCueId)) {
        return {
          field: `${cue.id}.sourceCueIds`,
          cueId: cue.id,
          message: `${prefix} 重复引用来源 Cue ${sourceCueId}`,
        };
      }
      sourceCueIds.add(sourceCueId);
    }
    if (
      cue.speakerId !== undefined &&
      (typeof cue.speakerId !== 'string' ||
        !/^speaker-\d{4}$/u.test(cue.speakerId))
    ) {
      return {
        field: `${cue.id}.speakerId`,
        cueId: cue.id,
        message: `${prefix} 的说话人引用无效`,
      };
    }
  }
  if (value.speakerAnalysis === undefined) {
    const speakerCue = value.cues.find(
      (candidate) => record(candidate) && candidate.speakerId !== undefined,
    );
    if (record(speakerCue) && typeof speakerCue.id === 'string') {
      return {
        field: `${speakerCue.id}.speakerId`,
        cueId: speakerCue.id,
        message: `Cue ${speakerCue.id} 缺少对应的说话人分析结果`,
      };
    }
  } else if (!record(value.speakerAnalysis)) {
    return { field: 'speakerAnalysis', message: '说话人分析结果无效' };
  } else if (!Array.isArray(value.speakerAnalysis.segments)) {
    return {
      field: 'speakerAnalysis.segments',
      message: '说话人分析缺少分段',
    };
  } else {
    const speakerIds = new Set<string>();
    for (const [index, segment] of value.speakerAnalysis.segments.entries()) {
      if (
        !record(segment) ||
        typeof segment.speakerId !== 'string' ||
        !/^speaker-\d{4}$/u.test(segment.speakerId) ||
        typeof segment.startMs !== 'number' ||
        !Number.isSafeInteger(segment.startMs) ||
        typeof segment.endMs !== 'number' ||
        !Number.isSafeInteger(segment.endMs) ||
        segment.endMs <= segment.startMs
      ) {
        return {
          field: `speakerAnalysis.segments[${index}]`,
          message: '说话人分析分段无效',
        };
      }
      speakerIds.add(segment.speakerId);
    }
    for (const candidate of value.cues) {
      if (
        record(candidate) &&
        typeof candidate.id === 'string' &&
        (typeof candidate.speakerId !== 'string' ||
          !speakerIds.has(candidate.speakerId))
      ) {
        return {
          field: `${candidate.id}.speakerId`,
          cueId: candidate.id,
          message: `Cue ${candidate.id} 的说话人引用与分析结果不一致`,
        };
      }
    }
  }
  return { field: '$', message: '字幕文件未通过完整校验' };
}

function invalidTrackError(value: unknown): SubtitleTrackValidationError {
  const issue = sourceTrackIssue(value);
  return new SubtitleTrackValidationError(
    issue.kind ?? 'malformed',
    issue.field,
    issue.cueId,
    issue.message,
  );
}

export function validateSubtitleSourceTrackForCommit(
  value: unknown,
): asserts value is SubtitleSourceTrackV1 {
  if (!isSubtitleSourceTrackV1(value)) {
    throw invalidTrackError(value);
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new SubtitleTrackValidationError(
      'malformed',
      '$',
      undefined,
      '字幕文件 JSON 格式无效',
      { cause: error },
    );
  }
}

async function readSubtitleSourceJson(path: string): Promise<unknown> {
  try {
    return parseJson(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SubtitleTrackValidationError) throw error;
    throw new SubtitleTrackValidationError(
      'malformed',
      'file',
      undefined,
      '字幕缓存文件无法读取',
      { cause: error },
    );
  }
}

export interface RecoveredSubtitleSourceTrack {
  readonly track: SubtitleSourceTrackV1;
  readonly repaired: boolean;
  readonly repairedCueId?: string;
}

export function serializeSubtitleSourceTrack(
  track: SubtitleSourceTrackV1,
): string {
  if (!isSubtitleSourceTrackV1(track)) {
    throw invalidTrackError(track);
  }
  return `${JSON.stringify(track, null, 2)}\n`;
}

export interface RepairedSubtitleSourceArtifact {
  readonly artifact: ResolvedAssetArtifact;
  readonly track: SubtitleSourceTrackV1;
  readonly repaired: boolean;
}

const activeSourceRepairs = new Map<
  string,
  Promise<RepairedSubtitleSourceArtifact>
>();

function sourceRepairKey(
  request: AssetArtifactRequest,
): string {
  return JSON.stringify([
    request.workspacePath,
    request.assetId,
    request.artifactKey,
  ]);
}

async function waitForSourceRepair(
  operation: Promise<RepairedSubtitleSourceArtifact>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await operation.catch(() => undefined);
    return;
  }
  signal.throwIfAborted();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const handleAbort = () =>
      rejectPromise(new DOMException('字幕修复已取消', 'AbortError'));
    signal.addEventListener('abort', handleAbort, { once: true });
    operation.then(
      () => {
        signal.removeEventListener('abort', handleAbort);
        resolvePromise();
      },
      () => {
        signal.removeEventListener('abort', handleAbort);
        resolvePromise();
      },
    );
  });
}

export async function readOrRepairSubtitleSourceArtifact(
  artifacts: AssetArtifactServiceApi,
  request: AssetArtifactRequest,
  artifact: ResolvedAssetArtifact,
  signal?: AbortSignal,
): Promise<RepairedSubtitleSourceArtifact> {
  const key = sourceRepairKey(request);
  const active = activeSourceRepairs.get(key);
  if (active) {
    await waitForSourceRepair(active, signal);
    return readOrRepairSubtitleSourceArtifact(
      artifacts,
      request,
      artifact,
      signal,
    );
  }

  const operation = (async () => {
    signal?.throwIfAborted();
    const current = (await artifacts.getCached(request)) ?? artifact;
    const recovered = await readSubtitleSourceTrackFileForRecovery(
      current.absolutePath,
    );
    if (!recovered.repaired) {
      return Object.freeze({
        artifact: current,
        track: recovered.track,
        repaired: false,
      });
    }
    if (!artifacts.replace) {
      throw new SubtitleTrackValidationError(
        'unrepairable',
        'artifact.replace',
        recovered.repairedCueId,
        '字幕缓存修复服务未就绪',
      );
    }

    let repairedArtifact: ResolvedAssetArtifact;
    try {
      repairedArtifact = await artifacts.replace(
        request,
        async (
          produceRequest: AssetArtifactProduceRequest,
          repairSignal: AbortSignal,
        ) => {
          repairSignal.throwIfAborted();
          const filePath = join(
            produceRequest.stagingDirectory,
            'subtitles.json',
          );
          await writeFile(
            filePath,
            serializeSubtitleSourceTrack(recovered.track),
            'utf8',
          );
          repairSignal.throwIfAborted();
          return {
            filePath,
            mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
            extension: 'json',
          };
        },
        signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new SubtitleTrackValidationError(
        'unrepairable',
        'artifact.replace',
        recovered.repairedCueId,
        '字幕缓存修复未能提交，旧字幕仍然保留',
        { cause: error },
      );
    }
    const track = await readSubtitleSourceTrackFile(
      repairedArtifact.absolutePath,
    );
    return Object.freeze({
      artifact: repairedArtifact,
      track,
      repaired: true,
    });
  })().finally(() => {
    if (activeSourceRepairs.get(key) === operation) {
      activeSourceRepairs.delete(key);
    }
  });
  activeSourceRepairs.set(key, operation);
  return operation;
}

export async function readSubtitleSourceTrackFile(
  path: string,
): Promise<SubtitleSourceTrackV1> {
  const value = await readSubtitleSourceJson(path);
  validateSubtitleSourceTrackForCommit(value);
  return value;
}

export async function readSubtitleSourceTrackFileForRecovery(
  path: string,
): Promise<RecoveredSubtitleSourceTrack> {
  const value = await readSubtitleSourceJson(path);
  if (isSubtitleSourceTrackV1(value)) {
    return Object.freeze({ track: value, repaired: false });
  }
  if (!isSubtitleSourceTrackV1(value, { allowZeroDuration: true })) {
    throw invalidTrackError(value);
  }

  const candidate = value;
  const repairedCueId = candidate.cues.find(
    (cue) => cue.endMs === cue.startMs,
  )?.id;
  if (repairedCueId === undefined) {
    throw invalidTrackError(value);
  }

  let cues: readonly SubtitleCueV1[];
  try {
    cues = repairZeroDurationSubtitleCues(candidate.cues, {
      speakerAnalysis: candidate.speakerAnalysis,
    });
  } catch (error) {
    const issue = sourceTrackIssue(value);
    throw new SubtitleTrackValidationError(
      'unrepairable',
      issue.field === '$' && repairedCueId
        ? `${repairedCueId}.timeWindow`
        : issue.field,
      issue.cueId ?? repairedCueId,
      error instanceof Error ? error.message : issue.message,
      { cause: error },
    );
  }

  const repaired = { ...candidate, cues };
  if (!isSubtitleSourceTrackV1(repaired)) {
    throw new SubtitleTrackValidationError(
      'unrepairable',
      'cues',
      undefined,
      '字幕修复后仍未通过完整校验',
    );
  }
  return Object.freeze({ track: repaired, repaired: true, repairedCueId });
}

export async function readSubtitleTranslationTrackFile(
  path: string,
  source: SubtitleSourceTrackV1,
  sourceTrackRevision: string,
): Promise<SubtitleTranslationTrackV1> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }
  if (
    !isSubtitleTranslationTrackV1(value) ||
    value.sourceTrackRevision !== sourceTrackRevision ||
    value.sourceLanguage !== source.language ||
    value.cues.length !== source.cues.length ||
    value.cues.some((cue, index) => cue.sourceCueId !== source.cues[index]?.id)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return value;
}
