import OpenAI from 'openai';
import { BaseProvider, ChatParams, ListModelsParams } from './types';
import { Message, ModelMeta } from '../types';
import modelsMeta from '../models_meta.json';

export class DeepSeekProvider implements BaseProvider {
  baseUrl = 'https://api.deepseek.com/v1';

  createClient(apiKey: string) {
    return new OpenAI({
      apiKey,
      baseURL: this.baseUrl
    });
  }

  async chat({ model, messages, apiKey }: ChatParams) {
    try {
      const client = this.createClient(apiKey!);
      const response = await client.chat.completions.create({
        model,
        messages: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })) as OpenAI.Chat.ChatCompletionMessageParam[]
      });
      return response;
    } catch (error: any) {
      console.error('DeepSeek API error:', error);
      throw error;
    }
  }

  async chatStream({ model, messages, apiKey }: ChatParams, stream: NodeJS.WritableStream) {
    try {
      const client = this.createClient(apiKey!);
      const response = await client.chat.completions.create({
        model,
        messages: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        })) as OpenAI.Chat.ChatCompletionMessageParam[],
        stream: true
      });

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

      const handleError = (error: Error) => {
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

      try {
        for await (const chunk of response) {
          if (streamEnded) break;

          if (chunk.choices[0]?.delta?.content) {
            const event = {
              model,
              created_at: new Date().toISOString(),
              message: {
                role: 'assistant',
                content: chunk.choices[0].delta.content
              },
              done: false
            };
            stream.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        }

        endStream();
      } catch (error) {
        handleError(error as Error);
      }
    } catch (error: any) {
      console.error('DeepSeek API error:', error);
      throw error;
    }
  }

  async listModels(params?: ListModelsParams) {
    const models = modelsMeta.deepseek.filter((m: ModelMeta) => {
      return m.mode === 'chat' && (!m.deprecation_date || new Date(m.deprecation_date) > new Date());
    });
    return models.map((item: ModelMeta) => ({
      id: item.model_id,
      provider: 'deepseek'
    }));
  }
}