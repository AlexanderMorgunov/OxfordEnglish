export type BookFormat = 'epub' | 'fb2' | 'docx' | 'pdf';

export type Chapter = {
  /** Stable id within the book (spine index or section index). */
  id: string;
  title?: string;
  /** Plain reading text, paragraphs separated by blank lines. */
  text: string;
};

export type ParsedBook = {
  title: string;
  author?: string;
  chapters: Chapter[];
};
