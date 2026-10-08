# Rodando e debugando o `merchant-support-lab` localmente

Este guia assume **Colima** (não Docker Desktop) e `nvm` disponíveis. Nenhuma instalação de Postgres, Kafka, Redis ou SQS é necessária na máquina — tudo roda em containers via `docker-compose.yml`, numa VM Linux leve que o Colima gerencia.

## -1. Arquitetura: onde os containers realmente rodam

```
seu Mac (host)
  └─ Colima → VM Linux leve (driver "vz")
       └─ dentro da VM: o daemon Docker de verdade
            └─ dentro do Docker: os 5 containers (postgres, kafka, redis, localstack, jaeger)
```

Por isso `postgres`/`kafka` **não aparecem** como processo nativo no Mac (`ps aux`, Activity Monitor) — rodam dentro do Linux da VM. O que faz tudo parecer local é o **port forwarding**: o Colima redireciona as portas do host (`localhost:5432`, etc.) pra dentro da VM, até o container. É por isso que `DATABASE_URL=postgres://lab:lab@localhost:5432/lab` funciona normalmente no `.env`.

### Dois ajustes de ambiente necessários nesta máquina

1. **`docker compose` (v2, sem hífen) não existia** — só o `docker-compose` (v1, com hífen) do Homebrew. Resolvido com um symlink, uma vez só:
   ```bash
   mkdir -p ~/.docker/cli-plugins
   ln -sf /opt/homebrew/bin/docker-compose ~/.docker/cli-plugins/docker-compose
   ```
2. **Porta 6379 do Redis já estava ocupada** por um `redis-server` local (Homebrew, outro projeto). Em vez de parar esse serviço, o `docker-compose.yml` deste projeto mapeia o Redis pra **6380** no host:
   ```yaml
   redis:
     ports: ["6380:6379"]  # host:container — 6379 já em uso localmente
   ```
   E o `.env` reflete isso: `REDIS_URL=redis://localhost:6380`. (O `vitest.config.ts` dos testes unitários usa `6379` fixo só pro ambiente de teste — não depende do container, não precisa mudar.)

## 0. Por que não preciso instalar banco nenhum

```yaml
# docker-compose.yml
postgres:
  image: pgvector/pgvector:pg16          # Postgres + extensão pgvector já compilada
  environment:
    POSTGRES_USER: lab
    POSTGRES_PASSWORD: lab
    POSTGRES_DB: lab                     # cria o banco "lab" no primeiro boot
  volumes:
    - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
```

- A imagem já cria o usuário/banco a partir das variáveis de ambiente.
- Qualquer `.sql` montado em `/docker-entrypoint-initdb.d/` roda automaticamente **na primeira criação do volume** — é assim que `db/init.sql` cria as tabelas (`orders`, `chunks`, `documents`, `conversations`) e os índices (`hnsw`, `gin`).
- ⚠️ Isso só executa **uma vez**. Se mudar `init.sql` depois de já ter subido o container, é preciso `npm run infra:down` (remove o volume com `-v`) e subir de novo — não existe migração versionada aqui (limitação conhecida, de propósito).

O mesmo vale para Kafka (modo KRaft, sem Zookeeper), Redis e LocalStack (simula SQS): tudo container, nada instalado no host.

## 1. Pré-requisitos

```bash
git clone <url-do-repo> && cd merchant-support-lab
nvm use 23                 # projeto exige Node >=22; tsx --env-file precisa de 20.6+
cp .env.example .env        # valores de dev já prontos (LLM_PROVIDER=fake funciona sem chave)
npm install                 # só se node_modules não existir ainda
```

Suba o daemon do Colima antes do próximo passo (precisa estar rodando):

```bash
colima start                # ~20-40s na primeira vez; "colima status" confirma
```

## 2. Subir a infraestrutura

```bash
npm run infra:up            # docker compose up -d
docker compose ps           # confirma os 5 containers "Up": kafka, postgres, redis, localstack, jaeger
docker compose logs -f kafka   # Ctrl+C quando aparecer "started (kafka.server.KafkaServer)"
```

Serviços expostos:

| Serviço | Porta (host) | Pra quê |
|---|---|---|
| Kafka | 9092 | tópicos `lab.orders.v1` e `.dlq` |
| Postgres | 5432 | `orders`, `chunks`, `documents`, `conversations` (pgvector) |
| Redis | **6380** → 6379 no container | idempotência (`claim`/`release`) — remapeado, ver seção -1 |
| LocalStack | 4566 | SQS (`lab-messages`, `lab-messages-dlq`) |
| Jaeger UI | 16686 | traces (http://localhost:16686) |

## 3. Ingerir a base de conhecimento (RAG)

```bash
npm run ingest   # lê knowledge/*.md (maquininha.md, repasse.md), gera embeddings e grava os chunks
```

Reexecutável: substitui os chunks do documento inteiro numa transação, não duplica.

### O que o ingest grava (exemplo real, `knowledge/maquininha.md` + `repasse.md`)

```
documents                              chunks
┌────┬───────────────┐                 ┌────┬─────────────┬─────┬───────┬──────┐
│ id │ source        │                 │ id │ document_id │ pos │ chars │ dims │
├────┼───────────────┤                 ├────┼─────────────┼─────┼───────┼──────┤
│ 1  │ maquininha.md │                 │ 1  │ 1           │ 0   │ 521   │ 256  │
│ 2  │ repasse.md    │                 │ 2  │ 2           │ 0   │ 530   │ 256  │
└────┴───────────────┘                 │ 3  │ 2           │ 1   │ 281   │ 256  │
                                        └────┴─────────────┴─────┴───────┴──────┘
```

`repasse.md` virou 2 chunks porque passa do `maxChars` (600) — o chunk `pos=1` começa repetindo os últimos 80 caracteres do `pos=0` (o `overlap`, de `chunkText` em `src/rag/chunk.ts`), pra nenhuma resposta perder contexto na fronteira entre chunks. `embedding` é `vector(256)`: com `LLM_PROVIDER=fake`, cada palavra do chunk cai num índice via hash MD5 (`fakeEmbed` em `src/llm/fake.ts`) — não é semântico de verdade, mas exercita pgvector/HNSW igual um embedding real exerceria.

### Consultando o banco direto (sem instalar `psql` no Mac)

Sem cliente Postgres instalado localmente, o jeito mais simples é abrir um `psql` **dentro do próprio container**:

```bash
docker exec -it merchant-support-lab-postgres-1 psql -U lab -d lab
```

Dentro do prompt `lab=#`:

```sql
\dt                                         -- lista as tabelas
\d chunks                                   -- schema da tabela (colunas, tipos, índices)

select * from documents;
select id, document_id, position, left(content, 60) from chunks;
select id, left(embedding::text, 60) from chunks;  -- vector NÃO suporta [1:5]: não é array nativo, é tipo escalar do pgvector

\q
```

Ou direto do terminal do Mac, sem entrar no modo interativo:

```bash
docker exec merchant-support-lab-postgres-1 \
  psql -U lab -d lab -c "select source, count(*) from documents d join chunks c on c.document_id = d.id group by source;"
```

## 4. Subir a API

```bash
npm run dev      # tsx watch --env-file=.env src/server.ts — API em :3000, recarrega sozinho
```

`LLM_PROVIDER=fake` (padrão do `.env.example`) funciona sem nenhuma chave de API.

## 5. Debugar com breakpoint no VS Code

O projeto já tem `.vscode/launch.json` configurado. Não precisa montar nada manualmente:

1. Abra o arquivo que quer inspecionar e coloque um breakpoint:
   - **Fluxo de pedidos (Kafka):** `src/kafka/orders-consumer.ts`, dentro do `handle:` (linha do `upsertOrder`).
   - **Fluxo de chat (agente/RAG):** `src/agent/chat.ts`, dentro do loop `for (let step = 1; ...)`, ou em `src/agent/tools.ts`.
2. Abra **Run and Debug** (`Cmd+Shift+D`) e escolha **"lab: API (tsx)"** no dropdown.
3. `F5`. Isso sobe a API **e** o consumer Kafka no mesmo processo (ambos vivem em `server.ts`).
4. Dispare o evento que vai acionar o breakpoint (próximos passos) em outro terminal.

Outras configurações já prontas: **"lab: Worker SQS"** (debuga `src/worker.ts` isoladamente), **"lab: Vitest (arquivo atual)"** (debuga o teste aberto no editor — precisa estar com essa aba em foco no momento do `F5`) e **"lab: Ingest (RAG)"** (debuga `src/rag/ingest.ts`; breakpoints úteis: linha 16 pra ver `chunks.length` por arquivo, linha 17 pra inspecionar o embedding gerado, linha 21-24 pro `docId` retornado, linha 26 pro `DELETE` que torna a reingestão idempotente).

Todas as configs usam `runtimeVersion: "23"` — o debugger resolve a versão certa do Node via `nvm` sozinho, não depende de `nvm use` já estar ativo no terminal integrado no momento do `F5`.

## 6. Disparar o fluxo de pedidos (Kafka → Postgres)

```bash
curl -X POST localhost:3000/dev/orders -H 'content-type: application/json' -d '{
  "eventId":"3f2b8c1e-9d4a-4e6b-8a57-1c2d3e4f5a6b","orderId":"o-1","merchantId":"m-1",
  "status":"PAID","amountCents":15990,"occurredAt":"2026-10-08T12:00:00.000Z"}'
```

Com o breakpoint do passo 5 ativo, o VS Code para dentro do `handle:` — dá pra inspecionar `parsed`, dar *step over* no `upsertOrder`, ver a chamada ao `claim()` do Redis antes dele.

Confirmar no banco:

```bash
docker compose exec postgres psql -U lab -d lab -c "SELECT * FROM orders;"
```

## 7. Testar idempotência e DLQ

```bash
# repete o MESMO eventId -> não duplica (claim no Redis bloqueia o reprocesso)
curl -X POST localhost:3000/dev/orders -H 'content-type: application/json' -d '{
  "eventId":"3f2b8c1e-9d4a-4e6b-8a57-1c2d3e4f5a6b","orderId":"o-1","merchantId":"m-1",
  "status":"PAID","amountCents":15990,"occurredAt":"2026-10-08T12:00:00.000Z"}'

# força a DLQ: status fora do enum do Zod -> falha no parse, vai direto pra DLQ (poison pill)
curl -X POST localhost:3000/dev/orders -H 'content-type: application/json' -d '{
  "eventId":"4a3c9d2f-0e5b-5f7c-9b68-2d3e4f5a6b7c","orderId":"o-2","merchantId":"m-1",
  "status":"INVALIDO","amountCents":100,"occurredAt":"2026-10-08T12:00:00.000Z"}'

# ler a DLQ dentro do container do Kafka
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 --topic lab.orders.v1.dlq --from-beginning
```

## 8. Disparar o fluxo de chat (agente + RAG)

```bash
BODY='{"merchantId":"m-1","text":"Em quanto tempo recebo as vendas no débito?"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "troque-me" | sed 's/^.* //')
curl -X POST localhost:3000/webhook/chat -H 'content-type: application/json' -H "x-signature: $SIG" -d "$BODY"
```

Com breakpoint em `agent/chat.ts`, dá pra ver o loop pedir a tool `buscar_conhecimento`, a busca híbrida rodar no Postgres, e a segunda chamada ao LLM já com o `tool_result` anexado.

## 9. Medir qualidade das respostas (eval)

```bash
python3 evals/run_evals.py   # chama a API de fora, assinando HMAC como um provedor faria
```

## 10. Testes unitários (sem precisar de nenhum container)

```bash
npm test                     # vitest run — retry, backoff, RRF, chunking, guardrails
```

## 11. Encerrar e limpar

```bash
npm run infra:down           # docker compose down -v — remove containers E volumes (banco zera)
```

## Checklist de exercícios (ordem sugerida)

- [ ] `npm test` sem infra nenhuma — leia `test/retry.test.ts` e quebre algo de propósito.
- [ ] Suba a infra, faça `POST /dev/orders` até a linha aparecer no Postgres.
- [ ] Mate o consumer no meio (`Ctrl+C` no debug), republique o mesmo `eventId`, confirme que não duplicou.
- [ ] Force a DLQ com um payload inválido e leia o tópico `.dlq`.
- [ ] Pare o Postgres (`docker compose stop postgres`) com a API no ar e observe retry → backoff → DLQ.
- [ ] Rode o eval, mude `maxChars` em `src/rag/chunk.ts`, rode o eval de novo e compare a taxa.
- [ ] Troque para `LLM_PROVIDER=anthropic` com uma chave real e observe o `usage` nos logs.
