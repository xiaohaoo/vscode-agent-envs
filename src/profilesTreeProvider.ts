import * as vscode from "vscode";
import { ConfigStore } from "./configStore";
import { getProfileToken } from "./profileSecrets";
import { agentDefinitionList, type AgentConfig, type AgentDefinition, type AgentKey, type ProfileMap } from "./types";

export type AgentTreeItem = {
  type: "agent";
  agent: AgentDefinition;
  config: AgentConfig;
};

export type ProfileTreeItem = {
  type: "profile";
  agent: AgentDefinition;
  name: string;
  profileMap: ProfileMap;
  active: boolean;
};

export type MessageTreeItem = {
  type: "message";
  label: string;
  description?: string;
};

export type AgentEnvsTreeItem = AgentTreeItem | ProfileTreeItem | MessageTreeItem;

export class ProfilesTreeProvider implements vscode.TreeDataProvider<AgentEnvsTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<AgentEnvsTreeItem | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly configStore: ConfigStore,
    private readonly secrets: vscode.SecretStorage
  ) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  async getChildren(element?: AgentEnvsTreeItem): Promise<AgentEnvsTreeItem[]> {
    if (!element) {
      return this.getAgentItemList();
    }

    if (element.type !== "agent") {
      return [];
    }

    const nameList = Object.keys(element.config.profileMap).sort();
    if (nameList.length === 0) {
      return [
        {
          type: "message",
          label: "No profiles",
          description: "Add a profile to get started"
        }
      ];
    }

    return nameList.map((name) => ({
      type: "profile",
      agent: element.agent,
      name,
      profileMap: element.config.profileMap[name],
      active: element.config.active === name
    }));
  }

  getTreeItem(element: AgentEnvsTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    switch (element.type) {
      case "agent":
        return this.getAgentTreeItem(element);
      case "profile":
        return this.getProfileTreeItem(element);
      case "message":
        return this.getMessageTreeItem(element);
    }
  }

  private async getAgentItemList(): Promise<AgentTreeItem[]> {
    const configMap = await this.configStore.loadAll();
    return agentDefinitionList.map((agent) => ({
      type: "agent",
      agent,
      config: configMap[agent.key] ?? { active: "", profileMap: {} }
    }));
  }

  private getAgentTreeItem(element: AgentTreeItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.agent.name, vscode.TreeItemCollapsibleState.Expanded);
    item.id = element.agent.key;
    item.description = element.config.active ? `active: ${element.config.active}` : "no active profile";
    item.tooltip = `${element.agent.description}\n${item.description}`;
    item.contextValue = "agent";
    item.iconPath = new vscode.ThemeIcon(getAgentIcon(element.agent.key));
    return item;
  }

  private async getProfileTreeItem(element: ProfileTreeItem): Promise<vscode.TreeItem> {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    const summaryList: string[] = [];
    const baseUrl = element.profileMap[element.agent.baseUrlKey];
    const token = await getProfileToken(this.secrets, element.agent, element.profileMap);

    if (typeof baseUrl === "string" && baseUrl) {
      summaryList.push(`API: ${baseUrl}`);
    }
    if (token) {
      summaryList.push(`Token: ${maskToken(token)}`);
    }

    item.id = `${element.agent.key}:${element.name}`;
    item.description = element.active ? "active" : summaryList[0];
    item.tooltip = [element.name, ...summaryList].join("\n");
    item.contextValue = "profile";
    item.iconPath = new vscode.ThemeIcon(element.active ? "pass-filled" : "circle-outline");
    item.command = {
      command: "agentEnvs.applyProfile",
      title: "Apply Profile",
      arguments: [element]
    };

    return item;
  }

  private getMessageTreeItem(element: MessageTreeItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.contextValue = "message";
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
  }
}

function maskToken(value: string): string {
  if (value.length <= 12) {
    return "****";
  }

  return `${value.slice(0, 8)}****${value.slice(-4)}`;
}

function getAgentIcon(agentKey: AgentKey): string {
  switch (agentKey) {
    case "claude":
      return "sparkle";
    case "codex":
      return "terminal";
  }
}
