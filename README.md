# merchant-support-lab

Projeto de estudo: um serviço de **chatbot de suporte a lojistas** em Node + TypeScript, montado com as peças que uma equipe de IA em produção costuma usar (Kafka com DLQ e idempotência, RAG híbrido em Postgres/pgvector, um agente de LLM com tools e autorização, observabilidade com OpenTelemetry). É um esqueleto de aprendizado, não a arquitetura de nenhuma empresa real.

## Status honesto

| Verificado | Não verificado (escrito, nunca executado) |
|---|---|
| `npm run typecheck` passa (TS strict) | Subir o `docker-compose` e o fluxo ponta a ponta |
| `npm test`: 21 testes passam (retry, backoff, RRF, chunking, guardrails) | Consumer Kafka e worker SQS contra brokers reais |
| | Adaptador da Anthropic (`src/llm/anthropic.ts`) |
| | SQL híbrido (pgvector + tsvector), manifestos K8s, Dockerfile |

Trate o que não foi executado como "hipótese a depurar". Quando algo quebrar, esse é o exercício.

## Como subir

Requer Node 22+ (o `tsx --env-file` precisa de Node 20.6+). Com `nvm`: `nvm use 23`.

```bash
cp .env.example .env
npm install
npm run infra:up        # Kafka (KRaft), Postgres+pgvector, Redis, LocalStack (SQS), Jaeger
npm run ingest          # lê ./knowledge/*.md, gera chunks e embeddings
npm run dev             # API em :3000 (LLM_PROVIDER=fake funciona sem chave)
```

Testar:

```bash
# publica um pedido no Kafka (o consumer grava no Postgres)
curl -X POST localhost:3000/dev/orders -H 'content-type: application/json' -d '{
  "eventId":"3f2b8c1e-9d4a-4e6b-8a57-1c2d3e4f5a6b","orderId":"o-1","merchantId":"m-1",
  "status":"PAID","amountCents":15990,"occurredAt":"2026-10-07T12:00:00.000Z"}'

# chat assinado (HMAC)
BODY='{"merchantId":"m-1","text":"Em quanto tempo recebo as vendas no débito?"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "troque-me" | sed 's/^.* //')
curl -X POST localhost:3000/webhook/chat -H 'content-type: application/json' -H "x-signature: $SIG" -d "$BODY"

python3 evals/run_evals.py   # taxa de acerto no dataset
```

Traces em http://localhost:16686 (Jaeger). Depurar: `.vscode/launch.json` (API, Ingest, Vitest, Worker).

Guia completo passo a passo (infra, debug, queries no banco, teste de idempotência/DLQ): [`docs/rodando-localmente.md`](docs/rodando-localmente.md). Visão geral de arquitetura: [`docs/architecture.md`](docs/architecture.md).

## Mapa de estudo: peças de produção cobertas aqui

