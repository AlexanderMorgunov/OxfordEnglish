import { tourOwner } from '@/features/onboarding/memory';

const PREFIX = 'dayenglish.sale.v1:';
export function saleHidden(campaign: string, owner = tourOwner()): boolean {
  try {
    return localStorage.getItem(`${PREFIX}${owner}:${campaign}`) !== null;
  } catch {
    return true;
  }
}
export function hideSale(campaign: string, owner = tourOwner()): void {
  try {
    localStorage.setItem(`${PREFIX}${owner}:${campaign}`, 'seen');
  } catch {
    /* Auto offers stay disabled without durable storage. */
  }
}
export function queueSaleAfterLesson(): void {
  try {
    sessionStorage.setItem(
      `${PREFIX}lesson`,
      JSON.stringify({ owner: tourOwner(), time: Date.now() })
    );
  } catch {
    /* The banner remains available. */
  }
}
export function lessonSalePending(): boolean {
  try {
    const item = JSON.parse(
      sessionStorage.getItem(`${PREFIX}lesson`) ?? 'null'
    );
    return (
      item?.owner === tourOwner() &&
      Number.isFinite(item?.time) &&
      Date.now() - item.time >= 0 &&
      Date.now() - item.time < 86400000
    );
  } catch {
    return false;
  }
}
export function consumeLessonSale(): void {
  try {
    sessionStorage.removeItem(`${PREFIX}lesson`);
  } catch {
    /* No auto show without storage. */
  }
}
