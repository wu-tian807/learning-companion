import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkbenchConversationInstruction } from "../../../main/conversation/workbench-conversation-instruction";
import type { GenerationTaskProcessContext } from "../../../main/generation/contracts/task-definition";
import { PDF_READ_FUNCTION_TOOL_ID } from "../../pdf/agent/pdf-function-tool";
import {
  DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
  createDocumentConversationContext,
} from "../document-conversation-context";
import { DocumentConversationContextProvider } from "./document-conversation-context-provider";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function createContext(input: {
  readonly mediaType: string;
  readonly materializedMediaType?: string;
  readonly previewDataUrl?: string;
  readonly selectedText?: string;
  readonly question?: string;
}) {
  const workspacePath = join(
    tmpdir(),
    `lc-document-region-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  temporaryPaths.push(workspacePath);
  const instruction = new WorkbenchConversationInstruction({
    contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
    assetId: "asset-1",
    conversationId: "conversation-1",
    question: input.question ?? "这个框里的公式是什么意思？",
    context: createDocumentConversationContext({
      target: {
        scope: "content",
        anchorType: "office.preview.region",
        anchorVersion: 1,
        anchorPayload: {
          pageNumber: 3,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.2,
        },
      },
      pageNumber: 3,
      ...(input.previewDataUrl ? { previewDataUrl: input.previewDataUrl } : {}),
      ...(input.selectedText ? { selectedText: input.selectedText } : {}),
    }),
  });

  return {
    workspacePath,
    context: {
      taskId: "task-1",
      projectId: "project-1",
      instruction,
      workspaces: {
        primary: {
          key: "workbench-conversation",
          instanceKey: "conversation-1",
          permissions: { read: true, write: false },
          path: workspacePath,
        },
        secondary: [],
      },
      assetReferences: {
        source: [
          {
            assetId: "asset-1",
            alias: "source",
            name: "slides.pptx",
            mediaType: input.mediaType,
            ...(input.materializedMediaType
              ? { materializedMediaType: input.materializedMediaType }
              : {}),
            relativePath: "references/source/slides.pptx",
            contentRevision: "revision-1",
          },
        ],
      },
      preparedUserMessage: {
        role: "user",
        content: [{ type: "text", text: "unused" }],
      },
      agent: {
        completedCalls: [],
        call: async () => {
          throw new Error("unused");
        },
      },
      reportStatus() {},
      reportOutputRejected() {},
    } as unknown as GenerationTaskProcessContext<WorkbenchConversationInstruction>,
  };
}

describe("DocumentConversationContextProvider", () => {
  it("materializes a PowerPoint region screenshot and sends it directly to the agent", async () => {
    const png = Buffer.from("selected PowerPoint pixels");
    const { context } = createContext({
      mediaType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      materializedMediaType: "application/pdf",
      previewDataUrl: `data:image/png;base64,${png.toString("base64")}`,
      question: "请用通俗易懂的语言解释我框选的内容。",
    });

    const prepared = await new DocumentConversationContextProvider().prepare(
      context,
    );

    expect(prepared.toolRequirements).toEqual([]);
    expect(prepared.statusMessage).toBe("正在快速回答框选内容…");
    expect(prepared.userMessage.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("优先只根据图中内容回答"),
        }),
        expect.objectContaining({ type: "local-image", detail: "original" }),
      ]),
    );
    const image = prepared.userMessage.content.find(
      (part) => part.type === "local-image",
    );
    expect(image?.type).toBe("local-image");
    if (image?.type !== "local-image") throw new Error("missing local image");
    await expect(readFile(image.path)).resolves.toEqual(png);
  });

  it("uses the no-tool fast path for a basic selected-region question", async () => {
    const { context } = createContext({
      mediaType: "application/pdf",
      previewDataUrl: `data:image/png;base64,${Buffer.from("pdf crop").toString("base64")}`,
      question: "请简洁总结我框选内容的核心信息。",
    });

    const prepared = await new DocumentConversationContextProvider().prepare(
      context,
    );

    expect(prepared.toolRequirements).toEqual([]);
  });

  it("uses the no-tool fast path for a basic selected-text question", async () => {
    const { context } = createContext({
      mediaType: "application/pdf",
      selectedText: "只看这段框选文字",
      question: "请翻译我框选的内容；如果主要是中文则翻译成英文，否则翻译成中文。",
    });

    const prepared = await new DocumentConversationContextProvider().prepare(
      context,
    );

    expect(prepared.toolRequirements).toEqual([]);
    expect(prepared.statusMessage).toBe("正在快速回答框选内容…");
    expect(JSON.stringify(prepared.userMessage)).toContain("只看这段框选文字");
  });

  it("keeps optional context available for an implicit-context question", async () => {
    const { context } = createContext({
      mediaType: "application/pdf",
      selectedText: "这个结论成立",
      question: "为什么会这样？",
    });

    const prepared = await new DocumentConversationContextProvider().prepare(
      context,
    );

    expect(prepared.toolRequirements).toEqual([
      { id: PDF_READ_FUNCTION_TOOL_ID, availability: "optional" },
    ]);
    expect(prepared.statusMessage).toBe("正在结合框选内容回答…");
  });

  it("offers nearby document context when the selected question explicitly needs it", async () => {
    const { context } = createContext({
      mediaType: "application/pdf",
      selectedText: "这个术语",
      question: "结合前文解释这里的术语为什么这样定义",
    });

    const prepared = await new DocumentConversationContextProvider().prepare(
      context,
    );

    expect(prepared.toolRequirements).toEqual([
      { id: PDF_READ_FUNCTION_TOOL_ID, availability: "optional" },
    ]);
    expect(prepared.statusMessage).toBe("正在结合框选内容回答…");
  });

  it("keeps the PDF reader for questions without a usable selection image", async () => {
    const { context } = createContext({ mediaType: "application/pdf" });

    const prepared = await new DocumentConversationContextProvider().prepare(
      context,
    );

    expect(prepared.toolRequirements).toEqual([
      { id: PDF_READ_FUNCTION_TOOL_ID, availability: "required" },
    ]);
  });
});
