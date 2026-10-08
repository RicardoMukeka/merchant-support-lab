import pino from 'pino';
import { config } from './config.js';

// Log estruturado (JSON) com redação de campos sensíveis.
// Em produção, o agregador (Datadog/Loki/CloudWatch) indexa por campo, não por regex em texto.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers["x-signature"]', '*.password', '*.apiKey'],
  base: { service: 'merchant-support-lab' },
});
