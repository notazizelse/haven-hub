// When Google answers with its own web page instead of the hub's JSON, the website must say what actually went wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { HUB_CONFIG: {}, HUB_RELEASE: {} };
globalThis.location = new URL('https://notazizelse.github.io/haven-hub/');
const api = await import('../docs/js/api.js');
const ID = 'AKfycbx1234567890abcdefghijklmnopqrstuvwxyz9fQ2kA';
const page = (title, body) => `<!DOCTYPE html><html><head><title>${title}</title><style>body{x:1}</style></head><body><div>Google Apps Script</div><div style="margin:20px">${body}</div></body></html>`;
const quiet = fn => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };
const explain = (html, status = 200) => quiet(() => api.explainPage(html, status, ID));

test('authorization page → re-authorize and deploy a new version', () => {
  const r = explain(page('Error', 'Authorization is required to perform that action.'));
  assert.equal(r.cause, 'auth');
  assert.match(r.error, /Run and allow everything/);
  assert.match(r.error, /New version/);
});

test('missing doPost/doGet → save the code before deploying', () => {
  const r = explain(page('Error', 'Script function not found: doPost'));
  assert.equal(r.cause, 'nocode');
  assert.match(r.error, /Ctrl\+S/);
});

test('unknown deployment ID → names the ID the page uses', () => {
  const r = explain(page('Google Drive -- Page Not Found', 'Sorry, unable to open the file at this time. Please check the address and try again.'), 404);
  assert.equal(r.cause, 'notfound');
  assert.match(r.error, /AKfycbx1…9fQ2kA/);
});

test('time limit → check before retrying', () => {
  const r = explain(page('Error', 'Exceeded maximum execution time'));
  assert.equal(r.cause, 'timeout');
});

test('a crash Google caught → shows Google\'s words and points to Executions', () => {
  const r = explain(page('Error', 'TypeError: Cannot read properties of undefined (reading &#39;x&#39;) (line 12, file &quot;Code&quot;)'), 200);
  assert.equal(r.cause, 'page');
  assert.match(r.error, /Executions/);
  assert.match(r.error, /Cannot read properties of undefined \(reading 'x'\) \(line 12, file "Code"\)/);
  assert.doesNotMatch(r.error, /Google Apps Script/);
});

test('Google sign-in page → the deployment is not open to Anyone', () => {
  const r = explain('<html><head><title>Sign in - Google Accounts</title></head><body><form action="https://accounts.google.com/v3/signin/identifier"></form></body></html>');
  assert.equal(r.cause, 'access');
  assert.match(r.error, /Anyone/);
});

test('no more "check that access is Anyone" for every web page', () => {
  for (const html of [page('Error', 'Authorization is required to perform that action.'), page('Error', 'Script function not found: doGet'), page('Error', 'Something else')]) {
    assert.doesNotMatch(explain(html).error, /deployed with access "Anyone"/);
  }
});

test('postTo turns an HTML answer into the explanation, and a failed fetch into "could not reach"', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(page('Error', 'Authorization is required to perform that action.'), { status: 200, headers: { 'Content-Type': 'text/html' } });
    const r = await quiet(() => api.postTo(ID, 'task.add', {}));
    assert.equal(r.ok, false); assert.equal(r.cause, 'auth');
    globalThis.fetch = async () => new Response('{"ok":true,"version":"5.1.1"}', { status: 200 });
    assert.deepEqual(await api.getFrom(ID, 'ping'), { ok: true, version: '5.1.1' });
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    const off = await api.getFrom(ID, 'ping');
    assert.equal(off.cause, 'unreachable');
  } finally { globalThis.fetch = real; }
});

// ---- the backend side: Code.gs must answer with JSON whatever happens, so Google never sends its own HTML page
const { readFileSync } = await import('node:fs');
const { createGas, loadBackend } = await import('../docs/demo/gas-fakes.js');
const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const json = out => JSON.parse(out.getContent());

test('doPost answers JSON for a broken or missing body', () => {
  const be = loadBackend(CODE, createGas());
  assert.deepEqual(json(be.api.doPost({ postData: { contents: '{not json' } })), { ok: false, error: 'Bad request' });
  assert.equal(json(be.api.doPost({})).ok, false);
  assert.equal(json(be.api.doPost(undefined)).ok, false);
  assert.equal(json(be.api.doGet(undefined)).ok, false, 'no parameters and no key: a JSON "who are you?", not a crash');
});

test('an answer that cannot be written still comes back as JSON', () => {
  const be = loadBackend(CODE, createGas());
  const out = json(be.call('answer_', () => ({ ok: true, n: 10n }))); // BigInt: JSON.stringify throws
  assert.equal(out.ok, false); assert.match(out.error, /could not write its answer/);
  const crash = json(be.call('answer_', () => { throw new Error('boom'); }));
  assert.equal(crash.ok, false); assert.match(crash.error, /boom/);
});
