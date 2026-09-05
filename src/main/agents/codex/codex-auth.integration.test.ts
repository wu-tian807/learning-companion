import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import writeFileAtomic from 'write-file-atomic';
import { describe, expect, it } from 'vitest';

import { createCodexRuntime } from '../../bootstrap/create-codex-runtime';
import { createManagedCodexHomePath, resolveCodexAuthHomePath } from './codex-home-resolver';

function authFixture(email: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + 3600, email,
    'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_plan_type: 'plus' },
  })}.fixture`;
  return JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: {
    access_token: token, id_token: token, refresh_token: 'fixture-refresh-never-log', account_id: 'fixture-account',
  }, last_refresh: new Date().toISOString() });
}

describe.runIf(['darwin', 'win32'].includes(process.platform))('native shared auth composition', () => {
  it('runs and resumes a real Codex turn with borrowed credentials against a local Responses fixture', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-native-auth-turn-'));
    const source = join(root, 'source'); const home = join(root, 'home');
    await mkdir(source);
    const original = '{"OPENAI_API_KEY":"fixture-local-model-key"}';
    await writeFile(join(source, 'auth.json'), original);
    let authenticatedRequests = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (!request.url?.endsWith('/responses')) { response.writeHead(404).end(); return; }
      if (request.headers.authorization === 'Bearer fixture-local-model-key') authenticatedRequests += 1;
      const item = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'LC_ISOLATED_OK', annotations: [] }] };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [
        { type: 'response.created', response: { id: 'resp_fixture', status: 'in_progress', output: [] } },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp_fixture', status: 'completed', output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture port unavailable');
    const service = createCodexRuntime({ codexHomePath: home, authHomePath: source, isPackaged: false, resourcesPath: process.cwd() });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const provider = { name: 'Local fixture', base_url: `http://127.0.0.1:${address.port}`,
        requires_openai_auth: true, wire_api: 'responses', supports_websockets: false } as const;
      const thread = await service.createThread({ cwd: home, model: 'gpt-test', modelProvider: 'fixture', approvalPolicy: 'never',
        configOverrides: { model_providers: { fixture: provider },
        features: { memories: false, shell_tool: false }, web_search: 'disabled' } });
      const completed = (async () => {
        const turn = service.startTurn({ threadId: thread.thread.id, input: [{ type: 'text', text: 'Local protocol fixture.' }] });
        while (true) { const next = await turn.next(); if (next.done) return next.value; }
      })();
      const result = await Promise.race([completed, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('local Responses fixture deadline exceeded')), 15_000);
      })]);
      clearTimeout(timer);
      expect(result.turn.status).toBe('completed');
      expect(JSON.stringify(result.turn.items)).toContain('LC_ISOLATED_OK');
      expect(authenticatedRequests).toBe(1);
      expect(await readFile(join(source, 'auth.json'), 'utf8')).toBe(original);
      expect(await readdir(source)).toEqual(['auth.json']);
      await service.shutdown();
      const resumed = await service.selectThread({ threadId: thread.thread.id, cwd: home,
        configOverrides: { model_providers: { fixture: provider } } });
      expect(JSON.stringify(resumed.thread.turns)).toContain('LC_ISOLATED_OK');
    } finally {
      clearTimeout(timer); await service.shutdown(); server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps sessions isolated, reuses native login, repairs replacement and clears deletion across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-native-auth-composition-'));
    const user = join(root, 'user'); const source = join(user, '.codex');
    const home = createManagedCodexHomePath(join(root, 'Documents'));
    await mkdir(source, { recursive: true });
    const sourceFile = join(source, 'auth.json');
    await writeFile(sourceFile, authFixture('first@example.invalid'));
    const authHomePath = await resolveCodexAuthHomePath({ managedCodexHomePath: home, userHomePath: user, environment: {} });
    const service = createCodexRuntime({ codexHomePath: home, authHomePath, isPackaged: false, resourcesPath: process.cwd() });
    try {
      expect((await service.getAccount()).account).toMatchObject({ type: 'chatgpt', email: 'first@example.invalid' });
      const thread = await service.createThread({ cwd: home, model: 'gpt-test', approvalPolicy: 'never',
        configOverrides: { features: { memories: false }, web_search: 'disabled' } });
      expect(String(thread.thread.path).replaceAll('\\', '/')).toContain(home.replaceAll('\\', '/'));
      expect(await readdir(source)).toEqual(['auth.json']);
      expect((await stat(sourceFile)).ino).toBe((await stat(join(home, 'auth.json'))).ino);
      await writeFile(sourceFile, authFixture('in-place@example.invalid'));
      expect((await service.getAccount()).account).toMatchObject({ email: 'in-place@example.invalid' });
      await writeFileAtomic(sourceFile, authFixture('second@example.invalid'));
      expect((await service.getAccount()).account).toMatchObject({ email: 'second@example.invalid' });
      await service.shutdown();
      expect((await service.getAccount()).account).toMatchObject({ email: 'second@example.invalid' });
      await rm(sourceFile);
      expect((await service.getAccount()).account).toBeNull();
      await expect(stat(join(home, 'auth.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readdir(source)).toEqual([]);
    } finally { await service.shutdown(); await rm(root, { recursive: true, force: true }); }
  }, 30_000);

  it('logs out locally without deleting the original credential file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lc-native-auth-logout-'));
    const source = join(root, 'source'); const home = join(root, 'home');
    await mkdir(source); await writeFile(join(source, 'auth.json'), '{"OPENAI_API_KEY":"fixture-key"}');
    const service = createCodexRuntime({ codexHomePath: home, authHomePath: source, isPackaged: false, resourcesPath: process.cwd() });
    try {
      expect((await service.getAccount()).account).toMatchObject({ type: 'apiKey' });
      await service.logout();
      expect((await service.getAccount()).account).toBeNull();
      expect(await readFile(join(source, 'auth.json'), 'utf8')).toBe('{"OPENAI_API_KEY":"fixture-key"}');
      await service.shutdown();
      expect((await service.getAccount()).account).toBeNull();
    } finally { await service.shutdown(); await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});
