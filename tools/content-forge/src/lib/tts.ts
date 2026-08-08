import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIPER_BIN, PIPER_VOICE } from './paths.ts';
import { ORIGINAL, type LicenseInfo } from './license.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PACK_ROOT =
  process.env.PACK_ROOT ?? join(REPO_ROOT, 'public/packs/dev-english-a2');

/**
 * Synthesize American-English speech for our own text with Piper (local, MIT).
 * Writes a WAV into the pack's media/audio and returns a MediaRef src + license
 * "original" (the text is ours). No provenance question — this is generated audio.
 */
export function ttsSynthesize(opts: {
  text: string;
  filename?: string;
}): { src: string; license: LicenseInfo; bytes: number } {
  if (!existsSync(PIPER_BIN)) {
    throw new Error(
      `Piper binary not found at ${PIPER_BIN} — install it (see tools/content-forge/README.md) or set PIPER_BIN.`
    );
  }
  if (!existsSync(PIPER_VOICE)) {
    throw new Error(`Piper voice not found at ${PIPER_VOICE} — set PIPER_VOICE.`);
  }

  const base =
    opts.filename ?? createHash('sha256').update(opts.text).digest('hex').slice(0, 16);
  const rel = `media/audio/${base}.wav`;
  const abs = join(PACK_ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });

  const result = spawnSync(PIPER_BIN, ['--model', PIPER_VOICE, '--output_file', abs], {
    input: opts.text,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !existsSync(abs)) {
    throw new Error(
      `Piper failed: ${result.stderr?.trim() || result.error?.message || 'unknown error'}`
    );
  }

  return { src: rel, license: ORIGINAL, bytes: statSync(abs).size };
}
