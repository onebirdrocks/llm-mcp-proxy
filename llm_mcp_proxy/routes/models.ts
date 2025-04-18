import { FastifyPluginAsync } from 'fastify';
import { allProviders, getLLMProviderByName } from '../providers';
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
  // 获取所有模型元数据
  fastify.get('/v1/models/meta', async (request, reply) => {
    try {
      return modelsMeta;
    } catch (error: any) {
      reply.code(500).send({
        error: 'Failed to fetch models metadata',
        details: error.message
      });
    }
  });

  // 获取特定提供商的模型元数据
  fastify.get('/v1/models/meta/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    
    try {
      const providerModels = modelsMeta[provider as ProviderName];
      if (!providerModels) {
        reply.code(404).send({ error: `No metadata found for provider ${provider}` });
        return;
      }

      return filterDeprecatedModels(providerModels as ModelMetadata[]);
    } catch (error: any) {
      reply.code(500).send({
        error: `Failed to fetch metadata for provider ${provider}`,
        details: error.message
      });
    }
  });

  // 获取所有可用模型列表
  fastify.get('/v1/models', async (request, reply) => {
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

      const filteredModels = filterDeprecatedModels(models as ModelInfo[]);
      return filteredModels;
    } catch (error: any) {
      reply.code(500).send({
        error: 'Failed to fetch models',
        details: error.message
      });
    }
  });

  // 获取特定提供商的可用模型列表
  fastify.get('/v1/models/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const authHeader = request.headers.authorization;
    let apiKey: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7);
    }

    try {
      const providerInstance = getLLMProviderByName(provider);
      if (!providerInstance) {
        reply.code(404).send({ error: `Provider ${provider} not found` });
        return;
      }

      // 对于需要 API Key 的提供商进行验证
      if (!apiKey && provider !== 'ollama') {
        reply.code(401).send({ 
          error: 'Authentication failed',
          message: 'Missing API Key. Please provide your API key in the Authorization header with Bearer scheme.'
        });
        return;
      }

      const models = await providerInstance.listModels({ apiKey, provider });
      const filteredModels = filterDeprecatedModels(models as ModelInfo[]);
      return filteredModels;
    } catch (error: any) {
      reply.code(500).send({
        error: `Failed to fetch models from ${provider}`,
        details: error.message
      });
    }
  });
};

export default modelsRoute;