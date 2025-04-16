import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { DeepSeekProvider } from './deepseek';
import { OllamaProvider } from './ollama';

const openai = new OpenAIProvider();
const anthropic = new AnthropicProvider();
const deepseek = new DeepSeekProvider();
const ollama = new OllamaProvider();


export const allProviders = [openai, anthropic, deepseek, ollama];

export function getProviderByName(name: string) {
  switch (name) {
    case 'openai': return openai;
    case 'anthropic': return anthropic;
    case 'deepseek': return deepseek;
    case 'ollama': return ollama;
    default: return null;
  }
}