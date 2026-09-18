import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import type * as ApiModule from './api';

vi.mock('./api', async () => {
  // ApiFailure stays the real class — `codeOf` narrows on `instanceof`, so a stand-in would make every
  // error read as the generic one and quietly pass the tests that exist to tell them apart.
  const actual = await vi.importActual<typeof ApiModule>('./api');
  return {
    ...actual,
    totpStatus: vi.fn(),
    totpEnroll: vi.fn(),
    totpConfirm: vi.fn(),
    totpBackupCodes: vi.fn(),
    totpCancel: vi.fn(),
    totpDisable: vi.fn(),
    setRecoveryName: vi.fn(),
    clearRecoveryName: vi.fn(),
  };
});

import * as api from './api';
import { ApiFailure } from './api';
import { useAccount } from './store';
import { TotpEnroll } from './TotpSection';
import { TotpStatusSchema, type TotpStatus } from './contract';

const status = (over: Partial<TotpStatus> = {}): TotpStatus => ({
  available: true,
  enrolled: false,
  backupCodesLeft: 0,
  pending: false,
  recoverFailures: 0,
  recoveryName: false,
  ...over,
});

/** A promise the test resolves by hand, for asserting what the screen says WHILE a request is open. */
function deferred<T>() {
  let settle!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    settle = res;
    fail = rej;
  });
  return { promise, settle, fail };
}

const view = () => render(<TotpEnroll ru={false} />);
const connect = () => screen.findByRole('button', { name: /connect an app|continue setup/i });
const visible = async () => {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  // A live session with an unexpired token, so `getAccessToken` answers without touching the network.
  useAccount.setState({
    status: 'authenticated',
    accountId: 'acc-test-0123456789ab',
    accessToken: 'access-token',
    accessExpiresAt: Date.now() + 3_600_000,
    error: null,
  });
  vi.mocked(api.totpStatus).mockResolvedValue(status());
  // Every four-character group distinct, so a query for one of them cannot match two spans.
  vi.mocked(api.totpEnroll).mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXPQRSTUVWX2345ABCD', uri: 'otpauth://totp/x' });
});

test('an unreachable server leaves the section on the page, with a way back', async () => {
  vi.mocked(api.totpStatus).mockRejectedValue(new ApiFailure('network', 0));
  view();

  // The whole point. Returning from the authenticator app on a bad connection used to render NOTHING
  // here — no heading, no error, nothing to press — because a null status and "the feature is off"
  // took the same branch.
  expect(await screen.findByText(/could not load the backup sign-in settings/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /backup sign-in/i })).toBeInTheDocument();

  vi.mocked(api.totpStatus).mockResolvedValue(status());
  await userEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(await connect()).toBeInTheDocument();
});

test('a server with no sealing key stays silent — a button that can only fail is worse', async () => {
  vi.mocked(api.totpStatus).mockResolvedValue(status({ available: false }));
  const { container } = view();

  await act(async () => undefined);
  expect(container).toBeEmptyDOMElement();
});

test('coming back to the tab re-reads the status', async () => {
  view();
  await connect();
  expect(api.totpStatus).toHaveBeenCalledTimes(1);

  // The trip to the authenticator app is exactly when this tab's copy goes stale.
  await visible();
  expect(api.totpStatus).toHaveBeenCalledTimes(2);
});

test('a setup confirmed on another device replaces the scanning card with the truth', async () => {
  view();
  await userEvent.click(await connect());
  expect(await screen.findByText(/JBSW/)).toBeInTheDocument();

  vi.mocked(api.totpStatus).mockResolvedValue(status({ enrolled: true, pending: false }));
  await visible();

  // Leaving the card up would offer a Confirm button that could only ever answer 409.
  expect(screen.queryByText(/JBSW/)).not.toBeInTheDocument();
  expect(screen.getByText(/already connected/i)).toBeInTheDocument();
});

test('a setup cancelled elsewhere says so instead of failing later', async () => {
  view();
  await userEvent.click(await connect());
  expect(await screen.findByText(/JBSW/)).toBeInTheDocument();

  vi.mocked(api.totpStatus).mockResolvedValue(status({ enrolled: false, pending: false }));
  await visible();

  expect(screen.queryByText(/JBSW/)).not.toBeInTheDocument();
  expect(screen.getByText(/that setup was cancelled/i)).toBeInTheDocument();
});

