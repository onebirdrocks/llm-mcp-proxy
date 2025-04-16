import { Client, ClientConfig } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, StdioTransportConfig } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServerConfig } from '../llm_mcp_proxy/utils/mcp';

// 存储服务器配置和客户端实例的 Map
const serverConfigs = new Map<string, MCPServerConfig>();
const clientInstances = new Map<string, Client>();

// 创建传输实例的辅助函数
function createTransport(config: MCPServerConfig): StdioClientTransport {
  return new StdioClientTransport({
    command: config.command,
    args: config.args
  });
}

export async function updateMCPServer(serverId: string, config: MCPServerConfig) {
  // 更新服务器配置
  serverConfigs.set(serverId, config);

  // 如果存在旧的客户端实例，直接移除它
  if (clientInstances.has(serverId)) {
    clientInstances.delete(serverId);
  }

  const client = new Client({
    name: 'llm-mcp-proxy',
    version: '1.0.0'
  });

  await client.connect(createTransport(config));
  clientInstances.set(serverId, client);
  
  return client;
} 