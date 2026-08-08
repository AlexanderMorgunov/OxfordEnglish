export type LicenseType =
  | 'CC0'
  | 'CC-BY'
  | 'CC-BY-SA'
  | 'public-domain'
  | 'original'
  | 'local-only';

export type LicenseInfo = {
  type: LicenseType;
  attribution?: string;
  sourceUrl?: string;
};

/** License stamped on anything we generate ourselves (LLM prose, TTS audio). */
export const ORIGINAL: LicenseInfo = {
  type: 'original',
  attribution: 'Project authors (LLM-assisted)',
};
