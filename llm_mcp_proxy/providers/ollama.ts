import { BaseProvider, ChatParams, ListModelsParams } from './types';
import modelsMeta from '../models_meta.json';
import { ModelMeta } from '../types';

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
      console.log('Initializing Ollama client...');
      await this.initialize();
      
      console.log('Calling Ollama list API...');
      const response = await this.client.list();
      console.log('Raw Ollama API response:', response);
      
      const models = Array.isArray(response.models) ? response.models : response;
      console.log('Parsed models before processing:', models);
      
      if (!Array.isArray(models)) {
        console.error('Unexpected response format from Ollama:', models);
        throw new Error('Invalid response format from Ollama');
      }

      const ollamaMeta = (modelsMeta.ollama || []) as ModelMeta[];
      console.log('Available Ollama meta:', ollamaMeta);

      const result = models.map((model: OllamaModel) => ({
        id: model.name,
        provider: 'ollama'
      }));
      
      console.log('Final processed models:', result);
      return result;
      
    } catch (error: any) {
      console.error('Full error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      });
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Failed to connect to Ollama server. Please make sure Ollama is running on port 11434');
      }
      throw error;
    }
  }
}