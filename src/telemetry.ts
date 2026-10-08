// IMPORTANTE: este arquivo precisa ser o PRIMEIRO import do processo (src/server.ts), antes do
// express/pg/kafkajs, para a auto-instrumentação conseguir "embrulhar" essas libs.
// Com ESM, o mais robusto é `node --import ./dist/telemetry.js`; aqui mantemos simples.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return; // vazio = desligado (testes, CI)

  sdk = new NodeSDK({
    serviceName: 'merchant-support-lab',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  sdk.start();
}

// Chamado no shutdown para não perder spans que ainda estão no buffer.
export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
