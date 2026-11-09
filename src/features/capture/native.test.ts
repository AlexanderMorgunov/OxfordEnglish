import { beforeEach, expect, test, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { connectCaptureLinks } from './native';

const fixture = vi.hoisted(() => ({
  deliver: (_event: { url: string }) => {},
  remove: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_name, listener) => {
      fixture.deliver = listener;
      return { remove: fixture.remove };
    }),
    getLaunchUrl: vi.fn(async () => ({
      url: 'https://dayenglish.ru/capture?v=1&en=word',
    })),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
});
test('cold launch and subsequent warm deliveries navigate, cleanup prevents late events', async () => {
  const navigate = vi.fn().mockResolvedValue(undefined);
  const close = await connectCaptureLinks(navigate);
  expect(navigate).toHaveBeenLastCalledWith('/capture?v=1&en=word');
  fixture.deliver({ url: 'dayenglish://capture?v=1&en=next' });
  expect(navigate).toHaveBeenLastCalledWith('/capture?v=1&en=next');
  close();
  fixture.deliver({ url: 'dayenglish://capture?v=1&en=late' });
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(fixture.remove).toHaveBeenCalledOnce();
});
test('a newer warm event wins against a delayed launch URL', async () => {
  let launch: ((value: { url: string }) => void) | undefined;
  vi.mocked(App.getLaunchUrl).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        launch = resolve;
      })
  );
  const navigate = vi.fn().mockResolvedValue(undefined);
  const pending = connectCaptureLinks(navigate);
  await vi.waitFor(() => expect(launch).toBeDefined());
  fixture.deliver({ url: 'https://dayenglish.ru/capture?v=1&en=new' });
  launch?.({ url: 'https://dayenglish.ru/capture?v=1&en=old' });
  await pending;
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/capture?v=1&en=new');
});
test('web startup installs no native listeners', async () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  await connectCaptureLinks(vi.fn());
  expect(App.addListener).not.toHaveBeenCalled();
});
