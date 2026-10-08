import { Kafka, logLevel, CompressionTypes, type Producer } from 'kafkajs';
import { config } from '../config.js';

// kafkajs: a lib mais usada em Node moderno para Kafka (kafka-node, a alternativa mais antiga, está sem manutenção).
export const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKERS,
  logLevel: logLevel.WARN,
  retry: { retries: 8, initialRetryTime: 300 }, // retry do CLIENTE (rede), diferente do retry de NEGÓCIO
});

let producer: Producer | undefined;

export async function getProducer(): Promise<Producer> {
  if (!producer) {
    // idempotent: o broker descarta duplicatas causadas por retry do próprio producer.
    producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
    await producer.connect();
  }
  return producer;
}

export interface PublishOptions {
  key: string; // define a partição: mesma chave => mesma partição => ORDEM garantida
  headers?: Record<string, string>;
}

export async function publish(topic: string, payload: unknown, opts: PublishOptions): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic,
    compression: CompressionTypes.GZIP,
    acks: -1, // espera todas as réplicas in-sync: mais durável, mais lento
    messages: [{ key: opts.key, value: JSON.stringify(payload), headers: opts.headers }],
  });
}

export async function disconnectProducer(): Promise<void> {
  await producer?.disconnect();
  producer = undefined;
}
