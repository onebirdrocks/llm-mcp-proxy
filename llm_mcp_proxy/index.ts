import 'dotenv/config';
import Fastify from 'fastify';
import chatRoutes from './routes/chat';
import modelsRoutes from './routes/models';
import mcpRoutes from './routes/mcp';
import { loadMCPClientByConfig } from './utils/mcp';
import { initializeMCP } from './providers';

const server = Fastify({ logger: true });

// 异步初始化服务器
async function initServer() {
  try {
    // 加载 MCP 配置
    const config = await loadMCPClientByConfig();
    
    // 初始化 MCP
    initializeMCP(config);

    server.register(chatRoutes, { prefix: '/v1/chat' });
    server.register(modelsRoutes, { prefix: '/v1' });
    server.register(mcpRoutes, { prefix: '/v1' });

    await server.listen({ port: 3000 });
    console.log(`🚀 Server ready at ${server.server.address()}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// 启动服务器
initServer();