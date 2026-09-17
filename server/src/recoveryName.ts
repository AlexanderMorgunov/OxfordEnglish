/**
 * A name the user chooses so that recovery has something they can actually remember.
 *
 * Why it exists: the account id is a random 22-character string. It is derived from the recovery key,
 * so it is only ever needed when that key is gone — which is exactly when nobody has it to hand. A name
 * is not a credential and grants nothing on its own; it only tells the server WHICH account to try the
 * authenticator code against.
 *
 * Names are deliberately NOT unique. Requiring uniqueness means answering "is this taken?", which turns
 * signup into an oracle for who is registered here, and brings squatting and reserved-word lists with
 * it. Instead several accounts may share a name and the authenticator code picks between them.
 */
import { keyedHash } from './indexHash.js';

/**
 * Names are compared after folding case, trimming, and collapsing inner whitespace — someone typing
 * their own name months later will not reproduce spacing or capitalisation exactly. Unicode is
 * normalised so that a composed and a decomposed "й" are the same name.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export const nameHash = (name: string): string => keyedHash('name', normalizeName(name));

/** Long enough not to collide with half the alphabet, short enough to be typed on a phone. */
export const NAME_MIN = 3;
export const NAME_MAX = 40;

export const nameAcceptable = (name: string): boolean => {
  const n = normalizeName(name);
  return n.length >= NAME_MIN && n.length <= NAME_MAX;
};

/**
 * How many accounts may share one name.
 *
 * This is a WRITE-side invariant, not a read-side truncation: `setName` refuses a name that already has
 * this many holders, which is what makes `candidates()` provably complete. Capping only the read would
 * leave holder 21 permanently unable to recover, with nothing anywhere to say so.
 *
 * The cost is a narrow leak — an authenticated caller learns "at least 20 accounts already use this
 * name" — and the price is worth paying for a lookup that cannot silently lose people. At the current
 * account count it will never fire.
 */
export const NAME_CANDIDATE_CAP = 20;

/**
 * Failed attempts are charged to the NAME, never to the accounts behind it. Charging the accounts is how
 * a popular name would become a way to lock strangers out of their own recovery — and it would hit
 * precisely the users who bothered to enrol.
 *
 * Each attempt costs one unit PER CANDIDATE the name resolves to, not one per request. That keeps the
 * thing that actually matters constant: attempts per window fall as 1/N while the chance that one
 * submitted code matches SOME candidate rises as N (about 3N in 10^6, since a ±1 step window leaves
 * roughly three codes live). The product — how often this endpoint hands out the wrong account — is
 * therefore independent of N and equal to the rate `/v1/totp/recover` already accepts for a single
 * account. Charging per request instead would multiply that rate by N.
 *
 * This throttle can itself be used to deny service: hammering "alex" locks out everyone named Alex.
 * Contained rather than absent — recovery by account id is a separate counter and stays open — so the
 * UI must keep that route visible and say so when this one is throttled.
 */
export const NAME_MAX_FAILURES = 10;
export const NAME_WINDOW_MS = 15 * 60_000;

export type NameAttempts = { nameHash: string; failCount: number; failWindowStart: number };

export const nameThrottled = (a: NameAttempts | null, now: number): boolean =>
  !!a && now - a.failWindowStart < NAME_WINDOW_MS && a.failCount >= NAME_MAX_FAILURES;

/** `weight` is the number of candidates the attempt will be tried against; a name that resolves to none
 *  still costs 1, or probing for a name that exists would be free. */
export function noteNameFailure(a: NameAttempts | null, hash: string, now: number, weight: number): NameAttempts {
  const cost = Math.max(1, weight);
  if (!a || now - a.failWindowStart >= NAME_WINDOW_MS) return { nameHash: hash, failCount: cost, failWindowStart: now };
  return { ...a, failCount: a.failCount + cost };
}

