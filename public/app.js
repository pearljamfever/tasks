const $ = (s, el = document) => el.querySelector(s);
const NEW = '__new__';
const PALETTE = ['#4f7cff', '#ef4f6b', '#22a06b', '#f59e0b', '#8b5cf6', '#14b8a6', '#ec4899', '#a47148'];

const svg = (d, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  stack: svg('<rect x="4" y="7" width="13" height="14" rx="2.5"/><path d="M8 3h9.5A2.5 2.5 0 0 1 20 5.5V17"/>', 17),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 14),
  checkCircle: svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  tag: svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor"/>'),
  note: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 13),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 13),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', 13),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', 15),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 15),
  hourglass: svg('<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>', 13),
  send: svg('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>', 15),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>', 18),
};
const icon = (name) => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = ICONS[name]; return s; };
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon]; el.classList.add('ico'); });

let tasks = [];
let cats = [];
let openCat = null;      // category id currently spread out
let detailId = null;     // task open in the detail panel
let closing = null;      // timer while the spread is gathering back up
let paletteFor = null;   // category whose color picker is open
let lastCat = null;
let busy = false;        // an add (note / task / category) is in flight; ignores repeat presses
const drafts = new Map(); // task id -> unsent note { text, mode, extra }, kept across re-renders and reopening
try { lastCat = localStorage.getItem('lastCat'); } catch {}

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.entries(v).forEach(([p, val]) => el.style.setProperty(p, val));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    alert('Can’t reach the server. Nothing was saved — try again in a moment.');
    throw new Error('Server unreachable');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { alert(data.error || 'Something went wrong'); throw new Error(data.error); }
  return data;
}

const catById = (id) => cats.find((c) => c.id === id);
const colorOf = (id) => catById(id)?.color || '#9aa0ae';
const catName = (id) => catById(id)?.name || 'Uncategorized';
const sortedCats = () => cats.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const stamp = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- dates (reminders use local YYYY-MM-DD days) ----------
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
const todayIso = () => isoDay(new Date());
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function dayLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  const diff = Math.round((d - new Date(todayIso() + 'T00:00:00')) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
}

// Builds a date and rejects overflow like 2/31.
function makeDay(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getMonth() === m && dt.getDate() === d ? isoDay(dt) : null;
}

// Reads "today", "tomorrow", "tue", "next friday", "3d", "2w", "10/14", "10/14/26", "2026-10-14" or "oct 14".
function parseDay(str) {
  const s = str.toLowerCase().trim().replace(/^next\s+/, '');
  const now = new Date();
  let m;
  if (s === 'today' || s === 'tod') return todayIso();
  if (s === 'tomorrow' || s === 'tmrw' || s === 'tom') return dayFromNow(1);
  if ((m = s.match(/^(\d+)\s*(d|days?|w|wks?|weeks?)$/))) return dayFromNow(+m[1] * (m[2][0] === 'w' ? 7 : 1));
  if (s.length >= 3) {
    const wd = WEEKDAYS.findIndex((w) => w.startsWith(s));
    if (wd >= 0) return dayFromNow((wd - now.getDay() + 7) % 7 || 7);
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return makeDay(+m[1], +m[2] - 1, +m[3]);
  let month, day, year;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) [month, day, year] = [+m[1] - 1, +m[2], m[3]];
  else if ((m = s.match(/^([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/))) {
    month = MONTHS.findIndex((mo) => mo.startsWith(m[1]));
    if (month < 0) return null;
    day = +m[2];
  } else return null;
  if (year) return makeDay(year.length === 2 ? 2000 + +year : +year, month, day);
  const iso = makeDay(now.getFullYear(), month, day);
  return iso && iso < todayIso() ? makeDay(now.getFullYear() + 1, month, day) : iso;
}

const openTasks = () => tasks.filter((t) => !t.done);
const doneTasks = () => tasks.filter((t) => t.done).sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));

