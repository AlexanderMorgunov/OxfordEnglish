import type { Snapshot } from './snapshot';

async function pipe(bytes: Uint8Array, transform: 'gzip' | 'gunzip'): Promise<Uint8Array> {
  const stream =
    transform === 'gzip' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // Fire-and-forget the write/close so the reader below can drain concurrently (awaiting here would
  // deadlock on a transform stream's backpressure). Blob.stream()/Response aren't used — jsdom lacks them.
  void writer.write(bytes);
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode a snapshot to a URL-fragment string: `<len>.<base64url(gzip(json))>`. The length prefix
 *  lets the receiver detect a browser-truncated fragment and refuse a partial import. */
export async function encodeSnapshot(s: Snapshot): Promise<string> {
  const json = JSON.stringify(s);
  const gz = await pipe(new TextEncoder().encode(json), 'gzip');
  const b64 = toB64url(gz);
  return `${b64.length}.${b64}`;
}

/** Decode `encodeSnapshot`'s output. Throws on a truncated fragment (length mismatch) so the caller
 *  can fall back to the manual file transfer instead of importing partial data. */
export async function decodeSnapshot(fragment: string): Promise<Snapshot> {
  const dot = fragment.indexOf('.');
  if (dot <= 0) throw new Error('migration: malformed payload');
  const expectedLen = Number(fragment.slice(0, dot));
  const b64 = fragment.slice(dot + 1);
  if (!Number.isFinite(expectedLen) || b64.length !== expectedLen) {
    throw new Error('migration: payload truncated');
  }
  const json = new TextDecoder().decode(await pipe(fromB64url(b64), 'gunzip'));
  return JSON.parse(json) as Snapshot;
}
