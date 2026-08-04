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