function groups() {
  const open = openTasks();
  return sortedCats()
    .map((c) => ({ cat: c, list: open.filter((t) => t.categoryId === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }))
    .filter((g) => g.list.length);
}

function upsert(t) {
  const i = tasks.findIndex((x) => x.id === t.id);
  if (i >= 0) tasks[i] = t; else tasks.push(t);
}

// ---------- card sizes ----------
let CW, CH, GAP;
function setSizes() {
  const small = window.innerWidth < 640;
  CW = small ? 136 : 156; CH = Math.round(CW * 1.4); GAP = small ? 16 : 26;
  const r = document.documentElement.style;
  r.setProperty('--cw', CW + 'px'); r.setProperty('--ch', CH + 'px');
}

// ---------- pieces ----------
const chip = (catId) => h('span', { class: 'chip', style: { '--cat': colorOf(catId) } }, h('i', { class: 'dot' }), catName(catId));

function cardFace(t) {
  return h('div', { class: 'card', style: { '--cat': colorOf(t.categoryId) } },
    chip(t.categoryId),
    h('div', { class: 'card-title' }, t.title),
    t.waitingOn ? h('div', { class: 'card-wait', title: `Waiting on ${t.waitingOn}` }, icon('hourglass'), h('span', {}, t.waitingOn)) : null,
    h('div', { class: 'card-foot' }, icon('note'), String(t.comments.length), h('span', { class: 'age' }, ago(t.updatedAt))),
  );
}

// Fills a category <select>; returns a function that re-syncs the color dot beside it.
function catSelect(select, selectedId, withNew) {
  select.replaceChildren(
    ...sortedCats().map((c) => h('option', { value: c.id }, c.name)),
    ...(withNew ? [h('option', { value: NEW }, cats.length ? '+ New category…' : '+ Create a category…')] : []),
  );
  select.value = catById(selectedId) ? selectedId : (cats.length ? sortedCats()[0].id : NEW);
  const sync = () => select.parentElement.style.setProperty('--cat', select.value === NEW ? 'var(--line-strong)' : colorOf(select.value));
  sync();
  return sync;
}

// ---------- board ----------
function render() {
  $('#completedCount').textContent = doneTasks().length;
  const board = $('#board');
  board.replaceChildren();

  const gs = groups();
  if (!gs.length) {
    const anyDone = doneTasks().length > 0;
    board.append(h('div', { class: 'empty' },
      h('div', { class: 'empty-art' }, h('span'), h('span'), h('span', {}, icon(anyDone ? 'checkCircle' : 'stack'))),
      h('h2', {}, anyDone ? 'All caught up' : 'No tasks yet'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => openNew() }, icon('plus'), 'New task'),
        cats.length ? null : h('button', { class: 'hbtn', onclick: openCats }, icon('tag'), 'Set up categories'),
      ),
    ));
  }
  for (const { cat, list } of gs) {
    const layers = Math.min(list.length, 4);
    const pile = h('div', { class: 'pile' });
    for (let k = layers - 1; k >= 1; k--) {
      pile.append(h('div', { class: 'layer', style: { '--k': k } }, h('div', { class: 'card blank', style: { '--cat': cat.color } })));
    }
    pile.append(h('div', { class: 'layer top', style: { '--k': 0 } }, cardFace(list[0])));
    const open = (e) => openSpread(cat.id, e.currentTarget);
    const stack = h('div', {
      class: 'stack', tabindex: 0, role: 'button', 'aria-label': `${cat.name}, ${plural(list.length, 'task')}`,
      onclick: open,
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } },
    },
      pile,
      h('div', { class: 'stack-label', style: { '--cat': cat.color } }, h('i', { class: 'dot' }), h('b', { title: cat.name }, cat.name),
        h('span', { class: 'badge' }, list.length)),
    );
    stack.dataset.cat = cat.id;
    if (cat.id === openCat) stack.style.visibility = 'hidden';
    board.append(stack);
  }
  renderFeed();
  if (openCat && !closing) renderSpread();
  if ($('#completedModal').classList.contains('show')) renderCompleted();
  if ($('#catsModal').classList.contains('show')) renderCats();
}

// ---------- feed ----------
// Reminders appear once their day arrives and sit at the top until dismissed; everything else is newest first.
function renderFeed() {
  const today = todayIso();
  const all = tasks.flatMap((t) => t.comments.filter((c) => c.feed).map((c) => ({ t, c, kind: kindOf(c) })));
  const due = all.filter((x) => x.kind === 'remind' && x.c.remindOn <= today && !x.t.done).sort((a, b) => a.c.remindOn.localeCompare(b.c.remindOn));
  const rest = all.filter((x) => x.kind !== 'remind').sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt));
  const items = [...due, ...rest].slice(0, 100);
  $('#feed').replaceChildren(
    h('div', { class: 'feed-head' }, h('span', { class: 'bolt' }, icon('bolt')), h('h2', {}, 'Feed'), items.length ? h('span', { class: 'badge' }, items.length) : null),
    items.length
      ? h('div', { class: 'feed-list' }, items.map(({ t, c, kind }) => h('div', { class: `feed-item${t.done ? ' done' : ''}${kind === 'remind' ? ' reminder' : ''}`, style: { '--cat': colorOf(t.categoryId) } },
          h('button', { class: 'feed-main', title: 'Open task', onclick: () => openDetail(t.id) },
            h('div', { class: 'feed-src' },
              h('span', { class: 'kind-ico', title: KINDS[kind].label, style: { '--cmd': KINDS[kind].color } }, icon(KINDS[kind].icon)),
              h('b', {}, t.title),
              h('span', { class: 'when' }, kind === 'remind' ? dayLabel(c.remindOn) : ago(c.createdAt))),
            h('p', {}, c.text),
          ),
          h('button', { class: 'icon-btn', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => setFeed(t, c, false) }, icon('x')),
        )))
      : h('div', { class: 'feed-empty' }, 'Nothing here yet.'),
  );
}

