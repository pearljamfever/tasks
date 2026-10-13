// Card Tasks - a tiny task manager. No dependencies; data lives in DATA_DIR/data.json.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = Number(process.env.KEEP_BACKUPS) || 30;
const MAX_BODY = 1024 * 1024;
const COLORS = ['#4f7cff', '#ef4f6b', '#22a06b', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#a47148'];

// Host names the app answers to, besides IP addresses and localhost. Anything else is refused,
// which stops DNS-rebinding pages from reaching the API under a hostile domain name.
const ALLOWED_HOSTS = new Set([
  'localhost', os.hostname().toLowerCase(), `${os.hostname().toLowerCase()}.local`,
  ...(process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
]);

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const log = (...a) => console.log(...a);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- storage ----------

function nextColor(cats) {
  const used = new Set(cats.map((c) => c.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[cats.length % COLORS.length];
}

// Writes a file so that a crash or power cut leaves either the old or the new version, never half of one.
function writeDurably(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// One backup per day (the last state of that day), keeping the newest KEEP_BACKUPS days.
function backup(text) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    writeDurably(path.join(BACKUP_DIR, `data-${localDay()}.json`), text);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse().slice(KEEP_BACKUPS);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (e) {
    log('Backup failed:', e.message);
  }
}

function save(data) {
  const text = JSON.stringify(data, null, 2);
  writeDurably(DATA_FILE, text);
  backup(text);
}

function parseData(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.tasks)) throw new Error('missing task list');
  return data;
}

// Loads data.json. If it is unreadable, it is set aside and the newest good backup is used instead.
function readData() {
  let text;
  try {
    text = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { tasks: [], categories: [] };
    throw e;
  }
  try {
    return parseData(text);
  } catch (e) {
    const aside = `${DATA_FILE}.corrupt-${Date.now()}`;
    fs.renameSync(DATA_FILE, aside);
    log(`ERROR: ${DATA_FILE} is unreadable (${e.message}); moved it to ${aside}`);
    const backups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort().reverse() : [];
    for (const f of backups) {
      try {
        const data = parseData(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
        log(`Recovered data from backup ${f}`);
        return data;
      } catch { /* try the next one */ }
    }
    log('ERROR: no usable backup found; starting with empty data');
    return { tasks: [], categories: [] };
  }
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const data = readData();
  // Older files stored the category name on each task; turn those into category records.
  if (!data.categories) {
    data.categories = [];
    for (const t of data.tasks) {
      const name = t.category || 'General';
      let cat = data.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (!cat) {
        cat = { id: id(), name, color: nextColor(data.categories), createdAt: now() };
        data.categories.push(cat);
      }
      t.categoryId = cat.id;
      delete t.category;
      if (t.done && !t.completedAt) t.completedAt = t.updatedAt;
    }
  }
  save(data);
  return data;
}

let db = load();

// ---------- http helpers ----------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large'));
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'Bad JSON')); }
    });
    req.on('error', reject);
  });
}

