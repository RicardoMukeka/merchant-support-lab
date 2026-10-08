import { z } from 'zod';

// Valida o ambiente na subida: se faltar variável, o processo cai AQUI, com mensagem clara,
// e não 3 horas depois dentro de um handler. (Em Spring seria @ConfigurationProperties + @Validated.)
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  KAFKA_BROKERS: z.string().transform((s) => s.split(',')),
  KAFKA_CLIENT_ID: z.string().default('merchant-support-lab'),
  KAFKA_GROUP_ID: z.string(),
  KAFKA_TOPIC_ORDERS: z.string(),
  KAFKA_TOPIC_ORDERS_DLQ: z.string(),

  SQS_ENDPOINT: z.string().url().optional(), // só em dev (LocalStack)
  SQS_QUEUE_URL: z.string(),
  AWS_REGION: z.string().default('us-east-1'),

  LLM_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-5-5'),
  EMBEDDING_DIM: z.coerce.number().default(256),

  WEBHOOK_SECRET: z.string().min(8),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Imprime só os NOMES dos campos inválidos, nunca os valores (podem ser segredos).
  console.error('Configuração inválida:', Object.keys(parsed.error.flatten().fieldErrors));
  process.exit(1);
}
export const config: Config = parsed.data;