async function setFeed(t, c, on) {
  upsert(await api('PATCH', `/api/tasks/${t.id}/comments/${c.id}`, { feed: on }));
  render();
  if (detailId === t.id) renderDetail();
}

const stackEl = (id) => [...document.querySelectorAll('.stack')].find((s) => s.dataset.cat === id);

// ---------- spread ----------
function layout(count) {
  const area = $('#spreadArea');
  const W = area.clientWidth;
  const cols = Math.max(1, Math.floor((W + GAP) / (CW + GAP)));
  const used = cols * CW + (cols - 1) * GAP;
  const x0 = Math.max(0, (W - used) / 2);
  area.style.height = Math.ceil(count / cols) * (CH + GAP) + 'px';
  return Array.from({ length: count }, (_, i) => ({ x: x0 + (i % cols) * (CW + GAP), y: Math.floor(i / cols) * (CH + GAP) }));
}

function buildSlots(list) {
  const slots = list.map((t) => h('div', {
    class: 'slot', tabindex: 0, role: 'button', 'aria-label': t.title,
    onclick: (e) => { e.stopPropagation(); openDetail(t.id); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(t.id); } },
  }, cardFace(t)));
  slots.push(h('div', {
    class: 'slot', tabindex: 0, role: 'button', 'aria-label': 'Add a task',
    onclick: (e) => { e.stopPropagation(); openNew(openCat); },
    onkeydown: (e) => { if (e.key === 'Enter') openNew(openCat); },
  }, h('div', { class: 'card add' }, h('div', { class: 'plus' }, icon('plus')), 'Add task')));
  return slots;
}

// Offset that moves a slot from its spread position back onto the stack.
function toPile(pos, i, pileRect, areaRect) {
  const k = Math.min(i, 3);
  return `translate(${pileRect.left - areaRect.left - pos.x + k * 3}px, ${pileRect.top - areaRect.top - pos.y + k * 4}px)`;
}

function setSpreadTitle(cat, n) {
  $('#spreadTitle').replaceChildren(
    h('i', { class: 'dot', style: { '--cat': cat.color } }), h('span', {}, cat.name), h('span', { class: 'badge' }, n));
}

function openSpread(catId, stack) {
  if (closing) return;
  const g = groups().find((x) => x.cat.id === catId);
  if (!g) return;
  openCat = catId;
  setSpreadTitle(g.cat, g.list.length);

  const spread = $('#spread');
  const area = $('#spreadArea');
  spread.classList.add('show');
  spread.scrollTop = 0;
  const slots = buildSlots(g.list);
  area.replaceChildren(...slots);
  const pos = layout(slots.length);
  const pileRect = $('.pile', stack).getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();

  slots.forEach((s, i) => {
    s.style.left = pos[i].x + 'px';
    s.style.top = pos[i].y + 'px';
    s.style.zIndex = slots.length - i;
    s.style.transition = 'none';
    s.style.transform = toPile(pos[i], i, pileRect, areaRect);
    if (i === slots.length - 1) s.style.opacity = 0; // the "add" slot fades in
  });
  stack.style.visibility = 'hidden';
  area.offsetWidth; // flush styles so the transition starts from the pile

  requestAnimationFrame(() => {
    spread.classList.add('open');
    slots.forEach((s, i) => {
      s.style.transition = `transform .55s cubic-bezier(.2,.8,.2,1) ${i * 40}ms, opacity .3s ease ${i * 40 + 200}ms`;
      s.style.transform = '';
      s.style.opacity = '';
    });
  });
}

// Re-draw the open spread in place (after edits) without the deal animation.
function renderSpread() {
  const g = groups().find((x) => x.cat.id === openCat);
  if (!g) return closeSpread();
  setSpreadTitle(g.cat, g.list.length);
  const area = $('#spreadArea');
  const slots = buildSlots(g.list);
  area.replaceChildren(...slots);
  const pos = layout(slots.length);
  slots.forEach((s, i) => { s.style.left = pos[i].x + 'px'; s.style.top = pos[i].y + 'px'; });
}

