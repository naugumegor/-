// Сборка сайта конспектов: content/ -> dist/
// Без зависимостей, нужен только Node 18+.
import { readdir, readFile, writeFile, mkdir, rm, stat, cp } from 'node:fs/promises';
import { join, extname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(ROOT, 'content');
const OUT = join(ROOT, 'dist');
const TYPES = { '.html': 'html', '.htm': 'html', '.pdf': 'pdf' };

// ---------- настройки ----------
async function loadConfig() {
  const def = {
    title: 'Мои конспекты',
    description: 'Конспекты, лабы и учёба в одном месте',
    subjects: {},
  };
  let raw;
  try {
    raw = await readFile(join(ROOT, 'site.config.json'), 'utf8');
  } catch {
    return def;
  }
  return { ...def, ...JSON.parse(raw) }; // кривой JSON -> сборка упадёт с понятной ошибкой
}

// ---------- утилиты ----------
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

// "01-limits_basic" -> "Limits basic" (цифры в начале нужны только для сортировки)
function prettyName(name) {
  const t = name.replace(/^\d+[-_.\s]+/, '').replace(/[-_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : name;
}

function fmtSize(b) {
  if (b < 1024) return b + ' Б';
  if (b < 1048576) return Math.round(b / 1024) + ' КБ';
  return (b / 1048576).toFixed(1).replace('.', ',') + ' МБ';
}

const skip = (name) => name.startsWith('.') || name.startsWith('_');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.toLowerCase() === 'assets') continue; // картинки/стили конспектов, в список не лезут
      out.push(...(await walk(full)));
    } else if (TYPES[extname(e.name).toLowerCase()]) {
      out.push(full);
    }
  }
  return out;
}

