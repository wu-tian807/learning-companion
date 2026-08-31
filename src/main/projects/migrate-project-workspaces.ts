import type { DatabaseContext } from '../database/database-context';
import { AppError } from '../errors/app-error';
import type { ProjectWorkspaceManagerApi } from './project-workspace-manager';

interface LegacyProjectWorkspaceRow {
  readonly id: string;
  readonly name: string;
}

export async function migrateProjectWorkspaces(
  context: DatabaseContext,
  defaultWorkspaceRoot: string,
  workspaceManager: ProjectWorkspaceManagerApi,
): Promise<void> {
  const rows = context.sqlite
    .prepare<[], LegacyProjectWorkspaceRow>(
      `SELECT id, name
       FROM projects
       WHERE workspace_path IS NULL OR trim(workspace_path) = ''`,
    )
    .all();
  const updateWorkspace = context.sqlite.prepare<
    [string, string],
    unknown
  >(
    `UPDATE projects
     SET workspace_path = ?
     WHERE id = ? AND (workspace_path IS NULL OR trim(workspace_path) = '')`,
  );

  for (const row of rows) {
    const workspacePath =
      await workspaceManager.createDefaultWorkspacePath(
        defaultWorkspaceRoot,
        row.id,
        row.name,
      );
    const preparation = await workspaceManager.prepareWorkspace({
      projectId: row.id,
      workspacePath,
    });

    try {
      const result = updateWorkspace.run(workspacePath, row.id);

      if (result.changes !== 1) {
        throw new AppError('DATABASE_WRITE_CONFLICT');
      }
    } catch (error) {
      await workspaceManager
        .rollbackPreparation(preparation)
        .catch((rollbackError: unknown) => {
          console.error('回滚旧 Project Workspace 失败', rollbackError);
        });
      throw error;
    }
  }
}
