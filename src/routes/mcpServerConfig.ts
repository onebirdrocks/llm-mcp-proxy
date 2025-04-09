import { FastifyPluginAsync } from 'fastify';
import { MCPServerRegistry } from '../config/mcpServerRegistry';

const registry = new MCPServerRegistry('mcp_servers.json');

const mcpServerRoutes: FastifyPluginAsync = async (server) => {
    server.get('/', async (_, reply) => {
        reply.send(registry.getAll());
    });

    server.get('/:name', async (req, reply) => {
        const { name } = req.params as any;
        reply.send(registry.get(name));
    });

    server.post('/reload', async (_, reply) => {
        registry.reload();
        reply.send({ status: 'reloaded' });
    });

    server.post('/', async (req, reply) => {
        const { name, config } = req.body as any;
        registry.set(name, config);
        reply.send({ status: 'updated', servers: registry.getAll() });
    });
};

export default mcpServerRoutes;