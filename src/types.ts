export type AgentKey = "claude" | "codex";

export type ProfileMap = Record<string, unknown>;

export interface AgentConfig {
  active: string;
  profileMap: Record<string, ProfileMap>;
}

export type ConfigMap = Partial<Record<AgentKey, AgentConfig>>;

export interface AgentDefinition {
  key: AgentKey;
  name: string;
  description: string;
  tokenKey: string;
  baseUrlKey: string;
}

export const agentDefinitionList: AgentDefinition[] = [
  {
    key: "claude",
    name: "Claude Code",
    description: "Anthropic Claude Code",
    tokenKey: "ANTHROPIC_AUTH_TOKEN",
    baseUrlKey: "ANTHROPIC_BASE_URL"
  },
  {
    key: "codex",
    name: "Codex",
    description: "Codex CLI",
    tokenKey: "OPENAI_API_KEY",
    baseUrlKey: "base_url"
  }
];
