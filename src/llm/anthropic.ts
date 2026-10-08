import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmRequest, LlmResponse, ContentBlock } from './provider.js';
import { fakeEmbed } from './fake.js';

// Adaptador do SDK da Anthropic. NÃO TESTADO contra a API real neste lab: confira a versão do SDK
// e os nomes de campos na documentação antes de depender dele.
export class AnthropicLlm implements LlmProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly dim: number,
  ) {
    // maxRetries do SDK cobre 429/5xx com backoff. Timeout explícito: LLM pendurado segura sua thread/conexão.
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        // cache_control: o prefixo estável (system + tools) é cacheado; paga bem menos nas chamadas seguintes.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: req.messages as Anthropic.MessageParam[],
        tools: req.tools as Anthropic.Tool[] | undefined,
      },
      { timeout: req.timeoutMs },
    );

    const stop =
      res.stop_reason === 'end_turn' || res.stop_reason === 'tool_use' || res.stop_reason === 'max_tokens'
        ? res.stop_reason
        : 'other';
    return {
      content: res.content as ContentBlock[],
      stopReason: stop,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }

  // Sem embeddings próprios na Anthropic: aqui fica um ponto de extensão. Mantemos o fake para o lab rodar.
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => fakeEmbed(t, this.dim));
  }
}
