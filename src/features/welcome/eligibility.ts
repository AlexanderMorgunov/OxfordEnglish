import { db } from '@/db/db';

export function welcomeEntry(path: string): boolean {
  return (
    path === '/' ||
    /^\/(course|syllabus|library|vocabulary|review|grammar|progress|settings)(?:\/|$)/.test(path)
  );
}
export async function newInstallation(): Promise<boolean> {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === 'oxford-account') {
        const account: unknown = JSON.parse(
          localStorage.getItem(key) ?? 'null'
        );
        if (
          account &&
          typeof account === 'object' &&
          [
            'accountId',
            'dataOwner',
            'fileOwner',
            'lastAccountId',
            'refreshToken',
          ].some((field) => Boolean(Reflect.get(account, field)))
        ) {
          return false;
        }
      }
      if (
        key &&
        /^(onboarding\.seen|oxford-(appearance|ui-text-size|learner)|migration\.|reader\.|dayenglish-contextual-tour:)/.test(
          key
        )
      ) {
        return false;
      }
    }
    const counts = await Promise.all([
      db.attempts.count(),
      db.wordStatus.count(),
      db.srsCards.count(),
      db.checkpoints.count(),
      db.books.count(),
      db.bookmarks.count(),
      db.activity.count(),
      db.reviewLog.count(),
      db.feedbackOutbox.count(),
    ]);
    if (counts.some(Boolean)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
