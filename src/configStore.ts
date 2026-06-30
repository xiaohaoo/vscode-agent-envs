import * as path from "node:path";
import * as vscode from "vscode";
import { atomicWrite, readTextIfExists } from "./fileUtil";
import type { AgentConfig, AgentKey, ConfigMap, ProfileMap } from "./types";

const keyActive = "active";
const keyProfiles = "profiles";
const profilesFileName = "profiles.json";

export class ConfigStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get path(): string {
    return path.join(this.context.globalStorageUri.fsPath, profilesFileName);
  }

  async loadAll(): Promise<ConfigMap> {
    const text = await readTextIfExists(this.path);
    if (!text) {
      return {};
    }

    const rawMap = JSON.parse(text) as Record<string, unknown>;
    const configMap: ConfigMap = {};

    for (const agentKey of ["claude", "codex"] as AgentKey[]) {
      const parsedConfig = parseAgentConfig(rawMap[agentKey]);
      if (parsedConfig) {
        configMap[agentKey] = parsedConfig;
      }
    }

    return configMap;
  }

  async load(agentKey: AgentKey): Promise<AgentConfig> {
    const configMap = await this.loadAll();
    return configMap[agentKey] ?? { active: "", profileMap: {} };
  }

  async save(agentKey: AgentKey, agentConfig: AgentConfig): Promise<void> {
    const configMap = await this.loadAll();
    configMap[agentKey] = agentConfig;
    await atomicWrite(this.path, JSON.stringify(renderConfigMap(configMap), null, 2), 0o600);
  }

  getDirectory(): string {
    return path.dirname(this.path);
  }
}

function parseAgentConfig(value: unknown): AgentConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const active = typeof value[keyActive] === "string" ? value[keyActive] : "";
  const profileMap: Record<string, ProfileMap> = {};
  const rawProfileMap = value[keyProfiles];

  if (isRecord(rawProfileMap)) {
    for (const [name, rawProfile] of Object.entries(rawProfileMap)) {
      if (isRecord(rawProfile)) {
        profileMap[name] = { ...rawProfile };
      }
    }
  }

  return { active, profileMap };
}

function renderConfigMap(configMap: ConfigMap): Record<string, unknown> {
  const outMap: Record<string, unknown> = {};

  for (const agentKey of Object.keys(configMap).sort() as AgentKey[]) {
    const agentConfig = configMap[agentKey];
    if (!agentConfig) {
      continue;
    }

    const profileMap: Record<string, unknown> = {};

    for (const name of Object.keys(agentConfig.profileMap).sort()) {
      profileMap[name] = sortObjectByKey(agentConfig.profileMap[name]);
    }

    outMap[agentKey] = {
      [keyActive]: agentConfig.active,
      [keyProfiles]: profileMap
    };
  }

  return outMap;
}

export function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortObjectByKey(valueMap: Record<string, unknown>): Record<string, unknown> {
  const outMap: Record<string, unknown> = {};
  for (const key of Object.keys(valueMap).sort()) {
    outMap[key] = valueMap[key];
  }
  return outMap;
}
