import { OpenAIAdapter } from './providers/openai';

export function getLLMClient(provider: string, model: string) {
    switch (provider) {
        case 'openai':
            return new OpenAIAdapter(model);
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}