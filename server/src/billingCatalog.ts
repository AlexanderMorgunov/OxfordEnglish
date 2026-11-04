import { z } from 'zod';
import { PLANS } from './billing.js';

const PriceSchema = z.number().int().positive();
export const CampaignSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    title: z.string().trim().min(1).max(80),
    startsAt: z.number().int().nonnegative().max(253402300799999),
    endsAt: z.number().int().nonnegative().max(253402300799999),
    prices: z
      .object({
        pro_month: PriceSchema.max(19899),
        pro_quarter: PriceSchema.max(49899),
        pro_year: PriceSchema.max(149899),
      })
      .strict(),
  })
  .strict()
  .refine((c) => c.endsAt > c.startsAt, 'End must follow start');
export const CatalogSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative().safe(),
    campaign: CampaignSchema.nullable(),
  })
  .strict();
export type CatalogSettings = z.infer<typeof CatalogSettingsSchema>;
export const initialCatalogSettings = (): CatalogSettings => ({
  revision: 0,
  campaign: {
    id: 'pro-november-2026',
    title: 'Неделя Pro',
    startsAt: Date.parse('2026-11-03T00:00:00+03:00'),
    endsAt: Date.parse('2026-11-11T00:00:00+03:00'),
    prices: { pro_month: 15000, pro_quarter: 39900, pro_year: 99000 },
  },
});

export interface BillingCatalogStore {
  get(): Promise<CatalogSettings>;
  replace(
    expectedRevision: number,
    campaign: CatalogSettings['campaign']
  ): Promise<CatalogSettings | null>;
}
export class InMemoryBillingCatalogStore implements BillingCatalogStore {
  constructor(private settings = initialCatalogSettings()) {}
  async get() {
    return structuredClone(this.settings);
  }
  async replace(
    expectedRevision: number,
    campaign: CatalogSettings['campaign']
  ) {
    if (this.settings.revision !== expectedRevision) return null;
    this.settings = {
      revision: expectedRevision + 1,
      campaign: structuredClone(campaign),
    };
    return this.get();
  }
}

export function catalogAt(
  settings: CatalogSettings,
  now: number,
  available: boolean
) {
  const configured = settings.campaign;
  const campaign =
    configured && configured.startsAt <= now && now < configured.endsAt
      ? configured
      : null;
  return {
    available,
    serverTime: now,
    validUntil:
      configured && now < configured.startsAt
        ? configured.startsAt
        : (campaign?.endsAt ?? null),
    campaign: campaign
      ? { id: campaign.id, title: campaign.title, endsAt: campaign.endsAt }
      : null,
    plans: Object.values(PLANS).map((p) => ({
      code: p.code,
      days: p.days,
      title: p.title,
      priceKopecks: campaign?.prices[p.code] ?? p.priceKopecks,
      regularPriceKopecks: p.priceKopecks,
    })),
  };
}
