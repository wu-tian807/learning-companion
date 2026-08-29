import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";

import {
  createVoiceDemoServer,
  safeRelative,
  videoDemoSessionsRoot,
} from "../src/server.mjs";
import { writeJsonAtomically } from "../src/video-demo-job.mjs";

async function withServer(run, overrides = {}) {
  const server = createVoiceDemoServer({
    runtimeResolver: async () => ({
      ready: false,
      checks: {
        python: false,
        subtitle: false,
        voxcpm15: false,
        voxcpm2: false,
        f5tts: false,
      },
    }),
    ...overrides,
  });
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolvePromise, rejectPromise) =>
      server.close((error) =>
        error ? rejectPromise(error) : resolvePromise(),
      ),
    );
  }
}

test("rejects unsupported uploads before creating a session", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "x-file-name": "notes.txt" },
      body: "not a video",
    });
    assert.equal(response.status, 400);
  });
});

test("stores an uploaded video inside an isolated session and supports ranges", async () => {
  let id;
  try {
    await withServer(async (baseUrl) => {
      const bytes = Buffer.from("0123456789");
      const upload = await fetch(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent("demo video.mp4") },
        body: bytes,
      });
      assert.equal(upload.status, 201);
      const manifest = await upload.json();
      id = manifest.id;
      assert.equal(manifest.video.originalName, "demo video.mp4");

      const range = await fetch(
        `${baseUrl}/api/sessions/${id}/files/${manifest.video.file}`,
        { headers: { range: "bytes=2-5" } },
      );
      assert.equal(range.status, 206);
      assert.equal(await range.text(), "2345");
    });
  } finally {
    if (id) {
      await rm(`${videoDemoSessionsRoot}/${id}`, {
        recursive: true,
        force: true,
      });
    }
  }
});

test("does not resolve session file traversal", () => {
  assert.equal(safeRelative("D:/demo/session", "../secret.txt"), undefined);
  assert.equal(safeRelative("D:/demo/session", ""), undefined);
});

test("exposes an orphaned active phase as resumable and starts it again", async () => {
  let id;
  let started = false;
  try {
    await withServer(
      async (baseUrl) => {
        const upload = await fetch(`${baseUrl}/api/sessions`, {
          method: "POST",
          headers: { "x-file-name": "resume.mp4" },
          body: Buffer.from("video"),
        });
        const uploaded = await upload.json();
        id = uploaded.id;
        const manifestPath = `${videoDemoSessionsRoot}/${id}/manifest.json`;
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        await writeJsonAtomically(manifestPath, {
          ...manifest,
          phase: "generating",
        });

        const restored = await fetch(`${baseUrl}/api/sessions/${id}`);
        assert.equal(restored.status, 200);
        const view = await restored.json();
        assert.equal(view.phase, "interrupted");
        assert.equal(view.interruptedPhase, "generating");

        const resumed = await fetch(`${baseUrl}/api/sessions/${id}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        assert.equal(resumed.status, 202);
        await new Promise((resolvePromise) => setImmediate(resolvePromise));
        assert.equal(started, true);
      },
      {
        runtimeResolver: async () => ({
          ready: true,
          checks: {},
          subtitle: {},
        }),
        jobFactory: () => ({
          run: async () => {
            started = true;
          },
        }),
      },
    );
  } finally {
    if (id) {
      await rm(`${videoDemoSessionsRoot}/${id}`, {
        recursive: true,
        force: true,
      });
    }
  }
});
