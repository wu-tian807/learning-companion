export const workbenchSurfaces = [
  'header',
  'overflow',
  'context-menu',
  'generation-center',
] as const;

export type WorkbenchSurface = (typeof workbenchSurfaces)[number];

export type WorkbenchActionClosePolicy =
  | 'always'
  | 'on-success'
  | 'never';

interface WorkbenchPresentationBase {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly badge?: string;
  readonly expanded?: boolean;
  readonly tone?: 'default' | 'accent';
  readonly shortcut?: string;
  readonly description?: string;
  readonly disabledReason?: string;
  readonly closePolicy?: WorkbenchActionClosePolicy;
}

export interface WorkbenchActionPresentation
  extends WorkbenchPresentationBase {
  readonly kind: 'action';
}

export interface WorkbenchCheckboxPresentation
  extends WorkbenchPresentationBase {
  readonly kind: 'checkbox';
  readonly checked: boolean;
}

export interface WorkbenchRadioPresentation
  extends WorkbenchPresentationBase {
  readonly kind: 'radio';
  readonly checked: boolean;
  readonly radioGroup: string;
}

export interface WorkbenchGenerationToolPresentation
  extends WorkbenchPresentationBase {
  readonly kind: 'generation-tool';
  readonly description: string;
}

export type WorkbenchContributionPresentation =
  | WorkbenchActionPresentation
  | WorkbenchCheckboxPresentation
  | WorkbenchRadioPresentation
  | WorkbenchGenerationToolPresentation;

export interface WorkbenchContribution {
  readonly id: string;
  readonly actionId: string;
  readonly surface: WorkbenchSurface;
  readonly group: string;
  readonly groupLabel?: string;
  readonly order: number;
  readonly presentation: WorkbenchContributionPresentation;
}
