import { describe, expect, it } from 'vitest';

import {
  AgentSession,
  createAgentSessionLocator,
} from './agent-session';

const locator = createAgentSessionLocator({
  projectId: 'project-1',
  workspaceKey: 'generation-mindmap',
  instanceKey: 'task-1',
});

describe('AgentSession', () => {
  it('keeps independent provider bindings under one workspace identity', () => {
    const session = AgentSession.create(locator, 10);

    session.bindProvider({
      providerId: 'codex',
      sessionId: 'thread-codex-1',
      updatedTime: 11,
    });
    session.bindProvider({
      providerId: 'claude-code',
      sessionId: 'session-claude-1',
      updatedTime: 12,
    });

    const snapshot = session.getSnapshot();
    expect(snapshot).toEqual({
      locator,
      providerBindings: {
        codex: {
          sessionId: 'thread-codex-1',
          createdTime: 11,
        },
        'claude-code': {
          sessionId: 'session-claude-1',
          createdTime: 12,
        },
      },
      createdTime: 10,
      updatedTime: 12,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.providerBindings)).toBe(true);
    expect(Object.isFrozen(snapshot.providerBindings.codex)).toBe(true);
  });

  it('treats the same binding as idempotent', () => {
    const session = AgentSession.create(locator, 10);
    const input = {
      providerId: 'codex',
      sessionId: 'thread-1',
      updatedTime: 11,
    } as const;

    expect(session.bindProvider(input)).toBe(true);
    expect(
      session.bindProvider({ ...input, updatedTime: 99 }),
    ).toBe(false);
    expect(session.getSnapshot().updatedTime).toBe(11);
  });

  it('refuses to overwrite a binding without an explicit replacement', () => {
    const session = AgentSession.create(locator, 10);
    session.bindProvider({
      providerId: 'codex',
      sessionId: 'thread-1',
      updatedTime: 11,
    });

    expect(() =>
      session.bindProvider({
        providerId: 'codex',
        sessionId: 'thread-2',
        updatedTime: 12,
      }),
    ).toThrow('AGENT_SESSION_CONFLICT');
    expect(session.getProviderBinding('codex')?.sessionId).toBe(
      'thread-1',
    );
  });

  it('replaces only the expected provider session', () => {
    const session = AgentSession.create(locator, 10);
    session.bindProvider({
      providerId: 'codex',
      sessionId: 'thread-1',
      updatedTime: 11,
    });

    expect(() =>
      session.replaceProviderBinding({
        providerId: 'codex',
        expectedSessionId: 'stale-thread',
        sessionId: 'thread-2',
        updatedTime: 12,
      }),
    ).toThrow('AGENT_SESSION_CONFLICT');
    expect(
      session.replaceProviderBinding({
        providerId: 'codex',
        expectedSessionId: 'thread-1',
        sessionId: 'thread-2',
        updatedTime: 12,
      }),
    ).toBe(true);
    expect(session.getProviderBinding('codex')).toMatchObject({
      sessionId: 'thread-2',
      createdTime: 12,
    });
  });

  it('rejects path-unsafe locator identities and invalid timestamps', () => {
    expect(() =>
      createAgentSessionLocator({
        projectId: 'project-1',
        workspaceKey: 'generation-mindmap',
        instanceKey: '../task-1',
      }),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(() => AgentSession.create(locator, -1)).toThrow(
      'DATA_INTEGRITY_ERROR',
    );
  });
});
