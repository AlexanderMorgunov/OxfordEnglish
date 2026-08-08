import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// lib -> src -> tool root. Resolving from the module (not cwd) lets the MCP
// server find its data no matter where the host launches it from.
const TOOL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const dataPath = (file: string) => join(TOOL_ROOT, 'data', file);

export const CACHE_DIR = process.env.CACHE_DIR ?? join(TOOL_ROOT, '.cache');
export const TATOEBA_DB = process.env.TATOEBA_DB ?? dataPath('tatoeba.sqlite');
export const DICTIONARY_DB = process.env.DICTIONARY_DB ?? dataPath('dictionary.sqlite');
export const WORDLISTS_PATH = process.env.WORDLISTS_PATH ?? dataPath('wordlists.json');
