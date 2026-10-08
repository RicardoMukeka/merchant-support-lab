import { config } from '../config.js';
import type { LlmProvider } from './provider.js';
import { FakeLlm } from './fake.js';
import { AnthropicLlm } from './anthropic.js';

export function createLlm(): LlmProvider {
  if (config.LLM_PROVIDER === 'anthropic') {
    if (!config.ANTHROPIC_API_KEY) throw new Error('LLM_PROVIDER=anthropic exige ANTHROPIC_API_KEY');
    return new AnthropicLlm(config.ANTHROPIC_API_KEY, config.LLM_MODEL, config.EMBEDDING_DIM);
  }
  return new FakeLlm(config.EMBEDDING_DIM);
}

export const llm: LlmProvider = createLlm();
