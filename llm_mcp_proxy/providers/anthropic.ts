import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, ChatParams } from './types';
import type { Message as BaseMessage } from './types';
import type { Message } from '../types';
import modelsMeta from '../models_meta.json';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function convertMessages(messages: Message[] | BaseMessage[]): AnthropicMessage[] {
  return messages.filter(msg => msg.role !== 'system').map(msg => ({
    role: msg.role === 'assistant' || msg.role === 'user' ? msg.role : 'user',
    content: msg.content
  }));
}

export class AnthropicProvider implements BaseProvider {
  async chat({ model, messages, apiKey }: ChatParams) {
    const client = new Anthropic({ apiKey });
    return client.messages.create({ model, max_tokens: 1024, messages: convertMessages(messages) });
  }

  async chatStream({ model, messages, apiKey }: ChatParams, stream: NodeJS.WritableStream) {
    const client = new Anthropic({ apiKey });
    const encoder = new TextEncoder();
    
    const res = await client.messages.stream({ model, max_tokens: 1024, messages: convertMessages(messages) });
    for await (const chunk of res) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        const event = {
          model,
          created_at: new Date().toISOString(),
          message: {
            role: 'assistant',
            content: chunk.delta.text
          },
          done: false
        };
        stream.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
    stream.write('data: [DONE]\n\n');
    stream.end();
  }

  async listModels() {
    const currentDate = new Date();
    const anthropicMeta = modelsMeta.anthropic || [];

    return anthropicMeta
      .filter(model => model.mode === 'chat' && (!model.deprecation_date || new Date(model.deprecation_date) > currentDate))
      .map(model => ({
        id: model.model_id,
        provider: 'anthropic'
      }));
  }
}