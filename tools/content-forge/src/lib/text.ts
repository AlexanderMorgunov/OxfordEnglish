export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

export function uniqueWords(text: string): string[] {
  return [...new Set(tokenize(text))];
}
