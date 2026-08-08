import { AppError } from '../../errors/app-error';

export interface GenerationValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type GenerationValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly issues: readonly GenerationValidationIssue[];
    };

export function generationValidationSuccess<T>(
  value: T,
): GenerationValidationResult<T> {
  return Object.freeze({ ok: true, value });
}

export function generationValidationFailure<T = never>(
  issues: readonly GenerationValidationIssue[],
): GenerationValidationResult<T> {
  if (issues.length === 0) {
    throw new Error('Generation validation failure 至少需要一个 issue');
  }

  return Object.freeze({
    ok: false,
    issues: Object.freeze(
      issues.map((issue) =>
        Object.freeze({
          path: issue.path,
          message: issue.message,
        }),
      ),
    ),
  });
}

export class GenerationOutputValidationError extends AppError {
  readonly issues: readonly GenerationValidationIssue[];

  constructor(issues: readonly GenerationValidationIssue[]) {
    const failure = generationValidationFailure(issues);

    if (failure.ok) {
      throw new Error('Generation validation failure 状态无效');
    }

    const normalized = failure.issues;
    super('GENERATION_OUTPUT_INVALID', {
      cause: new Error(
        normalized
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('\n'),
      ),
    });
    this.name = 'GenerationOutputValidationError';
    this.issues = normalized;
  }
}
