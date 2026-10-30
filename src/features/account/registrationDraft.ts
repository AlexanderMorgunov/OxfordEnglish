type RegistrationDraft = { key: string; accountId: string; owner: string };

const STORAGE_KEY = 'dayenglish.registration-draft';
let memory: RegistrationDraft | null = null;

export function readRegistrationDraft(owner: string): RegistrationDraft | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && typeof raw === 'object' && 'key' in raw && typeof raw.key === 'string' &&
      'accountId' in raw && typeof raw.accountId === 'string' && 'owner' in raw && typeof raw.owner === 'string') {
      memory = { key: raw.key, accountId: raw.accountId, owner: raw.owner };
    }
  } catch { /* An unavailable session store still leaves the current flow recoverable in memory. */ }
  return memory?.owner === owner ? memory : null;
}

export function writeRegistrationDraft(draft: RegistrationDraft | null): void {
  memory = draft;
  try {
    if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Keep the credential in memory until the user saves it. */ }
}
