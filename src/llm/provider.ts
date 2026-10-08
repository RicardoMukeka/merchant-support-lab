// Interface do provedor: o resto do código NÃO conhece o SDK. Trocar de modelo/provedor
// (ou usar um fake nos testes) é mudar uma linha em factory. Equivale a uma interface + @Bean no Spring.

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other';
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse>;
  embed(texts: string[]): Promise<number[][]>;
}
