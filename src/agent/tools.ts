import { z } from 'zod';
import type { ToolSpec } from '../llm/provider.js';
import { hybridSearch } from '../rag/retrieve.js';
import { findOrderForMerchant } from '../db/orders.js';

// Contexto vem da SESSÃO (já autenticada), não do modelo.
export interface ToolContext {
  merchantId: string;
}

interface Tool {
  spec: ToolSpec;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
}

const BuscarInput = z.object({ consulta: z.string().min(2).max(300) });
const PedidoInput = z.object({ orderId: z.string().min(1).max(64) }); // sem merchantId: de propósito!

export const tools: Record<string, Tool> = {
  buscar_conhecimento: {
    spec: {
      name: 'buscar_conhecimento',
      description: 'Busca na base de conhecimento (FAQ, políticas, taxas). Use para qualquer dúvida de como o produto funciona.',
      input_schema: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] },
    },
    async run(input) {
      const { consulta } = BuscarInput.parse(input);
      const hits = await hybridSearch(consulta);
      if (!hits.length) return 'Nada encontrado na base.';
      return hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n---\n');
    },
  },

  consultar_pedido: {
    spec: {
      name: 'consultar_pedido',
      description: 'Consulta o status de UM pedido do lojista atual pelo orderId.',
      input_schema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
    },
    async run(input, ctx) {
      const { orderId } = PedidoInput.parse(input);
      // O filtro por merchantId é do servidor. Mesmo que o modelo seja enganado, não alcança outro lojista.
      const order = await findOrderForMerchant(ctx.merchantId, orderId);
      return order
        ? `Pedido ${order.orderId}: status ${order.status}, valor R$ ${(order.amountCents / 100).toFixed(2)}`
        : 'Pedido não encontrado para este lojista.';
    },
  },
};

export const toolSpecs = Object.values(tools).map((t) => t.spec);
