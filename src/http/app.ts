import express from 'express';
import { z } from 'zod';
import { requestId, verifySignature, errorHandler } from './middleware.js';
import { chat } from '../agent/chat.js';
import { pool } from '../db/pool.js';
import { redis } from '../redis.js';
import { publish } from '../kafka/client.js';
import { config } from '../config.js';

const ChatBody = z.object({ merchantId: z.string().min(1), text: z.string() });
const OrderBody = z.object({
  eventId: z.string().uuid(),
  orderId: z.string(),
  merchantId: z.string(),
  status: z.enum(['CREATED', 'PAID', 'SETTLED', 'CANCELLED']),
  amountCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
});

export const state = { shuttingDown: false };

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(
    express.json({
      limit: '50kb',
      verify: (_req, res, buf) => ((res as express.Response).locals.rawBody = buf), // guarda o corpo cru p/ HMAC
    }),
  );

  // LIVENESS: "o processo está vivo?" Não checa dependências (senão o K8s mata o pod por culpa do banco).
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  // READINESS: "posso receber tráfego?" Checa dependências e fica 503 durante o shutdown.
  app.get('/health/ready', async (_req, res) => {
    if (state.shuttingDown) return void res.status(503).json({ status: 'shutting_down' });
    try {
      await Promise.all([pool.query('SELECT 1'), redis.ping()]);
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  // Webhook de chat (ex.: WhatsApp). Em produção o merchantId viria do token/telefone, não do body.
  app.post('/webhook/chat', verifySignature, async (req, res) => {
    const body = ChatBody.parse(req.body);
    const result = await chat({ merchantId: body.merchantId }, body.text);
    res.json(result);
  });

  // Atalho de estudo: publica um evento de pedido no Kafka (para você ver o consumer funcionando).
  app.post('/dev/orders', async (req, res) => {
    const evt = OrderBody.parse(req.body);
    await publish(config.KAFKA_TOPIC_ORDERS, evt, { key: evt.orderId }); // chave = orderId => ordem por pedido
    res.status(202).json({ accepted: true });
  });

  app.use(errorHandler);
  return app;
}
