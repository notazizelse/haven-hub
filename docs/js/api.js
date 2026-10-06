/* Haven Hub — talks to one Haven's Apps Script backend.
   Which hub: ?hub=<deployment id>  →  HUB_CONFIG.defaultHub (forks)  →  the last hub used in this browser.
   Personal links (?u=&t=) are stored per hub and then removed from the address bar, so a copied URL never leaks a key. */
import { store, browserTz } from './ui.js';

/** release.js (owned by the Haven Hub repo) + config.js (yours: anything set there wins). */
export const CFG = Object.assign({}, window.HUB_RELEASE || {}, ...Object.entries(window.HUB_CONFIG || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => ({ [k]: v })));
const REDIRECTS = CFG.redirects || {};
export const HUB_RE = /^AKfy[\w-]{30,}$/;
/** Hubs that run on their own server, by short name: ?hub=tashkent → that server's /api (set in config.js). */
const SERVERS = CFG.hubs || {};
const isHub = id => HUB_RE.test(id) || Object.prototype.hasOwnProperty.call(SERVERS, id);
export const params = new URLSearchParams(location.search);
/** The demo runs the real Code.gs in the browser with made-up data — only on the shared website (a hub's own server never runs it). */
export const DEMO = params.has('demo') && !(window.HUB_CONFIG || {}).selfHosted;
export const DEMO_HUB = 'AKfycbDEMOdemoDEMOdemoDEMOdemoDEMOdemo00000';
/** Served by your own Haven Hub server (server/): one hub, API on the same address. */
export const SELF = !!CFG.api && !DEMO;
let hubId = '', demoSession = null, demoReady = null;

/** Accepts a deployment ID, a Web-app URL (…/macros/s/<id>/exec) or any hub link. */
export function hubFrom(s) {
  s = String(s || '').trim();
  const m = s.match(/\/macros\/s\/([\w-]+)\/(exec|dev)/);
  if (m && HUB_RE.test(m[1])) return m[1];
  try { const h = new URL(s).searchParams.get('hub'); if (h && isHub(h)) return h; } catch (e) { /* not a URL */ }
  return isHub(s) ? s : '';
}
/** A pasted personal link → { hub, u, t } (or null). */
export function parseLink(s) {
  try {
    const u = new URL(String(s || '').trim());
    const t = u.searchParams.get('t') || '';
    return t ? { hub: hubFrom(u.searchParams.get('hub') || '') || (CFG.defaultHub || ''), u: u.searchParams.get('u') || '', t } : null;
  } catch (e) { return null; }
}

