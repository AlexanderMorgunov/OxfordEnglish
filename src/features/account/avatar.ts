/**
 * The pixel-art face of an account.
 *
 * DERIVED from the account id, never stored and never synced. That is the whole design: the same
 * account shows the same avatar on every device with no state to keep, no migration, and nothing that
 * could disagree between devices — and it costs nothing for a free account, which matters now that
 * syncing itself is part of Pro.
 *
 * The price is that there is no "give me another one". That is deliberate: an avatar the user can
 * re-roll has to be stored somewhere, and a per-device choice would make the same account look
 * different on a phone and a laptop — worse than not choosing at all, for a thing nobody else sees.
 */

/** How many avatars exist on disk. Keep in step with `public/assets/pixel/avatars/`. */
export const AVATAR_COUNT = 16;

/**
 * FNV-1a over the account id. Any stable hash would do; this one is three lines and has no
 * dependency. `>>> 0` keeps it unsigned — without it a high bit turns the index negative.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 1-based index of this account's avatar, matching the file names. */
export function avatarIndex(accountId: string, count = AVATAR_COUNT): number {
  return (hash(accountId) % count) + 1;
}

export function avatarSrc(accountId: string, count = AVATAR_COUNT): string {
  return `/assets/pixel/avatars/a${String(avatarIndex(accountId, count)).padStart(2, '0')}.png`;
}
