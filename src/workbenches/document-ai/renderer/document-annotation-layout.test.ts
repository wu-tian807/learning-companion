import { describe, expect, it } from 'vitest';

import { documentContentLayoutClassName } from './document-annotation-layout';

describe('documentContentLayoutClassName', () => {
  it('reserves the annotation sidebar width instead of overlaying document content', () => {
    expect(documentContentLayoutClassName(true)).toContain('mr-[332px]');
    expect(documentContentLayoutClassName(false)).not.toContain('mr-[332px]');
  });
});