/**
 * Give back what THIS attempt cost, and nothing more.
 *
 * Clearing the counter outright would be a hole rather than a kindness, because the counter belongs to
 * the name and the name belongs to nobody. Anyone may become a co-holder of any name — register, enrol,
 * set the name — so a full reset lets an attacker guess against a stranger until the lockout, then
 * recover their own throwaway account under the same name with a code they legitimately hold, and start
 * over. The throttle would exist only until someone bothered to read it.
 *
 * Refunding the attempt's own cost keeps the budget honest while still leaving somewhere for the
 * lost-response retry to spend: that retry is the one case where a user must be able to submit twice for
 * what is really one recovery.
 */
export function refundNameAttempt(a: NameAttempts | null, hash: string, now: number, weight: number): NameAttempts {
  if (!a) return { nameHash: hash, failCount: 0, failWindowStart: now };
  return { ...a, failCount: Math.max(0, a.failCount - Math.max(1, weight)) };
}

export type SetNameResult = 'ok' | 'crowded';

/**
 * Persistence for the name index.
 *
 * `account_id` is stored in the CLEAR here, and it has to be — resolving a name to candidates is the
 * whole job. So the HMAC protects the name from being read back out of a dump; it says nothing about
 * the link between a row and an account. That is a real widening of the join surface, and the rows must
 * be deleted with the account.
 */
export interface RecoveryNameStore {
  /**
   * One name per account: setting a second REPLACES the first. The old row has to be deleted rather
   * than left behind, or the account stays findable under every name it has ever used.
   *
   * Refuses with `crowded` once the name has `NAME_CANDIDATE_CAP` other holders — see the cap.
   */
  setName(accountId: string, hash: string, now: number): Promise<SetNameResult>;
  clearName(accountId: string): Promise<void>;
  /** Whether this account has a name set, for the settings screen. Never returns the name itself —
   *  we cannot, and would not want to. */
  hasName(accountId: string): Promise<boolean>;
  /** Accounts sharing a name. Complete, because `setName` enforces the cap. */
  candidates(hash: string): Promise<string[]>;
  /** Read, decide and write the name's attempt counter as one step, for the same reason the TOTP
   *  counter is serialized: a lost update turns ten-per-fifteen-minutes into however many requests fit
   *  in one round trip. */
  bumpAttempts<T>(hash: string, decide: (a: NameAttempts | null) => { row?: NameAttempts; result: T }): Promise<T>;
  /** Called with the account when it is deleted. Deliberately leaves the attempt counter alone: that row
   *  is keyed by name and shared with everyone else who chose it. */
  purge(accountId: string): Promise<void>;
}

export class InMemoryRecoveryNameStore implements RecoveryNameStore {
  private byAccount = new Map<string, string>();
  private attempts = new Map<string, NameAttempts>();

  async setName(accountId: string, hash: string, _now: number): Promise<SetNameResult> {
    if (this.byAccount.get(accountId) === hash) return 'ok';
    let holders = 0;
    for (const [id, h] of this.byAccount) if (h === hash && id !== accountId) holders += 1;
    if (holders >= NAME_CANDIDATE_CAP) return 'crowded';
    this.byAccount.set(accountId, hash);
    return 'ok';
  }
  async clearName(accountId: string) {
    this.byAccount.delete(accountId);
  }
  async hasName(accountId: string) {
    return this.byAccount.has(accountId);
  }
  async candidates(hash: string) {
    const out: string[] = [];
    for (const [accountId, h] of this.byAccount) if (h === hash) out.push(accountId);
    return out;
  }
  /** Atomic by construction: nothing awaits between the read and the write. */
  async bumpAttempts<T>(hash: string, decide: (a: NameAttempts | null) => { row?: NameAttempts; result: T }): Promise<T> {
    const { row, result } = decide(this.attempts.get(hash) ?? null);
    if (row) this.attempts.set(hash, row);
    return result;
  }
  async purge(accountId: string) {
    this.byAccount.delete(accountId);
  }
}
