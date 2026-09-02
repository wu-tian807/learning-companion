import type { AssetTargetRegistryApi } from '../../../main/workbench/asset-target-registry';
import type { PreparedGenerationAssetReferenceBindings } from '../../../main/generation/contracts/generation-asset-reference';
import {
  generationValidationFailure,
  generationValidationSuccess,
  type GenerationValidationIssue,
} from '../../../main/generation/contracts/generation-validation';
import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
} from '../../../shared/workbench/asset-target';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { MIND_MAP_GENERATION_CANDIDATE_FORMAT } from './mindmap-generation-output';
import {
  validateMindMapGenerationCandidateV2,
  type MindMapGenerationCandidateFrameV2,
  type MindMapGenerationCandidateNodeV2,
} from './mindmap-generation-output-v2';

export {
  MIND_MAP_GENERATION_CANDIDATE_FORMAT,
  MIND_MAP_GENERATION_CANDIDATE_RELATIVE_PATH,
} from './mindmap-generation-output';

export const MIND_MAP_GENERATION_CANDIDATE_VERSION_V3 = 3;

export interface MindMapGenerationCandidateSourceReferenceV3 {
  readonly sourceAlias: string;
  readonly target: AssetTarget;
}

export interface MindMapGenerationCandidateNodeV3 extends Omit<
  MindMapGenerationCandidateNodeV2,
  'sourceReferences'
> {
  readonly sourceReferences: readonly MindMapGenerationCandidateSourceReferenceV3[];
}

export interface MindMapGenerationCandidateFrameV3 extends Omit<
  MindMapGenerationCandidateFrameV2,
  'sourceReferences'
> {
  readonly sourceReferences: readonly MindMapGenerationCandidateSourceReferenceV3[];
}

export interface MindMapGenerationCandidateV3 {
  readonly format: typeof MIND_MAP_GENERATION_CANDIDATE_FORMAT;
  readonly version: typeof MIND_MAP_GENERATION_CANDIDATE_VERSION_V3;
  readonly title: string;
  readonly rootNodeId: string;
  readonly nodes: Readonly<Record<string, MindMapGenerationCandidateNodeV3>>;
  readonly frames: Readonly<Record<string, MindMapGenerationCandidateFrameV3>>;
}

export interface MindMapGenerationCandidateV3ValidationContext {
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly targets: AssetTargetRegistryApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsedReference(value: unknown):
  | {
      readonly sourceAlias: string;
      readonly target: AssetTarget;
    }
  | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'sourceAlias') ||
    !Object.hasOwn(value, 'target') ||
    typeof value.sourceAlias !== 'string' ||
    !isAssetTarget(value.target)
  ) {
    return undefined;
  }
  const sourceAlias = value.sourceAlias.trim();
  return sourceAlias
    ? Object.freeze({ sourceAlias, target: cloneAssetTarget(value.target) })
    : undefined;
}

function referencesOf(subject: unknown) {
  return isRecord(subject) && Array.isArray(subject.sourceReferences)
    ? subject.sourceReferences.map(parsedReference)
    : undefined;
}

function asV2Subject(subject: unknown): unknown {
  const references = referencesOf(subject);
  if (!isRecord(subject) || !references || references.some((value) => !value)) {
    return subject;
  }
  return {
    ...subject,
    sourceReferences: references.map((reference) => ({
      sourceAlias: reference!.sourceAlias,
      agentLocator: { target: reference!.target },
    })),
  };
}

function referenceByAlias(bindings: PreparedGenerationAssetReferenceBindings) {
  return new Map(
    Object.values(bindings)
      .flatMap((references) => references)
      .map((reference) => [reference.alias, reference] as const),
  );
}

export function validateMindMapGenerationCandidateV3(
  value: JsonValue,
  context: MindMapGenerationCandidateV3ValidationContext,
) {
  if (
    !isRecord(value) ||
    value.format !== MIND_MAP_GENERATION_CANDIDATE_FORMAT ||
    value.version !== MIND_MAP_GENERATION_CANDIDATE_VERSION_V3 ||
    !isRecord(value.nodes) ||
    !isRecord(value.frames)
  ) {
    return generationValidationFailure<MindMapGenerationCandidateV3>([
      { path: 'output', message: 'Mind Map candidate v3 顶层结构无效' },
    ]);
  }

  const converted = {
    ...value,
    version: 2,
    nodes: Object.fromEntries(
      Object.entries(value.nodes).map(([id, subject]) => [
        id,
        asV2Subject(subject),
      ]),
    ),
    frames: Object.fromEntries(
      Object.entries(value.frames).map(([id, subject]) => [
        id,
        asV2Subject(subject),
      ]),
    ),
  } as JsonValue;
  const structural = validateMindMapGenerationCandidateV2(converted, context);
  if (!structural.ok) {
    return generationValidationFailure<MindMapGenerationCandidateV3>(
      structural.issues,
    );
  }

  const preparedByAlias = referenceByAlias(context.assetReferences);
  const issues: GenerationValidationIssue[] = [];

  const cloneSubjects = <T extends 'nodes' | 'frames'>(kind: T) =>
    Object.freeze(
      Object.fromEntries(
        Object.entries(value[kind] as Record<string, unknown>).map(
          ([subjectId, rawSubject]) => {
            const subject = rawSubject as Record<string, unknown>;
            const normalizedSubject = structural.value[kind][subjectId]!;
            const references = referencesOf(subject)!;
            const cloned = references.map((reference, index) => {
              const prepared = preparedByAlias.get(reference!.sourceAlias);
              if (
                !prepared?.workbenchId ||
                !context.targets.validate(
                  prepared.workbenchId,
                  reference!.target,
                )
              ) {
                issues.push({
                  path: `output.${kind}.${subjectId}.sourceReferences.${index}.target`,
                  message: `Target 不属于来源 ${reference!.sourceAlias} 的 Workbench，或 payload 无效`,
                });
              }
              return Object.freeze({
                sourceAlias: reference!.sourceAlias,
                target: cloneAssetTarget(reference!.target),
              });
            });
            return [
              subjectId,
              Object.freeze({
                ...normalizedSubject,
                sourceReferences: Object.freeze(cloned),
              }),
            ];
          },
        ),
      ),
    );

  const nodes = cloneSubjects('nodes') as Readonly<
    Record<string, MindMapGenerationCandidateNodeV3>
  >;
  const frames = cloneSubjects('frames') as Readonly<
    Record<string, MindMapGenerationCandidateFrameV3>
  >;

  if (issues.length > 0) {
    return generationValidationFailure<MindMapGenerationCandidateV3>(issues);
  }

  return generationValidationSuccess(
    Object.freeze({
      format: MIND_MAP_GENERATION_CANDIDATE_FORMAT,
      version: MIND_MAP_GENERATION_CANDIDATE_VERSION_V3,
      title: structural.value.title,
      rootNodeId: structural.value.rootNodeId,
      nodes,
      frames,
    }),
  );
}
