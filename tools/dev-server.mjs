// Zero-dependency dev server for kroof-sim.
// "/" serves index.html wrapped in the same skeleton the Artifact host adds at publish time
// (so it renders in standards mode), or a self-refreshing "building" page until index.html exists.
// Everything else is served as static files with no caching.
import { createServer } from 'node:http';
import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { wrap } from './skeleton.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8765);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function buildingPage() {
  const want = ['index.html', 'js/container.js', 'js/environment.js',
    'js/designs/designA.js', 'js/designs/designB.js', 'js/designs/designC.js', 'js/designs/designD.js', 'js/designs/designE.js',
    'js/physics/sun.js', 'js/physics/thermal.js', 'js/physics/wind.js',
    'js/viz/shade.js', 'js/viz/heatmap.js', 'js/viz/flow.js', 'js/viz/rays.js', 'js/viz/animator.js', 'js/ui/ui.js', 'js/ui/charts.js'];
  const rows = [];
  for (const f of want) rows.push(`<li class="${(await exists(join(root, f))) ? 'y' : 'n'}">${f}</li>`);
  const done = rows.filter((r) => r.includes('class="y"')).length;
  return wrap(`<title>K-Roof 빌드 중</title>
<meta http-equiv="refresh" content="5">
<style>
  :root{--bg:#f3f5f7;--fg:#1d232b;--mut:#6b7684;--ok:#1f9d6b;--pend:#c9ced6}
  @media (prefers-color-scheme:dark){:root{--bg:#14181d;--fg:#e6e9ee;--mut:#8b95a3;--ok:#3cc28d;--pend:#3a424d;color-scheme:dark}}
  body{background:var(--bg);color:var(--fg);font:15px/1.5 "IBM Plex Sans KR",system-ui,sans-serif;padding:32px 16px}
  main{max-width:560px;margin:0 auto} h1{font-size:20px;margin:0 0 4px} p{color:var(--mut);margin:0 0 16px}
  ul{list-style:none;padding:0;margin:0;columns:2;font:13px/1.9 ui-monospace,monospace}
  li::before{content:"○ ";color:var(--pend)} li.y::before{content:"● ";color:var(--ok)} li.n{color:var(--mut)}
  .bar{height:6px;background:var(--pend);border-radius:3px;margin:0 0 20px;overflow:hidden}
  .bar i{display:block;height:100%;width:${Math.round((done / want.length) * 100)}%;background:var(--ok)}
</style>
<main><h1>K-Roof 3D 시뮬레이터 — 빌드 중</h1>
<p>병렬 에이전트가 모듈을 작성하고 있습니다. 이 페이지는 5초마다 새로고침되며, 파일이 모두 준비되고 통합 테스트를 통과하면 앱이 여기에 표시됩니다. (${done}/${want.length})</p>
<div class="bar"><i></i></div><ul>${rows.join('')}</ul></main>`);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    const headers = { 'Cache-Control': 'no-store' };
    // Dev-only: POST a canvas data URL to save a frame as tools/.shots/<name>.png for inspection.
    if (req.method === 'POST' && path === '/__shot') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const b64 = Buffer.concat(chunks).toString('utf8').replace(/^data:image\/\w+;base64,/, '');
      const name = (url.searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
      await mkdir(join(root, 'tools/.shots'), { recursive: true });
      await writeFile(join(root, 'tools/.shots', `${name}.png`), Buffer.from(b64, 'base64'));
      res.writeHead(200, headers);
      return res.end('ok');
    }
    if (path === '/' || path === '/index.html') {
      // Show the app only once integration is signed off (tools/.ready), so a half-built app never flashes up.
      const ready = (await exists(join(root, 'index.html'))) && (await exists(join(root, 'tools/.ready')));
      const html = ready || url.searchParams.has('force')
        ? wrap(await readFile(join(root, 'index.html'), 'utf8'))
        : await buildingPage();
      res.writeHead(200, { ...headers, 'Content-Type': TYPES['.html'] });
      return res.end(html);
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    const s = await stat(file).catch(() => null);
    if (!s) { res.writeHead(404, headers); return res.end('not found'); }
    if (s.isDirectory()) {
      const list = await readdir(file);
      res.writeHead(200, { ...headers, 'Content-Type': TYPES['.html'] });
      return res.end(list.map((f) => `<a href="${join(path, f).replace(/\\/g, '/')}">${f}</a>`).join('<br>'));
    }
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, () => console.log(`kroof-sim dev server → http://localhost:${port}/`));
