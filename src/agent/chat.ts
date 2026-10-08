import { llm } from '../llm/index.js';
import type { ContentBlock, LlmMessage } from '../llm/provider.js';
import { tools, toolSpecs, type ToolContext } from './tools.js';
import { checkInput, sanitizeOutput } from '../guardrails.js';
import { recentMessages, saveMessage } from '../db/orders.js';
import { logger } from '../logger.js';

const SYSTEM = `Você é o assistente de suporte a lojistas.
- Responda em português, curto e direto.
- Para dúvidas de produto, use buscar_conhecimento e responda SOMENTE com base no que voltar. Se não houver base, diga que não sabe e ofereça falar com um atendente.
- Para pedidos, use consultar_pedido.
- Nunca invente valores, prazos ou taxas.`;

const MAX_STEPS = 5; // limite do loop do agente: evita laço infinito de tools (e custo infinito)

export interface ChatResult {
  reply: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
}

export async function chat(ctx: ToolContext, userText: string): Promise<ChatResult> {
  const guard = checkInput(userText);
  if (!guard.ok) return { reply: 'Não consegui processar essa mensagem. Pode reformular?', steps: 0, usage: zero() };

  const history = await recentMessages(ctx.merchantId, 6);
  const messages: LlmMessage[] = [...history, { role: 'user', content: guard.text }];
  const usage = zero();

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await llm.complete({ system: SYSTEM, messages, tools: toolSpecs, maxTokens: 800 });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;

    if (res.stopReason !== 'tool_use') {
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      const reply = sanitizeOutput(text);
      await saveMessage(ctx.merchantId, 'user', guard.text);
      await saveMessage(ctx.merchantId, 'assistant', reply, { steps: step, usage }); // auditoria
      logger.info({ merchantId: ctx.merchantId, steps: step, ...usage }, 'chat respondido');
      return { reply, steps: step, usage };
    }

    messages.push({ role: 'assistant', content: res.content });
    const results: ContentBlock[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      results.push(await runTool(block, ctx));
    }
    messages.push({ role: 'user', content: results });
  }

  return { reply: 'Preciso de um atendente para ajudar com isso.', steps: MAX_STEPS, usage }; // fallback seguro
}

async function runTool(block: Extract<ContentBlock, { type: 'tool_use' }>, ctx: ToolContext): Promise<ContentBlock> {
  const tool = tools[block.name];
  try {
    if (!tool) throw new Error(`tool desconhecida: ${block.name}`);
    return { type: 'tool_result', tool_use_id: block.id, content: await tool.run(block.input, ctx) };
  } catch (err) {
    // Devolve o erro ao modelo (ele pode se corrigir) em vez de derrubar o request.
    logger.warn({ err, tool: block.name }, 'tool falhou');
    return { type: 'tool_result', tool_use_id: block.id, content: 'erro ao executar a ferramenta', is_error: true };
  }
}

const zero = () => ({ inputTokens: 0, outputTokens: 0 });