function closeSpread() {
  if (!openCat || closing) return;
  const spread = $('#spread');
  const area = $('#spreadArea');
  const slots = [...area.children];
  const stack = stackEl(openCat);
  if (stack) {
    const pileRect = $('.pile', stack).getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    slots.forEach((s, i) => {
      const pos = { x: parseFloat(s.style.left), y: parseFloat(s.style.top) };
      s.style.zIndex = slots.length - i;
      s.style.transition = `transform .4s cubic-bezier(.5,0,.6,1) ${(slots.length - 1 - i) * 25}ms, opacity .2s ease`;
      s.style.transform = toPile(pos, i, pileRect, areaRect);
      if (i === slots.length - 1) s.style.opacity = 0;
    });
  } else {
    slots.forEach((s) => { s.style.transition = 'opacity .25s'; s.style.opacity = 0; });
  }
  spread.classList.remove('open');
  const id = openCat;
  closing = setTimeout(() => {
    spread.classList.remove('show');
    area.replaceChildren();
    openCat = null; closing = null;
    // The board may have been re-rendered during the animation, so look the stack up again.
    const current = stackEl(id);
    if (current) { current.style.visibility = ''; current.focus({ preventScroll: true }); }
  }, 420 + slots.length * 25);
}

$('#spreadClose').onclick = closeSpread;
$('#spreadAdd').onclick = () => openNew(openCat);
$('#spread').addEventListener('click', (e) => {
  if (e.target.id === 'spread' || e.target.id === 'spreadArea') closeSpread();
});

// ---------- task detail ----------
function openDetail(id) {
  detailId = id;
  renderDetail();
  $('#detail').classList.add('show');
  const notes = $('.notes', $('#detailPanel'));
  if (notes) notes.scrollTop = notes.scrollHeight;
  if (matchMedia('(hover: hover)').matches) setTimeout(() => $('#noteText')?.focus(), 50);
}

function closeDetail() {
  $('#detail').classList.remove('show');
  detailId = null;
}

async function patchTask(t, body) {
  upsert(await api('PATCH', `/api/tasks/${t.id}`, body));
  render();
  if (detailId === t.id) renderDetail();
}

