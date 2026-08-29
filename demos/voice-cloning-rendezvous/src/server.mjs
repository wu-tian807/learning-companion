import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import {
  basename,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { VideoDemoJob, writeJsonAtomically } from "./video-demo-job.mjs";
import { demoRoot, resolveVideoDemoRuntime } from "./video-demo-runtime.mjs";

const port = Number.parseInt(process.env.PORT ?? "4178", 10);
export const videoDemoSessionsRoot = join(demoRoot, ".runtime", "sessions");
const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const ACTIVE_SESSION_PHASES = new Set([
  "starting",
  "transcribing",
  "source-ready",
  "separating-audio",
  "translating",
  "extracting-reference",
  "generating",
]);
const RESTARTABLE_SESSION_PHASES = new Set([
  "uploaded",
  "failed",
  "cancelled",
  ...ACTIVE_SESSION_PHASES,
]);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".m4v", "video/mp4"],
  [".mkv", "video/x-matroska"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
]);

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function safeRelative(root, requested) {
  const candidate = resolve(root, requested);
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot &&
    !pathFromRoot.startsWith("..") &&
    !pathFromRoot.includes(":")
    ? candidate
    : undefined;
}

function sessionPath(id) {
  return SESSION_ID.test(id) ? join(videoDemoSessionsRoot, id) : undefined;
}

function sessionView(manifest, isActive) {
  if (isActive || !ACTIVE_SESSION_PHASES.has(manifest.phase)) return manifest;
  return {
    ...manifest,
    phase: "interrupted",
    interruptedPhase: manifest.phase,
    message: "本地服务曾中断，可以从已完成进度继续。",
  };
}

async function serveFile(request, response, path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Not a file");
  const contentType =
    mimeTypes.get(extname(path).toLowerCase()) ?? "application/octet-stream";
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
    if (!match) {
      response
        .writeHead(416, { "Content-Range": `bytes */${info.size}` })
        .end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : info.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= info.size
    ) {
      response
        .writeHead(416, { "Content-Range": `bytes */${info.size}` })
        .end();
      return;
    }
    const boundedEnd = Math.min(end, info.size - 1);
    response.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": boundedEnd - start + 1,
      "Content-Range": `bytes ${start}-${boundedEnd}/${info.size}`,
      "Content-Type": contentType,
    });
    createReadStream(path, { start, end: boundedEnd }).pipe(response);
    return;
  }
  response.writeHead(200, {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Length": info.size,
    "Content-Type": contentType,
  });
  createReadStream(path).pipe(response);
}

