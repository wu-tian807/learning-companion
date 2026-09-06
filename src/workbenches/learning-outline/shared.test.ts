import { describe, expect, it } from 'vitest';

import { createEmptyLearningBrief, getLearningBriefMissingFields, isLearningBrief,
  isLearningBriefComplete, validateLearningBrief } from './shared';

function completeBrief() {
  return { ...createEmptyLearningBrief(), goal: '读懂论文', currentLevel: '有基础',
    difficulties: '暂无', constraints: '每周两天', preferences: '实践', scope: '核心方法',
    roadmap: [{ id: 'week-1', title: '基础与方法', goal: '理解核心思路' }] };
}

describe('Learning brief file and completion contract', () => {
  it('accepts old version-1 briefs without detailed, but does not treat an empty template as complete', () => {
    const { detailed, ...legacy } = completeBrief();
    expect(detailed).toBe('');
    expect(isLearningBrief(legacy)).toBe(true);
    expect(isLearningBrief(createEmptyLearningBrief())).toBe(true);
    expect(isLearningBriefComplete(createEmptyLearningBrief())).toBe(false);
    expect(isLearningBrief(completeBrief())).toBe(true);
    expect(isLearningBriefComplete(completeBrief())).toBe(true);
    expect(isLearningBriefComplete({ ...completeBrief(), detailed: '' })).toBe(true);
    expect(isLearningBriefComplete({ ...completeBrief(), detailed: '另外希望有配套例子。' })).toBe(true);
  });

  it.each(['goal', 'currentLevel', 'difficulties', 'constraints', 'preferences', 'scope'] as const)(
    'does not trust readiness=ready when %s is missing', (field) => {
      const brief = { ...completeBrief(), [field]: '  ', readiness: 'ready' as const };
      expect(isLearningBrief(brief)).toBe(true);
      expect(isLearningBriefComplete(brief)).toBe(false);
      expect(getLearningBriefMissingFields(brief)).toHaveLength(1);
    },
  );

  it('requires a roadmap and resolution of open questions without making detailed mandatory', () => {
    expect(getLearningBriefMissingFields({ ...completeBrief(), roadmap: [] })).toEqual(['路线草案']);
    expect(getLearningBriefMissingFields({ ...completeBrief(), openQuestions: ['范围确认？'] })).toEqual(['待确认问题']);
    expect(getLearningBriefMissingFields(completeBrief())).toEqual([]);
  });

  it('pinpoints the reported chapter/outcomes mismatch and accepts id/title/goal after correction', () => {
    const malformed = { ...completeBrief(), roadmap: [
      { chapter: '第 1 周', outcomes: '读懂基础', sourceAliases: ['source-0001'] },
      { chapter: '第 2 周', outcomes: '理解方法', sourceAliases: ['source-0001'] },
    ] };
    expect(validateLearningBrief(malformed).map((issue) => issue.split('：')[0])).toEqual([
      'roadmap[0].id', 'roadmap[0].title', 'roadmap[1].id', 'roadmap[1].title',
    ]);
    expect(isLearningBrief({ ...malformed, roadmap: malformed.roadmap.map((item, index) => ({
      id: `week-${index + 1}`, title: item.chapter, goal: item.outcomes,
    })), detailed: '路线参考 source-0001。' })).toBe(true);
  });

  it('rejects invalid optional data, duplicate ids, whitespace titles, unknown versions and non-JSON values', () => {
    for (const detailed of [null, [], {}, 1, 'x'.repeat(32_769)]) {
      expect(validateLearningBrief({ ...completeBrief(), detailed }).join()).toContain('detailed');
    }
    expect(validateLearningBrief({ ...completeBrief(), roadmap: [
      { id: 'same', title: '第一章' }, { id: 'same', title: '  ' },
    ] }).join()).toContain('标识重复');
    expect(isLearningBrief({ ...completeBrief(), version: 2 })).toBe(false);
    expect(isLearningBrief({ ...completeBrief(), extra: undefined })).toBe(false);
  });
});
