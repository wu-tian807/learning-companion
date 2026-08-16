import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(SOURCE_DIRECTORY, '..');
const LLAMA_VERSION = 'b10442';

async function findAvailablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForServer(baseUrl, child, getLogs, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Hy-MT2 server exited with code ${child.exitCode}.\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The port is not accepting connections while llama.cpp loads the model.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for the Hy-MT2 server.\n${getLogs()}`);
}

export async function readProcessWorkingSetBytes(pid) {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync(
      'tasklist.exe',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, encoding: 'utf8' },
    );
    const lastField = /,"([0-9,.\s]+)\s*K"\s*$/iu.exec(stdout.trim())?.[1];
    if (!lastField) return null;
    return Number(lastField.replace(/[^0-9]/gu, '')) * 1024;
  } catch {
    return null;
  }
}

export async function readNvidiaProcessMemoryBytes(pid) {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi.exe',
      ['--query-compute-apps=pid,used_gpu_memory', '--format=csv,noheader,nounits'],
      { windowsHide: true, encoding: 'utf8' },
    );
    for (const line of stdout.split(/\r?\n/u)) {
      const [processId, memoryMiB] = line.split(',').map((value) => value.trim());
      if (Number(processId) === pid && Number.isFinite(Number(memoryMiB))) {
        return Number(memoryMiB) * 1024 * 1024;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function startHyMt2Server({
  backend = 'vulkan',
  contextSize = 2_048,
  parallel = 4,
  timeoutMs = 120_000,
} = {}) {
  if (!['cpu', 'vulkan'].includes(backend)) throw new Error(`Unsupported Hy-MT2 backend: ${backend}`);
  const manifestPath = resolve(
    DEMO_ROOT,
    '.runtime',
    'llama.cpp',
    LLAMA_VERSION,
    backend,
    'hymt2.runtime.json',
  );
  let manifest;
  try {
    manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/u, ''));
  } catch (error) {
    throw new Error(`Hy-MT2 ${backend} runtime is not installed. Run pnpm setup:hymt2 -- -Backend ${backend}.`, {
      cause: error,
    });
  }

  const port = await findAvailablePort();
  const logs = [];
  const startedAt = performance.now();
  const child = spawn(
    manifest.executable,
    [
      '--model',
      manifest.model,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--ctx-size',
      String(contextSize),
      '--parallel',
      String(parallel),
      '--gpu-layers',
      backend === 'vulkan' ? '99' : '0',
      '--jinja',
      '--no-webui',
    ],
    {
      cwd: dirname(manifest.executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const capture = (chunk) => {
    logs.push(chunk.toString('utf8'));
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const getLogs = () => logs.join('').slice(-24_000);
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(baseUrl, child, getLogs, timeoutMs);
  } catch (error) {
    child.kill();
    throw error;
  }

  return {
    backend,
    baseUrl,
    child,
    manifest,
    modelLoadMs: performance.now() - startedAt,
    getLogs,
    async complete(prompt, { maxTokens = 512 } = {}) {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: manifest.modelId,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          seed: 1,
          max_tokens: maxTokens,
          stream: false,
          cache_prompt: false,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Hy-MT2 request failed (${response.status}): ${JSON.stringify(payload)}`);
      }
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new Error(`Hy-MT2 returned no assistant text: ${JSON.stringify(payload)}`);
      }
      return { text: text.trim(), usage: payload.usage ?? null };
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await Promise.race([
        new Promise((resolveExit) => child.once('exit', resolveExit)),
        new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
      ]);
    },
  };
}
