import { pool, toVector } from '../db/pool.js';
import { llm } from '../llm/index.js';

export interface Hit {
  id: number;
  content: string;
  score: number;
}

// Reciprocal Rank Fusion em TypeScript puro (testável). O SQL abaixo faz o mesmo no banco.
// score = soma de 1/(k + posição) em cada lista. k=60 é o valor clássico.
export function rrf(lists: number[][], k = 60): Map<number, number> {
  const scores = new Map<number, number>();
  for (const ids of lists) {
    ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

// Busca HÍBRIDA: semântica (vetor, acha "sinônimos") + lexical (palavra-chave, acha termos exatos
// como "chargeback" ou um código de erro). Juntar as duas com RRF costuma vencer cada uma sozinha.
const HYBRID_SQL = `
WITH sem AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS r
  FROM chunks ORDER BY embedding <=> $1::vector LIMIT 20
),
lex AS (
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv, q) DESC) AS r
  FROM chunks c, plainto_tsquery('portuguese', $2) q
  WHERE c.tsv @@ q ORDER BY ts_rank_cd(c.tsv, q) DESC LIMIT 20
)
SELECT c.id, c.content,
       COALESCE(1.0 / (60 + sem.r), 0) + COALESCE(1.0 / (60 + lex.r), 0) AS score
FROM chunks c
LEFT JOIN sem ON sem.id = c.id
LEFT JOIN lex ON lex.id = c.id
WHERE sem.id IS NOT NULL OR lex.id IS NOT NULL
ORDER BY score DESC
LIMIT $3`;

export async function hybridSearch(query: string, limit = 4): Promise<Hit[]> {
  const [embedding] = await llm.embed([query]);
  if (!embedding) return [];
  const { rows } = await pool.query(HYBRID_SQL, [toVector(embedding), query, limit]);
  return rows.map((r) => ({ id: Number(r.id), content: r.content as string, score: Number(r.score) }));
}
