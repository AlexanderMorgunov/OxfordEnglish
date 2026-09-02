import { API_BASE } from './config';
import {
  Routes,
  SessionSchema,
  DeviceListSchema,
  DeviceStartResponseSchema,
  DevicePollResponseSchema,
  ApiErrorSchema,
  type AuthRequest,
  type Session,
  type Device,
  type DeviceStartResponse,
  type DevicePollResponse,
} from './contract';

/** A typed API failure carrying the server's stable `code` (see contract ErrorCode). */
export class ApiFailure extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'ApiFailure';
  }
}

async function request<T>(path: string, init: RequestInit, parse: (j: unknown) => T): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    // Network-level failure — surfaced as a soft error the caller can queue/retry on.
    throw new ApiFailure('network', 0, 'network unreachable');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw new ApiFailure(
      parsed.success ? parsed.data.error.code : 'bad_request',
      res.status,
      parsed.success ? parsed.data.error.message : undefined
    );
  }
  return parse(json);
}

const asSession = (j: unknown): Session => SessionSchema.parse(j);

export function register(body: AuthRequest): Promise<Session> {
  return request(Routes.register, { method: 'POST', body: JSON.stringify(body) }, asSession);
}

export function login(body: AuthRequest): Promise<Session> {
  return request(Routes.login, { method: 'POST', body: JSON.stringify(body) }, asSession);
}

export function refresh(refreshToken: string): Promise<Session> {
  return request(
    Routes.refresh,
    { method: 'POST', body: JSON.stringify({ refreshToken }) },
    asSession
  );
}

export function logout(refreshToken: string): Promise<void> {
  return request(Routes.logout, { method: 'POST', body: JSON.stringify({ refreshToken }) }, () => undefined);
}

export function listDevices(accessToken: string): Promise<Device[]> {
  return request(
    Routes.devices,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
    (j) => DeviceListSchema.parse(j).devices
  );
}

/** New device: start a link request; returns the code to show + poll on. No auth. */
export function deviceStart(deviceName?: string): Promise<DeviceStartResponse> {
  return request(
    Routes.deviceStart,
    { method: 'POST', body: JSON.stringify({ deviceName }) },
    (j) => DeviceStartResponseSchema.parse(j)
  );
}

/** Authed device: approve a pending request by its code. Returns the new device's self-chosen name. */
export function deviceApprove(accessToken: string, code: string): Promise<{ deviceName?: string }> {
  return request(
    Routes.deviceApprove,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ code }) },
    (j) => ({ deviceName: (j as { deviceName?: string }).deviceName })
  );
}

/** New device: poll until approved; once approved carries the session (one-time). */
export function devicePoll(requestId: string): Promise<DevicePollResponse> {
  return request(
    `${Routes.devicePoll}?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET' },
    (j) => DevicePollResponseSchema.parse(j)
  );
}

export function deviceRevoke(accessToken: string, deviceId: string): Promise<void> {
  return request(
    Routes.deviceRevoke,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ deviceId }) },
    () => undefined
  );
}
