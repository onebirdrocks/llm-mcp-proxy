import { Ollama, ListResponse, ModelResponse } from 'ollama';
import { BaseProvider, ChatParams } from './types';
import { Message } from '../types';

export class OllamaProvider implements BaseProvider {
  private client: Ollama;

  constructor() {
    this.client = new Ollama({
      host: 'http://localhost:11434'
    });
  }

  async chat({ model, messages }: ChatParams) {
    try {
      const response = await this.client.chat({
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      });
      return response;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Failed to connect to Ollama server. Please make sure Ollama is running on port 11434');
      }
      throw error;
    }
  }

  async chatStream({ model, messages }: ChatParams, stream: NodeJS.WritableStream) {
    try {
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
          model,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          stream: true
        });

        for await (const chunk of response) {
          if (streamEnded) break;

          const event = {
            model,
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

  async listModels() {
    try {
      const models = await this.client.list();
      return Object.values(models.models).map((model: ModelResponse) => ({
        id: model.name.split(':')[0], // Remove ':latest' suffix
        name: model.name,
        provider: 'ollama',
        size: model.size,
        modified: model.modified_at ? new Date(model.modified_at).toISOString() : null
      }));
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Failed to connect to Ollama server. Please make sure Ollama is running on port 11434');
      }
      console.error('Error fetching models from Ollama:', error);
      throw new Error(`Failed to fetch models from Ollama: ${error.message}`);
    }
  }
}