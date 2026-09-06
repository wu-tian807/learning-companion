import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type { AssetSnapshot } from '../../shared/assets';
import type { ConversationRecord } from '../../shared/project-conversations';
import type { WorkbenchCommand } from '../../shared/workbench/protocol';
import { LEARNING_OUTLINE_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';

export { LEARNING_OUTLINE_ASSET_MEDIA_TYPE };

export const LEARNING_OUTLINE_WORKBENCH_ID = 'builtin.learning-outline';
export const LEARNING_OUTLINE_INTAKE_MODE_ID = 'learning-outline.intake';
export const LEARNING_OUTLINE_INTAKE_INSTRUCTION_FORMAT =
  'learning-companion/learning-outline-intake';
export const LEARNING_OUTLINE_INTAKE_INSTRUCTION_VERSION = 1;
export const LEARNING_OUTLINE_INTAKE_TASK_RESULT_FORMAT =
  'learning-companion/learning-outline-intake-result';
export const LEARNING_OUTLINE_INTAKE_TASK_RESULT_VERSION = 1;
export const LEARNING_OUTLINE_INTAKE_TASK_DEFINITION_ID =
  'learning-outline.intake';
export const LEARNING_OUTLINE_INTAKE_TASK_DEFINITION_VERSION = 1;
export const LEARNING_OUTLINE_GENERATION_TASK_DEFINITION_ID =
  'learning-outline.generate';
export const LEARNING_OUTLINE_GENERATION_TASK_DEFINITION_VERSION = 1;
export const LEARNING_OUTLINE_BRIEF_ATTACHMENT_TYPE = 'learning-outline.brief';
export const LEARNING_OUTLINE_BRIEF_ATTACHMENT_VERSION = 1;
export const LEARNING_OUTLINE_DOCUMENT_FORMAT =
  'learning-companion/learning-outline';
export const LEARNING_OUTLINE_DOCUMENT_VERSION = 1;
export const LEARNING_BRIEF_FORMAT = 'learning-companion/learning-brief';
export const LEARNING_BRIEF_VERSION = 1;
export const LEARNING_OUTLINE_BRIEF_FILE_NAME = 'learning-brief.json';
export const LEARNING_OUTLINE_GENERATED_FILE_NAME = 'learning-outline.outline';

export type LearningBriefReadiness = 'collecting' | 'ready';
export type LearningOutlineStatus = 'draft' | 'published';
export type LearningUnitStatus =
  'not-started' | 'learning' | 'completed' | 'skipped';

export interface LearningBriefRoadmapItem {
  readonly id: string;
  readonly title: string;
  readonly goal?: string;
  readonly notes?: string;
}

export interface LearningBrief {
  readonly format: typeof LEARNING_BRIEF_FORMAT;
  readonly version: typeof LEARNING_BRIEF_VERSION;
  readonly goal: string;
  readonly currentLevel: string;
  readonly difficulties: string;
  readonly constraints: string;
  readonly preferences: string;
  readonly scope: string;
  /** Optional user-provided information not covered by the structured fields. */
  readonly detailed?: string;
  readonly roadmap: readonly LearningBriefRoadmapItem[];
  readonly openQuestions: readonly string[];
  readonly readiness: LearningBriefReadiness;
  readonly readinessNote: string;
}

export interface LearningOutlineReference {
  readonly assetId: string;
  readonly target?: JsonValue;
}

export interface LearningOutlineUnit {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly completionCriteria: string;
  readonly required: boolean;
  readonly estimatedMinutes: number;
  readonly references: readonly LearningOutlineReference[];
}

export interface LearningOutlineChapter {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly units: readonly LearningOutlineUnit[];
}

export interface LearningOutlineProgressEntry {
  readonly unitId: string;
  readonly status: LearningUnitStatus;
  readonly updatedTime: number;
}

export interface LearningOutlineDocument {
  readonly format: typeof LEARNING_OUTLINE_DOCUMENT_FORMAT;
  readonly version: typeof LEARNING_OUTLINE_DOCUMENT_VERSION;
  readonly status: LearningOutlineStatus;
  readonly title: string;
  readonly goal: string;
  readonly sourceAssetIds: readonly string[];
  readonly chapters: readonly LearningOutlineChapter[];
  readonly progress: readonly LearningOutlineProgressEntry[];
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface LearningOutlineWorkbenchPayload {
  readonly document: LearningOutlineDocument;
  readonly brief: LearningOutlineBriefState;
}

export interface LearningOutlineSetUnitStatusPayload {
  readonly unitId: string;
  readonly status: LearningUnitStatus;
}

export const learningOutlineCommands = {
  setUnitStatus: 'learning-outline:set-unit-status',
} as const;

export const learningOutlineActions = {
  createDraft: 'learning-outline.create-draft',
  getBriefState: 'learning-outline.get-brief-state',
} as const;

export interface LearningOutlineWorkflowState {
  readonly validBriefRevision?: string;
  readonly promptedBriefRevision?: string;
  readonly readinessNote?: string;
}

export interface LearningOutlineBriefState {
  readonly valid: boolean;
  readonly ready?: boolean;
  readonly revision?: string;
  readonly error?: string;
  readonly updatedTime?: number;
  /** Last valid structured brief; an invalid rewrite must not erase it. */
  readonly brief?: LearningBrief;
}

export function isLearningOutlineBriefAttachmentMetadata(
  value: JsonValue,
): boolean {
  return (
    isRecord(value) &&
    value.format === LEARNING_BRIEF_FORMAT &&
    value.version === LEARNING_BRIEF_VERSION &&
    typeof value.revision === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.revision)
  );
}

export interface LearningOutlineSnapshot {
  readonly asset: AssetSnapshot;
  readonly document: LearningOutlineDocument;
  readonly brief: LearningOutlineBriefState;
}

export type LearningOutlineChangedEvent =
  | {
      readonly type: 'brief-changed';
      readonly projectId: string;
      readonly assetId: string;
      readonly revision?: string;
      readonly state: LearningOutlineBriefState;
    }
  | {
      readonly type: 'document-changed';
      readonly projectId: string;
      readonly assetId: string;
      readonly document: LearningOutlineDocument;
    };

export type LearningOutlineIntakeTaskResult = JsonValue & {
  readonly format: typeof LEARNING_OUTLINE_INTAKE_TASK_RESULT_FORMAT;
  readonly version: typeof LEARNING_OUTLINE_INTAKE_TASK_RESULT_VERSION;
  readonly answer: string;
  readonly title?: string;
  readonly providerId: string;
  readonly modelId: string;
};

export interface CreateLearningOutlineResult {
  readonly asset: AssetSnapshot;
  readonly conversation: ConversationRecord;
}

export const learningOutlineWorkbenchManifest: AssetWorkbenchManifest<
  typeof LEARNING_OUTLINE_WORKBENCH_ID
> = Object.freeze({
  id: LEARNING_OUTLINE_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: [LEARNING_OUTLINE_ASSET_MEDIA_TYPE],
  requiredContentCapabilities: ['read-bytes', 'write-bytes'] as const,
  supportedTargetTypes: [] as const,
  facilities: [] as const,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, allowEmpty = true): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.trim().length > 0) &&
    value.length <= 32_768
  );
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export const LEARNING_BRIEF_REQUIRED_FIELDS = Object.freeze({
  goal: '学习目标', currentLevel: '当前基础', difficulties: '困难',
  constraints: '约束', preferences: '偏好', scope: '学习范围',
});

