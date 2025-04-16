import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, ChatParams } from './types';
import { Message } from '../types';

export class AnthropicProvider implements BaseProvider {
  async chat({ model, messages, apiKey }: ChatParams) {
    const client = new Anthropic({ apiKey });
    return client.messages.create({ model, max_tokens: 1024, messages });
  }

  async chatStream({ model, messages, apiKey }: ChatParams, stream: NodeJS.WritableStream) {
    const client = new Anthropic({ apiKey });
    const encoder = new TextEncoder();
    
    const res = await client.messages.stream({ model, max_tokens: 1024, messages });
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
    return [{ id: 'claude-3-haiku-20240307', provider: 'anthropic' }];
  }
}