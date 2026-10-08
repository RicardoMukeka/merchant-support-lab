import { createHash } from 'node:crypto';
import type { LlmProvider, LlmRequest, LlmResponse } from './provider.js';

// Embedding determinístico por "bag of words hasheado": palavras iguais => vetores parecidos.
// NÃO é semântico de verdade, mas permite ingerir e buscar sem chave nenhuma.
// Em produção: um modelo de embeddings real (a Anthropic não oferece embeddings próprios; usa-se Voyage, OpenAI, Bedrock Titan etc.).
export function fakeEmbed(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const word of text.toLowerCase().normalize('NFD').replace(/[^a-z0-9\s]/g, '').split(/\s+/)) {
    if (word.length < 3) continue;
    const h = createHash('md5').update(word).digest();
    const idx = h.readUInt16BE(0) % dim;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

// LLM falso para testes e para estudar o fluxo do agente: se houver tool "buscar_conhecimento",
// chama a tool uma vez; depois responde com o texto do resultado. Isso exercita o loop inteiro.
export class FakeLlm implements LlmProvider {
  constructor(private readonly dim: number) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const last = req.messages[req.messages.length - 1];
    const lastIsToolResult = Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result');

    if (!lastIsToolResult && req.tools?.some((t) => t.name === 'buscar_conhecimento')) {
      const question = typeof last?.content === 'string' ? last.content : '';
      return {
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 5 },
        content: [{ type: 'tool_use', id: 'fake-1', name: 'buscar_conhecimento', input: { consulta: question } }],
      };
    }
    const toolText = Array.isArray(last?.content)
      ? last.content.filter((b) => b.type === 'tool_result').map((b) => (b as { content: string }).content).join('\n')
      : '';
    return {
      stopReason: 'end_turn',
      usage: { inputTokens: 20, outputTokens: 20 },
      content: [{ type: 'text', text: toolText ? `Com base na base de conhecimento:\n${toolText}` : 'Não sei responder isso.' }],
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => fakeEmbed(t, this.dim));
  }
}
