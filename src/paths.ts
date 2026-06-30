import * as os from "node:os";
import * as path from "node:path";
import type { AgentKey } from "./types";

export function getNativeConfigPathList(agentKey: AgentKey): string[] {
  switch (agentKey) {
    case "claude":
      return [path.join(os.homedir(), ".claude", "settings.json")];
    case "codex":
      return [
        path.join(os.homedir(), ".codex", "config.toml"),
        path.join(os.homedir(), ".codex", "auth.json")
      ];
  }
}
