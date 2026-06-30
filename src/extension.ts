import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { applyProfile } from "./agentApplier";
import { ConfigStore } from "./configStore";
import { getNativeConfigPathList } from "./paths";
import { buildTokenSecretKey, deleteProfileToken, getProfileToken, materializeProfile, saveProfileToken, tokenSecretKeyField } from "./profileSecrets";
import { ProfilesTreeProvider, type AgentEnvsTreeItem, type ProfileTreeItem } from "./profilesTreeProvider";
import { agentDefinitionList, type AgentDefinition, type AgentKey, type ProfileMap } from "./types";

export function activate(context: vscode.ExtensionContext): void {
  const configStore = new ConfigStore(context);
  const treeProvider = new ProfilesTreeProvider(configStore, context.secrets);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("agentEnvs.profilesView", treeProvider),
    vscode.commands.registerCommand("agentEnvs.refresh", () => treeProvider.refresh()),
    vscode.commands.registerCommand("agentEnvs.addProfile", async (item?: AgentEnvsTreeItem) => {
      await runWithErrorMessage(async () => {
        const agent = item?.type === "agent" ? item.agent : await pickAgent(configStore);
        if (!agent) {
          return;
        }

        const agentConfig = await configStore.load(agent.key);
        const profileInput = await collectProfileInput(context.secrets, agent, agentConfig.profileMap);
        if (!profileInput) {
          return;
        }

        agentConfig.profileMap[profileInput.name] = profileInput.profileMap;
        if (!agentConfig.active) {
          agentConfig.active = profileInput.name;
        }
        await configStore.save(agent.key, agentConfig);
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Added ${agent.name}: ${profileInput.name}`);
      });
    }),
    vscode.commands.registerCommand("agentEnvs.editProfile", async (item?: AgentEnvsTreeItem) => {
      await runWithErrorMessage(async () => {
        const profileItem = await resolveProfileItem(item, configStore);
        if (!profileItem) {
          return;
        }

        const agentConfig = await configStore.load(profileItem.agent.key);
        const currentProfileMap = agentConfig.profileMap[profileItem.name];
        if (!currentProfileMap) {
          void vscode.window.showWarningMessage(`Profile "${profileItem.name}" no longer exists.`);
          treeProvider.refresh();
          return;
        }

        const profileInput = await collectProfileInput(
          context.secrets,
          profileItem.agent,
          agentConfig.profileMap,
          profileItem.name,
          currentProfileMap
        );
        if (!profileInput) {
          return;
        }

        if (profileInput.name !== profileItem.name) {
          delete agentConfig.profileMap[profileItem.name];
          if (agentConfig.active === profileItem.name) {
            agentConfig.active = profileInput.name;
          }
          await deleteProfileToken(context.secrets, currentProfileMap);
        }

        agentConfig.profileMap[profileInput.name] = profileInput.profileMap;
        await configStore.save(profileItem.agent.key, agentConfig);
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Updated ${profileItem.agent.name}: ${profileInput.name}`);
      });
    }),
    vscode.commands.registerCommand("agentEnvs.deleteProfile", async (item?: AgentEnvsTreeItem) => {
      await runWithErrorMessage(async () => {
        const profileItem = await resolveProfileItem(item, configStore);
        if (!profileItem) {
          return;
        }

        const confirmed = await vscode.window.showWarningMessage(
          `Delete ${profileItem.agent.name} profile "${profileItem.name}"?`,
          { modal: true },
          "Delete"
        );
        if (confirmed !== "Delete") {
          return;
        }

        const agentConfig = await configStore.load(profileItem.agent.key);
        const profileMap = agentConfig.profileMap[profileItem.name];
        if (profileMap) {
          await deleteProfileToken(context.secrets, profileMap);
        }

        delete agentConfig.profileMap[profileItem.name];
        if (agentConfig.active === profileItem.name) {
          agentConfig.active = Object.keys(agentConfig.profileMap).sort()[0] ?? "";
        }
        await configStore.save(profileItem.agent.key, agentConfig);
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Deleted ${profileItem.agent.name}: ${profileItem.name}`);
      });
    }),
    vscode.commands.registerCommand("agentEnvs.applyProfile", async (item?: AgentEnvsTreeItem) => {
      await runWithErrorMessage(async () => {
        const profileItem = await resolveProfileItem(item, configStore);
        if (!profileItem) {
          return;
        }

        const agentConfig = await configStore.load(profileItem.agent.key);
        const profileMap = agentConfig.profileMap[profileItem.name];
        if (!profileMap) {
          void vscode.window.showWarningMessage(`Profile "${profileItem.name}" no longer exists.`);
          treeProvider.refresh();
          return;
        }

        const materializedProfileMap = await materializeProfile(context.secrets, profileItem.agent, profileMap);
        await applyProfile(profileItem.agent.key, profileItem.name, materializedProfileMap);
        agentConfig.active = profileItem.name;
        await configStore.save(profileItem.agent.key, agentConfig);
        treeProvider.refresh();
        void vscode.window.showInformationMessage(`Applied ${profileItem.agent.name}: ${profileItem.name}`);
      });
    }),
    vscode.commands.registerCommand("agentEnvs.openConfig", async () => {
      await runWithErrorMessage(async () => {
        const configPath = configStore.path;
        await ensureFile(configPath);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
        await vscode.window.showTextDocument(document);
      });
    }),
    vscode.commands.registerCommand("agentEnvs.revealNativeConfig", async (item?: AgentEnvsTreeItem) => {
      await runWithErrorMessage(async () => {
        const agentItem = item?.type === "agent" ? item : undefined;
        const agentKey = agentItem?.agent.key ?? (await pickAgent(configStore))?.key;
        if (!agentKey) {
          return;
        }

        const configPathList = getNativeConfigPathList(agentKey);
        const selectedPath = configPathList.length === 1
          ? configPathList[0]
          : await vscode.window.showQuickPick(configPathList, {
            ignoreFocusOut: true,
            placeHolder: "Select a native config file"
          });

        if (selectedPath) {
          await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(selectedPath));
        }
      });
    }),
    vscode.workspace.onDidChangeConfiguration(() => treeProvider.refresh())
  );
}

export function deactivate(): void {}

async function resolveProfileItem(item: AgentEnvsTreeItem | undefined, configStore: ConfigStore): Promise<ProfileTreeItem | undefined> {
  if (item?.type === "profile") {
    return item;
  }

  const configMap = await configStore.loadAll();
  const quickPickItemList: Array<vscode.QuickPickItem & { profileItem: ProfileTreeItem }> = [];

  for (const agent of agentDefinitionList) {
    const agentConfig = configMap[agent.key] ?? { active: "", profileMap: {} };
    for (const name of Object.keys(agentConfig.profileMap).sort()) {
      quickPickItemList.push({
        label: name,
        description: agent.name,
        detail: agentConfig.active === name ? "Active profile" : undefined,
        profileItem: {
          type: "profile",
          agent,
          name,
          profileMap: agentConfig.profileMap[name],
          active: agentConfig.active === name
        }
      });
    }
  }

  const selected = await vscode.window.showQuickPick(quickPickItemList, {
    ignoreFocusOut: true,
    placeHolder: "Select a profile to apply"
  });

  return selected?.profileItem;
}

async function pickAgent(configStore: ConfigStore): Promise<AgentDefinition | undefined> {
  const configMap = await configStore.loadAll();
  const itemList: Array<vscode.QuickPickItem & { agent: AgentDefinition }> = agentDefinitionList.map((agent) => ({
    label: agent.name,
    description: configMap[agent.key]?.active ? `active: ${configMap[agent.key]?.active}` : agent.description,
    agent
  }));

  const selected = await vscode.window.showQuickPick(itemList, {
    ignoreFocusOut: true,
    placeHolder: "Select an agent"
  });

  return selected?.agent;
}

async function collectProfileInput(
  secrets: vscode.SecretStorage,
  agent: AgentDefinition,
  profileMap: Record<string, ProfileMap>,
  currentName?: string,
  currentProfileMap?: ProfileMap
): Promise<{ name: string; profileMap: ProfileMap } | undefined> {
  const name = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: currentName ? `Edit ${agent.name} Profile` : `Add ${agent.name} Profile`,
    prompt: "Profile name",
    value: currentName ?? "",
    validateInput: (value) => validateProfileName(value, profileMap, currentName)
  });
  if (name === undefined) {
    return undefined;
  }

  const baseUrl = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: currentName ? `Edit ${agent.name} Profile` : `Add ${agent.name} Profile`,
    prompt: "API base URL",
    value: getString(currentProfileMap, agent.baseUrlKey),
    validateInput: (value) => value.trim() ? undefined : "API base URL is required."
  });
  if (baseUrl === undefined) {
    return undefined;
  }

  const currentToken = currentProfileMap
    ? await getProfileToken(secrets, agent, currentProfileMap)
    : "";
  const token = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: currentName ? `Edit ${agent.name} Profile` : `Add ${agent.name} Profile`,
    prompt: currentToken ? "Token. Leave unchanged by accepting the existing value." : "Token",
    value: currentToken,
    password: true,
    validateInput: (value) => value.trim() ? undefined : "Token is required."
  });
  if (token === undefined) {
    return undefined;
  }

  const trimmedName = name.trim();
  const tokenSecretKey = buildTokenSecretKey(agent, trimmedName);
  const nextProfileMap = buildProfileMap(agent.key, baseUrl.trim(), tokenSecretKey);
  await saveProfileToken(secrets, tokenSecretKey, token.trim());

  return {
    name: trimmedName,
    profileMap: nextProfileMap
  };
}

function buildProfileMap(agentKey: AgentKey, baseUrl: string, tokenSecretKey: string): ProfileMap {
  switch (agentKey) {
    case "claude":
      return {
        ANTHROPIC_BASE_URL: baseUrl,
        [tokenSecretKeyField]: tokenSecretKey
      };
    case "codex":
      return {
        base_url: baseUrl,
        wire_api: "responses",
        requires_openai_auth: true,
        [tokenSecretKeyField]: tokenSecretKey
      };
  }
}

function validateProfileName(
  value: string,
  profileMap: Record<string, ProfileMap>,
  currentName?: string
): string | undefined {
  const name = value.trim();
  if (!name) {
    return "Profile name is required.";
  }

  if (name !== currentName && Object.prototype.hasOwnProperty.call(profileMap, name)) {
    return `Profile "${name}" already exists.`;
  }

  return undefined;
}

function getString(profileMap: ProfileMap | undefined, key: string): string {
  const value = profileMap?.[key];
  return typeof value === "string" ? value : "";
}

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "", { mode: 0o644 });
  }
}

async function runWithErrorMessage(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Agent Envs: ${message}`);
  }
}
