import { BaseProvider, ChatParams, Message, ListModelsParams } from './types';
import modelsMeta from '../models_meta.json';

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export class OllamaProvider implements BaseProvider {
  private client: any;

  async initialize() {
    const ollama = await import('ollama');
    this.client = ollama.default;
  }

  async chat(params: ChatParams) {
    if (!this.client) {
      await this.initialize();
    }

    const response = await this.client.chat({
      model: params.model,
      messages: params.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))
    });

    return response;
  }

  async chatStream(params: ChatParams, stream: NodeJS.WritableStream) {
    try {
      await this.initialize();
      let streamEnded = false;

      const endStream = () => {
        if (!streamEnded) {
          streamEnded = true;
          try {
            stream.write('data: [DONE]\n\n');
            stream.end();
          } catch (e) {
            console.error('Error ending stream:', e);
          }
        }
      };

      const handleError = (error: any) => {
        if (!streamEnded) {
          streamEnded = true;
          try {
            const errorEvent = {
              error: true,
              message: error.message
            };
            stream.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
            stream.write('data: [DONE]\n\n');
            stream.end();
          } catch (e) {
            console.error('Error handling stream error:', e);
          }
        }
      };

      const writeToStream = (data: any) => {
        if (!streamEnded) {
          try {
            stream.write(`data: ${JSON.stringify(data)}\n\n`);
          } catch (e) {
            console.error('Error writing to stream:', e);
            handleError(e);
          }
        }
      };

      try {
        const response = await this.client.chat({
          model: params.model,
          messages: params.messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          stream: true
        });

        for await (const chunk of response) {
          if (streamEnded) break;

          const event = {
            model: params.model,
            created_at: new Date().toISOString(),
            message: {
              role: 'assistant',
              content: chunk.message.content
            },
            done: false
          };

          writeToStream(event);
        }

        endStream();
      } catch (error) {
        handleError(error);
      }
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Failed to connect to Ollama server. Please make sure Ollama is running on port 11434');
      }
      throw error;
    }
  }

  async listModels(params?: ListModelsParams) {
    try {
      await this.initialize();
      const response = await this.client.list();
      
      // 添加调试日志
      console.log('Ollama response:', JSON.stringify(response, null, 2));

      const models = Array.isArray(response.models) ? response.models : response;
      
      if (!Array.isArray(models)) {
        console.error('Unexpected response format from Ollama:', models);
        throw new Error('Invalid response format from Ollama');
      }

      const currentDate = new Date();
      const ollamaMeta = modelsMeta.ollama || [];

      return models
        .filter((model: any) => {
          const meta = ollamaMeta.find(m => m.model_id === model.name);
          return meta?.mode === 'chat' && (!meta.deprecation_date || new Date(meta.deprecation_date) > currentDate);
        })
        .map((model: OllamaModel) => {
          const meta = ollamaMeta.find(item => item.model_id === model.name);
          return {
            id: model.name,
            provider: 'ollama',
            ...meta
          };
        });
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Failed to connect to Ollama server. Please make sure Ollama is running on port 11434');
      }
      console.error('Error fetching models from Ollama:', error);
      throw error;
    }
  }
}