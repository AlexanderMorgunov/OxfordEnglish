import type { Context } from 'hono';
import type { AccessSecurity } from './accessSecurity.js';

class RollbackResponse extends Error {
  constructor(readonly response: Response) {
    super('Account operation rolled back');
  }
}

export function accessHandler(security?: AccessSecurity) {
  return (handle: (c: Context) => Response | Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      if (!security || !(await security.rows.available())) return handle(c);
      try {
        return await security.rows.atomic(async () => {
          const response = await handle(c);
          if (response.status >= 500) throw new RollbackResponse(response);
          return response;
        });
      } catch (error) {
        if (error instanceof RollbackResponse) return error.response;
        throw error;
      }
    };
}
