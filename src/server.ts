import Fastify from 'fastify';
import chatRoute from './routes/chat';
import mcpServerRoutes from './routes/mcpServerConfig';

const server = Fastify();

server.register(chatRoute, { prefix: '/v1/chat' });
server.register(mcpServerRoutes, { prefix: '/mcp/servers' });

server.listen({ port: 3000 }, (err, address) => {
    if (err) throw err;
    console.log(`Server running at ${address}`);
});