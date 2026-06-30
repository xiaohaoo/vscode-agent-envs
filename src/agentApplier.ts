import * as os from "node:os";
import * as path from "node:path";
import { quoteTomlString, isRecord } from "./configStore";
import { atomicWrite, readTextIfExists } from "./fileUtil";
import type { AgentKey, ProfileMap } from "./types";

const toml = require("smol-toml") as { parse: (text: string) => unknown };

const claudeKeyEnv = "env";
const claudeKeyBaseURL = "ANTHROPIC_BASE_URL";
const claudeKeyAuthToken = "ANTHROPIC_AUTH_TOKEN";

const codexKeyBaseURL = "base_url";
const codexKeyWireAPI = "wire_api";
const codexKeyRequiresOpenAIAuth = "requires_openai_auth";
const codexKeyOpenAIAPIKey = "OPENAI_API_KEY";
const codexKeyModelProvider = "model_provider";

const codexTableHeaderPattern = /^\s*\[([^\[\]]+)]\s*$/;

export async function applyProfile(agentKey: AgentKey, name: string, profileMap: ProfileMap): Promise<void> {
  switch (agentKey) {
    case "claude":
      await applyClaudeProfile(profileMap);
      break;
    case "codex":
      await Promise.all([writeCodexConfigToml(name, profileMap), writeCodexAuthJson(profileMap)]);
      break;
  }
}

function getString(profileMap: ProfileMap, key: string): string {
  const value = profileMap[key];
  return typeof value === "string" ? value : "";
}

async function applyClaudeProfile(profileMap: ProfileMap): Promise<void> {
  const filePath = path.join(os.homedir(), ".claude", "settings.json");
  const text = await readTextIfExists(filePath);
  const settingsMap = text ? JSON.parse(text) as Record<string, unknown> : { env: {} };

  const envMap = isRecord(settingsMap[claudeKeyEnv]) ? settingsMap[claudeKeyEnv] : {};
  for (const [key, value] of Object.entries(profileMap)) {
    envMap[key] = value;
  }
  settingsMap[claudeKeyEnv] = envMap;

  await atomicWrite(filePath, JSON.stringify(settingsMap, null, 2), 0o644);
}

async function writeCodexConfigToml(name: string, profileMap: ProfileMap): Promise<void> {
  const filePath = path.join(os.homedir(), ".codex", "config.toml");
  const original = await readTextIfExists(filePath) ?? "";
  const existingMap = original ? toml.parse(original) as Record<string, unknown> : {};

  const providerMap = isRecord(existingMap.model_providers)
    ? { ...existingMap.model_providers }
    : {};

  const providerEntryMap: Record<string, unknown> = {
    base_url: getString(profileMap, codexKeyBaseURL),
    name,
    wire_api: getString(profileMap, codexKeyWireAPI)
  };

  if (typeof profileMap[codexKeyRequiresOpenAIAuth] === "boolean") {
    providerEntryMap[codexKeyRequiresOpenAIAuth] = profileMap[codexKeyRequiresOpenAIAuth];
  }

  providerMap[name] = providerEntryMap;

  const { body, providerOrderList } = stripManagedCodexConfig(original, name);
  const rendered = normalizeCodexTableSpacing(renderCodexConfig(body, providerMap, providerOrderList));
  await atomicWrite(filePath, rendered.replace(/\n+$/u, ""), 0o644);
}

async function writeCodexAuthJson(profileMap: ProfileMap): Promise<void> {
  const filePath = path.join(os.homedir(), ".codex", "auth.json");
  const text = await readTextIfExists(filePath);
  const authMap = text ? JSON.parse(text) as Record<string, unknown> : {};

  if (Object.prototype.hasOwnProperty.call(profileMap, codexKeyOpenAIAPIKey)) {
    authMap[codexKeyOpenAIAPIKey] = profileMap[codexKeyOpenAIAPIKey];
  }

  await atomicWrite(filePath, JSON.stringify(authMap, null, 2), 0o600);
}

