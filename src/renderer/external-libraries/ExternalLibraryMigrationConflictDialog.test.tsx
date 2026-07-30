import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ExternalLibraryMigrationConflictDialog } from './ExternalLibraryMigrationConflictDialog';

describe('ExternalLibraryMigrationConflictDialog', () => {
  it('presents both non-destructive and replacement resolutions', () => {
    const markup = renderToStaticMarkup(
      <ExternalLibraryMigrationConflictDialog
        targetPath="/Volumes/Data/externalLib"
        conflicts={[
          {
            libraryId: 'libreoffice',
            displayName: 'LibreOffice',
            targetPath: '/Volumes/Data/externalLib/libreoffice',
            targetStatus: 'invalid',
          },
        ]}
        busy={false}
        onCancel={vi.fn()}
        onResolve={vi.fn()}
      />,
    );

    expect(markup).toContain('目标位置已有同名组件');
    expect(markup).toContain('保留目标并跳过');
    expect(markup).toContain('替换目标');
    expect(markup).toContain('/Volumes/Data/externalLib');
  });
});
