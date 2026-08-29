import { describe, expect, it } from 'vitest';

import { resolveProjectRightRail } from './project-right-rail';

describe('resolveProjectRightRail', () => {
  it('replaces Generation Center with an inline conversation rail', () => {
    expect(resolveProjectRightRail({
      conversationOpen: true,
      generationOpen: true,
      generationInline: false,
    })).toEqual({
      kind: 'conversation',
      className: 'h-full w-[clamp(318px,20vw,390px)] shrink-0',
    });
  });

  it('keeps the existing Generation Center behavior when conversation is closed', () => {
    expect(resolveProjectRightRail({
      conversationOpen: false,
      generationOpen: true,
      generationInline: false,
    })?.kind).toBe('generation');
    expect(resolveProjectRightRail({
      conversationOpen: false,
      generationOpen: false,
      generationInline: true,
    })).toBeUndefined();
  });
});
