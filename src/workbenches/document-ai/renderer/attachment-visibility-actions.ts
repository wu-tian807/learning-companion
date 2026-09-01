import type { WorkbenchActionBundle } from "../../../renderer/workbench/actions/workbench-action-bundle";

export function createAttachmentVisibilityActions(input: {
  readonly attachmentCount: number;
  readonly visible: boolean;
  readonly onToggle: () => void;
}): WorkbenchActionBundle {
  return {
    actions: [
      {
        id: "document-ai.toggle-attachments",
        enabled: input.attachmentCount > 0,
        execute: input.onToggle,
      },
    ],
    contributions: [
      {
        id: "document-ai.toggle-attachments.header",
        actionId: "document-ai.toggle-attachments",
        surface: "header",
        group: "20-document-annotations",
        order: 10,
        presentation: {
          kind: "checkbox",
          checked: input.visible,
          label: input.visible ? "隐藏附着" : "显示附着",
          badge: String(input.attachmentCount),
          description:
            input.attachmentCount > 0
              ? input.visible
                ? "隐藏文档中的附着框和回复卡片"
                : "显示文档中的附着框和回复卡片"
              : "当前资料没有附着内容",
          disabledReason:
            input.attachmentCount > 0 ? undefined : "当前资料没有附着内容",
        },
      },
    ],
  };
}
