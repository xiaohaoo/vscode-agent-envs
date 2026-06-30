import * as vscode from "vscode";
import type { AgentDefinition, ProfileMap } from "./types";

export const tokenSecretKeyField = "tokenSecretKey";

export function buildTokenSecretKey(agent: AgentDefinition, profileName: string): string {
  return `agentEnvs:${agent.key}:${profileName}:${agent.tokenKey}`;
}

export async function getProfileToken(
  secrets: vscode.SecretStorage,
  agent: AgentDefinition,
  profileMap: ProfileMap
): Promise<string> {
  const tokenSecretKey = getTokenSecretKey(profileMap);
  if (tokenSecretKey) {
    return await secrets.get(tokenSecretKey) ?? "";
  }

  const token = profileMap[agent.tokenKey];
  return typeof token === "string" ? token : "";
}

export async function materializeProfile(
  secrets: vscode.SecretStorage,
  agent: AgentDefinition,
  profileMap: ProfileMap
): Promise<ProfileMap> {
  const materializedProfileMap: ProfileMap = { ...profileMap };
  delete materializedProfileMap[tokenSecretKeyField];

  const token = await getProfileToken(secrets, agent, profileMap);
  if (token) {
    materializedProfileMap[agent.tokenKey] = token;
  }

  return materializedProfileMap;
}

export async function saveProfileToken(
  secrets: vscode.SecretStorage,
  tokenSecretKey: string,
  token: string
): Promise<void> {
  await secrets.store(tokenSecretKey, token);
}

export async function deleteProfileToken(secrets: vscode.SecretStorage, profileMap: ProfileMap): Promise<void> {
  const tokenSecretKey = getTokenSecretKey(profileMap);
  if (tokenSecretKey) {
    await secrets.delete(tokenSecretKey);
  }
}

export function getTokenSecretKey(profileMap: ProfileMap): string {
  const tokenSecretKey = profileMap[tokenSecretKeyField];
  return typeof tokenSecretKey === "string" ? tokenSecretKey : "";
}
