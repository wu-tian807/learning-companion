import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { GenerationCenter } from './GenerationCenter';

describe('GenerationCenter', () => {
  it('renders an explicit empty state without an active Asset', () => {
    const html = renderToStaticMarkup(
      <WorkbenchRuntimeProvider onError={() => undefined}>
        <GenerationCenter
          asset={undefined}
          mediaLabel={(mediaType) => mediaType}
        />
      </WorkbenchRuntimeProvider>,
    );

    expect(html).toContain('生成中心');
    expect(html).toContain('选择 Asset 后显示对应上下文');
    expect(html).toContain('选择 Asset 后显示对应工具');
  });
});