const briefTextSchema = { type: 'string', maxLength: 32_768 } as const;
const briefIdSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$' } as const;

/** The file contract supplied to the Agent, including non-empty array items. */
export const LEARNING_BRIEF_SCHEMA = {
  type: 'object',
  required: ['format', 'version', ...Object.keys(LEARNING_BRIEF_REQUIRED_FIELDS),
    'roadmap', 'openQuestions', 'readiness', 'readinessNote'],
  properties: {
    format: { const: LEARNING_BRIEF_FORMAT }, version: { const: LEARNING_BRIEF_VERSION },
    ...Object.fromEntries(Object.entries(LEARNING_BRIEF_REQUIRED_FIELDS).map(([key, label]) =>
      [key, { ...briefTextSchema, description: `${label}；收集时可为空，完成前需明确。` }])),
    detailed: { ...briefTextSchema, description: '可选的额外补充；没有补充时省略或留空。' },
    roadmap: { type: 'array', maxItems: 128, items: {
      type: 'object', required: ['id', 'title'], properties: {
        id: briefIdSchema, title: { ...briefTextSchema, minLength: 1, pattern: '\\S' },
        goal: briefTextSchema, notes: briefTextSchema,
      },
    } },
    openQuestions: { type: 'array', maxItems: 128,
      items: { ...briefTextSchema, minLength: 1, pattern: '\\S' } },
    readiness: { enum: ['collecting', 'ready'] }, readinessNote: briefTextSchema,
  },
} as const;

