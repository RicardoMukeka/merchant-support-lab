import { describe, it, expect, vi } from 'vitest';
import { runWithRetry, backoffDelay, NonRetryableError, isRetryableStatus } from '../src/kafka/retry.js';

const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 };
const noSleep = async () => {};

describe('runWithRetry', () => {
  it('retorna ok na primeira tentativa', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    expect(await runWithRetry(fn, policy, noSleep)).toEqual({ ok: true, attempts: 1 });
  });

  it('tenta de novo e passa quando a dependência volta', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(undefined);
    expect(await runWithRetry(fn, policy, noSleep)).toEqual({ ok: true, attempts: 2 });
  });

  it('desiste após maxAttempts (vai para a DLQ)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('sempre falha'));
    const out = await runWithRetry(fn, policy, noSleep);
    expect(out.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('NÃO repete erro não retentável', async () => {
    const fn = vi.fn().mockRejectedValue(new NonRetryableError('dado inválido'));
    const out = await runWithRetry(fn, policy, noSleep);
    expect(out).toMatchObject({ ok: false, attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('backoffDelay', () => {
  it('cresce exponencialmente e respeita o teto (jitter fixado em 1)', () => {
    const max = () => 0.999999;
    expect(backoffDelay(1, policy, max)).toBeLessThan(100);
    expect(backoffDelay(3, policy, max)).toBeLessThan(400);
    expect(backoffDelay(10, policy, max)).toBeLessThan(1000);
  });
});

describe('isRetryableStatus (cuidado com `in` vs `.includes()` em array)', () => {
  it.each([500, 502, 503, 504, 429])('%i é retentável', (s) => expect(isRetryableStatus(s)).toBe(true));
  it.each([200, 400, 401, 404, 422])('%i NÃO é retentável', (s) => expect(isRetryableStatus(s)).toBe(false));
  it('demonstra o erro de `in` com array', () => {
    expect(500 in [500, 504]).toBe(false); // `in` testa ÍNDICES
    expect([500, 504].includes(500)).toBe(true);
  });
});
