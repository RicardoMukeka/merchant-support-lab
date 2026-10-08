import { pool } from './pool.js';

export interface Order {
  orderId: string;
  merchantId: string;
  status: string;
  amountCents: number;
}

// UPSERT idempotente: processar a mesma mensagem 2x (at-least-once) deixa o mesmo resultado.
// O WHERE protege contra evento atrasado sobrescrevendo um estado mais novo.
export async function upsertOrder(o: Order & { eventAt: Date }): Promise<void> {
  await pool.query(
    `INSERT INTO orders (order_id, merchant_id, status, amount_cents, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (order_id) DO UPDATE
       SET status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents, updated_at = EXCLUDED.updated_at
       WHERE orders.updated_at < EXCLUDED.updated_at`,
    [o.orderId, o.merchantId, o.status, o.amountCents, o.eventAt],
  );
}

// merchantId vem SEMPRE da sessão autenticada, nunca do que o LLM "decidiu".
// Isso evita que o modelo (ou uma injeção de prompt) leia pedido de outro lojista.
export async function findOrderForMerchant(merchantId: string, orderId: string): Promise<Order | null> {
  const { rows } = await pool.query(
    `SELECT order_id, merchant_id, status, amount_cents FROM orders WHERE merchant_id = $1 AND order_id = $2`,
    [merchantId, orderId],
  );
  const r = rows[0];
  return r ? { orderId: r.order_id, merchantId: r.merchant_id, status: r.status, amountCents: Number(r.amount_cents) } : null;
}

export async function saveMessage(merchantId: string, role: 'user' | 'assistant', content: string, meta: object = {}) {
  await pool.query(`INSERT INTO conversations (merchant_id, role, content, meta) VALUES ($1,$2,$3,$4)`, [
    merchantId,
    role,
    content,
    JSON.stringify(meta),
  ]);
}

export async function recentMessages(merchantId: string, limit = 10) {
  const { rows } = await pool.query(
    `SELECT role, content FROM conversations WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [merchantId, limit],
  );
  return rows.reverse() as { role: 'user' | 'assistant'; content: string }[];
}