test('enroll answering 409 says what is true, not "try again"', async () => {
  vi.mocked(api.totpEnroll).mockRejectedValue(new ApiFailure('totp_already_enrolled', 409));
  vi.mocked(api.totpStatus).mockResolvedValueOnce(status()).mockResolvedValue(status({ enrolled: true }));
  view();

  await userEvent.click(await connect());

  // "Something went wrong. Try again." is advice that cannot work: a retry can only 409 again.
  expect(await screen.findByText(/already connected/i)).toBeInTheDocument();
  expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
});

test('six digits submit themselves', async () => {
  vi.mocked(api.totpConfirm).mockResolvedValue(['aaaaa-bbbbb']);
  view();
  await userEvent.click(await connect());

  await userEvent.type(await screen.findByPlaceholderText(/6 digits/i), '123456');

  expect(api.totpConfirm).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.totpConfirm).mock.calls[0]![1]).toBe('123456');
});

test('a rejected code is never sent again on its own', async () => {
  vi.mocked(api.totpConfirm).mockRejectedValue(new ApiFailure('totp_invalid', 401));
  view();
  await userEvent.click(await connect());
  const field = await screen.findByPlaceholderText(/6 digits/i);

  await userEvent.type(field, '123456');
  expect(api.totpConfirm).toHaveBeenCalledTimes(1);

  // A failed confirm leaves the field untouched, so anything keyed on "six digits and not busy" would
  // resend the same wrong code the moment the request settled — ten of those is a fifteen-minute
  // lockout that refuses correct codes too.
  await userEvent.type(field, '{backspace}6');
  expect(api.totpConfirm).toHaveBeenCalledTimes(1);
});

test('a throttle stands auto-submit down for good', async () => {
  vi.mocked(api.totpConfirm).mockRejectedValue(new ApiFailure('rate_limited', 429));
  view();
  await userEvent.click(await connect());
  const field = await screen.findByPlaceholderText(/6 digits/i);

  await userEvent.type(field, '123456');
  expect(api.totpConfirm).toHaveBeenCalledTimes(1);

  await userEvent.clear(field);
  await userEvent.type(field, '654321');
  // Each further automatic send is another refusal and another fifteen minutes; the decision goes back
  // to the user, who still has the Confirm button.
  expect(api.totpConfirm).toHaveBeenCalledTimes(1);
});

test('letters never reach the server', async () => {
  view();
  await userEvent.click(await connect());
  const field = await screen.findByPlaceholderText(/6 digits/i);

  // An `autocomplete="one-time-code"` autofill of the wrong thing used to spend one of ten attempts.
  await userEvent.type(field, 'ab12cd34');
  expect(field).toHaveValue('1234');
  expect(api.totpConfirm).not.toHaveBeenCalled();
});

test('issuing fresh backup codes does not forget that a recovery name is set', async () => {
  vi.mocked(api.totpStatus).mockResolvedValue(status({ enrolled: true, backupCodesLeft: 10, recoveryName: true }));
  vi.mocked(api.totpBackupCodes).mockResolvedValue(['aaaaa-bbbbb']);
  view();

  expect(await screen.findByRole('button', { name: /change the name/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /new backup codes/i }));
  await userEvent.type(await screen.findByPlaceholderText(/6 digits from the app/i), '123456');
  await userEvent.click(screen.getByRole('button', { name: /issue codes/i }));
  await userEvent.click(await screen.findByRole('button', { name: /i have saved the codes/i }));

  // Replacing the status with an object literal dropped `recoveryName`, so the field came back claiming
  // no name was set — misinformation about the recovery surface itself.
  expect(await screen.findByRole('button', { name: /change the name/i })).toBeInTheDocument();
});

