import { API_BASE } from './config';
import { ApiFailure } from './api';
import { withDeadline } from '@/shared/lib/deadline';
import {
  ACCESS_ROUTES,
  AccessAccountSchema,
  AccessAvailabilitySchema,
  AccessCapabilitiesSchema,
  AccessResultSchema,
} from './access-contract';
import type { AccessRequest } from './access-contract';

async function request<T>(
  path: string,
  parse: (value: unknown) => T,
  body?: unknown,
  token?: string,
  signal?: AbortSignal
): Promise<T> {
  try {
    return await withDeadline(20_000, signal, async (bounded) => {
      const response = await fetch(`${API_BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        signal: bounded,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code =
          value &&
          typeof value === 'object' &&
          'error' in value &&
          value.error &&
          typeof value.error === 'object' &&
          'code' in value.error &&
          typeof value.error.code === 'string'
            ? value.error.code
            : 'access_unavailable';
        throw new ApiFailure(code, response.status);
      }
      return parse(value);
    });
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new ApiFailure('network', 0);
  }
}

export const accessCapabilities = (signal?: AbortSignal) =>
  request(
    ACCESS_ROUTES.capabilities,
    (value) => AccessCapabilitiesSchema.parse(value),
    undefined,
    undefined,
    signal
  );
export const accessAvailability = (login: string, signal?: AbortSignal) =>
  request(
    ACCESS_ROUTES.availability,
    (value) => AccessAvailabilitySchema.parse(value),
    { login },
    undefined,
    signal
  );
export const accessStatus = (token: string) =>
  request(
    ACCESS_ROUTES.status,
    (value) => AccessAccountSchema.parse(value),
    undefined,
    token
  );
export const accessOperation = (body: AccessRequest, token?: string) =>
  request(
    ACCESS_ROUTES.operation,
    (value) => AccessResultSchema.parse(value),
    body,
    token
  );
export const accessReceipt = (operationToken: string, token?: string) =>
  request(
    ACCESS_ROUTES.receipt,
    (value) => AccessResultSchema.parse(value),
    { operationToken },
    token
  );

export function accessOperationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
