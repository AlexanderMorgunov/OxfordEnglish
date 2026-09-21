/**
 * Approving a new device on a machine that cannot scan.
 *
 * The code is shown on the device being ADDED — a phone — and has to be read by the device that is
 * already signed in, which is just as often a desktop with no camera at all. Offering "scan a QR"
 * there is what made the flow read as unfinished: the typed code was always the path, the button just
 * pointed away from it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { create } from 'zustand';
import type { Device } from './contract';

type AccountState = {
  approveDevice: (code: string) => Promise<{ deviceName?: string }>;
  listDevices: () => Promise<Device[]>;
  revokeDevice: (id: string) => Promise<void>;
};
const accountStore = create<AccountState>(() => ({
  approveDevice: async () => ({}),
  listDevices: async () => [],
  revokeDevice: async () => undefined,
}));

vi.mock('./store', () => ({ useAccount: accountStore }));
vi.mock('./QrScanner', () => ({ QrScanner: () => <div>scanner</div> }));

const { DeviceManager } = await import('./AccountSection');

const SCAN = /сканировать qr|scan qr/i;
const TYPE_IT = /type the code it shows/i;

/** The manager renders collapsed to a single button; the approve form is behind it. */
async function openManager(): Promise<void> {
  render(<DeviceManager ru={false} thisDeviceId="d1" />);
  await userEvent.click(screen.getByRole('button', { name: /devices/i }));
}

function setCameras(kinds: MediaDeviceKind[]): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => kinds.map((kind) => ({ kind })) },
  });
}

beforeEach(() => {
  Reflect.deleteProperty(navigator as object, 'mediaDevices');
});

test('a machine with a camera is offered the scanner', async () => {
  setCameras(['audioinput', 'videoinput']);

  await openManager();

  expect(await screen.findByText(SCAN)).toBeInTheDocument();
});

test('a machine without one is not, and is told to type the code instead', async () => {
  setCameras(['audioinput', 'audiooutput']);

  await openManager();

  expect(await screen.findByText(TYPE_IT)).toBeInTheDocument();
  expect(screen.queryByText(SCAN)).toBeNull();
  // The path that always worked stays exactly where it was.
  expect(screen.getByPlaceholderText(/code from the new device/i)).toBeInTheDocument();
});

test('no media API at all — an insecure origin, an old WebView — counts as no camera', async () => {
  await openManager();

  expect(await screen.findByText(TYPE_IT)).toBeInTheDocument();
  expect(screen.queryByText(SCAN)).toBeNull();
});
