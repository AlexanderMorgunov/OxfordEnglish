import { toSentences } from '@/features/reader/parse/text';

export const utf8Size = (text: string): number => new TextEncoder().encode(text).length;

export function translationChunks(text: string, maxBytes = 500): string[] {
  const chunks: string[] = [];
  let buffer = '';
  for (const sentence of toSentences(text)) {
    const combined = buffer ? `${buffer} ${sentence}` : sentence;
    if (utf8Size(combined) <= maxBytes) { buffer = combined; continue; }
    if (buffer) { chunks.push(buffer); buffer = ''; }
    let remaining = sentence;
    while (utf8Size(remaining) > maxBytes) {
      let end = 0;
      let bytes = 0;
      let space = 0;
      for (const char of remaining) {
        const size = utf8Size(char);
        if (bytes + size > maxBytes) break;
        bytes += size;
        end += char.length;
        if (/\s/.test(char)) space = end;
      }
      if (!end) throw new Error('Translation byte budget too small');
      const cut = space || end;
      const part = remaining.slice(0, cut).trim();
      if (part) chunks.push(part);
      remaining = remaining.slice(cut).trimStart();
    }
    buffer = remaining;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}
