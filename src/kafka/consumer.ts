import type { Consumer, EachMessagePayload } from 'kafkajs';
import { kafka, publish } from './client.js';
import { runWithRetry, NonRetryableError, type RetryPolicy } from './retry.js';
import { claim, release } from '../redis.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

export interface ConsumerOptions<T> {
  topic: string;
  groupId: string;
  dlqTopic: string;
  parse: (raw: unknown) => T; // valida o payload (zod). Falha aqui = NonRetryable
  idempotencyKey: (msg: T) => string;
  handle: (msg: T) => Promise<void>;
  policy?: RetryPolicy;
}

const DEFAULT_POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 10_000 };

export async function startConsumer<T>(opts: ConsumerOptions<T>): Promise<Consumer> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const consumer = kafka.consumer({
    groupId: opts.groupId, // mesmo groupId = instâncias dividem as partições (escala horizontal no K8s)
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
  });

  await consumer.connect();
  await consumer.subscribe({ topic: opts.topic, fromBeginning: false });

  await consumer.run({
    autoCommit: true, // o offset só é confirmado depois que eachMessage RESOLVE => at-least-once
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      const log = logger.child({ topic, partition, offset: message.offset });
      const raw = message.value?.toString() ?? '';

      let parsed: T;
      try {
        parsed = opts.parse(JSON.parse(raw));
      } catch (err) {
        // "Poison pill": mensagem que nunca vai ser parseável. DLQ direto, sem travar a partição.
        await sendToDlq(opts.dlqTopic, message.key, raw, err, 0, message.headers);
        log.warn({ err }, 'mensagem inválida enviada para a DLQ');
        return;
      }

      const key = opts.idempotencyKey(parsed);
      if (!(await claim(`${opts.groupId}:${key}`))) {
        log.info({ key }, 'duplicada, ignorando'); // at-least-once => duplicatas são NORMAIS
        return;
      }

      const outcome = await runWithRetry(() => opts.handle(parsed), policy);
      if (outcome.ok) return;

      await release(`${opts.groupId}:${key}`); // libera para um eventual reprocesso manual da DLQ
      await sendToDlq(opts.dlqTopic, message.key, raw, outcome.error, outcome.attempts, message.headers);
      log.error({ key, attempts: outcome.attempts, err: outcome.error }, 'esgotou tentativas, enviado para a DLQ');
    },
  });

  return consumer;
}

async function sendToDlq(
  dlqTopic: string,
  key: Buffer | null,
  rawValue: string,
  error: unknown,
  attempts: number,
  headers: EachMessagePayload['message']['headers'],
) {
  const reason = error instanceof Error ? error.message : String(error);
  await publish(
    dlqTopic,
    { original: rawValue, reason, attempts, failedAt: new Date().toISOString(), service: config.KAFKA_CLIENT_ID },
    { key: key?.toString() ?? 'no-key', headers: { 'x-original-topic': String(headers?.['x-topic'] ?? '') } },
  );
}

export { NonRetryableError };