| Tema | Arquivo | O que observar | Pergunta que isso responde |
|---|---|---|---|
| Retry com backoff + jitter | `src/kafka/retry.ts` | Hoje: retentativa imediata em memória. Aqui: exponencial com jitter e erro não retentável | "Retry imediato ajuda ou piora?" |
| DLQ | `src/kafka/consumer.ts` | Hoje o DLQ está comentado e a mensagem é descartada | "O que fazer com mensagem que nunca processa?" |
| Idempotência | `src/redis.ts`, `src/db/orders.ts` | `SET NX` + `UPSERT ... WHERE updated_at <` | "Como lidar com entrega duplicada?" |
| At-least-once | `consumer.ts` (`autoCommit`) | Offset só confirma após o handler resolver | "At-least-once x exactly-once?" |
| Chave de partição | `kafka/client.ts` | `key = orderId` garante ordem por pedido | "Como garantir ordem no Kafka?" |
| Producer idempotente | `kafka/client.ts` | `idempotent`, `acks: -1` | "Durabilidade x latência?" |
| Validação de contrato | `orders-consumer.ts` | Zod na borda, versão no nome do tópico | "Como evoluir schema sem quebrar?" |
| SQS x Kafka | `sqs/consumer.ts`, `infra/localstack-init.sh` | Visibility timeout, redrive para DLQ, long polling | "Quando fila, quando log?" |
| Shutdown gracioso | `src/server.ts` | readiness 503, fecha HTTP, para consumer, fecha pool. O BFF faz `process.exit(0)` direto | "O que acontece no SIGTERM do K8s?" |
| Liveness x readiness | `http/app.ts`, `k8s/deployment.yaml` | Liveness não checa banco; readiness checa | "Por que não checar o banco na liveness?" |
| Config validada | `src/config.ts` | Falha na subida, sem vazar valores | "Como tratar config e segredos?" |
| Webhook assinado | `http/middleware.ts` | HMAC no corpo cru + `timingSafeEqual` | "Como autenticar um webhook?" |
| Observabilidade | `telemetry.ts`, `logger.ts` | OTel primeiro, log JSON com redação | "Como rastrear um request entre serviços?" |
| Pool de conexões | `db/pool.ts` | N réplicas x `max` no Postgres | "Como dimensionar o pool?" |
| Transação | `db/pool.ts` (`withTransaction`) | `release` no `finally` | "Vazamento de conexão?" |
| RAG híbrido | `rag/retrieve.ts`, `db/init.sql` | HNSW + GIN + RRF em SQL | "Por que busca híbrida?" |
| Chunking | `rag/chunk.ts` | Tamanho x sobreposição | "O RAG responde mal, o que ajusta?" |
| Provedor de LLM abstrato | `llm/provider.ts`, `fake.ts` | Fake permite testar sem rede nem custo | "Como testar código com LLM?" |
| Tool use | `agent/chat.ts`, `agent/tools.ts` | Loop com `MAX_STEPS`, erro devolvido ao modelo | "Como limitar custo de um agente?" |
| Autorização nas tools | `agent/tools.ts` | `merchantId` vem da sessão, não do modelo | "Como evitar vazamento entre clientes?" |
| Guardrails | `guardrails.ts` | Entrada, saída, e por que segurança não vive no prompt | "Prompt injection: como mitigar?" |
| Cache de prompt, timeout, retry de API | `llm/anthropic.ts` | `cache_control`, `timeout`, `maxRetries` | "Como reduzir custo e latência?" |
| Evals | `evals/` | Taxa de acerto num conjunto fixo | "Como saber se a mudança melhorou?" |
| Docker | `Dockerfile` | Multi-stage, `USER node`, `node` direto para receber SIGTERM | "Por que não `npm start` no CMD?" |
| Kubernetes | `k8s/deployment.yaml` | Probes, requests/limits, rolling update, HPA, preStop | "OOMKilled: por quê?" |

## Roteiro sugerido

1. **Testes primeiro** (sem infra): `npm test`. Leia `retry.test.ts` e quebre algo de propósito.
2. **Depure** um teste com breakpoint (`.vscode/launch.json` já tem a config pronta).
3. **Suba a infra** e faça o fluxo `POST /dev/orders` até a linha no Postgres. Se não funcionar, depure: esse é o exercício.
4. **Mate o consumer no meio** (`Ctrl+C`), republique o mesmo `eventId` e confirme que não duplica.
5. **Force a DLQ**: publique um JSON inválido com `kafka-console-producer` e leia `lab.orders.v1.dlq`.
6. **Quebre o Postgres** (`docker compose stop postgres`) e veja retry, backoff e DLQ.
7. **RAG**: `npm run ingest`, pergunte no chat, depois mude `maxChars` e rode os evals.
8. **LLM real**: `LLM_PROVIDER=anthropic` + chave. Observe `usage` nos logs e o loop de tools.

## Limitações conhecidas (decisões deliberadas de escopo, não bugs)

- Retry dentro do `eachMessage` **bloqueia a partição** enquanto espera. Alternativa: tópicos de retry (`.retry.1`, `.retry.2`).
- Idempotência só em Redis: se o Redis perder a chave, o `UPSERT` ainda protege, mas efeitos externos duplicariam. Alternativa: tabela de eventos processados na mesma transação.
- `merchantId` no body do webhook é só para estudo; em produção vem de token ou identidade verificada do canal.
- Embedding "fake" não é semântico. O adaptador Anthropic não implementa embeddings.
- Sem migrações versionadas (`db/init.sql` só roda na criação do volume). Em produção: Flyway/Knex/Prisma migrate.
- Sem rate limit por lojista nem orçamento de tokens (relevante para custo de LLM).
- `config.ts` valida no import e chama `process.exit`; isso complica testes (veja `vitest.config.ts`).
