#!/usr/bin/env node
/* ==========================================================================
   Ciudadano Ready | pre-deploy sanity check
   ==========================================================================
   A lightweight, dependency-free safety net for a project with no build
   step and no automated test suite: catches the classes of mistakes that
   have actually happened during manual editing of this codebase (a broken
   <div> nesting, a stale internal link, a JS syntax typo, an English
   string shipped without its Spanish counterpart).

   Run locally before packaging the zip:   node scripts/pre-deploy-check.js
   Also runs automatically in CI on every push, see
   .github/workflows/ci.yml. That workflow triggers on ANY push to the
   repo, including files added via GitHub's web "Upload files" UI, so it
   works with a drag-and-drop deploy flow with no git/CLI access required.

   This is intentionally NOT a full test suite; it doesn't spin up a
   browser or talk to Supabase. It's static analysis: fast, zero-setup,
   and catches an entire class of "oops, broke the page" mistakes before
   they ship.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
let warnings = 0;

function fail(msg) {
  console.log('  \x1b[31m✗\x1b[0m ' + msg);
  failures++;
}
function warn(msg) {
  console.log('  \x1b[33m!\x1b[0m ' + msg);
  warnings++;
}
function pass(msg) {
  console.log('  \x1b[32m✓\x1b[0m ' + msg);
}

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const jsFiles = walk(ROOT, ['.js']);
const htmlFiles = walk(ROOT, ['.html']);

// ---- 1. JS syntax check (node --check) ---------------------------------
console.log('\n[1/4] JavaScript syntax');
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    pass(path.relative(ROOT, file));
  } catch (e) {
    fail(`${path.relative(ROOT, file)}: ${e.stderr.toString().split('\n').slice(0, 3).join(' ')}`);
  }
}

// ---- 2. HTML tag balance (heuristic) ------------------------------------
console.log('\n[2/4] HTML tag balance (div / section / form / table / ul / ol)');
const TAGS_TO_CHECK = ['div', 'section', 'form', 'table', 'ul', 'ol'];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const mismatches = [];
  for (const tag of TAGS_TO_CHECK) {
    const openCount = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
    const closeCount = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (openCount !== closeCount) mismatches.push(`<${tag}> open=${openCount} close=${closeCount}`);
  }
  if (mismatches.length) fail(`${path.relative(ROOT, file)}: ${mismatches.join(', ')}`);
  else pass(path.relative(ROOT, file));
}

// ---- 3. Internal link / asset integrity ---------------------------------
console.log('\n[3/4] Internal links & asset references');
const ATTR_RE = /(?:href|src)="([^"]+)"/g;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  let match;
  let brokenInFile = 0;
  while ((match = ATTR_RE.exec(html))) {
    let ref = match[1];
    if (!ref || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('mailto:') ||
        ref.startsWith('tel:') || ref.startsWith('//') || ref.startsWith('#') || ref.startsWith('data:') ||
        ref.startsWith('javascript:')) continue;
    ref = ref.split('#')[0].split('?')[0];
    if (!ref) continue;
    const resolved = ref.startsWith('/') ? path.join(ROOT, ref) : path.join(dir, ref);
    if (!fs.existsSync(resolved)) {
      fail(`${path.relative(ROOT, file)} references missing "${ref}"`);
      brokenInFile++;
    }
  }
  if (!brokenInFile) pass(path.relative(ROOT, file));
}

// ---- 4. Bilingual completeness (data-en without data-es) ----------------
console.log('\n[4/4] Bilingual completeness (data-en / data-es pairs)');
const DATA_EN_RE = /<[a-zA-Z0-9]+\s+[^>]*\bdata-en="([^"]*)"[^>]*>/g;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  let match;
  let missingInFile = 0;
  while ((match = DATA_EN_RE.exec(html))) {
    const tagHtml = match[0];
    if (!/\bdata-es="/.test(tagHtml)) {
      warn(`${path.relative(ROOT, file)}: data-en="${match[1].slice(0, 40)}" has no data-es`);
      missingInFile++;
    }
  }
  if (!missingInFile) pass(path.relative(ROOT, file));
}

// ---- Summary -------------------------------------------------------------
console.log('\n' + '─'.repeat(60));
if (failures) {
  console.log(`\x1b[31m${failures} check(s) failed\x1b[0m, ${warnings} warning(s). Fix failures before deploying.`);
  process.exit(1);
} else {
  console.log(`\x1b[32mAll checks passed.\x1b[0m ${warnings} warning(s) (missing Spanish translations, not blocking).`);
  process.exit(0);
}
