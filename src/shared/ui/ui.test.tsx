import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Button } from './Button';
import { Console } from './Console';
import { Popover } from './Popover';
import { SegmentedToggle } from './SegmentedToggle';

test('Button forwards click and type defaults to button', async () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Run</Button>);
  const btn = screen.getByRole('button', { name: 'Run' });
  expect(btn).toHaveAttribute('type', 'button');
  await userEvent.click(btn);
  expect(onClick).toHaveBeenCalledOnce();
});

test('Console exposes an assertive-friendly polite live region', () => {
  render(<Console status="pass">ok</Console>);
  const region = screen.getByRole('status');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveClass('console--pass');
});

test('SegmentedToggle switches value via click and arrow keys', async () => {
  function Harness() {
    const [v, setV] = useState<'en' | 'ru'>('en');
    return (
      <SegmentedToggle
        ariaLabel="lang"
        value={v}
        onChange={setV}
        segments={[
          { value: 'en', label: 'en' },
          { value: 'ru', label: 'ru' },
        ]}
      />
    );
  }
  render(<Harness />);
  const ru = screen.getByRole('radio', { name: 'ru' });
  await userEvent.click(ru);
  expect(ru).toHaveAttribute('aria-checked', 'true');
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('radio', { name: 'en' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

test('Popover opens on trigger and closes on Escape', async () => {
  render(
    <Popover trigger={<button type="button">word</button>}>
      <span>definition</span>
    </Popover>
  );
  const trigger = screen.getByRole('button', { name: 'word' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Popover close button dismisses the panel and restores focus to the trigger', async () => {
  render(
    <Popover showClose trigger={<button type="button">word</button>}>
      <span>definition</span>
    </Popover>
  );
  const trigger = screen.getByRole('button', { name: 'word' });
  await userEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
