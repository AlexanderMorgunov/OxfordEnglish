export const splitParas = (text: string) => text.split(/\n{2,}/).filter(Boolean);

export const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** Word offsets over a book's paginated pages — the basis for a reading-progress fraction. */
export type BookIndex = { pageStart: number[]; paraStart: number[][]; total: number };

export function buildBookIndex(pages: { text: string }[]): BookIndex {
  const pageStart: number[] = [];
  const paraStart: number[][] = [];
  let total = 0;
  for (const page of pages) {
    pageStart.push(total);
    const starts: number[] = [];
    for (const para of splitParas(page.text)) {
      starts.push(total);
      total += countWords(para);
    }
    paraStart.push(starts);
  }
  return { pageStart, paraStart, total };
}

/** Share of the book (0–1) before a position; `wordsIn` counts words already into the paragraph. */
export function positionOf(index: BookIndex, page: number, paragraph: number, wordsIn = 0): number {
  if (index.total === 0) return 0;
  const start = index.paraStart[page]?.[paragraph] ?? index.pageStart[page] ?? 0;
  return Math.min(1, Math.max(0, (start + wordsIn) / index.total));
}
