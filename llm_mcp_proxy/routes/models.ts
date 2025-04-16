import { FastifyPluginAsync } from 'fastify';
import { allProviders, getProviderByName } from '../providers';

const modelsRoutes: FastifyPluginAsync = async (fastify) => {
  // 获取所有模型的路由
  fastify.get('/models', async (_request, reply) => {
    try {
      const results = await Promise.allSettled(
        allProviders.map(p => p.listModels())
      );

      const errors: string[] = [];
      const models = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          errors.push(`Provider ${index}: ${result.reason.message}`);
          return [];
        }
      });

      if (errors.length > 0 && models.length === 0) {
        reply.code(500).send({
          error: 'Failed to fetch models from all providers',
          details: errors
        });
        return;
      }

      reply.send(models);
    } catch (error: any) {
      reply.code(500).send({
        error: 'Failed to fetch models',
        details: error.message
      });
    }
  });

  // 获取特定提供商模型的路由
  fastify.get('/models/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const authHeader = request.headers.authorization;
    let apiKey: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }

    const providerInstance = getProviderByName(provider);
    if (!providerInstance) {
      return reply.code(400).send({ error: 'Unknown provider' });
    }

    // 对于需要 API Key 的提供商进行验证
    if (!apiKey && provider !== 'ollama') {
      return reply.code(401).send({ 
        error: 'Authentication failed',
        message: 'Missing API Key. Please provide your API key in the Authorization header with Bearer scheme.'
      });
    }

    try {
      const models = await providerInstance.listModels({ apiKey });
      reply.send(models);
    } catch (error: any) {
      reply.code(500).send({
        error: `Failed to fetch models from ${provider}`,
        details: error.message
      });
    }
  });
};

export default modelsRoutes;