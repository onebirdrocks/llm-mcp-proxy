import { FastifyPluginAsync } from 'fastify';
import { allProviders, getProviderByName } from '../providers';
import modelsMeta from '../models_meta.json';

type ModelsMetaType = typeof modelsMeta;
type ProviderName = keyof ModelsMetaType;
type BaseModelMetadata = {
  max_tokens: number;
  max_input_tokens: number;
  max_output_tokens: number;
  input_cost_per_token: number;
  output_cost_per_token: number;
  mode: string;
  model_id: string;
  deprecation_date?: string;
};

type ModelMetadata = BaseModelMetadata & {
  [key: string]: any;
};

interface ModelInfo {
  id: string;
  provider: string;
  deprecation_date?: string;
  [key: string]: any;
}

function isModelDeprecated(model: ModelMetadata | ModelInfo): boolean {
  if (!model.deprecation_date) {
    return false;
  }
  const deprecationDate = new Date(model.deprecation_date);
  return deprecationDate <= new Date();
}

function filterDeprecatedModels<T extends ModelMetadata | ModelInfo>(models: T[]): T[] {
  return models.filter(model => !isModelDeprecated(model));
}

const modelsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/models/meta', async (request, reply) => {
    return modelsMeta;
  });

  fastify.get('/v1/models/meta/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const providerInstance = getProviderByName(provider);
    
    if (!providerInstance) {
      reply.code(404).send({ error: `Provider ${provider} not found` });
      return;
    }

    const providerModels = modelsMeta[provider as ProviderName];
    if (!providerModels) {
      reply.code(404).send({ error: `No metadata found for provider ${provider}` });
      return;
    }

    return filterDeprecatedModels(providerModels as ModelMetadata[]);
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

      // 过滤掉已过期的模型
      const filteredModels = filterDeprecatedModels(models as ModelInfo[]);
      reply.send(filteredModels);
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
      // 过滤掉已过期的模型
      const filteredModels = filterDeprecatedModels(models as ModelInfo[]);
      reply.send(filteredModels);
    } catch (error: any) {
      reply.code(500).send({
        error: `Failed to fetch models from ${provider}`,
        details: error.message
      });
    }
  });
};

export default modelsRoute;