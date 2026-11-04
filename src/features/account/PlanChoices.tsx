import type { BillingPlans } from './contract';
import { formatPrice } from './billing';

import { planLabel } from './planCopy';

export function PlanChoices({
  value,
  selected,
  select,
  ru,
  disabled,
}: {
  value: BillingPlans;
  selected: string;
  select: (code: string) => void;
  ru: boolean;
  disabled: boolean;
}) {
  return (
    <fieldset className="pro-plan-fieldset" disabled={disabled}>
      <legend>
        {ru ? 'Выберите срок доступа' : 'Choose your access period'}
      </legend>
      <div className="pro-plan-grid">
        {value.plans.map((p) => (
          <label className="pro-plan" key={p.code}>
            <input
              type="radio"
              name="pro-plan"
              value={p.code}
              checked={p.code === selected}
              onChange={() => select(p.code)}
            />
            <span className="pro-plan-face">
              <span className="pro-plan-title">
                {planLabel(p.days, ru)}
                <span className="pro-plan-radio" />
              </span>
              {value.campaign &&
                p.regularPriceKopecks != null &&
                p.priceKopecks < p.regularPriceKopecks && (
                  <span className="pro-plan-comparison">
                    {ru ? 'После акции ' : 'After the sale '}
                    <s>{formatPrice(p.regularPriceKopecks)}</s>
                  </span>
                )}
              <strong className="pro-plan-price">
                {value.campaign && (
                  <span className="sr-only">
                    {ru ? 'По акции ' : 'Sale price '}
                  </span>
                )}
                {formatPrice(p.priceKopecks)}
              </strong>
              <span className="pro-plan-rate">
                {p.days === 30
                  ? ru
                    ? '30 дней доступа'
                    : '30 days of access'
                  : `${ru ? 'В среднем ' : 'Average '}${formatPrice(p.priceKopecks / (p.days === 90 ? 3 : 12))}${ru ? '/мес' : '/month'}`}
              </span>
              {p.days === 365 && (
                <span className="pro-plan-note">
                  {ru ? 'Самая низкая цена за месяц' : 'Lowest monthly price'}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
