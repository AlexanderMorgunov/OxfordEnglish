import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here = new URL('./', import.meta.url);
let sdk;
try { sdk = import.meta.resolve('@dayenglish/game-sdk'); }
catch { sdk = new URL('../../packages/game-sdk/index.js', here).href; }
const files = new Map([['/', new URL('index.html', here)], ['/sdk.js', new URL(sdk)]]);
http.createServer(async (req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', req.url === '/sdk.js' ? 'text/javascript' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await fs.readFile(fileURLToPath(file)));
  } catch { res.writeHead(500).end('File unavailable'); }
}).listen(5188, 'localhost', () => console.log('Game fixture: http://localhost:5188/ (embed in DayEnglish /games/integration-demo)'));
