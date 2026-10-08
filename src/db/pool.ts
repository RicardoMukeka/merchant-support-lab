import pg from 'pg';
import { config } from '../config.js';

// Pool compartilhado. max pequeno de propósito: em K8s com N réplicas, N * max conexões
// chegam no Postgres (RDS tem limite). Pergunta clássica: "como dimensionar o pool?".
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// pgvector recebe o vetor como texto '[0.1,0.2,...]'
export const toVector = (v: number[]): string => `[${v.join(',')}]`;

export async function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // sem isso o pool esgota e a API "trava" (vazamento de conexão)
  }
}