async function titleOf(full, type) {
  if (type === 'html') {
    const html = await readFile(full, 'utf8');
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (m) {
      const t = decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
  }
  return prettyName(basename(full, extname(full)));
}

async function makeItems(files) {
  const items = [];
  for (const full of files) {
    const type = TYPES[extname(full).toLowerCase()];
    const rel = relative(SRC, full);
    items.push({
      title: await titleOf(full, type),
      type,
      size: (await stat(full)).size,
      file: rel,
      href: 'files/' + rel.split(sep).map(encodeURIComponent).join('/'),
    });
  }
  items.sort((a, b) => collator.compare(a.file, b.file));
  return items;
}

// ---------- сбор данных ----------
const config = await loadConfig();

let top;
try {
  top = await readdir(SRC, { withFileTypes: true });
} catch {
  console.error('Нет папки content/ — создай её и положи туда папки с предметами.');
  process.exit(1);
}

const subjects = [];

const dirs = top.filter((e) => e.isDirectory() && !skip(e.name)).sort((a, b) => collator.compare(a.name, b.name));
for (const d of dirs) {
  const items = await makeItems(await walk(join(SRC, d.name)));
  if (items.length) subjects.push({ id: d.name, name: config.subjects[d.name] ?? prettyName(d.name), items });
}

const looseFiles = top
  .filter((e) => e.isFile() && !skip(e.name) && TYPES[extname(e.name).toLowerCase()])
  .map((e) => join(SRC, e.name));
if (looseFiles.length) {
  subjects.push({ id: '_root', name: config.subjects._root ?? 'Разное', items: await makeItems(looseFiles) });
}

const all = subjects.flatMap((s) => s.items);
const counts = { all: all.length, html: all.filter((i) => i.type === 'html').length, pdf: all.filter((i) => i.type === 'pdf').length };

// ---------- HTML главной ----------
const cardHtml = (s, i) => `
      <a class="card" href="${esc(i.href)}" data-type="${i.type}" data-s="${esc((i.title + ' ' + s.name + ' ' + i.file).toLowerCase())}">
        <span class="badge ${i.type}">${i.type.toUpperCase()}</span>
        <span class="t">${esc(i.title)}</span>
        <span class="m">${fmtSize(i.size)}</span>
      </a>`;

const sectionsHtml = subjects
  .map(
    (s) => `
    <section class="subject">
      <h2>${esc(s.name)} <span class="n">${s.items.length}</span></h2>
      <div class="grid">${s.items.map((i) => cardHtml(s, i)).join('')}
      </div>
    </section>`
  )
  .join('\n');

const css = `
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#6b6560;--card:#fff;--line:#e7e5e4;--accent:#2563eb;--html:#047857;--pdf:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--accent:#60a5fa;--html:#34d399;--pdf:#f87171}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:48px 16px 64px}
h1{font-size:2rem;margin:0 0 4px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0 0 28px}
.tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
#q{flex:1 1 240px;min-width:0;padding:11px 14px;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:10px}
#q:focus{outline:2px solid var(--accent);outline-offset:1px}
.chips{display:flex;gap:6px}
.chip{font:inherit;font-size:.9rem;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
.chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.status{color:var(--muted);font-size:.9rem;margin:6px 2px 0}
.subject{margin-top:32px}
h2{font-size:1.15rem;margin:0 0 12px;display:flex;align-items:center;gap:8px}
h2 .n{font-size:.8rem;font-weight:400;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:6px;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-radius:12px;color:inherit;text-decoration:none;transition:border-color .15s,transform .15s}
.card:hover,.card:focus-visible{border-color:var(--accent);transform:translateY(-2px);outline:none}
.badge{align-self:flex-start;font-size:.7rem;font-weight:700;letter-spacing:.06em;padding:1px 7px;border-radius:6px;border:1px solid currentColor}
.badge.html{color:var(--html)}.badge.pdf{color:var(--pdf)}
.t{font-weight:600;line-height:1.3}
.m{color:var(--muted);font-size:.85rem}
#empty{margin-top:40px;color:var(--muted);text-align:center}
footer{margin-top:56px;color:var(--muted);font-size:.85rem}
@media (prefers-reduced-motion:reduce){.card{transition:none}.card:hover{transform:none}}
`;

const script = `
(function(){
  var q=document.getElementById('q');
  var cards=[].slice.call(document.querySelectorAll('.card'));
  var secs=[].slice.call(document.querySelectorAll('.subject'));
  var chips=[].slice.call(document.querySelectorAll('.chip'));
  var type='all';
  function apply(){
    var s=q.value.trim().toLowerCase(), n=0;
    cards.forEach(function(c){
      var ok=(type==='all'||c.dataset.type===type)&&(!s||c.dataset.s.indexOf(s)!==-1);
      c.hidden=!ok; if(ok)n++;
    });
    secs.forEach(function(sec){sec.hidden=!sec.querySelector('.card:not([hidden])');});
    document.getElementById('empty').hidden=n>0||!cards.length;
    document.getElementById('count').textContent=n;
  }
  q.addEventListener('input',apply);
  chips.forEach(function(ch){ch.addEventListener('click',function(){
    type=ch.dataset.type;
    chips.forEach(function(c){c.setAttribute('aria-pressed',c===ch?'true':'false');});
    apply();
  });});
  document.addEventListener('keydown',function(e){
    if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}
  });
  apply();
})();
`;

const built = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(config.description)}">
<meta name="robots" content="noindex">
<title>${esc(config.title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%93%9A%3C/text%3E%3C/svg%3E">
<style>${css}</style>
</head>
<body>
<main class="wrap">
  <h1>${esc(config.title)}</h1>
  <p class="sub">${esc(config.description)}</p>

  <div class="tools">
    <input id="q" type="search" placeholder="Поиск по конспектам (нажми /)" aria-label="Поиск по конспектам" autocomplete="off">
    <div class="chips" role="group" aria-label="Тип файла">
      <button class="chip" data-type="all" aria-pressed="true">Все ${counts.all}</button>
      <button class="chip" data-type="html" aria-pressed="false">HTML ${counts.html}</button>
      <button class="chip" data-type="pdf" aria-pressed="false">PDF ${counts.pdf}</button>
    </div>
  </div>
  <p class="status" aria-live="polite">Показано: <span id="count">${counts.all}</span></p>
${sectionsHtml || '  <p id="none" class="status">Пока пусто. Кинь файлы в папку content/ПРЕДМЕТ/ и запушь.</p>'}
  <p id="empty" hidden>Ничего не нашлось.</p>
  <footer>Обновлено: ${esc(built)}</footer>
</main>
<script>${script}</script>
</body>
</html>
`;

// ---------- запись ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
// Копируем всё, кроме скрытых и черновиков (имена с . или _ в начале) на любой глубине
await cp(SRC, join(OUT, 'files'), {
  recursive: true,
  filter: (p) => p === SRC || !relative(SRC, p).split(sep).some(skip),
});
await writeFile(join(OUT, 'index.html'), page);

console.log(`Готово: ${all.length} файлов (${counts.html} HTML, ${counts.pdf} PDF), предметов: ${subjects.length} -> dist/`);
