import type {
  WorkbenchAction,
  WorkbenchActionBundle,
} from '../actions/workbench-action';
import type {
  WorkbenchContribution,
  WorkbenchSurface,
} from '../actions/workbench-contribution';

interface OwnedWorkbenchAction {
  readonly ownerId: string;
  readonly action: WorkbenchAction;
}

export interface ResolvedWorkbenchContribution {
  readonly ownerId: string;
  readonly action: WorkbenchAction;
  readonly contribution: WorkbenchContribution;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} 不能为空`);
  }

  return normalized;
}

function validateActionId(actionId: string): void {
  const normalized = requireText(actionId, 'Workbench Action ID');

  if (!normalized.includes('.')) {
    throw new Error(`Workbench Action ID 必须包含命名空间：${actionId}`);
  }
}

function contributionOrder(
  left: ResolvedWorkbenchContribution,
  right: ResolvedWorkbenchContribution,
): number {
  return (
    left.contribution.group.localeCompare(right.contribution.group) ||
    left.contribution.order - right.contribution.order ||
    left.contribution.id.localeCompare(right.contribution.id)
  );
}

export class WorkbenchActionRegistry {
  private readonly bundles = new Map<string, WorkbenchActionBundle>();
  private readonly actions = new Map<string, OwnedWorkbenchAction>();

  register(ownerId: string, bundle: WorkbenchActionBundle): () => void {
    const normalizedOwnerId = requireText(
      ownerId,
      'Workbench Action Owner ID',
    );
    this.validateBundle(normalizedOwnerId, bundle);

    const previousBundle = this.bundles.get(normalizedOwnerId);
    const previousActionIds = new Set(
      previousBundle?.actions.map((action) => action.id) ?? [],
    );

    for (const action of bundle.actions) {
      const existing = this.actions.get(action.id);

      if (
        existing &&
        existing.ownerId !== normalizedOwnerId &&
        !previousActionIds.has(action.id)
      ) {
        throw new Error(`Workbench Action 重复注册：${action.id}`);
      }
    }

    this.removeOwner(normalizedOwnerId);
    this.bundles.set(normalizedOwnerId, bundle);

    for (const action of bundle.actions) {
      this.actions.set(action.id, {
        ownerId: normalizedOwnerId,
        action,
      });
    }

    let active = true;
    return () => {
      if (!active) {
        return;
      }

      active = false;
      if (this.bundles.get(normalizedOwnerId) === bundle) {
        this.removeOwner(normalizedOwnerId);
      }
    };
  }

  unregister(ownerId: string): void {
    this.removeOwner(ownerId.trim());
  }

  clear(): void {
    this.bundles.clear();
    this.actions.clear();
  }

  getAction(actionId: string): WorkbenchAction | undefined {
    return this.actions.get(actionId)?.action;
  }

  getContributions(
    surface: WorkbenchSurface,
  ): readonly ResolvedWorkbenchContribution[] {
    const resolved: ResolvedWorkbenchContribution[] = [];

    for (const [ownerId, bundle] of this.bundles) {
      const ownedActions = new Map(
        bundle.actions.map((action) => [action.id, action]),
      );

      for (const contribution of bundle.contributions) {
        if (contribution.surface !== surface) {
          continue;
        }

        const action = ownedActions.get(contribution.actionId);

        if (action) {
          resolved.push({ ownerId, action, contribution });
        }
      }
    }

    return resolved.sort(contributionOrder);
  }

  private validateBundle(
    ownerId: string,
    bundle: WorkbenchActionBundle,
  ): void {
    const actionIds = new Set<string>();

    for (const action of bundle.actions) {
      validateActionId(action.id);

      if (actionIds.has(action.id)) {
        throw new Error(`Workbench Action 重复注册：${action.id}`);
      }
      actionIds.add(action.id);
    }

    const contributionIds = new Set<string>();

    for (const contribution of bundle.contributions) {
      requireText(contribution.id, 'Workbench Contribution ID');
      requireText(contribution.group, 'Workbench Contribution Group');

      if (
        !Number.isFinite(contribution.order) ||
        !Number.isSafeInteger(contribution.order)
      ) {
        throw new Error(
          `Workbench Contribution 顺序无效：${contribution.id}`,
        );
      }
      if (contributionIds.has(contribution.id)) {
        throw new Error(
          `Workbench Contribution 重复注册：${contribution.id}`,
        );
      }
      contributionIds.add(contribution.id);

      if (!actionIds.has(contribution.actionId)) {
        throw new Error(
          `Workbench Contribution 引用了未注册 Action：${contribution.actionId}`,
        );
      }
    }

    if (!ownerId.includes('.')) {
      throw new Error(
        `Workbench Action Owner ID 必须包含命名空间：${ownerId}`,
      );
    }
  }

  private removeOwner(ownerId: string): void {
    const bundle = this.bundles.get(ownerId);

    if (!bundle) {
      return;
    }

    for (const action of bundle.actions) {
      const existing = this.actions.get(action.id);

      if (existing?.ownerId === ownerId) {
        this.actions.delete(action.id);
      }
    }
    this.bundles.delete(ownerId);
  }
}
