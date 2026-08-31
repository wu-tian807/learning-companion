import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AssetSourceBadge } from './AssetSourceBadge';

describe('AssetSourceBadge', () => {
  it('renders the external label for absolute local files', () => {
    const markup = renderToStaticMarkup(
      <AssetSourceBadge
        contentRef={{
          kind: 'local-file',
          base: 'absolute',
          path: '/tmp/external.md',
        }}
      />,
    );

    expect(markup).toContain('外部');
    expect(markup).toContain('Project 工作区之外');
  });

  it('renders nothing for files managed inside the Workspace', () => {
    expect(
      renderToStaticMarkup(
        <AssetSourceBadge
          contentRef={{
            kind: 'local-file',
            base: 'project-workspace',
            path: 'assets/imported/internal.md',
          }}
        />,
      ),
    ).toBe('');
  });
});
