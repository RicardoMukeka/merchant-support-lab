import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header('x-request-id') ?? randomUUID();
  res.setHeader('x-request-id', id);
  res.locals.requestId = id;
  next();
}

// Webhook assinado (como WhatsApp/Stripe fazem): HMAC-SHA256 do CORPO CRU.
// Precisa do body cru (ver express.json({ verify }) em app.ts). Comparação em tempo constante.
export function verifySignature(req: Request, res: Response, next: NextFunction) {
  const given = req.header('x-signature') ?? '';
  const expected = createHmac('sha256', config.WEBHOOK_SECRET).update(res.locals.rawBody ?? '').digest('hex');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'assinatura inválida' });
    return;
  }
  next();
}

// Handler de erro central: o cliente nunca recebe stack trace; o log recebe tudo, com o requestId.
// (Express 5 repassa rejeições de handlers async para cá automaticamente; no 4 precisava de try/catch.)
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'requisição inválida', details: err.issues.map((i) => i.path.join('.')) });
    return;
  }
  logger.error({ err, requestId: res.locals.requestId, path: req.path }, 'erro não tratado');
  res.status(500).json({ error: 'erro interno', requestId: res.locals.requestId });
}
