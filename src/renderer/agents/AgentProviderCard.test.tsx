import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSnapshot } from '../../shared/agent-providers';
import { AgentProviderCard } from './AgentProviderCard';

const selectedProvider: AgentProviderSnapshot = {
  id: 'codex',
  displayName: 'Codex',
  description: '使用 ChatGPT 账号运行 Codex。',
  loginLabel: '使用 ChatGPT 登录',
  selected: true,
  credential: {
    status: 'authenticated',
    account: {
      email: 'student@example.com',
      planType: 'plus',
    },
  },
};

function renderCard(selectedActionLabel?: string): string {
  return renderToStaticMarkup(
    <AgentProviderCard
      provider={selectedProvider}
      busy={false}
      checking={false}
      selectedActionLabel={selectedActionLabel}
      onLogin={vi.fn()}
      onSelect={vi.fn()}
      onRefresh={vi.fn()}
      onReopenLogin={vi.fn()}
    />,
  );
}

describe('AgentProviderCard', () => {
  it('does not offer an action for the selected Provider in settings', () => {
    const markup = renderCard();

    expect(markup).toContain('已选择');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('继续使用');
  });

  it('allows the onboarding dialog to provide an explicit completion action', () => {
    const markup = renderCard('完成');

    expect(markup).toContain('<button');
    expect(markup).toContain('完成');
  });
});