function renderDetail() {
  const t = tasks.find((x) => x.id === detailId);
  const panel = $('#detailPanel');
  if (!t) return closeDetail();
  panel.style.setProperty('--cat', colorOf(t.categoryId));
  const sameTask = panel.dataset.task === t.id;
  panel.dataset.task = t.id;
  const focused = !sameTask ? null
    : document.activeElement?.id === 'noteText' ? { el: 'note', start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
    : document.activeElement?.classList.contains('chip-input') ? { el: 'extra' } : null;

  const title = h('textarea', { class: 'title-input', rows: 1, maxlength: 200, 'aria-label': 'Task title' });
  title.value = t.title;
  const grow = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', grow);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', () => {
    const v = title.value.trim();
    if (!v) { title.value = t.title; grow(); return; }
    if (v !== t.title) patchTask(t, { title: v });
  });

  const sel = h('select', { class: 'select', 'aria-label': 'Category' });
  const selWrap = h('div', { class: 'cat-select-wrap' }, h('i', { class: 'dot' }), sel);
  const sync = catSelect(sel, t.categoryId, false);
  sel.addEventListener('change', () => { sync(); patchTask(t, { categoryId: sel.value }); });

  const notes = t.comments.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const noteText = h('textarea', { id: 'noteText', class: 'input', rows: 3, maxlength: 5000, placeholder: 'Add a note…' });
  const saveDraft = () => {
    const d = { text: noteText.value, mode: slash.mode()?.name || null, extra: slash.value() };
    if (d.text.trim() || d.mode) drafts.set(t.id, d); else drafts.delete(t.id);
  };
  const slash = slashCommands(noteText, saveDraft);
  noteText.addEventListener('input', saveDraft);
  const draft = drafts.get(t.id);
  if (draft) { noteText.value = draft.text; slash.restore(draft.mode, draft.extra); }

  const addNote = async () => {
    if (busy) return;
    let text = noteText.value.trim();
    let kind = slash.mode()?.name || 'note';
    let remindOn = kind === 'remind' ? slash.value() : null;
    let waitingOn = kind === 'waiting' ? slash.value().trim() : null;

    // Commands can also be typed out in full, e.g. "/remind tue Call the plumber" or "/waiting Sam: sending the quote".
    const typed = kind === 'note' && text.match(/^\/(\w+)\b\s*/);
    if (typed && KINDS[typed[1].toLowerCase()]) {
      kind = typed[1].toLowerCase();
      text = text.slice(typed[0].length);
      if (kind === 'remind') {
        const words = text.split(/\s+/);
        const n = [2, 1].find((k) => words.length >= k && parseDay(words.slice(0, k).join(' ')));
        if (!n) { alert('Couldn’t read the reminder date. Try /remind tue, /remind 10/14 or /remind 3d.'); return; }
        remindOn = parseDay(words.slice(0, n).join(' '));
        text = words.slice(n).join(' ');
      }
      if (kind === 'waiting') {
        const m = text.match(/^(.+?)\s*(?:[:,]|\s[-–—]\s)\s*([\s\S]*)$/);
        [waitingOn, text] = m ? [m[1], m[2]] : [text, ''];
      }
      text = text.trim();
    }

    if (kind === 'remind' && !remindOn) return slash.focusExtra();
    if (kind === 'waiting' && !waitingOn) return slash.focusExtra();
    if (!text && kind === 'waiting') text = `Waiting on ${waitingOn}`;
    if (!text) return noteText.focus();
    busy = true;
    try { upsert(await api('POST', `/api/tasks/${t.id}/comments`, { text, kind, remindOn, waitingOn })); }
    finally { busy = false; }
    drafts.delete(t.id);
    render(); renderDetail();
    const list = $('.notes', panel); list.scrollTop = list.scrollHeight;
    $('#noteText').focus();
  };
  noteText.addEventListener('keydown', (e) => {
    if (slash.handleKey(e)) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); }
  });

  panel.replaceChildren(
    h('div', { class: 'detail-top' },
      h('div', { class: 'detail-row' },
        selWrap,
        t.done ? h('span', { class: 'done-banner' }, icon('check'), 'Completed') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeDetail }, icon('x')),
      ),
      title,
      h('div', { class: 'meta' },
        h('span', {}, icon('cal'), `Added ${stamp(t.createdAt)}`),
        t.done && t.completedAt
          ? h('span', {}, icon('check'), `Completed ${ago(t.completedAt)}`)
          : h('span', {}, icon('clock'), `Updated ${ago(t.updatedAt)}`),
      ),
      h('div', { class: 'actions' },
        t.done
          ? h('button', { class: 'pbtn', onclick: () => patchTask(t, { done: false }) }, icon('undo'), 'Reopen task')
          : h('button', { class: 'pbtn success', onclick: () => patchTask(t, { done: true }) }, icon('check'), 'Mark complete'),
        h('button', {
          class: 'pbtn danger',
          onclick: async () => {
            if (!confirm(`Delete "${t.title}" and its notes?`)) return;
            await api('DELETE', `/api/tasks/${t.id}`);
            tasks = tasks.filter((x) => x.id !== t.id);
            closeDetail(); render();
          },
        }, icon('trash'), 'Delete'),
        t.waitingOn && !t.done ? h('span', { class: 'wait-banner' }, icon('hourglass'), `Waiting on ${t.waitingOn}`,
          h('button', { title: 'No longer waiting', 'aria-label': 'No longer waiting', onclick: () => patchTask(t, { waitingOn: null }) }, icon('x'))) : null,
      ),
    ),
    h('div', { class: 'notes' },
      h('div', { class: 'section-title' }, notes.length ? `Progress notes · ${notes.length}` : 'Progress notes'),
      notes.length
        ? h('div', { class: 'timeline' }, notes.map((c) => h('div', { class: 'note' },
            h('time', {}, stamp(c.createdAt), noteTag(c)),
            h('p', {}, c.text),
            h('button', {
              class: 'icon-btn danger', title: 'Delete note', 'aria-label': 'Delete note',
              onclick: async () => {
                if (!confirm('Delete this note?')) return;
                upsert(await api('DELETE', `/api/tasks/${t.id}/comments/${c.id}`)); render(); renderDetail();
              },
            }, icon('trash')),
          )))
        : h('p', { class: 'no-notes' }, 'No notes yet.'),
    ),
    h('div', { class: 'compose' }, h('div', { class: 'compose-box' }, slash.chip, noteText, slash.menu),
      h('div', { class: 'compose-row' },
        h('button', { class: 'pbtn primary', onclick: addNote }, icon('send'), 'Add note'),
      ),
    ),
  );
  requestAnimationFrame(grow);
  if (focused?.el === 'note') { noteText.focus(); noteText.setSelectionRange(focused.start, focused.end); }
  if (focused?.el === 'extra') slash.focusExtra();
}

