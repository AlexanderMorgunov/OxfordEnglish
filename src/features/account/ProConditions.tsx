export function ProConditions({ ru }: { ru: boolean }) {
  return <details className="border-t border-line pt-3 text-sm leading-relaxed text-muted">
    <summary className="min-h-11 cursor-pointer text-content">{ru ? 'Условия пробного периода' : 'Free trial conditions'}</summary>
    <p>{ru ? 'Попробовать бесплатно можно один раз. У AI есть лимит использования, его остаток виден в настройках. После 14 дней ничего не спишется — вы сами решите, продолжать ли с Pro.' : 'You can try Pro for free once. AI use has a limit; check what is left in Settings. Nothing is charged after 14 days: you decide whether to continue with Pro.'}</p>
  </details>;
}
