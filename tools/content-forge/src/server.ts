import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { tatoebaSearch } from './lib/tatoeba.ts';
import { dictLookup } from './lib/dictionary.ts';
import { cefrjLevel, levelCheck, ngslRank } from './lib/level.ts';
import { openverseSearch, voaList, librivoxSearch } from './lib/sources.ts';
import { storybookSearch, storybookFetch } from './lib/storybooks.ts';
import { ttsSynthesize } from './lib/tts.ts';
import { writeDay } from './lib/writer.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: `ERROR: ${message}` }],
  isError: true,
});
const guard = <T>(fn: () => T) => {
  try {
    return ok(fn());
  } catch (e) {
    return fail((e as Error).message);
  }
};
const guardAsync = async <T>(fn: () => Promise<T>) => {
  try {
    return ok(await fn());
  } catch (e) {
    return fail((e as Error).message);
  }
};

const server = new McpServer({ name: 'content-forge', version: '0.1.0' });

server.tool(
  'tatoeba_search',
  'Search local Tatoeba sentences (EN + optional RU + audio), each carrying its own license. ' +
    'Audio licensing is per-contributor and checked, not assumed from the text license.',
  {
    query: z.string().optional(),
    maxNgslRank: z.number().int().positive().optional(),
    requireRussian: z.boolean().default(true),
    requireAudio: z.boolean().default(false),
    maxWords: z.number().int().positive().default(14),
    limit: z.number().int().positive().max(100).default(20),
  },
  async (args) => guard(() => tatoebaSearch(args))
);

server.tool(
  'dict_lookup',
  'Look up a word (IPA, senses, pronunciation audio) from the local kaikki/Wiktextract dictionary. ' +
    'CC BY-SA — ShareAlike is carried forward.',
  { word: z.string() },
  async ({ word }) => guard(() => dictLookup(word) ?? { note: `no entry for "${word}"` })
);

server.tool(
  'level_check',
  'Check whether a text fits a CEFR level. Returns offending words (frequency rank + CEFR-J tag) ' +
    'so the caller rewrites instead of guessing. A2 ≈ rank under 1500, B1 ≈ under 2800.',
  { text: z.string(), maxRank: z.number().int().positive().default(1500) },
  async ({ text, maxRank }) => guard(() => levelCheck(text, maxRank))
);

server.tool(
  'ngsl_rank',
  'Return the frequency rank and CEFR-J level of each word — a level probe for any vocabulary set.',
  { words: z.array(z.string()) },
  async ({ words }) =>
    guard(() =>
      words.map((word) => ({ word, rank: ngslRank(word), cefr: cefrjLevel(word) }))
    )
);

server.tool(
  'image_search',
  'Search openly-licensed images on Openverse (anonymous). Returns URLs with a ready ' +
    'attribution string; defaults to cc0/by so downstream use stays unencumbered.',
  {
    query: z.string(),
    license: z.string().default('cc0,by'),
    limit: z.number().int().positive().max(20).default(6),
  },
  async (args) => guardAsync(() => openverseSearch(args))
);

server.tool(
  'voa_list',
  'List recent VOA Learning English items from an RSS feed (public domain; credit ' +
    'learningenglish.voanews.com). Returns title, link, audio URL, each licensed.',
  {
    feedUrl: z.string().url(),
    limit: z.number().int().positive().max(30).default(10),
  },
  async (args) => guardAsync(() => voaList(args))
);

server.tool(
  'librivox_search',
  'Search LibriVox public-domain audiobooks (JSON API). Pair with level_check to pick ' +
    'suitable excerpts for extended listening.',
  {
    title: z.string().optional(),
    limit: z.number().int().positive().max(20).default(5),
  },
  async (args) => guardAsync(() => librivoxSearch(args))
);

server.tool(
  'storybook_search',
  'Search openly-licensed leveled English stories (African Storybook / global-asp). ' +
    'Returns story paths + titles; fetch one with storybook_fetch.',
  { query: z.string().optional(), limit: z.number().int().positive().max(30).default(15) },
  async (args) => guardAsync(() => storybookSearch(args))
);

server.tool(
  'storybook_fetch',
  'Fetch one story: title, pages, author, and a stitched license. Refuses ' +
    'non-redistributable (NC/ND) titles. Adapt pages into reading blocks; author ' +
    'grammar + exercises on top.',
  { path: z.string() },
  async ({ path }) => guardAsync(() => storybookFetch(path))
);

server.tool(
  'tts_synthesize',
  'Generate American-English speech (Piper, local) for our OWN text — writes a WAV into ' +
    'the pack and returns a MediaRef src with license "original". Use for listening scripts, ' +
    'reading-block audio, and dictation phrases.',
  {
    text: z.string(),
    filename: z.string().regex(/^[a-z0-9_.-]+$/, 'lowercase slug, no extension').optional(),
  },
  async (args) => guard(() => ttsSynthesize(args))
);

server.tool(
  'pack_write_day',
  'Write an assembled day into the public pack. Validates against the app schema (structure, ' +
    'media licenses, SkillTag registry) and REFUSES local-only licenses or missing attribution.',
  {
    dayJson: z.string(),
    filename: z.string().regex(/^u\d+\.d\d+\.json$/, 'expected uXX.dYY.json'),
  },
  async ({ dayJson, filename }) => guardAsync(() => writeDay(dayJson, filename))
);

server.tool(
  'pack_validate',
  'Run the pack validator (npm run validate:packs) over the whole pack.',
  {},
  async () =>
    guard(() => {
      const r = spawnSync('npm', ['run', 'validate:packs'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
      return { code: r.status, stdout: r.stdout?.trim(), stderr: r.stderr?.trim() };
    })
);

await server.connect(new StdioServerTransport());
