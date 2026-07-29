import type { JsonValue } from '../protocol';
import type { WorkbenchFacilityDeclaration } from './facility-declaration';

export const workbenchFacilityRoles = [
  'surface',
  'input',
  'transport',
  'capture',
] as const;

export type WorkbenchFacilityRole =
  (typeof workbenchFacilityRoles)[number];

export interface WorkbenchFacilityDefinition {
  readonly id: string;
  readonly version: number;
  readonly role: WorkbenchFacilityRole;
  readonly validateOptions: (
    value: JsonValue | undefined,
  ) => boolean;
  readonly validateEvent?: (value: JsonValue) => boolean;
  readonly inputCardinality?: 'one' | 'many';
  readonly validateDependencies?: (
    options: JsonValue | undefined,
    declarations: readonly WorkbenchFacilityDeclaration[],
  ) => boolean;
}

export interface TypedWorkbenchFacilityDefinition<
  TOptions extends JsonValue | undefined,
  TEvent extends JsonValue,
> extends Omit<
    WorkbenchFacilityDefinition,
    'validateOptions' | 'validateEvent'
  > {
  readonly validateOptions: (
    value: JsonValue | undefined,
  ) => value is TOptions;
  readonly validateEvent?: (value: JsonValue) => value is TEvent;
}

export function defineWorkbenchFacility<
  TOptions extends JsonValue | undefined,
  TEvent extends JsonValue = JsonValue,
>(
  definition: TypedWorkbenchFacilityDefinition<TOptions, TEvent>,
): WorkbenchFacilityDefinition {
  return definition;
}
