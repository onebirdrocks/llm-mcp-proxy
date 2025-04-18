import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import chatRoutes from './routes/chat';
import modelsRoutes from './routes/models';
import mcpRoutes from './routes/mcp';
import { loadMCPClientByConfig } from './utils/mcp';
import { initializeMCP } from './providers';
import { MCPConfig } from './utils/mcp';

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

    // 注册路由，不使用前缀，让每个路由模块自己控制完整路径
    await server.register(chatRoutes);
    await server.register(modelsRoutes);
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
if (require.main === module) {
  createServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}