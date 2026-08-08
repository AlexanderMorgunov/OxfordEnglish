import { useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Console,
  Eyebrow,
  Input,
  Option,
  Popover,
  ProgressBar,
  SegmentedToggle,
} from '@/shared/ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-2">
        <span className="font-mono text-sm text-amber">§</span>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

const RULE = {
  en: "Use the Past Simple for finished actions with a known time — what you shipped, fixed, or broke yesterday.",
  ru: 'Past Simple — для завершённых действий с известным временем: что ты задеплоил, починил или сломал вчера.',
} as const;

export function KitchenSinkPage() {
  const [lang, setLang] = useState<'en' | 'ru'>('en');
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState<'pass' | 'fail' | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [progress, setProgress] = useState(4);

  const CHOICES = ['Did', 'Do', 'Was', 'Does'];
  const CORRECT = 0;

  const check = () => {
    setChecked(answer.trim().toLowerCase() === 'deployed' ? 'pass' : 'fail');
  };

  return (
    <div>
      <Eyebrow className="mb-3.5">design system · kitchen sink</Eyebrow>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-balance">
        Component states, one page
      </h1>
      <p className="mb-10 max-w-prose text-muted text-pretty">
        Visual acceptance surface for M1 — every component in every state. Compare
        against <code className="font-mono text-amber">past_simple_lesson.html</code>.
      </p>

      <Section title="Typography">
        <p className="text-3xl font-bold tracking-tight">Display 3xl — headings</p>
        <p className="text-lg">
          Reading text (lg / display). The interface is grotesk;{' '}
          <span className="font-mono text-amber">the target language</span> is mono.
        </p>
        <p className="font-mono text-sm text-muted">
          console.log("mono · muted · 13px")
        </p>
      </Section>

      <Section title="Eyebrow">
        <Eyebrow>file 2 · a2 → b1 · lesson 01</Eyebrow>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Run check</Button>
          <Button variant="ghost">Show hint</Button>
          <Button size="sm">sm primary</Button>
          <Button size="sm" variant="ghost">
            sm ghost
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Input + Console (interactive)">
        <Card>
          <p className="mb-3.5 text-base">
            Yesterday I <span className="text-faint">____</span>{' '}
            <code className="font-mono text-amber">(deploy)</code> the new build.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              className="w-44"
              placeholder="past form…"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && check()}
            />
            <Button onClick={check}>Run check</Button>
          </div>
          {checked === 'pass' && (
            <Console status="pass">
              ✓ test passed
              <br />
              <span className="text-muted">
                "Yesterday I <b className="text-content">deployed</b> the new build."
              </span>
            </Console>
          )}
          {checked === 'fail' && (
            <Console status="fail">
              ✕ assertion failed
              <br />
              <span className="text-muted">
                expected the past form of{' '}
                <b className="text-content">deploy</b> — try again
              </span>
            </Console>
          )}
        </Card>
      </Section>

      <Section title="Option — all states">
        <div className="flex flex-wrap gap-2">
          <Option>default</Option>
          <Option state="chosen">chosen</Option>
          <Option state="correct">correct</Option>
          <Option state="wrong">wrong</Option>
          <Option disabled>disabled</Option>
        </div>
        <Card>
          <p className="mb-3.5 text-base">
            <span className="text-faint">____</span> you fix the login bug last
            night?
          </p>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((opt, i) => (
              <Option
                key={opt}
                disabled={choice !== null}
                state={
                  choice === null
                    ? 'default'
                    : i === CORRECT
                      ? 'correct'
                      : i === choice
                        ? 'wrong'
                        : 'default'
                }
                onClick={() => setChoice(i)}
              >
                {opt}
              </Option>
            ))}
          </div>
          {choice !== null && (
            <Console status={choice === CORRECT ? 'pass' : 'fail'}>
              {choice === CORRECT
                ? '✓ passed — correct answer: Did'
                : '✕ not quite — keep going'}
            </Console>
          )}
        </Card>
      </Section>

      <Section title="ProgressBar">
        <ProgressBar value={progress} max={12} />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setProgress((p) => Math.max(0, p - 1))}
          >
            −
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setProgress((p) => Math.min(12, p + 1))}
          >
            +
          </Button>
        </div>
      </Section>

      <Section title="SegmentedToggle — per-block EN/RU">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">
              grammar · rule
            </span>
            <SegmentedToggle
              ariaLabel="Rule language"
              value={lang}
              onChange={setLang}
              segments={[
                { value: 'en', label: 'en' },
                { value: 'ru', label: 'ru' },
              ]}
            />
          </div>
          <p className="text-base leading-relaxed">{RULE[lang]}</p>
        </Card>
      </Section>

      <Section title="Popover — word look-up">
        <p className="text-lg leading-relaxed">
          She{' '}
          <Popover
            trigger={
              <button
                type="button"
                className="cursor-pointer rounded-[3px] font-mono text-amber underline decoration-amber/40 underline-offset-4 hover:decoration-amber"
              >
                wrote
              </button>
            }
          >
            <p className="mb-1 font-mono text-sm text-content">wrote</p>
            <p className="mb-2 font-mono text-xs text-muted">/rəʊt/ · past of write</p>
            <Button size="sm" className="w-full">
              + add to review
            </Button>
          </Popover>{' '}
          the tests and the pipeline ran green.
        </p>
      </Section>

      <Section title="Word status — LingQ colors">
        <p className="text-lg leading-relaxed">
          The{' '}
          <span className="underline decoration-2 underline-offset-4 [text-decoration-color:var(--color-word-unknown)]">
            deployment
          </span>{' '}
          failed because the{' '}
          <span className="underline decoration-2 underline-offset-4 [text-decoration-color:var(--color-word-learning)]">
            rollback
          </span>{' '}
          script was known already.
        </p>
        <div className="flex flex-wrap gap-4 font-mono text-2xs text-muted">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber" />
            unknown
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-teal" />
            learning
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full border border-line" />
            known
          </span>
        </div>
      </Section>

      <Section title="Grammar pattern — mono formula">
        <Card className="p-0">
          <div className="border-b border-line p-5">
            <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
              Negative — didn't + base form
            </p>
            <p className="font-mono text-sm">
              <span className="text-amber">didn't</span>{' '}
              <span className="text-teal">push</span> ·{' '}
              <span className="text-amber">didn't</span>{' '}
              <span className="text-teal">pass</span>
            </p>
            <p className="mt-2 text-base text-muted">
              The build{' '}
              <em className="border-b-[1.5px] border-teal-dim not-italic text-content">
                didn't pass
              </em>
              , so I{' '}
              <em className="border-b-[1.5px] border-teal-dim not-italic text-content">
                didn't push
              </em>{' '}
              to main.
            </p>
          </div>
        </Card>
      </Section>
    </div>
  );
}
