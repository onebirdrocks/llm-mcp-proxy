import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { DeepSeekProvider } from './deepseek';
import { OllamaProvider } from './ollama';
import { OpenAIWithToolProvider } from './openai_with_tool';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadMCPClientByConfig, initializeMCPConfig, MCPConfig, updateServerConfig, MCPServerConfig } from '../utils/mcp';

//const openai = new OpenAIProvider();
const openai = new OpenAIWithToolProvider();
const anthropic = new AnthropicProvider();
const deepseek = new DeepSeekProvider();
const ollama = new OllamaProvider();

export const allProviders = [openai, anthropic, deepseek, ollama];

// 存储 MCP 客户端实例的 Map
const mcpClients: Map<string, Client> = new Map();

export function getLLMProviderByName(name: string) {
  switch (name) {
    case 'openai': return openai;
    case 'anthropic': return anthropic;
    case 'deepseek': return deepseek;
    case 'ollama': return ollama;
    default: return null;
  }
}

let isConfigInitialized = false;

export function initializeMCP(config: MCPConfig) {
  if (!isConfigInitialized) {
    console.log('Initializing MCP with config:', config);
    initializeMCPConfig(config);
    isConfigInitialized = true;
  }
}

export async function updateMCPServer(server: string, config: MCPServerConfig): Promise<Client | null> {
  try {
    console.log(`Updating MCP server "${server}" with config:`, config);
    
    // 更新配置
    updateServerConfig(server, config);
    isConfigInitialized = true;

    // 如果存在旧的客户端实例，先断开连接
    const existingClient = mcpClients.get(server);
    if (existingClient) {
      console.log(`Disconnecting existing client for server "${server}"`);
      // 从缓存中移除客户端实例
      mcpClients.delete(server);
    }

    // 创建新的传输层
    console.log(`Creating transport for server "${server}"`);
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || []
    });

    // 创建新的客户端
    console.log(`Creating client for server "${server}"`);
    const client = new Client({
      name: `mcp-client-${server}`,
      version: "1.0.0"
    });

    // 连接到服务器
    console.log(`Connecting to server "${server}"`);
    try {
      await client.connect(transport);
      console.log(`Successfully connected to server "${server}"`);
    } catch (connectError) {
      console.error(`Failed to connect to server "${server}":`, connectError);
      return null;
    }
    
    // 将新的客户端实例存储到缓存中
    mcpClients.set(server, client);
    
    return client;
  } catch (error) {
    console.error(`Failed to update MCP client for server "${server}":`, error);
    return null;
  }
}

export async function getMCPClientByName(server: string): Promise<Client | null> {
  try {
    console.log(`Getting MCP client for server "${server}"`);
    
    if (!isConfigInitialized) {
      console.log('MCP not initialized, loading config from file');
      const config = await loadMCPClientByConfig();
      initializeMCP(config);
    }

    // 检查缓存中是否已存在客户端实例
    const cachedClient = mcpClients.get(server);
    if (cachedClient) {
      console.log(`Using cached client for server "${server}"`);
      return cachedClient;
    }

    // 从配置加载服务器配置
    console.log(`Loading config for server "${server}"`);
    const config = await loadMCPClientByConfig();
    
    // 检查服务器是否存在于配置中
    if (!config?.mcpServers?.[server]) {
      console.error(`Server "${server}" not found in MCP configuration`);
      return null;
    }

    const serverConfig = config.mcpServers[server];
    console.log(`Found config for server "${server}":`, serverConfig);

    // 创建传输层
    console.log(`Creating transport for server "${server}"`);
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args || []
    });

    // 创建客户端
    console.log(`Creating client for server "${server}"`);
    const client = new Client({
      name: `mcp-client-${server}`,
      version: "1.0.0"
    });

    // 连接到服务器
    console.log(`Connecting to server "${server}"`);
    try {
      await client.connect(transport);
      console.log(`Successfully connected to server "${server}"`);
    } catch (connectError) {
      console.error(`Failed to connect to server "${server}":`, connectError);
      return null;
    }
    
    // 将客户端实例存储到缓存中
    mcpClients.set(server, client);
    
    return client;
  } catch (error) {
    console.error(`Failed to create MCP client for server "${server}":`, error);
    return null;
  }
}

// 用于清理缓存的方法（如果需要）
export function clearMCPClientCache(server?: string) {
  if (server) {
    console.log(`Clearing cache for server "${server}"`);
    mcpClients.delete(server);
  } else {
    console.log('Clearing all MCP client cache');
    mcpClients.clear();
  }
}