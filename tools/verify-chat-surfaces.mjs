import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync(new URL('../src/js/chat-settings.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../src/template.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/css/chat-main.css', import.meta.url), 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const values = new Map(), props = new Map();
const context = vm.createContext({
  store: { get: k => values.get(k), set: (k, v) => values.set(k, v) },
  chatPage: { style: { setProperty: (k, v) => props.set(k, String(v)) } },
  document: { getElementById: () => null },
  _csHexRgb: h => /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null
});
const start = source.indexOf('  const CHAT_SURFACE_SETTINGS = [');
const end = source.indexOf('  function applySettings()', start);
assert(start >= 0 && end > start);
vm.runInContext(source.slice(start, end), context);
const apply = () => vm.runInContext("applyChatSurfaces('#ffffff', '#111111')", context);
test('defaults preserve original appearance', () => {
  apply(); assert.equal(props.get('--cs-head-opacity'), '0.92');
  assert.equal(props.get('--cs-input-opacity'), '0.92');
  assert.equal(props.get('--cs-in-surface'), 'rgba(255,255,255,1)');
});
test('zero alpha is retained and bars are independent', () => {
  values.set('cs-head-opacity', '0'); values.set('cs-input-opacity', '40'); apply();
  assert.equal(props.get('--cs-head-opacity'), '0'); assert.equal(props.get('--cs-input-opacity'), '0.4');
});
test('bubble alpha changes paint only', () => {
  values.set('cs-bubble-opacity', '30'); apply();
  assert.equal(props.get('--cs-in-surface'), 'rgba(255,255,255,0.3)');
  assert.equal(props.get('--cs-out-surface'), 'rgba(17,17,17,0.3)');
});
test('invalid numbers fall back and bounds clamp', () => {
  values.set('cs-head-opacity', 'NaN'); values.set('cs-input-inset', '999'); values.set('cs-head-inset', '-20'); apply();
  assert.equal(props.get('--cs-head-opacity'), '0.92'); assert.equal(props.get('--cs-input-inset'), '80px');
  assert.equal(props.get('--cs-head-inset'), '0px');
});
test('each new entry exists once', () => {
  for (const id of ['cs-bar-op', 'cs-bubble-op', 'cs-bar-pos', 'cs-typing-ink'])
    assert.equal(template.split('id="' + id + '"').length - 1, 1, id);
});
test('typing picker and value refresh are connected', () => {
  assert(source.includes("bindBubbleColorRow('cs-typing-ink', 'cs-typing-ink'"));
  assert(source.includes("'cs-typing-ink-val': store.get('cs-typing-ink')"));
});
test('beauty schemes preserve all new values', () => {
  const keys = source.match(/const CHAT_BEAUTY_KEYS = \[([\s\S]*?)\];/)[1];
  for (const key of ['cs-head-opacity','cs-input-opacity','cs-bubble-opacity','cs-head-inset','cs-input-inset']) assert(keys.includes("'" + key + "'"));
});
test('position controls reserve real flex space', () => {
  assert(css.includes('#page-chat::before { height:var(--cs-head-inset, 0px); }'));
  assert(css.includes('#page-chat::after { height:var(--cs-input-inset, 0px); }'));
  assert(css.includes("content:''; display:block; flex-shrink:0;"));
});
test('bar alpha supports dark theme and stays single-chat scoped', () => {
  assert(css.includes('[data-theme="dark"] #page-chat { --cs-bar-rgb:30,30,30; }'));
  assert(css.includes('#page-chat > .chat-head { background:rgba(var(--cs-bar-rgb), var(--cs-head-opacity, .92)); }'));
  assert(css.includes('#page-chat > .chat-input-row { background:rgba(var(--cs-bar-rgb), var(--cs-input-opacity, .92)); }'));
});
test('sliders commit only on confirmation and protect contact changes', () => {
  const edit = source.slice(source.indexOf('  function editChatSurface('), source.indexOf('  function bindChatSurfaceGroup('));
  assert(edit.includes('if (window.activePrefix() !== cid) return;'));
  assert(!edit.includes('onChange:'));
  assert(edit.includes("{ label: '恢复默认', value: item.def }"));
});
console.log(`${passed}/${passed} source and isolated-function checks passed (not a full UI test)`);
