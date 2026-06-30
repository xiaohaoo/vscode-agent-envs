# 智能体环境

用于管理 Claude Code 和 Codex CLI 配置档的 VS Code 插件。

配置档保存在 VS Code 全局存储目录：

```text
%APPDATA%\Code\User\globalStorage\xiaohaoo.vscode-agent-envs\profiles.json
```

Token 通过 VS Code SecretStorage 保存，不会写入 `profiles.json`。

## 功能

- 在侧边栏展示 Claude Code 和 Codex 配置档。
- 在树视图中添加、编辑、删除配置档。
- 从 VS Code 中应用选中的配置档。
- 将 Claude Code 配置写入 `~/.claude/settings.json`。
- 将 Codex 配置写入 `~/.codex/config.toml` 和 `~/.codex/auth.json`。
- 打开私有 `profiles.json` 便于查看。

## 开发

```bash
npm install
npm run compile
```

在 VS Code 中按 `F5` 启动扩展开发窗口。

## 编辑配置档

- 点击智能体环境视图标题栏的 `+` 添加配置档。
- 右键 Claude Code 或 Codex 可为对应智能体添加配置档。
- 右键配置档可编辑或删除。
- 点击配置档可应用。
