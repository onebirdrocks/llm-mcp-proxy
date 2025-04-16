import { FastifyInstance } from 'fastify';
import { getMCPClientByName } from '../providers';

export default async function mcpRoutes(fastify: FastifyInstance) {
  fastify.get('/mcp/:serverName/tools', async (request, reply) => {
    try {
      const { serverName } = request.params as { serverName: string };
      
      // 获取 MCP 客户端
      const client = await getMCPClientByName(serverName);
      if (!client) {
        return reply.status(404).send({
          error: `MCP server "${serverName}" not found or not configured`
        });
      }

      // 获取工具列表
      const tools = await client.listTools();
      
      return {
        server: serverName,
        tools
      };
    } catch (error) {
      console.error('Error getting MCP tools:', error);
      return reply.status(500).send({
        error: 'Failed to get MCP tools',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });
} 