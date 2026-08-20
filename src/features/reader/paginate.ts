import type { Chapter } from './parse';

/** A chapter longer than this mounts too many WordToken components at once (perf/OOM on mobile),
 *  so BookView paginates it. ~12k chars ≈ a few minutes of reading. */
export const MAX_CHAPTER_CHARS = 12_000;

function splitText(text: string, maxChars: number): string[] {
  const paras = text.split(/\n{2,}/);
  const parts: string[] = [];
  let buf: string[] = [];
  let len = 0;
  const flush = () => {
    if (buf.length) parts.push(buf.join('\n\n'));
    buf = [];
    len = 0;
  };
  for (const p of paras) {
    if (len > 0 && len + p.length > maxChars) flush();
    buf.push(p);
    len += p.length + 2;
  }
  flush();
  return parts;
}

/** Split any oversized chapter into sub-chapters on paragraph boundaries, so a single render
 *  never mounts tens of thousands of word tokens. Short chapters pass through untouched. */
export function paginateChapters(chapters: Chapter[], maxChars = MAX_CHAPTER_CHARS): Chapter[] {
  const out: Chapter[] = [];
  for (const ch of chapters) {
    if (ch.text.length <= maxChars) {
      out.push(ch);
      continue;
    }
    const parts = splitText(ch.text, maxChars);
    parts.forEach((text, i) => {
      out.push({
        id: `${ch.id}#${i + 1}`,
        title: ch.title ? `${ch.title} · ${i + 1}/${parts.length}` : undefined,
        text,
      });
    });
  }
  return out;
}
