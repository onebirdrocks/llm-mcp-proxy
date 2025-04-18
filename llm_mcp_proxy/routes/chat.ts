import { FastifyPluginAsync } from 'fastify';
import { getLLMProviderByName } from '../providers';

const chatRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/completions', async (request, reply) => {
    const { provider = 'ollama', model, messages, stream } = request.body as any;
    const authHeader = request.headers.authorization;
    let apiKey: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }

    if (!model) {
      return reply.code(400).send({ error: 'Missing model parameter' });
    }

    if (!apiKey && provider !== 'ollama') {
      return reply.code(401).send({ 
        error: 'Authentication failed',
        message: 'Missing API Key. Please provide your API key in the Authorization header with Bearer scheme.'
      });
    }

    const providerHandler = getLLMProviderByName(provider);
    if (!providerHandler) {
      return reply.code(400).send({ error: 'Unknown provider' });
    }

    try {
      if (stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('Transfer-Encoding', 'chunked');
        reply.raw.setHeader('Access-Control-Allow-Origin', '*');
        
        try {
          await providerHandler.chatStream({ model, messages, apiKey }, reply.raw);
        } catch (error: any) {
          // 对于流式响应，需要以 SSE 格式发送错误
          const errorEvent = {
            error: true,
            message: error.message,
            details: error.response?.data
          };
          reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        }
      } else {
        const result = await providerHandler.chat({ model, messages, apiKey });
        reply.send(result);
      }
    } catch (error: any) {
      // 对于非流式响应，直接发送错误对象
      const statusCode = error.response?.status || 500;
      reply.code(statusCode).send({
        error: true,
        message: error.message,
        details: error.response?.data
      });
    }
  });
};

export default chatRoutes;