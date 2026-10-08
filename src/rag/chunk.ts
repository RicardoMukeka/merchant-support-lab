// Chunking por parágrafos com tamanho máximo e sobreposição.
// Por que importa: chunk grande dilui a relevância; chunk pequeno perde contexto. É o primeiro
// parâmetro que você ajusta quando o RAG responde mal, e deve ser medido com evals (evals/).
export function chunkText(text: string, maxChars = 600, overlap = 80): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxChars && current) {
      chunks.push(current);
      current = current.slice(-overlap) + '\n\n' + p; // repete o final do anterior
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