function stripManagedCodexConfig(original: string, selectedProvider: string): {
  body: string;
  providerOrderList: string[];
} {
  const lineList = splitLinesKeepNewline(original);
  if (lineList.length === 0) {
    return {
      body: `${codexKeyModelProvider} = ${quoteTomlString(selectedProvider)}\n`,
      providerOrderList: []
    };
  }

  const outList: string[] = [];
  const providerOrderList: string[] = [];
  let currentSection = "";
  let skippingProviders = false;
  let replacedTopLevelKV = false;

  for (const line of lineList) {
    const header = parseCodexTableHeader(line);
    if (header !== undefined) {
      currentSection = header;
      const providerName = parseModelProvidersHeader(header);

      if (providerName !== undefined) {
        skippingProviders = true;
        if (providerName !== "") {
          appendUnique(providerOrderList, providerName);
        }
        continue;
      }

      skippingProviders = false;
      outList.push(line);
      continue;
    }

    if (skippingProviders) {
      continue;
    }

    if (currentSection === "" && isTopLevelKeyAssignment(line, codexKeyModelProvider)) {
      outList.push(`${codexKeyModelProvider} = ${quoteTomlString(selectedProvider)}\n`);
      replacedTopLevelKV = true;
      continue;
    }

    outList.push(line);
  }

  if (!replacedTopLevelKV) {
    insertTopLevelKey(outList, codexKeyModelProvider, selectedProvider);
  }

  return {
    body: outList.join("").replace(/\n+$/u, ""),
    providerOrderList
  };
}

function renderCodexConfig(body: string, providerMap: Record<string, unknown>, providerOrderList: string[]): string {
  const lineList: string[] = [];
  if (body) {
    lineList.push(body);
  }

  for (const name of orderedProviderNameList(providerMap, providerOrderList)) {
    const profileMap = providerMap[name];
    if (!isRecord(profileMap)) {
      continue;
    }

    if (lineList.length > 0) {
      lineList.push("");
    }

    lineList.push(`[model_providers.${quoteTomlString(name)}]`);
    for (const key of Object.keys(profileMap).sort()) {
      lineList.push(`${key} = ${formatTomlValue(profileMap[key])}`);
    }
  }

  return lineList.join("\n");
}

function normalizeCodexTableSpacing(text: string): string {
  const outList: string[] = [];
  for (const line of splitLinesKeepNewline(text)) {
    if (parseCodexTableHeader(line) !== undefined) {
      while (outList.length > 0 && outList[outList.length - 1].trim() === "") {
        outList.pop();
      }
      if (outList.length > 0) {
        outList.push("\n");
      }
    }
    outList.push(line);
  }

  return outList.join("");
}

function orderedProviderNameList(providerMap: Record<string, unknown>, existingOrderList: string[]): string[] {
  const seenSet = new Set<string>();
  const orderedList: string[] = [];

  for (const name of existingOrderList) {
    if (Object.prototype.hasOwnProperty.call(providerMap, name)) {
      orderedList.push(name);
      seenSet.add(name);
    }
  }

  const remainingList = Object.keys(providerMap)
    .filter((name) => !seenSet.has(name))
    .sort();

  return [...orderedList, ...remainingList];
}

function splitLinesKeepNewline(text: string): string[] {
  return text ? text.match(/[^\n]*\n|[^\n]+/gu) ?? [] : [];
}

function parseCodexTableHeader(line: string): string | undefined {
  const matchList = codexTableHeaderPattern.exec(line);
  return matchList?.[1]?.trim();
}

function parseModelProvidersHeader(header: string): string | undefined {
  if (header === "model_providers") {
    return "";
  }

  const prefix = "model_providers.";
  if (!header.startsWith(prefix)) {
    return undefined;
  }

  const rawName = header.slice(prefix.length).trim();
  try {
    return JSON.parse(rawName) as string;
  } catch {
    return rawName;
  }
}

function isTopLevelKeyAssignment(line: string, key: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && trimmed.startsWith(`${key} =`);
}

function insertTopLevelKey(lineList: string[], key: string, value: string): void {
  const insertLine = `${key} = ${quoteTomlString(value)}\n`;
  let insertAt = lineList.findIndex((line) => parseCodexTableHeader(line) !== undefined);
  if (insertAt < 0) {
    insertAt = lineList.length;
  }

  while (insertAt > 0 && lineList[insertAt - 1].trim() === "") {
    insertAt--;
  }

  lineList.splice(insertAt, 0, insertLine);
}

function appendUnique(valueList: string[], candidate: string): void {
  if (!valueList.includes(candidate)) {
    valueList.push(candidate);
  }
}

function formatTomlValue(value: unknown): string {
  if (typeof value === "string") {
    return quoteTomlString(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return quoteTomlString(String(value ?? ""));
}
