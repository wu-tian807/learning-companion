# HTML 对话消息锚点回显红框实现计划

## 1. 目标

用户点击 HTML AI 对话消息中的“选中：……”锚点摘要后，应用使用该消息已经保存的 `anchorPayload.rect`，在 HTML 原文对应位置短暂显示红框。

本次只恢复“点击消息锚点后回显红框”的交互，不重新计算 iframe 内滚动或页面重排后的元素位置。

## 2. 当前基础

现有实现已经具备以下能力：

- 用户消息会保存发送时使用的完整 anchor；
- `html.element@1` 的 `anchorPayload` 必须包含 `rect`；
- 新版拖选产生的 `html.quote@1` 可以携带 `rect`；
- `AnchorHighlight` 已能把 frame 内 rect 加上 iframe 视口偏移，绘制红框；
- `HtmlWorkbenchView` 已经维护 `highlightTarget`、`highlightPersistent` 和 `highlightKey`。

当前缺失的是从消息中的锚点摘要到 `HtmlWorkbenchView` 高亮状态之间的点击回调链路。

## 3. 范围

只修改 `src/workbenches/html/`：

- `conversation/conversation-messages.tsx`
- `conversation/ConversationOverlay.tsx`
- `renderer.tsx`
- 对应测试文件

不修改以下通用层：

- `src/main/workbench/interaction/`
- `src/renderer/workbench/runtime/`
- `src/shared/workbench/facilities/`
- preload / IPC / generation provider

当前 renderer 本地 mock 必须保留，真实 `startGenerationTask` 代码也继续保留。

## 4. 非目标

本次不处理：

- iframe 内容滚动后重新计算 rect；
- HTML 页面重新布局、缩放或刷新后的锚点重新解析；
- 根据 `domPath` 重新查找元素；
- 自动滚动 iframe 到锚点位置；
- 为 link anchor 新增 rect；
- 为旧历史补齐缺失的 rect；
- 修改对话历史协议版本。

## 5. 可点击锚点规则

新增一个纯函数判断消息 anchor 是否可以回显红框。

可点击条件：

1. anchor 必须是对象；
2. `anchorPayload` 必须是对象；
3. `anchorPayload.rect` 必须包含有限数值的 `x`、`y`、`width`、`height`；
4. `width` 和 `height` 必须大于 0；
5. anchor 类型必须是 `html.element` 或 `html.quote`。

以下情况继续显示摘要文字，但不渲染为按钮：

- 没有 rect 的旧版 `html.quote`；
- 当前没有位置数据的 `html.link`；
- rect 无效或宽高为 0；
- 未识别的 anchor 类型。

这样可以避免出现“看起来能点击，但点击后没有任何反应”的控件。

## 6. 实现步骤

### Task 1：改造消息锚点摘要

文件：`src/workbenches/html/conversation/conversation-messages.tsx`

改动：

1. 增加 `isHighlightableMessageAnchor(anchor)` 纯函数；
2. 给 `MessageBubble` 增加可选的 `onAnchorActivate` 属性；
3. 对具有合法 rect 的 element/quote anchor：
   - 使用 `<button type="button">` 渲染“选中：……”；
   - 点击时回传该消息保存的完整 anchor；
   - 增加 `aria-label="在原文中显示选中位置"`；
   - 增加 hover、focus-visible 和红色提示样式；
4. 对不可定位 anchor 保留普通 `<span>`；
5. 给 `MessageStream` 增加 `onAnchorActivate`，并传给每个 `MessageBubble`。

锚点按钮不得修改消息内容、当前输入框、pending anchor 或历史身份。

### Task 2：贯通 ConversationOverlay 回调

文件：`src/workbenches/html/conversation/ConversationOverlay.tsx`

改动：

1. 给 `HtmlConversationOverlayProps` 增加：

   ```ts
   readonly onAnchorActivate?: (anchor: JsonValue) => void;
   ```

2. 将该回调传给 `MessageStream`；
3. 不在 `ConversationOverlay` 内维护第二份高亮状态；
4. 不把点击的历史 anchor 设置成待发送 anchor；
5. 不触发保存、恢复、新对话或 generation task。

点击历史锚点只是一项查看操作，不能改变下一次提问携带的 anchor。

### Task 3：在 HtmlWorkbenchView 激活红框

文件：`src/workbenches/html/renderer.tsx`

给 `ConversationOverlay` 传入 `onAnchorActivate`：

1. 从完整 anchor 中读取 `anchorType` 和 `anchorPayload`；
2. 设置 `highlightTarget`；
3. 设置 `highlightPersistent(false)`，使用短暂模式；
4. 递增 `highlightKey`，保证连续点击同一个锚点也会重新启动计时器；
5. 不修改 `aiAnchor`，避免把历史锚点错误带到下一条提问；
6. 不关闭对话栏。

继续复用现有：

```tsx
<AnchorHighlight
  key={highlightKey}
  target={highlightTarget}
  durationMs={highlightPersistent ? 0 : 2_800}
/>
```

红框默认显示约 2.8 秒，然后由 `AnchorHighlight` 自动隐藏。

### Task 4：补测试

新增或扩展消息组件测试，至少覆盖：

1. 携带合法 rect 的 `html.element` 渲染为按钮；
2. 携带合法 rect 的 `html.quote` 渲染为按钮；
3. 无 rect 的旧 quote 只渲染摘要文字；
4. link anchor 不渲染为定位按钮；
5. 无效 rect 不渲染为定位按钮；
6. 调用锚点按钮的点击处理时，回传原始 anchor；
7. 普通用户消息和 AI 消息结构保持不变。

测试优先保持在现有 Vitest/SSR 体系内，不为这一项功能额外引入 React Testing Library 或新的 DOM 测试依赖。可将锚点按钮拆成小型纯组件，直接验证其返回元素和点击回调。

## 7. 验证命令

实现完成后运行：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run src/workbenches/html
node node_modules/eslint/bin/eslint.js src/workbenches/html/conversation/conversation-messages.tsx src/workbenches/html/conversation/ConversationOverlay.tsx src/workbenches/html/renderer.tsx
git diff --check
```

同时人工核对：

1. 新建一条带文本选区的 mock 对话；
2. 回答完成并保存历史；
3. 点击当前消息的“选中：……”；
4. 原文对应存档 rect 显示红框；
5. 打开历史并恢复该对话；
6. 再次点击“选中：……”仍能显示红框；
7. 连续点击同一个锚点时，红框计时会重新开始；
8. 点击锚点后继续提问，不会自动携带刚查看的历史 anchor。

## 8. 验收标准

- 有合法 rect 的消息锚点具有明确的可点击样式和键盘焦点样式；
- 点击后原文位置出现红框；
- 红框约 2.8 秒后消失；
- 重复点击能够重新显示；
- 无 rect 的历史锚点不会出现无效按钮；
- 点击历史锚点不会改变下一次提问的 pending anchor；
- 当前本地 mock、真实 generation 代码和历史存档逻辑不受影响；
- 改动全部位于 `src/workbenches/html/`；
- 类型检查、定向测试、目标 ESLint 和 `git diff --check` 全部通过。

## 9. 回滚方式

该能力仅通过可选回调接入。需要回滚时：

1. 删除 `renderer.tsx` 传入的 `onAnchorActivate`；
2. 删除 `ConversationOverlay` 和 `MessageStream` 中的回调透传；
3. 将消息锚点按钮恢复为原来的只读 `<span>`。

不需要迁移或删除任何历史数据。
