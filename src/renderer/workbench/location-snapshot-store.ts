import {
  cloneWorkbenchLocationReference,
  isWorkbenchLocationReference,
  type WorkbenchLocationReference,
} from '../../shared/workbench/location-reference';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import {
  CORE_FACILITY_VERSION,
  CORE_LOCATION_REFERENCE_CAPTURE_FACILITY_ID,
} from '../../shared/workbench/facilities/core-facilities';

/**
 * A Project-local, renderer-only handoff between a source Workbench selection
 * and a Markdown editor.  It deliberately stores only a frozen exported
 * location contract; native selection state remains owned by each Workbench.
 */
export interface WorkbenchLocationSnapshot {
  readonly ownerId: string;
  readonly projectId: string;
  readonly reference: WorkbenchLocationReference;
  /** Human-readable link label, not part of the portable target protocol. */
  readonly text: string;
}

const snapshotsByProject = new Map<
  string,
  Map<string, WorkbenchLocationSnapshot>
>();
const latestOwnerByProject = new Map<string, string>();

function requiredText(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} 不能为空。`);
  return trimmed;
}

function cloneSnapshot(
  snapshot: WorkbenchLocationSnapshot,
): WorkbenchLocationSnapshot {
  return Object.freeze({
    ownerId: snapshot.ownerId,
    projectId: snapshot.projectId,
    reference: cloneWorkbenchLocationReference(snapshot.reference),
    text: snapshot.text,
  });
}

export function publishWorkbenchLocationSnapshot(
  manifest: AssetWorkbenchManifest,
  snapshot: WorkbenchLocationSnapshot,
): void {
  const ownerId = requiredText(snapshot.ownerId, '位置快照所有者');
  const projectId = requiredText(snapshot.projectId, 'Project');
  const declared = manifest.facilities.some(
    (facility) =>
      facility.id === CORE_LOCATION_REFERENCE_CAPTURE_FACILITY_ID &&
      facility.version === CORE_FACILITY_VERSION,
  );
  if (!declared || !isWorkbenchLocationReference(snapshot.reference) ||
    snapshot.reference.target.scope !== 'content' ||
    snapshot.reference.projectId !== projectId) {
    throw new Error('Workbench 未声明有效的位置快照能力。');
  }

  const entries = snapshotsByProject.get(projectId) ?? new Map();
  entries.set(ownerId, cloneSnapshot({
    ...snapshot,
    ownerId,
    projectId,
  }));
  snapshotsByProject.set(projectId, entries);
  latestOwnerByProject.set(projectId, ownerId);
}

export function getLatestWorkbenchLocationSnapshot(
  projectId: string,
): WorkbenchLocationSnapshot | undefined {
  const normalizedProjectId = requiredText(projectId, 'Project');
  const entries = snapshotsByProject.get(normalizedProjectId);
  const ownerId = latestOwnerByProject.get(normalizedProjectId);
  const snapshot = ownerId ? entries?.get(ownerId) : undefined;
  return snapshot ? cloneSnapshot(snapshot) : undefined;
}

export function clearWorkbenchLocationSnapshot(
  projectId: string,
  ownerId?: string,
): void {
  const normalizedProjectId = requiredText(projectId, 'Project');
  const entries = snapshotsByProject.get(normalizedProjectId);
  if (!entries) return;

  if (!ownerId) {
    snapshotsByProject.delete(normalizedProjectId);
    latestOwnerByProject.delete(normalizedProjectId);
    return;
  }

  const normalizedOwnerId = requiredText(ownerId, '位置快照所有者');
  entries.delete(normalizedOwnerId);
  if (entries.size === 0) {
    snapshotsByProject.delete(normalizedProjectId);
    latestOwnerByProject.delete(normalizedProjectId);
    return;
  }
  if (latestOwnerByProject.get(normalizedProjectId) === normalizedOwnerId) {
    // A capture is an explicit user decision. Never silently fall back to a
    // different viewport's older selection after the current owner is cleared.
    latestOwnerByProject.delete(normalizedProjectId);
  }
}

/** Test-only process-local cleanup; production uses project/owner cleanup. */
export function resetWorkbenchLocationSnapshotsForTests(): void {
  snapshotsByProject.clear();
  latestOwnerByProject.clear();
}