async function readJson(request, maximumBytes = 16_384) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("JSON request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createVoiceDemoServer({
  runtimeResolver = resolveVideoDemoRuntime,
  jobFactory = (options) => new VideoDemoJob(options),
} = {}) {
  const activeJobs = new Map();

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (request.method === "GET" && pathname === "/api/health") {
        const runtime = await runtimeResolver();
        json(response, 200, {
          ready: runtime.ready,
          checks: runtime.checks,
          subtitleVersion: runtime.subtitle?.version,
          activeJobs: activeJobs.size,
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/sessions") {
        const encodedName = String(request.headers["x-file-name"] ?? "").trim();
        let originalName = encodedName;
        try {
          originalName = decodeURIComponent(encodedName);
        } catch {
          json(response, 400, { error: "视频文件名无效。" });
          return;
        }
        const safeName = basename(originalName);
        const extension = extname(safeName).toLowerCase();
        const contentLength = Number(request.headers["content-length"] ?? 0);
        if (!safeName || !VIDEO_EXTENSIONS.has(extension)) {
          json(response, 400, {
            error: "请选择 MP4、MOV、M4V、WEBM 或 MKV 视频。",
          });
          return;
        }
        if (
          !Number.isSafeInteger(contentLength) ||
          contentLength <= 0 ||
          contentLength > MAX_UPLOAD_BYTES
        ) {
          json(response, 413, { error: "视频为空或超过 4 GB。" });
          return;
        }
        const id = randomUUID();
        const root = join(videoDemoSessionsRoot, id);
        const inputDirectory = join(root, "input");
        const inputPath = join(inputDirectory, `source${extension}`);
        await mkdir(inputDirectory, { recursive: true });
        let received = 0;
        const limiter = new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            callback(
              received > MAX_UPLOAD_BYTES
                ? new Error("Video upload exceeded 4 GB")
                : undefined,
              chunk,
            );
          },
        });
        try {
          await pipeline(
            request,
            limiter,
            createWriteStream(inputPath, { flags: "wx" }),
          );
          if (received !== contentLength) {
            throw new Error("Video upload ended before Content-Length");
          }
          const now = Date.now();
          const manifest = {
            schemaVersion: 1,
            id,
            phase: "uploaded",
            uploadedTime: now,
            updatedTime: now,
            video: {
              originalName: safeName,
              file: `input/source${extension}`,
              bytes: received,
            },
            models: {},
          };
          await writeManifest(root, manifest);
          json(response, 201, manifest);
        } catch (error) {
          await rm(root, { recursive: true, force: true });
          throw error;
        }
        return;
      }

      const sessionMatch = /^\/api\/sessions\/([^/]+)(?:\/(.*))?$/u.exec(
        pathname,
      );
      if (sessionMatch) {
        const [, id, suffix = ""] = sessionMatch;
        const root = sessionPath(id);
        if (!root) {
          json(response, 404, { error: "实验不存在。" });
          return;
        }
        if (request.method === "GET" && !suffix) {
          json(
            response,
            200,
            sessionView(await readManifest(root), activeJobs.has(id)),
          );
          return;
        }
        if (request.method === "POST" && suffix === "start") {
          await readJson(request);
          if (activeJobs.has(id)) {
            json(response, 409, { error: "这个实验已经在运行。" });
            return;
          }
          if (activeJobs.size > 0) {
            json(response, 409, {
              error: "另一个实验正在使用 GPU，请等待它完成或先取消。",
            });
            return;
          }
          const runtime = await runtimeResolver();
          if (!runtime.ready || !runtime.subtitle) {
            json(response, 409, {
              error: "请先完成字幕组件、三个声音模型的本地安装，并登录 Codex。",
              checks: runtime.checks,
            });
            return;
          }
          const manifest = await readManifest(root);
          if (!RESTARTABLE_SESSION_PHASES.has(manifest.phase)) {
            json(response, 409, { error: "当前状态不能重新开始。" });
            return;
          }
          const inputPath = safeRelative(root, manifest.video.file);
          if (!inputPath) throw new Error("Session video path is invalid");
          const controller = new AbortController();
          const job = jobFactory({
            manifest,
            manifestPath: join(root, "manifest.json"),
            sessionRoot: root,
            inputPath,
            runtime,
          });
          activeJobs.set(id, controller);
          void job
            .run(controller.signal)
            .catch((error) => console.error("Video voice demo failed", error))
            .finally(() => activeJobs.delete(id));
          json(response, 202, { id, phase: "starting" });
          return;
        }
        if (request.method === "POST" && suffix === "cancel") {
          const controller = activeJobs.get(id);
          if (controller) controller.abort();
          json(response, 202, { id, cancelling: Boolean(controller) });
          return;
        }
        if (request.method === "GET" && suffix.startsWith("files/")) {
          const requested = suffix.slice("files/".length);
          const candidate = safeRelative(root, requested);
          if (!candidate) {
            json(response, 403, { error: "文件路径无效。" });
            return;
          }
          await serveFile(request, response, candidate);
          return;
        }
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      const relativePath =
        pathname === "/" ? "web/index.html" : pathname.slice(1);
      const candidate = safeRelative(demoRoot, normalize(relativePath));
      if (!candidate) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      await serveFile(request, response, candidate);
    } catch (error) {
      if (!response.headersSent) {
        const status =
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
            ? 404
            : 500;
        json(response, status, {
          error:
            status === 404
              ? "Not found"
              : error instanceof Error
                ? error.message
                : String(error),
        });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  });
}

async function writeManifest(root, manifest) {
  await mkdir(root, { recursive: true });
  await writeJsonAtomically(join(root, "manifest.json"), manifest);
}

async function readManifest(root) {
  return JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
}

const isEntrypoint =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  await mkdir(videoDemoSessionsRoot, { recursive: true });
  createVoiceDemoServer().listen(port, "127.0.0.1", () => {
    console.log(`Voice-cloning rendezvous demo: http://127.0.0.1:${port}`);
    console.log(
      `Real video experiment: http://127.0.0.1:${port}/web/video-demo.html`,
    );
  });
}
