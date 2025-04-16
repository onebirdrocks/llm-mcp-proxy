import OpenAI from 'openai';
import { BaseProvider, ChatParams, ListModelsParams } from './types';
import { Message } from '../types';

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
    try {
      // 如果指定了 provider 且不是 'deepseek'，返回空数组
      if (params?.provider && params.provider !== 'deepseek') {
        return [];
      }

      const client = this.createClient(params?.apiKey || process.env.DEEPSEEK_API_KEY!);
      const response = await client.models.list();
      return response.data.map(model => ({
        id: model.id,
        provider: 'deepseek'
      }));
    } catch (error: any) {
      console.error('Error fetching models from DeepSeek:', error);
      throw new Error(`Failed to fetch models from DeepSeek: ${error.message}`);
    }
  }
}