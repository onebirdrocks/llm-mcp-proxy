import OpenAI from 'openai';
import { BaseProvider, ChatParams } from './types';
import { Message } from '../types';
import modelsMeta from '../models_meta.json';

export class OpenAIProvider implements BaseProvider {
  async chat({ model, messages, apiKey }: ChatParams) {
    const client = new OpenAI({ apiKey });
    const formattedMessages = messages.map(msg => {
      switch (msg.role) {
        case 'system':
          return { role: 'system', content: msg.content } as const;
        case 'user':
          return { role: 'user', content: msg.content } as const;
        case 'assistant':
          return { role: 'assistant', content: msg.content } as const;
        case 'function':
          return { role: 'function', content: msg.content, name: 'function_call' } as const;
        default:
          return { role: 'user', content: msg.content } as const;
      }
    });
    
    return client.chat.completions.create({ 
      model, 
      messages: formattedMessages 
    });
  }

  async chatStream({ model, messages, apiKey }: ChatParams, stream: NodeJS.WritableStream) {
    const encoder = new TextEncoder();
    const client = new OpenAI({ apiKey });
    const formattedMessages = messages.map(msg => {
      switch (msg.role) {
        case 'system':
          return { role: 'system', content: msg.content } as const;
        case 'user':
          return { role: 'user', content: msg.content } as const;
        case 'assistant':
          return { role: 'assistant', content: msg.content } as const;
        case 'function':
          return { role: 'function', content: msg.content, name: 'function_call' } as const;
        default:
          return { role: 'user', content: msg.content } as const;
      }
    });
    
    const completion = await client.chat.completions.create({ 
      model, 
      messages: formattedMessages, 
      stream: true 
    });
    
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
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.models.list();
    const currentDate = new Date();
    const openaiMeta = modelsMeta.openai || [];

    return res.data
      .filter(model => {
        const meta = openaiMeta.find(m => m.model_id === model.id);
        return meta?.mode === 'chat' && (!meta.deprecation_date || new Date(meta.deprecation_date) > currentDate);
      })
      .map(m => ({ id: m.id, provider: 'openai' }));
  }
}