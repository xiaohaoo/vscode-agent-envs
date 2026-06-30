# Agent Envs

VS Code extension for managing Claude Code and Codex CLI profiles.

Profiles are stored in VS Code global storage:

```text
%APPDATA%\Code\User\globalStorage\xiaohaoo.vscode-agent-envs\profiles.json
```

Tokens are stored through VS Code SecretStorage instead of being written to `profiles.json`.

## Features

- Shows Claude Code and Codex profiles in the Activity Bar.
- Adds, edits, and deletes profiles from the tree view.
- Applies a selected profile from VS Code.
- Writes Claude Code profiles to `~/.claude/settings.json`.
- Writes Codex profiles to `~/.codex/config.toml` and `~/.codex/auth.json`.
- Opens the private `profiles.json` file for inspection.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

## Editing Profiles

- Click the `+` button in the Agent Envs view to add a profile.
- Right-click Claude Code or Codex to add a profile for that agent.
- Right-click a profile to edit or delete it.
- Click a profile to apply it.
