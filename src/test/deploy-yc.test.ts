import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, test } from 'vitest';

test('web deployment delivers all onboarding media types before the app entry', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dayenglish-deploy-test-'));
  const script = resolve('scripts/deploy-yc.sh').replaceAll('\\', '/');
  const bash =
    process.platform === 'win32'
      ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : 'bash';
  const log = join(temporary, 'commands.log');
  const actual = realpathSync(temporary);
  if (
    !actual.startsWith(realpathSync(tmpdir()) + sep) ||
    !actual.includes('dayenglish-deploy-test-')
  )
    throw new Error('Unexpected fixture cleanup path');
  try {
    mkdirSync(join(temporary, 'dist/onboarding/2026-11-02'), {
      recursive: true,
    });
    for (const name of ['demo.gif', 'demo.png', 'manifest.json'])
      writeFileSync(
        join(temporary, 'dist/onboarding/2026-11-02', name),
        'fixture'
      );
    writeFileSync(join(temporary, 'dist/index.html'), '<html></html>');
    execFileSync(
      bash,
      [
        '-c',
        'aws() { printf "%s\\0" "$@" >> "$QA_UPLOAD_LOG"; printf "\\n" >> "$QA_UPLOAD_LOG"; }; export -f aws; bash "$1"',
        'qa-deploy',
        script,
      ],
      {
        cwd: temporary,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          YC_BUCKET: 'qa-no-cloud',
          AWS_ENDPOINT_URL: 'https://invalid.example',
          QA_UPLOAD_LOG: log.replaceAll('\\', '/'),
        },
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('\0').filter(Boolean));
    const entry = calls.findIndex(
      (args) => args.includes('cp') && args.includes('dist/index.html')
    );
    expect(entry).toBeGreaterThan(-1);
    for (const [extension, mime] of [
      ['gif', 'image/gif'],
      ['png', 'image/png'],
      ['json', 'application/json'],
    ]) {
      const upload = calls.findIndex(
        (args) =>
          args.includes('sync') &&
          args[args.indexOf('--include') + 1] === `onboarding/*.${extension}`
      );
      expect(upload, `Missing ${extension} delivery`).toBeGreaterThan(-1);
      expect(upload).toBeLessThan(entry);
      const args = calls[upload]!;
      expect(args[args.indexOf('--content-type') + 1]).toBe(mime);
      expect(args[args.indexOf('--cache-control') + 1]).toBe('no-cache');
      expect(args).not.toContain('--size-only');
    }
  } finally {
    rmSync(actual, { recursive: true });
  }
});
