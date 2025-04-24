import 'dotenv/config';
import Fastify from 'fastify';
import chatRoutes from './routes/chat';
import modelsRoutes from './routes/models';
import mcpRoutes from './routes/mcp';
import { loadMCPClientByConfig } from './utils/mcp';
import { initializeMCP } from './providers';
import { MCPConfig } from './utils/mcp';
import { Server as HttpServer } from 'http';

export interface ServerConfig {
  port?: number;
  mcpConfig?: MCPConfig;
}

export interface Server {
  url: string;
  close: () => Promise<void>;
}

export async function createServer(config: ServerConfig = {}): Promise<Server> {
  const server = Fastify({ logger: true });
  const port = config.port || 3000;

  try {
    // 如果提供了 MCP 配置，则初始化它
    if (config.mcpConfig) {
      initializeMCP(config.mcpConfig);
    } else {
      // 尝试从配置文件加载
      const mcpConfig = await loadMCPClientByConfig();
      if (mcpConfig) {
        initializeMCP(mcpConfig);
      }
    }

    // 为所有路由添加 /v1 前缀
    await server.register(chatRoutes, { prefix: '/v1/chat' });
    await server.register(modelsRoutes, { prefix: '/v1' });
    await server.register(mcpRoutes, { prefix: '/v1' });

    await server.listen({ port, host: '0.0.0.0' });
    
    return {
      url: `http://localhost:${port}`,
      close: async () => {
        await server.close();
      }
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

// 如果直接运行此文件，则启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer()
    .then(server => {
      console.log('Server is running at', server.url);
    })
    .catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}