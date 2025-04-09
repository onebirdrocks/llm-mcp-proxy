import { FastifyPluginAsync } from 'fastify';
import { getLLMClient } from '../llm/getLLMClient';

const chatRoute: FastifyPluginAsync = async (server) => {
    server.post('/', async (request, reply) => {
        const { provider, model, messages, tools } = request.body as any;
        const client = getLLMClient(provider, model);
        const result = await client.chat(messages, tools);
        reply.send(result);
    });
};

export default chatRoute;