export function validateLearningBrief(value: unknown): readonly string[] {
  if (!isRecord(value)) return ['brief：必须是 JSON 对象'];
  const issues: string[] = [];
  if (value.format !== LEARNING_BRIEF_FORMAT) issues.push(`format：必须为 ${LEARNING_BRIEF_FORMAT}`);
  if (value.version !== LEARNING_BRIEF_VERSION) issues.push(`version：必须为 ${LEARNING_BRIEF_VERSION}`);
  for (const key of [...Object.keys(LEARNING_BRIEF_REQUIRED_FIELDS), 'readinessNote']) {
    if (!isText(value[key])) issues.push(`${key}：必须是字符串（最多 32768 字符）`);
  }
  if (value.detailed !== undefined && !isText(value.detailed)) issues.push('detailed：可选，填写时必须是字符串（最多 32768 字符）');
  if (!Array.isArray(value.roadmap) || value.roadmap.length > 128) {
    issues.push('roadmap：必须是最多 128 项的数组');
  } else {
    const ids = new Set<string>();
    value.roadmap.forEach((item: unknown, index) => {
      const prefix = `roadmap[${index}]`;
      if (!isRecord(item)) { issues.push(`${prefix}：必须是对象`); return; }
      if (!isId(item.id)) issues.push(`${prefix}.id：必须是唯一的字母或数字标识，可包含 . _ -`);
      else if (ids.has(item.id)) issues.push(`${prefix}.id：标识重复`);
      else ids.add(item.id);
      if (!isText(item.title, false)) issues.push(`${prefix}.title：必须填写非空标题`);
      for (const key of ['goal', 'notes']) {
        if (item[key] !== undefined && !isText(item[key])) issues.push(`${prefix}.${key}：必须是字符串`);
      }
    });
  }
  if (!Array.isArray(value.openQuestions) || value.openQuestions.length > 128 ||
      !value.openQuestions.every((item) => isText(item, false))) {
    issues.push('openQuestions：必须是最多 128 个非空问题的字符串数组');
  }
  if (value.readiness !== 'collecting' && value.readiness !== 'ready') issues.push('readiness：必须为 collecting 或 ready');
  if (!isJsonValue(value)) issues.push('brief：必须只包含可序列化的 JSON 值');
  return issues;
}

export function isLearningBrief(value: unknown): value is LearningBrief {
  return validateLearningBrief(value).length === 0;
}

export function getLearningBriefMissingFields(brief: LearningBrief): readonly string[] {
  return [
    ...Object.entries(LEARNING_BRIEF_REQUIRED_FIELDS)
      .filter(([key]) => !brief[key as keyof typeof LEARNING_BRIEF_REQUIRED_FIELDS].trim())
      .map(([, label]) => label),
    ...(brief.roadmap.length === 0 ? ['路线草案'] : []),
    ...(brief.openQuestions.length > 0 ? ['待确认问题'] : []),
  ];
}

/** Model readiness is advisory; a saved brief must satisfy the actual fields. */
export function isLearningBriefComplete(brief: LearningBrief): boolean {
  return getLearningBriefMissingFields(brief).length === 0;
}

export const LEARNING_BRIEF_COMPLETION_NOTICE =
  '所有必填项已填写完成。你可以继续补充额外信息；生成大纲功能即将开放。';

function isReference(value: unknown): value is LearningOutlineReference {
  return (
    isRecord(value) &&
    isId(value.assetId) &&
    (value.target === undefined || isJsonValue(value.target))
  );
}

function isUnit(value: unknown): value is LearningOutlineUnit {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isText(value.title, false) &&
    isText(value.objective, false) &&
    isText(value.completionCriteria, false) &&
    typeof value.required === 'boolean' &&
    isNonNegativeInteger(value.estimatedMinutes) &&
    Array.isArray(value.references) &&
    value.references.length <= 128 &&
    value.references.every(isReference)
  );
}

function isChapter(value: unknown): value is LearningOutlineChapter {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isText(value.title, false) &&
    isText(value.summary) &&
    Array.isArray(value.units) &&
    value.units.length <= 256 &&
    value.units.every(isUnit) &&
    new Set(value.units.map((item) => item.id)).size === value.units.length
  );
}

function isProgressEntry(
  value: unknown,
): value is LearningOutlineProgressEntry {
  return (
    isRecord(value) &&
    isId(value.unitId) &&
    (value.status === 'not-started' ||
      value.status === 'learning' ||
      value.status === 'completed' ||
      value.status === 'skipped') &&
    isNonNegativeInteger(value.updatedTime)
  );
}

export function isLearningOutlineDocument(
  value: unknown,
): value is LearningOutlineDocument {
  return (
    isRecord(value) &&
    value.format === LEARNING_OUTLINE_DOCUMENT_FORMAT &&
    value.version === LEARNING_OUTLINE_DOCUMENT_VERSION &&
    (value.status === 'draft' || value.status === 'published') &&
    isText(value.title, false) &&
    isText(value.goal) &&
    Array.isArray(value.sourceAssetIds) &&
    value.sourceAssetIds.length <= 128 &&
    value.sourceAssetIds.every(isId) &&
    new Set(value.sourceAssetIds).size === value.sourceAssetIds.length &&
    Array.isArray(value.chapters) &&
    value.chapters.length <= 128 &&
    value.chapters.every(isChapter) &&
    new Set(value.chapters.map((item) => item.id)).size ===
      value.chapters.length &&
    Array.isArray(value.progress) &&
    value.progress.length <= 4_096 &&
    value.progress.every(isProgressEntry) &&
    new Set(value.progress.map((item) => item.unitId)).size ===
      value.progress.length &&
    isNonNegativeInteger(value.createdTime) &&
    isNonNegativeInteger(value.updatedTime) &&
    isJsonValue(value)
  );
}

