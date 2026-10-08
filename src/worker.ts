// Worker SQS separado da API: mesmo código, outro processo (outro Deployment no K8s).
// Escala pela profundidade da fila, não pelo tráfego HTTP.
import { startSqsWorker } from './sqs/consumer.js';
import { chat } from './agent/chat.js';
import { pool } from './db/pool.js';
import { redis } from './redis.js';
import { logger } from './logger.js';
import { z } from 'zod';

const Incoming = z.object({ messageId: z.string(), merchantId: z.string(), text: z.string() });

async function main() {
  await redis.connect();
  const ac = new AbortController();

  const loop = startSqsWorker(async (body) => {
    const msg = Incoming.parse(body);
    const { claim } = await import('./redis.js');
    if (!(await claim(`sqs:${msg.messageId}`))) return; // SQS standard também entrega duplicado (at-least-once)
    const result = await chat({ merchantId: msg.merchantId }, msg.text);
    logger.info({ messageId: msg.messageId, steps: result.steps }, 'resposta gerada'); // aqui enviaria para o WhatsApp
  }, ac.signal);

  const stop = async () => {
    ac.abort(); // interrompe o long polling
    await loop; // espera o lote em andamento
    await Promise.allSettled([pool.end(), redis.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err) => {
  logger.fatal({ err }, 'falha no worker');
  process.exit(1);
});
