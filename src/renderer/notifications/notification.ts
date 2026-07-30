export type NotificationKind = 'success' | 'info' | 'warning' | 'error';

export interface NotificationAction {
  readonly label: string;
  readonly invoke: () => void;
}

export interface AppNotificationInput {
  readonly id?: string;
  readonly dedupeKey?: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly message?: string;
  readonly durationMs?: number | null;
  readonly action?: NotificationAction;
}

export interface AppNotification {
  readonly id: string;
  readonly dedupeKey?: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly message?: string;
  readonly durationMs: number | null;
  readonly action?: NotificationAction;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Notification ${field} 不能为空`);
  }

  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveDuration(
  kind: NotificationKind,
  durationMs: number | null | undefined,
): number | null {
  if (durationMs === null) {
    return null;
  }
  if (durationMs === undefined) {
    return kind === 'error' ? null : 5_000;
  }
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error('Notification durationMs 必须是正整数或 null');
  }

  return durationMs;
}

export function createAppNotification(
  input: AppNotificationInput,
  fallbackId: string,
): AppNotification {
  const id = normalizeRequiredText(input.id ?? fallbackId, 'id');
  const title = normalizeRequiredText(input.title, 'title');
  const dedupeKey = normalizeOptionalText(input.dedupeKey);
  const message = normalizeOptionalText(input.message);
  const action = input.action
    ? Object.freeze({
        label: normalizeRequiredText(input.action.label, 'action.label'),
        invoke: input.action.invoke,
      })
    : undefined;

  return Object.freeze({
    id,
    kind: input.kind,
    title,
    durationMs: resolveDuration(input.kind, input.durationMs),
    ...(dedupeKey ? { dedupeKey } : {}),
    ...(message ? { message } : {}),
    ...(action ? { action } : {}),
  });
}
