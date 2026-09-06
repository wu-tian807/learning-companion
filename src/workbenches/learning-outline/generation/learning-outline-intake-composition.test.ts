import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { WorkbenchConversationContextProviderRegistry } from '../../../main/conversation/workbench-conversation-context-provider-registry';
import { createTextAgentUserMessage } from '../../../main/generation/contracts/agent-message';
import type { TaskAgentCallRequest, TaskAgentCallResult } from '../../../main/generation/contracts/task-definition';
import { LearningOutlineBriefMonitor } from '../brief/learning-outline-brief-monitor';
import type { LearningOutlineServiceApi } from '../service/learning-outline-service';
import { createEmptyLearningBrief, LEARNING_BRIEF_COMPLETION_NOTICE, LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  LEARNING_OUTLINE_INTAKE_MODE_ID } from '../shared';
import { LearningOutlineIntakeInstruction } from './learning-outline-intake-instruction';
import { createLearningOutlineIntakeTaskDefinitionV1 } from './learning-outline-intake-task-definition';

it('validates actual Agent file writes, feeds back field errors and persists a repaired complete brief', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lc-intake-composition-'));
  const file = join(directory, 'learning-brief.json');
  const snapshots: unknown[] = [];
  const asset = { id: 'outline-1', projectId: 'project-1', mediaType: LEARNING_OUTLINE_ASSET_MEDIA_TYPE };
  const monitor = new LearningOutlineBriefMonitor(
    { get: () => asset } as never,
    { listByAsset: async () => [],
      createWithContent: async ({ content }: { content: { data: Uint8Array } }) => {
        snapshots.push(JSON.parse(Buffer.from(content.data).toString('utf8')));
        return { updatedTime: 42 };
      },
    } as never,
    { prepare: async () => directory } as never,
  );
  const requests: TaskAgentCallRequest[] = [];
  try {
    const service = {
      runBriefTask: async <T>(_assetId: string, operation: () => Promise<T>) => operation(),
      requireBoundConversation: () => ({ id: 'conversation-1', modeId: LEARNING_OUTLINE_INTAKE_MODE_ID }),
      startBriefMonitor: (projectId: string, assetId: string) => monitor.start(projectId, assetId),
      flushBrief: (assetId: string) => monitor.flush(assetId),
      getBriefState: (assetId: string) => monitor.getState(assetId),
    } as unknown as LearningOutlineServiceApi;
    const result = await createLearningOutlineIntakeTaskDefinitionV1(new WorkbenchConversationContextProviderRegistry(), service).process({
      taskId: 'task-1', projectId: asset.projectId,
      instruction: new LearningOutlineIntakeInstruction({ conversationId: 'conversation-1', boundAssetId: asset.id, question: '就按刚才讨论的范围整理吧。' }),
      workspaces: { primary: { key: 'learning-outline-intake', instanceKey: 'conversation-1', path: directory, permissions: { read: true, write: false } },
        secondary: [{ key: 'learning-outline-brief', instanceKey: asset.id, path: directory, permissions: { read: true, write: true } }] },
      preparedUserMessage: createTextAgentUserMessage('整理已确认的需求。'), assetReferences: {},
      reportStatus: () => undefined, reportOutputRejected: () => undefined,
      agent: { completedCalls: [], call: async (request) => {
        requests.push(request);
        if (request.callKey === 'answer') {
          await writeFile(file, JSON.stringify({ ...createEmptyLearningBrief(),
            goal: '读懂主题', currentLevel: '有基础', difficulties: '暂无', constraints: '不限',
            preferences: '例子', scope: '方法', detailed: '保留这条额外补充。', readiness: 'ready',
            roadmap: [{ chapter: '基础与方法', outcomes: '理解方法' }],
          }));
        } else {
          const current = JSON.parse(await readFile(file, 'utf8'));
          await writeFile(file, JSON.stringify({ ...current, roadmap: current.roadmap.map(
            (item: { chapter: string; outcomes: string }, index: number) => ({ id: `unit-${index + 1}`, title: item.chapter, goal: item.outcomes }),
          ) }));
        }
        return { callKey: request.callKey, purpose: request.purpose, sessionId: 'session-1',
          assistantOutput: request.callKey === 'answer' ? '已整理路线。' : '已确认路线并保留额外补充。',
          metrics: { providerId: 'fixture', modelId: 'fixture' },
        } as TaskAgentCallResult;
      } },
    });
    expect(requests.map((request) => request.callKey)).toEqual(['answer', 'repair-brief-1']);
    expect(JSON.stringify(requests[1]!.userMessage)).toContain('roadmap[0].title');
    expect(snapshots).toHaveLength(2); // Initial template and the repaired file; never the rejected shape.
    expect(snapshots[1]).toMatchObject({ detailed: '保留这条额外补充。', roadmap: [{ id: 'unit-1', title: '基础与方法', goal: '理解方法' }] });
    expect(monitor.getState(asset.id)).toMatchObject({ valid: true, ready: true });
    expect(result.answer).toContain(LEARNING_BRIEF_COMPLETION_NOTICE);
  } finally {
    await monitor.shutdown(); monitor.dispose(); await rm(directory, { recursive: true, force: true });
  }
});
