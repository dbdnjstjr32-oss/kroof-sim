// Builds the static site for GitHub Pages into dist/:
//   dist/index.html  — index.html wrapped in a full document (doctype, lang, meta, favicon)
//   dist/js/**       — the ES modules, unchanged
//   dist/.nojekyll   — serve files as-is (no Jekyll processing)
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { wrap } from './skeleton.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'index.html'), wrap(readFileSync(join(root, 'index.html'), 'utf8'), { social: true }));
cpSync(join(root, 'js'), join(dist, 'js'), { recursive: true });
writeFileSync(join(dist, '.nojekyll'), '');
console.log('built dist/ for GitHub Pages');
