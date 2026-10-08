import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { config } from '../config.js';
import { logger } from '../logger.js';

// SQS x Kafka: trade-offs centrais entre fila e log de eventos.
// - SQS: fila. A mensagem some quando alguém dá DELETE. Sem ordem (a menos que FIFO). Escala por nº de workers.
//   Retry = não deletar; ela reaparece após o VisibilityTimeout. DLQ = redrive policy da própria fila.
// - Kafka: log. A mensagem fica retida; cada consumer group tem seu offset. Ordem por partição. Reprocessável.
export const sqs = new SQSClient({
  region: config.AWS_REGION,
  ...(config.SQS_ENDPOINT ? { endpoint: config.SQS_ENDPOINT } : {}), // LocalStack só em dev
});

export async function sendMessage(body: unknown): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: config.SQS_QUEUE_URL, MessageBody: JSON.stringify(body) }));
}

export function startSqsWorker(handle: (body: unknown, msg: Message) => Promise<void>, signal: AbortSignal) {
  const loop = (async () => {
    while (!signal.aborted) {
      try {
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: config.SQS_QUEUE_URL,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20, // long polling: menos chamadas vazias, menos custo
          }),
          { abortSignal: signal },
        );

        // Em paralelo, mas cada mensagem tem seu próprio try/catch: uma ruim não derruba o lote.
        await Promise.allSettled(
          Messages.map(async (m) => {
            try {
              await handle(JSON.parse(m.Body ?? '{}'), m);
              await sqs.send(new DeleteMessageCommand({ QueueUrl: config.SQS_QUEUE_URL, ReceiptHandle: m.ReceiptHandle! }));
            } catch (err) {
              // NÃO deleta: volta para a fila após o visibility timeout. Após maxReceiveCount => DLQ.
              logger.error({ err, messageId: m.MessageId }, 'falha ao processar, mensagem volta para a fila');
            }
          }),
        );
      } catch (err) {
        if (signal.aborted) break;
        logger.error({ err }, 'erro no polling do SQS, aguardando 2s');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();
  return loop; // aguarde esta promise no shutdown para terminar o lote em andamento
}
