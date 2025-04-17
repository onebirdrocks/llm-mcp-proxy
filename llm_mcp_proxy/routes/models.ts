import { FastifyPluginAsync } from 'fastify';
import { allProviders, getProviderByName } from '../providers';
import modelsMeta from '../models_meta.json';

const modelsRoutes: FastifyPluginAsync = async (fastify) => {
  // 获取模型元数据的路由
  fastify.get('/models/meta', async (_request, reply) => {
    reply.send(modelsMeta);
  });

  // 获取特定提供商的模型元数据的路由
  fastify.get('/models/meta/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const authHeader = request.headers.authorization;
    let apiKey: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }

    // 检查提供商是否存在
    const providerInstance = getProviderByName(provider);
    if (!providerInstance) {
      return reply.code(404).send({ 
        error: 'Provider not found',
        message: `No metadata available for provider "${provider}"`
      });
    }

    // 获取元数据
    const providerMeta = modelsMeta[provider as keyof typeof modelsMeta] || [];

    try {
      // 从 SDK 获取模型列表
      const sdkModels = await providerInstance.listModels({ apiKey });

      // 将 SDK 模型信息与元数据合并，并只保留 mode 为 "chat" 的模型
      const enrichedModels = sdkModels
        .map(sdkModel => {
          const metaModel = providerMeta.find(meta => meta.model_id === sdkModel.id);
          if (metaModel) {
            // 如果有元数据且是 chat 模式，返回合并后的数据
            return metaModel.mode === 'chat' ? {
              ...sdkModel,
              ...metaModel
            } : null;
          }
          // 如果没有元数据，返回带有默认 chat 模式的数据
          return {
            ...sdkModel,
            mode: 'chat'
          };
        })
        .filter((model): model is NonNullable<typeof model> => model !== null);

      reply.send(enrichedModels);
    } catch (error: any) {
      // 如果 SDK 调用失败，至少返回元数据中的 chat 模型
      if (providerMeta.length > 0) {
        const chatModels = providerMeta.filter(model => model.mode === 'chat');
        reply.send(chatModels);
      } else {
        reply.code(500).send({
          error: `Failed to fetch models from ${provider}`,
          details: error.message
        });
      }
    }
  });

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