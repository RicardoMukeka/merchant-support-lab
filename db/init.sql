CREATE EXTENSION IF NOT EXISTS vector;

-- Base de conhecimento para o RAG (FAQ de lojistas, por exemplo)
CREATE TABLE IF NOT EXISTS documents (
  id         BIGSERIAL PRIMARY KEY,
  source     TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id          BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position    INT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(256) NOT NULL,                 -- dimensão = EMBEDDING_DIM
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  UNIQUE (document_id, position)
);

-- Busca semântica aproximada (HNSW) e busca por palavra-chave (GIN)
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_tsv_gin ON chunks USING gin (tsv);

-- Pedidos (alimentados pelo consumer Kafka). order_id UNIQUE garante idempotência no banco.
CREATE TABLE IF NOT EXISTS orders (
  order_id    TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  status      TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mensagens de conversa (histórico + auditoria do que a IA respondeu)
CREATE TABLE IF NOT EXISTS conversations (
  id          BIGSERIAL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_merchant ON conversations (merchant_id, created_at);