test('a lost confirm answer still leaves somewhere to enter the next code', async () => {
  // The refetch after a 409 used to be the ONLY thing that set `enrolled`, and this is the path where
  // answers go missing — so when it missed too, the screen fell back to the not-enrolled branch: a live
  // authenticator, no backup codes, an instruction to type a code, and no field to type it into.
  vi.mocked(api.totpConfirm).mockRejectedValue(new ApiFailure('totp_already_enrolled', 409));
  vi.mocked(api.totpStatus).mockResolvedValueOnce(status()).mockRejectedValue(new ApiFailure('network', 0));
  view();
  await userEvent.click(await connect());

  await userEvent.type(await screen.findByPlaceholderText(/^6 digits$/i), '123456');

  expect(await screen.findByPlaceholderText(/6 digits from the app/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /issue codes/i })).toBeInTheDocument();
});

test('a cancel whose answer is lost does not offer to continue what is gone', async () => {
  vi.mocked(api.totpCancel).mockResolvedValue(undefined);
  vi.mocked(api.totpStatus).mockResolvedValueOnce(status()).mockRejectedValue(new ApiFailure('network', 0));
  view();
  await userEvent.click(await connect());
  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  // Pressing "Continue setup" against a row that no longer exists MINTS a new secret — right after the
  // copy promised no re-scan was needed. Every code from the stale entry is then a counted failure.
  expect(await screen.findByRole('button', { name: /connect an app/i })).toBeInTheDocument();
  expect(screen.queryByText(/no need to scan again/i)).not.toBeInTheDocument();
});

test('cancelling something already confirmed elsewhere says so', async () => {
  vi.mocked(api.totpCancel).mockRejectedValue(new ApiFailure('totp_already_enrolled', 409));
  view();
  await userEvent.click(await connect());
  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  expect(await screen.findByText(/nothing to cancel/i)).toBeInTheDocument();
});

