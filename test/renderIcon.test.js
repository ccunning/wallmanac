const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// renderIcon() is inline in the wall display's <script>, so pull the real
// source out of public/index.html rather than keeping a copy in sync here.
// It touches no DOM, so evaluating it standalone is enough.
function loadRenderIcon() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const defaultIcon = html.match(/^const DEFAULT_ICON = .*$/m);
  assert.ok(defaultIcon, 'DEFAULT_ICON declaration not found in public/index.html');

  const start = html.indexOf('function renderIcon(');
  assert.ok(start !== -1, 'renderIcon not found in public/index.html');
  let depth = 0;
  let end = -1;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end !== -1, 'could not find the end of renderIcon');

  const src = `${defaultIcon[0]}\n${html.slice(start, end)}\nreturn renderIcon;`;
  return new Function(src)();
}

const renderIcon = loadRenderIcon();

// ── emoji symbols ─────────────────────────────────────────────────────────
test('a plain emoji symbol is emitted literally, not as a Font Awesome <i>', () => {
  assert.strictEqual(renderIcon('🎂'), '🎂');
});

test('multi-codepoint emoji survive intact', () => {
  // ZWJ sequence, skin-tone modifier, regional-indicator flag, and an emoji
  // that needs its VS16 presentation selector to render as color.
  for (const emoji of ['👨‍👩‍👧‍👦', '👍🏽', '🇺🇸', '⚽', '❤️']) {
    assert.strictEqual(renderIcon(emoji), emoji, `mangled ${emoji}`);
  }
});

test('an emoji with stray whitespace is trimmed but otherwise untouched', () => {
  assert.strictEqual(renderIcon('  🍕 '), '🍕');
});

test('an emoji paired with a label still renders as text', () => {
  assert.strictEqual(renderIcon('🎉 Party'), '🎉 Party');
});

test('an emoji whose label merely contains the letters "fa" is not read as Font Awesome', () => {
  // The fa- test is anchored to a token boundary, so "sofa-day" must not
  // turn the symbol into an icon class.
  assert.strictEqual(renderIcon('🛋 sofa-day'), '🛋 sofa-day');
});

test('a non-emoji text symbol also passes through (short labels, dingbats)', () => {
  assert.strictEqual(renderIcon('★'), '★');
  assert.strictEqual(renderIcon('PTO'), 'PTO');
});

// ── Font Awesome symbols still work alongside emoji ───────────────────────
test('explicit Font Awesome classes render as an <i> unchanged', () => {
  assert.strictEqual(renderIcon('fa-solid fa-plane'), '<i class="fa-solid fa-plane"></i>');
  assert.strictEqual(renderIcon('fa-brands fa-github'), '<i class="fa-brands fa-github"></i>');
});

test('a bare fa- icon name gets the fa-solid style prefix', () => {
  assert.strictEqual(renderIcon('fa-plane'), '<i class="fa-solid fa-plane"></i>');
});

// ── no symbol ─────────────────────────────────────────────────────────────
test('a missing or blank symbol falls back to the default house icon', () => {
  for (const empty of [undefined, null, '', '   ']) {
    assert.strictEqual(renderIcon(empty), '<i class="fa-solid fa-house"></i>');
  }
});

// ── the containers that size the emoji ────────────────────────────────────
test('both render paths wrap the icon in their sized symbol span', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  // Emoji are glyphs, not icon fonts, so they only look right inside these
  // spans (font-size / line-height live on .chip-symbol and .agenda-symbol).
  assert.match(html, /<span class="chip-symbol">\$\{renderIcon\(/);
  assert.match(html, /<span class="agenda-symbol">\$\{renderIcon\(/);
  assert.match(html, /\.chip-symbol\s*\{[^}]*font-size/);
  assert.match(html, /\.agenda-symbol\s*\{[^}]*font-size/);
});