let leaving = false;
/** True while the page is being sent to the hub's new address (stop rendering). */
export const redirecting = () => leaving;
/** ?hub=<name> (or the hub this browser remembers) moved to its own address: go there, taking the sign-in along after # (never sent to any server). */
function redirectMoved(q) {
  const name = !DEMO && !SELF && [q, !q && store.get('hh:last')].find(n => n && Object.prototype.hasOwnProperty.call(REDIRECTS, n));
  if (!name) return false;
  let target; try { target = new URL(REDIRECTS[name]); } catch (e) { return false; }
  if (target.protocol !== 'https:') return false;
  const s = params.get('t') ? { u: params.get('u') || '', t: params.get('t') } : store.json('hh:s:' + name, null);
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  const h = new URLSearchParams(Object.assign(s && s.t ? { u: s.u || '', t: s.t } : {}, r ? { r } : {}));
  ['hh:s:', 'hh:c:'].forEach(k => store.del(k + name));
  if (store.get('hh:last') === name) store.del('hh:last');
  leaving = true;
  location.replace(target.origin + target.pathname.replace(/\/?$/, '/') + (String(h) ? '#/handoff?' + h : ''));
  return true;
}
/** Arrived from an old link of a hub that moved here: #/handoff?u=…&t=…&r=<page> → sign in on this site. */
function takeHandoff() {
  const m = location.hash.match(/^#\/handoff\?(.*)$/);
  if (!m) return;
  const h = new URLSearchParams(m[1]), r = (h.get('r') || '').replace(/[^\w/-]/g, '');
  if (h.get('t')) setSession({ u: h.get('u') || '', t: h.get('t') });
  history.replaceState(null, '', location.pathname + location.search + '#/' + (r === 'handoff' ? '' : r));
}

export function resolve() {
  const q = params.get('hub') || params.get('api');
  if (redirectMoved(q)) return '';
  if (DEMO) hubId = DEMO_HUB;
  else if (SELF) hubId = 'self';
  else if (q && hubFrom(q)) hubId = hubFrom(q);
  else if (CFG.defaultHub && HUB_RE.test(CFG.defaultHub)) hubId = CFG.defaultHub;
  else hubId = store.get('hh:last') || '';
  if (!SELF && !isHub(hubId)) hubId = '';
  if (hubId) takeHandoff();
  if (hubId && params.get('t')) setSession({ u: params.get('u') || '', t: params.get('t') });
  if (hubId && !DEMO && !SELF) store.set('hh:last', hubId);
  // Clean address bar: keep ?hub= (so a copied URL opens the public page), drop the key.
  const want = new URLSearchParams(params);
  want.delete('t'); want.delete('u'); want.delete('api');
  if (hubId && !DEMO && !SELF && !CFG.defaultHub) want.set('hub', hubId);
  const qs = want.toString();
  if (qs !== location.search.replace(/^\?/, '')) history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  return hubId;
}
export const hub = () => hubId;
/** Address of the hub's own server (for its /files/raw/…), when it runs on one. */
export const serverBase = () => SELF ? location.origin : String(SERVERS[hubId] || '').replace(/\/api\/?$/, '');
export const urlFor = id => id === 'self' ? CFG.api : SERVERS[id] ? SERVERS[id] : 'https://script.google.com/macros/s/' + id + '/exec';
export const siteUrl = () => (location.origin + location.pathname).replace(/\/index\.html$/, '').replace(/\/$/, '');
export const publicUrl = () => siteUrl() + '/' + (SELF || (CFG.defaultHub && hubId === CFG.defaultHub) ? '' : '?hub=' + hubId);

export function session() { return DEMO ? demoSession : store.json('hh:s:' + hubId, null); }
export function setSession(s) { if (DEMO) { demoSession = s; return; } store.set('hh:s:' + hubId, JSON.stringify(s)); store.del('hh:c:' + hubId); }
export function signOut() {
  if (DEMO) { demoSession = null; return; }
  const s = session();
  if (s && /^hs_/.test(s.t)) postTo(hubId, 'logout', { t: s.t }); // end a password session on the server too
  store.del('hh:s:' + hubId); store.del('hh:c:' + hubId);
}
/** Hubs on their own server (server/) offer username + password sign-in. */
export const isServerHub = () => !DEMO && (SELF || Object.prototype.hasOwnProperty.call(SERVERS, hubId));
/** Signed in with a password (not with a personal link)? */
export const passwordSession = () => { const s = session(); return !!(s && /^hs_/.test(s.t)); };
export function forgetHub() { signOut(); store.del('hh:last'); }
/** Last dashboard payload for this hub + person, shown instantly while fresh data loads. */
export function cached() { const s = session(), c = !DEMO && store.json('hh:c:' + hubId, null); return c && s && c.me && c.me.key === s.u ? c : null; }
export function cache(D) { if (!DEMO) store.set('hh:c:' + hubId, JSON.stringify(D)); }

/** Short form of a hub ID for messages: AKfycbx1…9fQ2kA. */
export const shortId = id => String(id || '').length > 16 ? String(id).slice(0, 8) + '…' + String(id).slice(-6) : String(id || '');
/** The visible text of an HTML page (Google's error pages are small). */
export function pageText(html) {
  return String(html || '').replace(/<(head|script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
const REDEPLOY = 'Deploy → Manage deployments → ✏️ → Version: New version → Deploy';
/** Google's own pages, recognised by their text → what went wrong and what the hub owner does about it. First match wins. */
const GOOGLE_PAGES = [
  ['auth', /authori[sz]ation is required|requires? (your )?(authori[sz]ation|permission)|needs (your )?permission|do not have permission to call|required permissions/i,
    () => `The hub needs Google permissions again. The hub owner: in Apps Script pick installTriggers at the top, press Run and allow everything, then ${REDEPLOY}.`],
  ['nocode', /script function not found|did not return anything|completed but did not return/i,
    () => `The hub's code wasn't saved when it was deployed. The hub owner: paste Code.gs into Apps Script, press Ctrl+S, then ${REDEPLOY}.`],
  ['notfound', /unable to open the file|file you have requested does not exist|page not found|requested url was not found|\b404\b/i,
    id => `There is no hub at the ID this page uses (${shortId(id)}). Open the hub from a fresh link, or compare that ID with the Deployment ID in Apps Script → Deploy → Manage deployments.`],
  ['timeout', /exceeded maximum execution time|timed out|time ?out/i,
    () => 'Google stopped the hub because it took too long. Wait a minute, refresh and check whether your change was saved before trying again.'],
  ['busy', /too many simultaneous|service invoked too many times|too many (requests|times)|quota|rate limit/i,
    () => "The hub hit one of Google's limits (too many requests, or today's quota). Try again in a few minutes."],
];
/** Google answered with a web page instead of the hub's JSON: say why, in plain words, and keep the page in the console for whoever debugs it. */
export function explainPage(html, status, id) {
  const text = pageText(html), google = /script\.google|googleusercontent|google/i.test(String(html).slice(0, 4000)) || /AKfy/.test(String(id || ''));
  const said = text.replace(/^((google (apps script|drive))|error)\s*/gi, '').replace(/^((google (apps script|drive))|error)\s*/gi, '').replace(/\b(sign in|learn more|report abuse)\b/gi, '').replace(/\s+/g, ' ').trim().slice(0, 140);
  try { console.warn('[Haven Hub] the hub answered with a web page instead of data', { hub: id, status, text: text.slice(0, 2000) }); } catch (e) { /* no console */ }
  // A Google sign-in page = the deployment isn't open to "Anyone".
  if (/ServiceLogin|accounts\.google\.com\/(v\d\/)?signin|<title>\s*sign in/i.test(html))
    return { ok: false, code: 'network', cause: 'access', status, error: 'Google asked for a sign-in instead of answering. The hub owner: set the web app\'s Who has access to Anyone (Deploy → Manage deployments → ✏️).' };
  const hit = GOOGLE_PAGES.find(([, re]) => re.test(text));
  if (hit) return { ok: false, code: 'network', cause: hit[0], status, error: hit[2](id) + (hit[0] === 'notfound' || !said ? '' : ` (Google said: “${said}”)`) };
  return { ok: false, code: 'network', cause: 'page', status,
    error: (google ? `Google sent an error page instead of the hub's data (HTTP ${status}). The hub owner can see why in Apps Script → Executions.` : `The hub's server sent a web page instead of data (HTTP ${status}).`)
      + (said ? ` It said: “${said}”` : '') };
}
async function parse(r, id) {
  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch (e) {
    if (/<html|<!doctype/i.test(txt)) return explainPage(txt, r.status, id);
    return { ok: false, code: 'network', cause: 'odd', status: r.status, error: `Unexpected answer from the hub (HTTP ${r.status}).` };
  }
}
const offline = () => (typeof navigator !== 'undefined' && navigator.onLine === false)
  ? { ok: false, code: 'network', cause: 'offline', error: 'You seem to be offline. Check your internet connection and try again.' }
  : { ok: false, code: 'network', cause: 'unreachable', error: 'Could not reach the hub. Check your internet. If it keeps happening, the hub owner should check that the web app\'s Who has access is Anyone.' };

export async function getFrom(id, action, extra) {
  const q = Object.assign({ action }, extra || {});
  if (DEMO) return demoCall('GET', q);
  let r; try { r = await fetch(urlFor(id) + '?' + new URLSearchParams(q), { cache: 'no-store' }); } catch (e) { return offline(); }
  try { return await parse(r, id); } catch (e) { return offline(); }
}
export async function postTo(id, action, body) {
  const b = Object.assign({ action }, body || {});
  if (DEMO) return demoCall('POST', b);
  let r; try { r = await fetch(urlFor(id), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) }); } catch (e) { return offline(); }
  try { return await parse(r, id); } catch (e) { return offline(); }
}
const withKey = o => { const s = session(); return Object.assign({}, o, s ? { u: s.u, t: s.t } : {}); };
/** The hub moved to its own server: forward this person there, with their key. */
export function followMove(r) {
  if (!r || r.code !== 'moved') return false;
  let u; try { u = new URL(String(r.url || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  const s = session();
  if (s) { u.searchParams.set('u', s.u); u.searchParams.set('t', s.t); }
  location.replace(u.toString() + location.hash);
  return true;
}
const follow = p => p.then(r => { if (followMove(r)) return new Promise(() => {}); return r; });
export const get = (action, extra) => follow(getFrom(hubId, action, withKey(extra)));
export const post = (action, body) => follow(postTo(hubId, action, withKey(body)));
export const getPublic = (action, extra) => follow(getFrom(hubId, action, extra));
export const postPublic = (action, body) => follow(postTo(hubId, action, body));

// ------------------------------------------------------------------ dev mock: ?demo=1 runs the REAL Code.gs in the browser
// Only works when the repo root is served (it loads ../apps-script/Code.gs and ../dev/*). ?demo=fresh starts un-set-up.
export async function ready() { if (DEMO) await demo(); }
async function demo() {
  if (demoReady) return demoReady;
  demoReady = (async () => {
    const [fakes, code, data] = await Promise.all([import('../demo/gas-fakes.js'), fetch('demo/Code.gs', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('demo/Code.gs is missing (npm run sync)'); return r.text(); }), import('../demo/demo-data.js')]);
    const gas = fakes.createGas({ tz: browserTz() }), be = fakes.loadBackend(code, gas);
    const people = params.get('demo') === 'fresh' ? {} : data.seed(be, gas, DEMO_HUB);
    demoSession = people[params.get('as') || 'admin'] || null;
    window.__hub = { be, gas, people, sheetUrl: gas._ss.getUrl(), tree: data.TREE || [], raw: data.rawFor, as: params.get('as') || 'admin' };
    return be;
  })();
  return demoReady;
}
async function demoCall(method, q) {
  const be = await demo();
  await new Promise(r => setTimeout(r, 150));
  return JSON.parse(JSON.stringify(method === 'GET' ? be.get(q) : be.post(q)));
}
export const demoSheetUrl = () => (window.__hub && window.__hub.sheetUrl) || '';
/** The guided tour: look at the hub as someone else (admin, lead, member, viewer, or 'guest' = the public page) without reloading. */
export function demoAs(who) { if (!DEMO || !window.__hub) return; window.__hub.as = who; demoSession = window.__hub.people[who] || null; }
/** The Google sign-in client of this hub: the server's (config.js), or the one a Google Sheet hub reports. */
export const googleClient = P => String(CFG.googleClientId || (P && P.google) || '');
