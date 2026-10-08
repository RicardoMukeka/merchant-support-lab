// Lógica de retry/DLQ SEPARADA do kafkajs para ser testável sem broker (ver test/retry.test.ts).
// Retry imediato (sem backoff) e DLQ ausente são erros comuns em consumers Kafka de produção.

export class NonRetryableError extends Error {
  override name = 'NonRetryableError';
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

// Backoff exponencial com "full jitter": evita todos os consumers re-tentando no mesmo milissegundo
// (thundering herd) quando uma dependência volta.
export function backoffDelay(attempt: number, p: RetryPolicy, rand: () => number = Math.random): number {
  const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(rand() * exp);
}

export type Outcome = { ok: true; attempts: number } | { ok: false; attempts: number; error: unknown };

export async function runWithRetry(
  fn: () => Promise<void>,
  policy: RetryPolicy,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  rand: () => number = Math.random,
): Promise<Outcome> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      await fn();
      return { ok: true, attempts: attempt };
    } catch (error) {
      // Erro de dado (JSON inválido, regra de negócio): repetir não adianta, vai direto para a DLQ.
      if (error instanceof NonRetryableError || attempt === policy.maxAttempts) {
        return { ok: false, attempts: attempt, error };
      }
      await sleep(backoffDelay(attempt, policy, rand));
    }
  }
  return { ok: false, attempts: policy.maxAttempts, error: new Error('unreachable') };
}

// Classifica status HTTP retentável. Usar `in` em vez de `.includes()` num array é um erro clássico
// aqui: `500 in [500, 504]` testa ÍNDICE, não valor (ver test/retry.test.ts).
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
export const isRetryableStatus = (status: number): boolean => RETRYABLE.has(status);
