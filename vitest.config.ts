import { defineConfig } from 'vitest/config';

// Ambiente de teste fixo: o config.ts valida o env no import (e dá process.exit se faltar).
// Esse é o custo de validar no import; alternativa: exportar uma função loadConfig(env) e injetar nos testes.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: 'postgres://lab:lab@localhost:5432/lab',
      REDIS_URL: 'redis://localhost:6379',
      KAFKA_BROKERS: 'localhost:9092',
      KAFKA_GROUP_ID: 'test',
      KAFKA_TOPIC_ORDERS: 'test.orders',
      KAFKA_TOPIC_ORDERS_DLQ: 'test.orders.dlq',
      SQS_QUEUE_URL: 'http://localhost:4566/000000000000/test',
      WEBHOOK_SECRET: 'segredo-de-teste',
    },
  },
});