$('#detail').addEventListener('click', (e) => { if (e.target.id === 'detail') closeDetail(); });

// ---------- slash commands in the note box ----------
const KINDS = {
  task: { label: 'Task', icon: 'bolt', color: '#f59e0b' },
  remind: { label: 'Remind', icon: 'bell', color: '#4f7cff' },
  waiting: { label: 'Waiting', icon: 'hourglass', color: '#64748b' },
};
const COMMANDS = Object.entries(KINDS).map(([name, k]) => ({ name, ...k }));

// Older feed notes were saved before kinds existed; they were all /task notes.
const kindOf = (c) => c.kind || (c.feed ? 'task' : 'note');

function noteTag(c) {
  const kind = kindOf(c);
  const k = KINDS[kind];
  if (!k) return null;
  const tag = (...kids) => h('span', { class: 'feed-tag', style: { '--cmd': k.color } }, icon(k.icon), ...kids);
  if (kind === 'task') return c.feed ? tag('In feed') : null;
  if (kind === 'remind') return tag(`Reminder · ${dayLabel(c.remindOn)}`);
  if (kind === 'waiting') return tag(`Waiting on ${c.waitingOn}`);
}

// Wires a "/" command menu onto a textarea. Picking a command turns it into a chip above the box.
function slashCommands(input, onChange) {
  let mode = null, extra = null, matches = [], active = 0, query = '';
  const chip = h('span', { class: 'cmd-chip' });
  const menu = h('div', { class: 'slash-menu', role: 'listbox' });

  // /remind and /waiting carry an extra value (a date / a name) in a small field on the chip.
  function setMode(cmd) {
    mode = cmd;
    extra = null;
    if (cmd?.name === 'remind') extra = h('input', { class: 'chip-input', type: 'date', value: dayFromNow(1), min: todayIso(), 'aria-label': 'Reminder date' });
    if (cmd?.name === 'waiting') {
      extra = h('input', { class: 'chip-input', type: 'text', maxlength: 80, placeholder: 'Who?', 'aria-label': 'Waiting on' });
      extra.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.focus(); } });
    }
    extra?.addEventListener('input', () => onChange?.());
    chip.replaceChildren(...(cmd ? [
      icon(cmd.icon), cmd.label, extra,
      h('button', { type: 'button', 'aria-label': 'Remove command', onclick: () => { setMode(null); input.focus(); } }, icon('x')),
    ].filter(Boolean) : []));
    if (cmd) chip.style.setProperty('--cmd', cmd.color);
    chip.classList.toggle('show', !!cmd);
    onChange?.();
  }
  function hide() { matches = []; menu.classList.remove('show'); }
  function draw() {
    menu.replaceChildren(h('div', { class: 'menu-title' }, 'Commands'), ...matches.map((c, i) => h('button', {
      type: 'button', class: 'cmd', role: 'option', 'aria-selected': String(i === active),
      onmousedown: (e) => { e.preventDefault(); pick(c); },
    }, h('span', { class: 'bolt', style: { '--cmd': c.color } }, icon(c.icon)), h('b', {}, '/' + c.name))));
    menu.classList.add('show');
  }
  function update() {
    const before = input.value.slice(0, input.selectionStart);
    const m = before.match(/(^|\s)\/(\w*)$/);
    if (!m) return hide();
    query = m[2].toLowerCase();
    matches = COMMANDS.filter((c) => c.name.startsWith(query));
    if (!matches.length) return hide();
    active = Math.min(active, matches.length - 1);
    draw();
  }
  function pick(cmd) {
    const pos = input.selectionStart;
    const start = pos - query.length - 1;
    input.value = input.value.slice(0, start) + input.value.slice(pos);
    input.setSelectionRange(start, start);
    setMode(cmd);
    hide();
    (cmd.name === 'waiting' ? extra : input).focus();
  }
  input.addEventListener('input', () => { active = 0; update(); });
  input.addEventListener('click', update);
  input.addEventListener('blur', () => setTimeout(hide, 100));

  return {
    chip, menu,
    mode: () => mode,
    value: () => extra?.value || '',
    focusExtra: () => extra?.focus(),
    restore(name, value) {
      const cmd = COMMANDS.find((c) => c.name === name);
      if (!cmd) return;
      setMode(cmd);
      if (extra && value != null) extra.value = value;
      onChange?.();
    },
    // Returns true when the key was used by the menu.
    handleKey(e) {
      if (menu.classList.contains('show')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          draw(); return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return true; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return true; }
      }
      return false;
    },
  };
}

