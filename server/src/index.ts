import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
// HOST is optional (local dev / testing). Unset → the node-server default bind.
const hostname = process.env.HOST || undefined;
serve({ fetch: createApp().fetch, port, hostname });
// eslint-disable-next-line no-console
console.log(`dayenglish-api listening on ${hostname ?? '::'}:${port}`);
