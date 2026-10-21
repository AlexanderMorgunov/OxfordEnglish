const KEY = 'oxford-session-diagnostics';
const LIMIT = 20;
const EVENTS = ['session_present', 'session_absent', 'storage_invalid', 'storage_read_failed', 'storage_write_failed', 'authenticated', 'signed_out', 'refresh_invalid', 'refresh_reused', 'refresh_network', 'refresh_failed'] as const;

export type SessionEvent = typeof EVENTS[number];
export type SessionDiagnostic = { event: SessionEvent; time: number; build: string };

export function sessionDiagnostics(): SessionDiagnostic[] {
  try {
    const raw = localStorage.getItem(KEY) ?? '[]';
    if (raw.length > 16_384) return [];
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.slice(-LIMIT).filter((row): row is SessionDiagnostic =>
      typeof row === 'object' && row !== null &&
      EVENTS.includes(row.event) && Number.isFinite(row.time) &&
      typeof row.build === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(row.build)
    ).slice(-LIMIT).map(({ event, time, build }) => ({ event, time, build }));
  } catch {
    return [];
  }
}

export function recordSessionEvent(event: SessionEvent): void {
  if (!EVENTS.includes(event)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...sessionDiagnostics(), {
      event, time: Date.now(), build: __APP_VERSION__,
    }].slice(-LIMIT)));
  } catch {
    // Diagnostics must never interfere with credential persistence or sign-out.
  }
}

export function sessionRejectionReason(): 'refresh_invalid' | 'refresh_reused' | null {
  for (const { event } of sessionDiagnostics().reverse()) {
    if (event === 'authenticated' || event === 'signed_out') return null;
    if (event === 'refresh_invalid' || event === 'refresh_reused') return event;
  }
  return null;
}
