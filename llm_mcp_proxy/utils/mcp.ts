import fs from 'fs';
import path from 'path';
import os from 'os';

export interface MCPServerConfig {
  command: string;
  args: string[];
}

export interface MCPConfig {
  mcpServers: {
    [key: string]: MCPServerConfig;
  };
}

let mcpConfig: MCPConfig | null = null;

export function initializeMCPConfig(config: MCPConfig) {
  mcpConfig = config;
}

export function updateServerConfig(serverName: string, serverConfig: MCPServerConfig) {
  if (!mcpConfig) {
    mcpConfig = {
      mcpServers: {}
    };
  }
  mcpConfig.mcpServers[serverName] = serverConfig;
}

export async function loadMCPClientByConfig(): Promise<MCPConfig> {
  // 如果已经初始化过配置，直接返回
  if (mcpConfig) {
    return mcpConfig;
  }

  try {
    // 从项目根目录读取配置文件
    const configPath = path.join(process.cwd(), 'mcp_servers.json');
    const configContent = await fs.promises.readFile(configPath, 'utf-8');
    mcpConfig = JSON.parse(configContent) as MCPConfig;
    return mcpConfig;
  } catch (error) {
    console.error('Failed to load MCP configuration:', error);
    throw error;
  }
} 