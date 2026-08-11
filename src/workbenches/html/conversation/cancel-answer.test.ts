import { describe, expect, it } from 'vitest';

import {
  applyCancellation,
  type DisplayMessage,
} from './cancel-answer';

describe('applyCancellation', () => {
  it('取消时保留已生成的部分并标记 stopped，用户问题保留', () => {
    const messages: DisplayMessage[] = [
      { id: 'u-1', role: 'user', text: '请总结' },
      {
        id: 'a-1',
        role: 'assistant',
        text: '这是已经生成的部分内容',
        streaming: true,
      },
    ];

    const result = applyCancellation(messages, 'a-1');

    expect(result).toHaveLength(2);
    const stopped = result.find((message) => message.id === 'a-1');
    expect(stopped).toBeDefined();
    expect(stopped).toMatchObject({
      role: 'assistant',
      text: '这是已经生成的部分内容',
      streaming: false,
      stopped: true,
    });
    expect(result.find((message) => message.id === 'u-1')).toBeDefined();
  });

  it('没有匹配消息时保持内容不变', () => {
    const messages: DisplayMessage[] = [
      { id: 'u-1', role: 'user', text: '问题' },
      { id: 'a-1', role: 'assistant', text: '回答', streaming: false },
    ];

    const result = applyCancellation(messages, 'a-999');

    expect(result).toEqual(messages);
    expect(result[1].streaming).toBe(false);
  });

  it('取消非流式消息时不打 stopped 标记', () => {
    const messages: DisplayMessage[] = [
      { id: 'u-1', role: 'user', text: '问题' },
      { id: 'a-1', role: 'assistant', text: '完整回答', streaming: false },
    ];

    const result = applyCancellation(messages, 'a-1');

    expect(result[1]).toEqual(messages[1]);
    expect(result[1].stopped).toBeUndefined();
  });
});