// ---------- completed ----------
function openCompleted() { renderCompleted(); $('#completedModal').classList.add('show'); }
const closeCompleted = () => $('#completedModal').classList.remove('show');

function renderCompleted() {
  const done = doneTasks();
  $('#completedPanel').replaceChildren(
    h('div', { class: 'panel-head' },
      h('div', { class: 'panel-icon' }, icon('checkCircle')),
      h('h2', {}, 'Completed'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeCompleted }, icon('x')),
    ),
    h('div', { class: 'panel-body' },
      done.length
        ? h('div', { class: 'list' }, done.map((t) => h('div', { class: 'row-item', style: { '--cat': colorOf(t.categoryId) } },
            h('span', { class: 'done-check' }, icon('check')),
            h('button', { class: 'row-main', onclick: () => openDetail(t.id), title: 'Open task' },
              h('b', {}, t.title),
              h('small', {}, chip(t.categoryId), `Completed ${ago(t.completedAt || t.updatedAt)}`, t.comments.length ? ` · ${plural(t.comments.length, 'note')}` : ''),
            ),
            h('button', { class: 'pbtn', onclick: () => patchTask(t, { done: false }) }, icon('undo'), 'Reopen'),
          )))
        : h('div', { class: 'empty-small' }, h('div', { class: 'panel-icon' }, icon('checkCircle')), 'Nothing completed yet.'),
    ),
  );
}

// ---------- categories ----------
function openCats() { paletteFor = null; renderCats(); $('#catsModal').classList.add('show'); setTimeout(() => $('#addCatName')?.focus(), 50); }
const closeCats = () => $('#catsModal').classList.remove('show');

async function addCategory(name) {
  const c = await api('POST', '/api/categories', { name });
  cats.push(c);
  return c;
}

function renderCats() {
  const count = (id) => tasks.filter((t) => t.categoryId === id).length;
  const addInput = h('input', { class: 'input', id: 'addCatName', maxlength: 60, placeholder: 'New category name' });
  const add = async () => {
    const v = addInput.value.trim();
    if (!v) return addInput.focus();
    if (busy) return;
    busy = true;
    try { await addCategory(v); } finally { busy = false; }
    render(); renderCats();
    $('#addCatName').focus();
  };
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  $('#catsPanel').replaceChildren(
    h('div', { class: 'panel-head' },
      h('div', { class: 'panel-icon' }, icon('tag')),
      h('h2', {}, 'Categories'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: closeCats }, icon('x')),
    ),
    h('div', { class: 'panel-body' },
      cats.length ? null : h('div', { class: 'empty-small' }, 'No categories yet.'),
      h('div', { class: 'list' }, sortedCats().map((c) => {
        const n = count(c.id);
        const name = h('input', { class: 'input', value: c.name, maxlength: 60, 'aria-label': 'Category name' });
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        name.addEventListener('blur', async () => {
          const v = name.value.trim();
          if (!v || v === c.name) { name.value = c.name; return; }
          try { Object.assign(c, await api('PATCH', `/api/categories/${c.id}`, { name: v })); } catch { name.value = c.name; }
          render();
        });
        return h('div', { class: 'row-item cat-row', style: { '--cat': c.color } },
          h('button', {
            class: 'swatch-btn', title: 'Change color', 'aria-label': `Change color of ${c.name}`,
            onclick: () => { paletteFor = paletteFor === c.id ? null : c.id; renderCats(); },
          }),
          name,
          h('span', { class: 'cat-count' }, plural(n, 'task')),
          h('button', {
            class: 'icon-btn danger', 'aria-label': `Delete ${c.name}`,
            title: n ? 'Move or delete its tasks first' : 'Delete category', disabled: n > 0,
            onclick: async () => {
              if (!confirm(`Delete the "${c.name}" category?`)) return;
              await api('DELETE', `/api/categories/${c.id}`);
              cats = cats.filter((x) => x.id !== c.id);
              render(); renderCats();
            },
          }, icon('trash')),
          paletteFor === c.id ? h('div', { class: 'palette' }, PALETTE.map((col) => h('button', {
            style: { '--c': col }, 'aria-label': `Color ${col}`, 'aria-pressed': String(col === c.color),
            onclick: async () => {
              Object.assign(c, await api('PATCH', `/api/categories/${c.id}`, { color: col }));
              paletteFor = null; render(); renderCats();
            },
          }, col === c.color ? icon('check') : null))) : null,
        );
      })),
      h('div', { class: 'add-cat' }, addInput, h('button', { class: 'pbtn primary', onclick: add }, icon('plus'), 'Add')),
    ),
  );
}

