import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
// HOST is optional (local dev / testing). Unset → the node-server default bind.
const hostname = process.env.HOST || undefined;
serve({ fetch: createApp().fetch, port, hostname });
// `process.uptime()` here = Node boot + module load + app construction, i.e. everything we control.
// Subtracting it from the platform's cold-start latency says how much is image pull + VM boot, which is
// the only way to know whether shrinking the image (see build.mjs) would buy anything.
// eslint-disable-next-line no-console
console.log(`dayenglish-api listening on ${hostname ?? '::'}:${port} — startup ${Math.round(process.uptime() * 1000)}ms`);