const hostName = (h) => {
  const v = String(h || '').toLowerCase();
  return v.startsWith('[') ? v.slice(0, v.indexOf(']') + 1) : v.split(':')[0];
};
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[');

function checkHost(req) {
  const h = hostName(req.headers.host);
  if (!h || !(isIp(h) || ALLOWED_HOSTS.has(h))) {
    throw new HttpError(421, `Unknown host "${h}". Add it to ALLOWED_HOSTS to use this name.`);
  }
}

// Changes must come from this app's own page: same origin, sent as JSON. A plain form or
// "simple" cross-site request from another website is refused.
function checkWrite(req) {
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let oh;
    try { oh = new URL(origin).host.toLowerCase(); } catch { oh = ''; }
    if (oh !== String(req.headers.host || '').toLowerCase()) throw new HttpError(403, 'Cross-site request refused');
  } else if (origin === 'null') {
    throw new HttpError(403, 'Cross-site request refused');
  }
  if (req.method !== 'DELETE' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Send JSON');
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  const type = STATIC_TYPES[path.extname(file)];
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !type) return send(res, 404, { error: 'Not found' });
  let stat;
  try { stat = fs.statSync(file); } catch { return send(res, 404, { error: 'Not found' }); }
  if (!stat.isFile()) return send(res, 404, { error: 'Not found' });
  const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': 'no-cache' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---------- API ----------

const nameTaken = (name, exceptId) =>
  db.categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
// Note kinds, one per "/" command. Plain notes are 'note'.
const KINDS = ['note', 'task', 'remind', 'waiting'];
const validDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00'));
const validColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

async function categoriesApi(req, res, catId) {
  const cat = catId && db.categories.find((c) => c.id === catId);
  if (catId && !cat) return send(res, 404, { error: 'Category not found' });

  if (!catId && req.method === 'GET') return send(res, 200, db.categories);

  if (!catId && req.method === 'POST') {
    const b = await readBody(req);
    const name = clean(b.name, 60);
    if (!name) return send(res, 400, { error: 'Category name is required' });
    if (nameTaken(name)) return send(res, 409, { error: `There is already a category called "${name}"` });
    const c = { id: id(), name, color: validColor(b.color) ? b.color : nextColor(db.categories), createdAt: now() };
    db.categories.push(c);
    save(db);
    return send(res, 201, c);
  }

  if (catId && req.method === 'PATCH') {
    const b = await readBody(req);
    if (b.name !== undefined) {
      const name = clean(b.name, 60);
      if (!name) return send(res, 400, { error: 'Category name is required' });
      if (nameTaken(name, cat.id)) return send(res, 409, { error: `There is already a category called "${name}"` });
      cat.name = name;
    }
    if (b.color !== undefined) {
      if (!validColor(b.color)) return send(res, 400, { error: 'Bad color' });
      cat.color = b.color;
    }
    save(db);
    return send(res, 200, cat);
  }

  if (catId && req.method === 'DELETE') {
    const n = db.tasks.filter((t) => t.categoryId === cat.id).length;
    if (n) return send(res, 409, { error: `"${cat.name}" still has ${n} task${n === 1 ? '' : 's'}. Move or delete them first.` });
    db.categories = db.categories.filter((c) => c.id !== cat.id);
    save(db);
    return send(res, 200, { ok: true });
  }

  send(res, 405, { error: 'Not allowed' });
}

async function tasksApi(req, res, parts) {
  // parts: [id?, 'comments'?, commentId?]
  const [taskId, sub, commentId] = parts;
  const task = taskId && db.tasks.find((t) => t.id === taskId);
  if (taskId && !task) return send(res, 404, { error: 'Task not found' });
  const catExists = (cid) => db.categories.some((c) => c.id === cid);

  if (!taskId && req.method === 'GET') return send(res, 200, db.tasks);

  if (!taskId && req.method === 'POST') {
    const b = await readBody(req);
    const title = clean(b.title, 200);
    if (!title) return send(res, 400, { error: 'Title is required' });
    if (!catExists(b.categoryId)) return send(res, 400, { error: 'Pick a category' });
    const t = {
      id: id(), title, categoryId: b.categoryId,
      done: false, createdAt: now(), updatedAt: now(), completedAt: null, comments: [],
    };
    db.tasks.push(t);
    save(db);
    return send(res, 201, t);
  }

  if (taskId && !sub && req.method === 'PATCH') {
    const b = await readBody(req);
    if (b.title !== undefined) {
      const title = clean(b.title, 200);
      if (!title) return send(res, 400, { error: 'Title is required' });
      task.title = title;
    }
    if (b.categoryId !== undefined) {
      if (!catExists(b.categoryId)) return send(res, 400, { error: 'Unknown category' });
      task.categoryId = b.categoryId;
    }
    if (b.done !== undefined && !!b.done !== task.done) {
      task.done = !!b.done;
      task.completedAt = task.done ? now() : null;
      if (task.done) task.waitingOn = null;
    }
    if (b.waitingOn !== undefined) task.waitingOn = clean(b.waitingOn, 80) || null;
    task.updatedAt = now();
    save(db);
    return send(res, 200, task);
  }

  if (taskId && !sub && req.method === 'DELETE') {
    db.tasks = db.tasks.filter((t) => t.id !== taskId);
    save(db);
    return send(res, 200, { ok: true });
  }

  if (sub === 'comments' && !commentId && req.method === 'POST') {
    const b = await readBody(req);
    const text = clean(b.text, 5000);
    if (!text) return send(res, 400, { error: 'Comment is empty' });
    const kind = KINDS.includes(b.kind) ? b.kind : 'note';
    const c = { id: id(), text, kind, feed: !!b.feed, createdAt: now() };
    if (kind === 'task' || kind === 'remind') c.feed = true;
    if (kind === 'remind') {
      if (!validDate(b.remindOn)) return send(res, 400, { error: 'Pick a date for the reminder' });
      c.remindOn = b.remindOn;
    }
    if (kind === 'waiting') {
      const who = clean(b.waitingOn, 80);
      if (!who) return send(res, 400, { error: 'Who are you waiting on?' });
      c.waitingOn = who;
      task.waitingOn = who;
    }
    task.comments.push(c);
    task.updatedAt = now();
    save(db);
    return send(res, 201, task);
  }

  if (sub === 'comments' && commentId && req.method === 'PATCH') {
    const c = task.comments.find((x) => x.id === commentId);
    if (!c) return send(res, 404, { error: 'Comment not found' });
    const b = await readBody(req);
    if (b.feed !== undefined) c.feed = !!b.feed;
    save(db);
    return send(res, 200, task);
  }

  if (sub === 'comments' && commentId && req.method === 'DELETE') {
    task.comments = task.comments.filter((c) => c.id !== commentId);
    task.updatedAt = now();
    save(db);
    return send(res, 200, task);
  }

  send(res, 405, { error: 'Not allowed' });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  // Everything is inside the try: one malformed request must not take the server down.
  try {
    checkHost(req);
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const read = req.method === 'GET' || req.method === 'HEAD';

    if (url.pathname === '/healthz') return send(res, 200, { ok: true, tasks: db.tasks.length });
    if (parts[0] === 'api') {
      if (!read) checkWrite(req);
      if (parts[1] === 'tasks') return await tasksApi(req, res, parts.slice(2));
      if (parts[1] === 'categories') return await categoriesApi(req, res, parts[2]);
      return send(res, 404, { error: 'Not found' });
    }
    if (read) return serveStatic(req, res, url.pathname);
    send(res, 405, { error: 'Not allowed' });
  } catch (e) {
    if (!(e instanceof HttpError)) log(`ERROR ${req.method} ${req.url}:`, e.stack || e);
    if (res.headersSent) return res.destroy();
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the server' });
  }
});

server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.on('error', (e) => {
  log(e.code === 'EADDRINUSE' ? `ERROR: port ${PORT} is already in use by another program. Set PORT to a free port.` : `ERROR: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => log(`Card Tasks listening on http://${HOST}:${PORT} (data: ${DATA_DIR})`));

// Saves are synchronous, so by the time a signal is handled no write is half-done.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