// ---------- new task ----------
let syncNewCat = () => {};
function toggleNewCatBox() {
  const isNew = $('#newCat').value === NEW;
  $('#newCatBox').classList.toggle('show', isNew);
  syncNewCat();
  return isNew;
}
function openNew(catId) {
  $('#newTitle').value = '';
  $('#newCatName').value = '';
  syncNewCat = catSelect($('#newCat'), catId || openCat || lastCat, true);
  toggleNewCatBox();
  $('#newModal').classList.add('show');
  setTimeout(() => $('#newTitle').focus(), 30);
}
const closeNew = () => $('#newModal').classList.remove('show');
$('#newCat').addEventListener('change', () => { if (toggleNewCatBox()) $('#newCatName').focus(); });
$('#newModal').addEventListener('click', (e) => { if (e.target.id === 'newModal' || e.target.closest('[data-close]')) closeNew(); });
$('#newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#newTitle').value.trim();
  if (!title || busy) return;
  let categoryId = $('#newCat').value;
  if (categoryId === NEW && !$('#newCatName').value.trim()) { $('#newCatName').focus(); return; }
  busy = true;
  try {
    if (categoryId === NEW) {
      const name = $('#newCatName').value.trim();
      const existing = cats.find((c) => c.name.toLowerCase() === name.toLowerCase());
      categoryId = existing ? existing.id : (await addCategory(name)).id;
    }
    upsert(await api('POST', '/api/tasks', { title, categoryId }));
  } finally { busy = false; }
  lastCat = categoryId;
  try { localStorage.setItem('lastCat', categoryId); } catch {}
  closeNew();
  render();
});

// ---------- global ----------
$('#newBtn').onclick = () => openNew();
$('#completedBtn').onclick = openCompleted;
$('#catsBtn').onclick = openCats;
$('#completedModal').addEventListener('click', (e) => { if (e.target.id === 'completedModal') closeCompleted(); });
$('#catsModal').addEventListener('click', (e) => { if (e.target.id === 'catsModal') closeCats(); });

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const shown = (id) => $(id).classList.contains('show');
  if (shown('#newModal')) closeNew();
  else if (shown('#detail')) closeDetail();
  else if (shown('#completedModal')) closeCompleted();
  else if (shown('#catsModal')) closeCats();
  else if (openCat) closeSpread();
});

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { setSizes(); if (openCat && !closing) renderSpread(); }, 100);
});

setSizes();
// Keeps "x ago" times fresh and lets reminders appear when their day arrives.
setInterval(renderFeed, 60000);
async function loadAll() {
  [cats, tasks] = await Promise.all([api('GET', '/api/categories'), api('GET', '/api/tasks')]);
  render();
  if (detailId) renderDetail();
}
loadAll();
// Pick up changes made in another tab or on another device when this tab comes back into view.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !busy) loadAll().catch(() => {}); });

// ---------- pull to refresh ----------
// Opened from the home screen, iPhone apps have no browser pull-to-refresh, so the board
// provides its own there. In a normal browser tab the browser's own one is left alone.
(function pullToRefresh() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) return;
  const THRESHOLD = 70, MAX = 110;
  const spinner = icon('refresh');
  const ind = h('div', { class: 'ptr', 'aria-hidden': 'true' }, spinner);
  document.body.append(ind);
  let startY = null, pull = 0;
  const busyElsewhere = () => openCat || document.querySelector('.modal.show');
  const show = (d, animate) => {
    ind.style.transition = animate ? 'transform .25s ease, opacity .25s ease' : 'none';
    ind.style.transform = `translate(-50%, ${d - 48}px)`;
    ind.style.opacity = Math.min(1, d / THRESHOLD);
    spinner.style.transform = `rotate(${d * 3}deg)`;
    ind.classList.toggle('ready', d >= THRESHOLD);
  };
  document.addEventListener('touchstart', (e) => {
    pull = 0;
    startY = window.scrollY <= 0 && e.touches.length === 1 && !busyElsewhere() ? e.touches[0].clientY : null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { if (pull) show(0); pull = 0; return; }
    e.preventDefault(); // keep iOS from rubber-banding the whole page while pulling
    pull = Math.min(MAX, dy * 0.5);
    show(pull);
  }, { passive: false });
  const release = () => {
    if (startY === null) return;
    startY = null;
    if (pull >= THRESHOLD) {
      show(THRESHOLD, true);
      ind.classList.add('spinning');
      location.reload();
    } else {
      show(0, true);
    }
    pull = 0;
  };
  document.addEventListener('touchend', release);
  document.addEventListener('touchcancel', release);
})();
