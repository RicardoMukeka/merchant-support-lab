// Telemetria PRIMEIRO (ver comentário em telemetry.ts)
import { startTelemetry, stopTelemetry } from './telemetry.js';
startTelemetry();

import { createApp, state } from './http/app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db/pool.js';
import { redis } from './redis.js';
import { disconnectProducer } from './kafka/client.js';
import { startOrdersConsumer } from './kafka/orders-consumer.js';

async function main() {
  await redis.connect();
  const consumer = await startOrdersConsumer();
  const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT }, 'API no ar'));

  // Shutdown gracioso: o K8s manda SIGTERM e dá 30s (terminationGracePeriodSeconds).
  // Ordem: 1) readiness vira 503 (para de receber tráfego)  2) fecha HTTP  3) para o consumer  4) fecha dependências.
  // Um `process.exit(0)` direto no SIGTERM, sem essa sequência, derruba requests em voo e deixa conexões penduradas.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'encerrando');
    state.shuttingDown = true;
    const force = setTimeout(() => process.exit(1), 25_000).unref(); // não passa do grace period do K8s
    await new Promise((r) => server.close(r));
    await consumer.disconnect(); // termina a mensagem em andamento e comita o offset
    await disconnectProducer();
    await Promise.allSettled([pool.end(), redis.quit(), stopTelemetry()]);
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Erros que escapam: logar e SAIR (estado indefinido). O K8s sobe outro pod.
  process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'unhandledRejection');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'falha na inicialização');
  process.exit(1);
});
