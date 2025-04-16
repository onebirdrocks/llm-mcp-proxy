import OpenAI from 'openai';
import { BaseProvider, ChatParams } from './types';
import { Message } from '../types';

export class OpenAIProvider implements BaseProvider {
  async chat({ model, messages, apiKey }: ChatParams) {
    const client = new OpenAI({ apiKey });
    return client.chat.completions.create({ model, messages });
  }

  async chatStream({ model, messages, apiKey }: ChatParams, stream: NodeJS.WritableStream) {
    const encoder = new TextEncoder();
    const client = new OpenAI({ apiKey });
    
    const completion = await client.chat.completions.create({ model, messages, stream: true });
    
    for await (const chunk of completion) {
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
        stream.write(encoder.encode(JSON.stringify(event) + '\n'));
      }
    }
    
    stream.write('data: [DONE]\n\n');
    stream.end();
  }

  async listModels() {
    // 注意：listModels 可能需要一个默认的 API Key
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.models.list();
    return res.data.map(m => ({ id: m.id, provider: 'openai' }));
  }
}