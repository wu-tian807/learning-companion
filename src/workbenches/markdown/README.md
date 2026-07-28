# Markdown Workbench

该目录包含内置 Markdown 工作台：

- Main Provider 负责源码、恢复快照、编码、行尾与 revision；
- Vditor Adapter 负责本地 WYSIWYG、KaTeX、Mermaid 与安全策略；
- Renderer 提供可视化/源码切换、显式保存和编辑状态反馈；
- Shared 模块维护双端 Manifest、状态和命令的运行时契约。

磁盘 Markdown 源码始终是权威数据。打开和切换模式不会写入文件；只有用户点击保存或按下 `Ctrl/Cmd + S` 时，当前编辑内容才会通过普通保存命令写入。未保存内容由恢复快照保护。
