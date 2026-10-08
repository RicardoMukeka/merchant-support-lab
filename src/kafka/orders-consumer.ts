import { z } from 'zod';
import { startConsumer } from './consumer.js';
import { upsertOrder } from '../db/orders.js';
import { config } from '../config.js';

// Contrato do evento. Versionado no nome do tópico (lab.orders.v1) e validado na borda.
// Evolução de schema sem quebrar consumers existentes: campos opcionais, nova versão de tópico, schema registry.
export const OrderEvent = z.object({
  eventId: z.string().uuid(),
  orderId: z.string().min(1),
  merchantId: z.string().min(1),
  status: z.enum(['CREATED', 'PAID', 'SETTLED', 'CANCELLED']),
  amountCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
});
export type OrderEvent = z.infer<typeof OrderEvent>;

export function startOrdersConsumer() {
  return startConsumer<OrderEvent>({
    topic: config.KAFKA_TOPIC_ORDERS,
    groupId: config.KAFKA_GROUP_ID,
    dlqTopic: config.KAFKA_TOPIC_ORDERS_DLQ,
    parse: (raw) => OrderEvent.parse(raw),
    idempotencyKey: (e) => e.eventId,
    handle: (e) =>
      upsertOrder({
        orderId: e.orderId,
        merchantId: e.merchantId,
        status: e.status,
        amountCents: e.amountCents,
        eventAt: new Date(e.occurredAt),
      }),
  });
}