test('enroll answering 503 names the outage instead of blaming the user', async () => {
  vi.mocked(api.totpEnroll).mockRejectedValue(new ApiFailure('totp_unavailable', 503));
  view();
  await userEvent.click(await connect());

  // The generic path also says "temporarily unavailable" — but it says RECOVERY is, to someone who is
  // enrolling. The whole value of handling 503 here is naming the thing the user is actually doing.
  expect(await screen.findByText(/connecting an app is temporarily unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
});

test('a status read landing mid-confirm does not accuse the user of another device', async () => {
  const confirmCall = deferred<string[]>();
  vi.mocked(api.totpConfirm).mockReturnValue(confirmCall.promise);
  view();
  await userEvent.click(await connect());
  await userEvent.type(await screen.findByPlaceholderText(/^6 digits$/i), '123456');

  // The confirm has committed on the server; its answer is still travelling. A read now truthfully
  // reports an enrolled account — and reading that as "someone else did this" would tear down the card
  // and leave the line sitting under the backup codes when they arrive.
  vi.mocked(api.totpStatus).mockResolvedValue(status({ enrolled: true, pending: false }));
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(screen.queryByText(/perhaps on another device/i)).not.toBeInTheDocument();

  await act(async () => {
    confirmCall.settle(['aaaaa-bbbbb']);
  });
  expect(await screen.findByText('aaaaa-bbbbb')).toBeInTheDocument();
  expect(screen.queryByText(/perhaps on another device/i)).not.toBeInTheDocument();
});

test('a second enrollment may use the same digits as the first', async () => {
  vi.mocked(api.totpConfirm).mockRejectedValue(new ApiFailure('totp_invalid', 401));
  vi.mocked(api.totpCancel).mockResolvedValue(undefined);
  view();

  await userEvent.click(await connect());
  await userEvent.type(await screen.findByPlaceholderText(/^6 digits$/i), '123456');
  expect(api.totpConfirm).toHaveBeenCalledTimes(1);

  await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  await userEvent.click(await screen.findByRole('button', { name: /connect an app/i }));
  // The guard that stops a wrong code repeating itself must not outlive the enrollment it belonged to:
  // a fresh secret makes the same six digits a different answer.
  await userEvent.type(await screen.findByPlaceholderText(/^6 digits$/i), '123456');
  expect(api.totpConfirm).toHaveBeenCalledTimes(2);
});

test('the code field stops at six digits', async () => {
  view();
  await userEvent.click(await connect());
  const field = await screen.findByPlaceholderText(/^6 digits$/i);

  await userEvent.type(field, '12345678');
  expect(field).toHaveValue('123456');
});

test('one return to the tab is one read, not two', async () => {
  view();
  await connect();
  expect(api.totpStatus).toHaveBeenCalledTimes(1);

  // A backgrounded tab coming forward fires visibilitychange AND focus.
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  expect(api.totpStatus).toHaveBeenCalledTimes(2);
});

test('focus alone re-reads the status', async () => {
  view();
  await connect();

  // Not every return fires visibilitychange — moving focus back from another window need not.
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(api.totpStatus).toHaveBeenCalledTimes(2);
});

test('a tab going hidden does not spend a request', async () => {
  view();
  await connect();

  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  hidden.mockRestore();

  expect(api.totpStatus).toHaveBeenCalledTimes(1);
});

test('the section does not blink out while a retry is in flight', async () => {
  vi.mocked(api.totpStatus).mockRejectedValueOnce(new ApiFailure('network', 0));
  view();
  await screen.findByText(/could not load the backup sign-in settings/i);

  const retryCall = deferred<never>();
  vi.mocked(api.totpStatus).mockReturnValue(retryCall.promise);
  await userEvent.click(screen.getByRole('button', { name: /retry/i }));

  // Clearing the failure flag on the way in would take the whole section off the page until the answer
  // came back — the vanishing act this branch exists to stop, reintroduced between attempts.
  expect(screen.getByText(/could not load the backup sign-in settings/i)).toBeInTheDocument();

  await act(async () => {
    retryCall.fail(new ApiFailure('network', 0));
  });
  expect(await screen.findByText(/could not load the backup sign-in settings/i)).toBeInTheDocument();
});

test('a name set through the field survives the codes card unmounting it', async () => {
  // Found in the browser, not here: the earlier test seeded `recoveryName: true` into the status, so it
  // never exercised the path a user takes. Setting the name updated only the field's own state, the
  // parent's copy stayed false, and the codes card — which unmounts this field and puts it back — read
  // that stale copy. Someone who had just named their account was offered to name it again.
  vi.mocked(api.totpStatus).mockResolvedValue(status({ enrolled: true, backupCodesLeft: 10, recoveryName: false }));
  vi.mocked(api.setRecoveryName).mockResolvedValue(undefined);
  vi.mocked(api.totpBackupCodes).mockResolvedValue(['aaaaa-bbbbb']);
  view();

  await userEvent.click(await screen.findByRole('button', { name: /set a name/i }));
  await userEvent.type(screen.getByPlaceholderText(/for example/i), 'Alex Smith');
  await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
  expect(await screen.findByRole('button', { name: /change the name/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /new backup codes/i }));
  await userEvent.type(await screen.findByPlaceholderText(/6 digits from the app/i), '123456');
  await userEvent.click(screen.getByRole('button', { name: /issue codes/i }));
  await userEvent.click(await screen.findByRole('button', { name: /i have saved the codes/i }));

  expect(await screen.findByRole('button', { name: /change the name/i })).toBeInTheDocument();
});

test('a wrong code on an authenticated screen does not send the user looking for an account id', async () => {
  // There is no id field on this screen. The message used to say "check the account id and the code"
  // because it was written for the signed-out route and then reused everywhere.
  vi.mocked(api.totpConfirm).mockRejectedValue(new ApiFailure('totp_invalid', 401));
  view();
  await userEvent.click(await connect());
  await userEvent.type(await screen.findByPlaceholderText(/^6 digits$/i), '123456');

  expect(await screen.findByText(/that code did not work/i)).toBeInTheDocument();
  expect(screen.queryByText(/account id/i)).not.toBeInTheDocument();
});

test('a server that omits `pending` reads as "nothing to resume", not as undefined', () => {
  // Pinned as a wire contract, not as a behaviour: `undefined` and `false` are falsy in the same
  // places, so nothing at runtime tells them apart. What the default buys is the TYPE — every
  // constructed status must declare `pending`, which is what stops an object literal dropping it.
  expect(TotpStatusSchema.parse({ available: true, enrolled: false, backupCodesLeft: 0 }).pending).toBe(false);
});
