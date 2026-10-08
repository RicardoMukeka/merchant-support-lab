// Guardrails simples, de entrada e de saída. Não substituem moderação real, mas mostram ONDE ficam.
// Regra de ouro: segurança NÃO vive no prompt ("não revele dados"), vive no código (autorização nas tools).

const MAX_INPUT_CHARS = 2000;

// Padrões grosseiros de injeção de prompt. Detectar é só uma camada; o que protege de verdade
// é a tool só enxergar dados do lojista da sessão (ver agent/tools.ts).
const INJECTION = [/ignore (all|as) (previous|anteriores)/i, /ignore.*instru[cç][õo]es/i, /system prompt/i, /voc[êe] agora é/i];

export function checkInput(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: 'mensagem vazia' };
  if (t.length > MAX_INPUT_CHARS) return { ok: false, reason: 'mensagem muito longa' };
  if (INJECTION.some((re) => re.test(t))) return { ok: false, reason: 'possível injeção de prompt' };
  return { ok: true, text: t };
}

// Saída: mascara dados que NUNCA devem sair num chat (PII/financeiro), mesmo que o modelo erre.
export function sanitizeOutput(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]') // CPF
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARTÃO]'); // número de cartão (aproximado)
}
