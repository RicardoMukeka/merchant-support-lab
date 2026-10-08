import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool, toVector, withTransaction } from '../db/pool.js';
import { llm } from '../llm/index.js';
import { chunkText } from './chunk.js';
import { logger } from '../logger.js';

// Ingestão: lê .md de ./knowledge, quebra em chunks, gera embeddings e grava.
// Reexecutável (idempotente): substitui os chunks do documento inteiro numa transação.
const DIR = join(process.cwd(), 'knowledge');

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const text = await readFile(join(DIR, file), 'utf8');
    const chunks = chunkText(text);
    const embeddings = await llm.embed(chunks); // 1 chamada em lote, não N chamadas

    await withTransaction(async (c) => {
      const doc = await c.query(
        `INSERT INTO documents (source, title) VALUES ($1, $2)
         ON CONFLICT (source) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
        [file, file.replace('.md', '')],
      );
      const docId = doc.rows[0].id as number;
      await c.query('DELETE FROM chunks WHERE document_id = $1', [docId]);
      for (const [i, content] of chunks.entries()) {
        await c.query(`INSERT INTO chunks (document_id, position, content, embedding) VALUES ($1,$2,$3,$4)`, [
          docId,
          i,
          content,
          toVector(embeddings[i]!),
        ]);
      }
    });
    logger.info({ file, chunks: chunks.length }, 'documento ingerido');
  }
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, 'falha na ingestão');
  process.exit(1);
});