export function isLearningOutlineBriefState(
  value: unknown,
): value is LearningOutlineBriefState {
  return (
    isRecord(value) &&
    typeof value.valid === 'boolean' &&
    (value.ready === undefined || typeof value.ready === 'boolean') &&
    (value.revision === undefined || isText(value.revision, false)) &&
    (value.error === undefined || isText(value.error)) &&
    (value.updatedTime === undefined ||
      isNonNegativeInteger(value.updatedTime)) &&
    (value.brief === undefined || isLearningBrief(value.brief))
  );
}

export function isLearningOutlineChangedEvent(
  value: unknown,
): value is LearningOutlineChangedEvent {
  if (
    !isRecord(value) ||
    !isText(value.projectId, false) ||
    !isText(value.assetId, false)
  ) {
    return false;
  }
  if (value.type === 'brief-changed') {
    return (
      (value.revision === undefined || isText(value.revision, false)) &&
      isLearningOutlineBriefState(value.state)
    );
  }
  return (
    value.type === 'document-changed' &&
    isLearningOutlineDocument(value.document)
  );
}

export function isLearningOutlineWorkbenchPayload(
  value: unknown,
): value is JsonValue & LearningOutlineWorkbenchPayload {
  return (
    isRecord(value) &&
    isLearningOutlineDocument(value.document) &&
    isLearningOutlineBriefState(value.brief) &&
    isJsonValue(value)
  );
}

export function isLearningOutlineSetUnitStatusPayload(
  value: unknown,
): value is JsonValue & LearningOutlineSetUnitStatusPayload {
  return (
    isRecord(value) &&
    isId(value.unitId) &&
    (value.status === 'not-started' ||
      value.status === 'learning' ||
      value.status === 'completed' ||
      value.status === 'skipped') &&
    isJsonValue(value)
  );
}

export function createLearningOutlineSetUnitStatusCommand(
  payload: LearningOutlineSetUnitStatusPayload,
): WorkbenchCommand {
  if (!isLearningOutlineSetUnitStatusPayload(payload)) {
    throw new Error('Learning Outline Unit 状态无效');
  }
  return {
    type: learningOutlineCommands.setUnitStatus,
    payload: { unitId: payload.unitId, status: payload.status },
  };
}

export function cloneLearningBrief(value: LearningBrief): LearningBrief {
  if (!isLearningBrief(value)) throw new Error('Learning brief 数据无效');
  return cloneJsonValue(
    value as unknown as JsonValue,
  ) as unknown as LearningBrief;
}

export function cloneLearningOutlineDocument(
  value: LearningOutlineDocument,
): LearningOutlineDocument {
  if (!isLearningOutlineDocument(value)) {
    throw new Error('Learning outline 文档数据无效');
  }
  return cloneJsonValue(
    value as unknown as JsonValue,
  ) as unknown as LearningOutlineDocument;
}

export function createEmptyLearningBrief(): LearningBrief {
  return Object.freeze({
    format: LEARNING_BRIEF_FORMAT,
    version: LEARNING_BRIEF_VERSION,
    goal: '',
    currentLevel: '',
    difficulties: '',
    constraints: '',
    preferences: '',
    scope: '',
    detailed: '',
    roadmap: Object.freeze([]),
    openQuestions: Object.freeze([]),
    readiness: 'collecting',
    readinessNote: '',
  });
}

export function createDraftLearningOutline(
  title: string,
  now: number,
): LearningOutlineDocument {
  const normalizedTitle = title.trim();
  if (!normalizedTitle || !isNonNegativeInteger(now)) {
    throw new Error('Learning outline 草稿数据无效');
  }
  return Object.freeze({
    format: LEARNING_OUTLINE_DOCUMENT_FORMAT,
    version: LEARNING_OUTLINE_DOCUMENT_VERSION,
    status: 'draft',
    title: normalizedTitle,
    goal: '',
    sourceAssetIds: Object.freeze([]),
    chapters: Object.freeze([]),
    progress: Object.freeze([]),
    createdTime: now,
    updatedTime: now,
  });
}

export function isLearningOutlineWorkflowState(
  value: unknown,
): value is LearningOutlineWorkflowState {
  return (
    isRecord(value) &&
    (value.validBriefRevision === undefined ||
      isText(value.validBriefRevision, false)) &&
    (value.promptedBriefRevision === undefined ||
      isText(value.promptedBriefRevision, false)) &&
    (value.readinessNote === undefined || isText(value.readinessNote))
  );
}
