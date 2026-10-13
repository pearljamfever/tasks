// Run with: npm test   (uses Node's built-in test runner; starts the server on a spare port with a throwaway data folder)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
let dataDir, port, proc, base;

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function start() {
  proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: port, HOST: '127.0.0.1', DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.output = '';
  proc.stdout.on('data', (d) => { proc.output += d; });
  proc.stderr.on('data', (d) => { proc.output += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/healthz')).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start:\n' + proc.output);
}

async function stop() {
  if (!proc || proc.exitCode !== null) return;
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGTERM');
  await exited;
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call(urlPath, opts) {
  const res = await fetch(base + urlPath, opts);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

// Sends raw bytes, for requests fetch() refuses to make (bad Host headers, malformed URLs).
function raw(text) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.end(text));
    let out = '';
    s.on('data', (d) => { out += d; });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-test-'));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  await start();
});

after(async () => {
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('serves the page, styles, script and font with security headers', async () => {
  for (const [p, type] of [['/', 'text/html'], ['/app.css', 'text/css'], ['/app.js', 'text/javascript'], ['/fonts/inter-var.woff2', 'font/woff2'], ['/favicon.svg', 'image/svg+xml'], ['/apple-touch-icon.png', 'image/png'], ['/icon-512.png', 'image/png'], ['/manifest.webmanifest', 'application/manifest+json']]) {
    const res = await fetch(base + p);
    assert.strictEqual(res.status, 200, p);
    assert.ok(res.headers.get('content-type').startsWith(type), p);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('page uses caching validators', async () => {
  const first = await fetch(base + '/app.js');
  const again = await fetch(base + '/app.js', { headers: { 'If-None-Match': first.headers.get('etag') } });
  assert.strictEqual(again.status, 304);
});

test('does not serve files outside public/', async () => {
  for (const p of ['/server.js', '/../server.js', '/%2e%2e/server.js', '/fonts/../../server.js', '/data/data.json', '/package.json']) {
    assert.strictEqual((await fetch(base + p)).status, 404, p);
  }
});

test('categories: create, unique names, recolor, rename', async () => {
  const a = await call('/api/categories', json('POST', { name: 'Car' }));
  assert.strictEqual(a.status, 201);
  assert.strictEqual((await call('/api/categories', json('POST', { name: 'car' }))).status, 409);
  assert.strictEqual((await call('/api/categories', json('POST', { name: '  ' }))).status, 400);
  assert.strictEqual((await call(`/api/categories/${a.body.id}`, json('PATCH', { color: 'red' }))).status, 400);
  const r = await call(`/api/categories/${a.body.id}`, json('PATCH', { name: 'Cars', color: '#123456' }));
  assert.deepStrictEqual([r.body.name, r.body.color], ['Cars', '#123456']);
});

test('tasks and note commands', async () => {
  const cat = (await call('/api/categories', json('POST', { name: 'House' }))).body;
  assert.strictEqual((await call('/api/tasks', json('POST', { title: 'x', categoryId: 'nope' }))).status, 400);
  const t = (await call('/api/tasks', json('POST', { title: 'Fix roof', categoryId: cat.id }))).body;

  let r = await call(`/api/tasks/${t.id}/comments`, json('POST', { text: 'plain' }));
  assert.strictEqual(r.body.comments.at(-1).feed, false);
  r = await call(`/api/tasks/${t.id}/comments`, json('POST', { text: 'to feed', kind: 'task' }));
  assert.strictEqual(r.body.comments.at(-1).feed, true);
  assert.strictEqual((await call(`/api/tasks/${t.id}/comments`, json('POST', { text: 'r', kind: 'remind', remindOn: 'tomorrow' }))).status, 400);
  r = await call(`/api/tasks/${t.id}/comments`, json('POST', { text: 'r', kind: 'remind', remindOn: '2026-12-25' }));
  assert.strictEqual(r.body.comments.at(-1).remindOn, '2026-12-25');
  assert.strictEqual((await call(`/api/tasks/${t.id}/comments`, json('POST', { text: 'w', kind: 'waiting' }))).status, 400);
  r = await call(`/api/tasks/${t.id}/comments`, json('POST', { text: 'w', kind: 'waiting', waitingOn: 'Sam' }));
  assert.strictEqual(r.body.waitingOn, 'Sam');

  r = await call(`/api/tasks/${t.id}`, json('PATCH', { done: true }));
  assert.strictEqual(r.body.done, true);
  assert.ok(r.body.completedAt);
  assert.strictEqual(r.body.waitingOn, null, 'completing clears waiting');

  assert.strictEqual((await call(`/api/categories/${cat.id}`, { method: 'DELETE' })).status, 409, 'category with tasks');
  assert.strictEqual((await call(`/api/tasks/${t.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await call(`/api/categories/${cat.id}`, { method: 'DELETE' })).status, 200);
});

test('refuses writes from other websites and non-JSON writes', async () => {
  const body = JSON.stringify({ name: 'Evil' });
  assert.strictEqual((await call('/api/categories', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.strictEqual((await call('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body })).status, 403);
  assert.strictEqual((await call('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body })).status, 403);
  assert.strictEqual((await call('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body })).status, 201, 'own origin is fine');
});

test('refuses unknown Host names (DNS rebinding)', async () => {
  const res = await raw(`GET /api/tasks HTTP/1.1\r\nHost: evil.example:${port}\r\nConnection: close\r\n\r\n`);
  assert.match(res, /^HTTP\/1.1 421/);
  const ok = await raw(`GET /healthz HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
  assert.match(ok, /^HTTP\/1.1 200/);
});

test('rejects oversized bodies and survives malformed requests', async () => {
  const big = JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) });
  const r = await call('/api/categories', json('POST', JSON.parse(big))).catch(() => ({ status: 413 }));
  assert.strictEqual(r.status, 413);
  await raw('GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  await raw('garbage\r\n\r\n');
  assert.strictEqual((await fetch(base + '/healthz')).status, 200, 'still up');
});

test('writes a daily backup', () => {
  const files = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.ok(files.some((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)), files.join(','));
});

test('recovers from a damaged data file using the newest backup', async () => {
  await call('/api/categories', json('POST', { name: 'Keep me' }));
  await stop();
  fs.writeFileSync(path.join(dataDir, 'data.json'), '{ this is not json');
  await start();
  const cats = (await call('/api/categories')).body;
  assert.ok(cats.some((c) => c.name === 'Keep me'), 'data came back from backup');
  assert.ok(fs.readdirSync(dataDir).some((f) => f.startsWith('data.json.corrupt-')), 'damaged file kept aside');
});
