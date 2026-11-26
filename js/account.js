// Account UI: Google sign-in button, sign-in / setup dialog, account menu, sync status.
import { el, store } from './util.js';
import { I } from './icons.js';
import { cloud } from './cloud.js';
import { dialog, popup, menuList, toast, closePopup } from './ui.js';

const SAVED = ['Chart layouts, symbols, intervals & chart types', 'Indicators, their settings & templates', 'All drawings on every symbol', 'Price alerts & alert log', 'Watchlists', 'Paper-trading account, positions, orders & history', 'Custom scripts & strategy-tester settings', 'Chart settings, theme & favorites'];

let btn, app;

export function init(a, button) {
  app = a; btn = button;
  btn.addEventListener('click', () => (cloud.user ? menu(app, btn) : signInDialog(app)));
  cloud.on('status', render);
  cloud.on('user', (u) => { render(); if (u && !cloud._greeted) { cloud._greeted = true; } });
  cloud.on('remote', (n) => {
    const t = toast(`☁️ ${n} change${n > 1 ? 's' : ''} synced from another device. <button class="btn btn-primary xs t-reload">Reload</button>`, 'info', 12000);
    t.querySelector('.t-reload')?.addEventListener('click', () => location.reload());
  });
  render();
  cloud.init();
}

function avatar(u, size = 26) {
  if (u.photo) return el('img', { class: 'avatar', src: u.photo, alt: '', referrerpolicy: 'no-referrer', width: size, height: size, style: { width: size + 'px', height: size + 'px' } });
  return el('span', { class: 'avatar letter', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.45) + 'px' } }, (u.name || u.email || '?')[0].toUpperCase());
}

function statusText() {
  switch (cloud.status) {
    case 'syncing': return 'Saving to cloud…';
    case 'synced': return 'All changes saved to cloud' + (cloud.lastSync ? ' · ' + new Date(cloud.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
    case 'error': return cloud.error || 'Sync error';
    case 'loading': return 'Connecting…';
    default: return 'Saved on this device only';
  }
}

function render() {
  if (!btn) return;
  btn.innerHTML = '';
  btn.className = 'tb-btn account-btn';
  if (cloud.user) {
    btn.append(avatar(cloud.user), el('span', { class: 'sync-dot ' + cloud.status }));
    btn.title = `${cloud.user.name} — ${statusText()}`;
    btn.classList.add('signed-in');
  } else if (cloud.status === 'loading') {
    btn.append(el('span', { class: 'spin sm' }));
    btn.title = 'Connecting…';
  } else {
    btn.innerHTML = I.user + '<span class="lbl">Sign in</span>';
    btn.title = cloud.configured ? 'Sign in with Google to save & sync everything' : 'Set up Google sign-in';
    if (cloud.status === 'error') btn.classList.add('err');
  }
  const info = document.querySelector('.acct-status');
  if (info) { info.textContent = statusText(); info.className = 'acct-status ' + cloud.status; }
}

export function menu(a, anchor) {
  const u = cloud.user; if (!u) return signInDialog(a);
  const head = el('div', { class: 'acct-head' }, avatar(u, 40), el('div', { class: 'acct-who' }, el('b', {}, u.name || ''), el('span', { class: 'muted sm' }, u.email || '')));
  const st = el('div', { class: 'acct-status ' + cloud.status }, statusText());
  const list = menuList([
    { label: 'Sync now', icon: 'sync', onClick: async () => { await cloud.syncNow(); toast('Everything is saved to your account', 'success', 2000); } },
    { label: 'What is saved?', icon: 'cloudOk', onClick: () => dialog({ title: 'Saved to your account', width: 420, body: el('ul', { class: 'saved-list' }, ...SAVED.map((x) => el('li', {}, x))) }) },
    { label: 'Export backup (JSON)', icon: 'download', onClick: () => a.exportLayout() },
    { divider: true },
    { label: 'Sign out', icon: 'logout', onClick: () => signOutDialog() },
  ]);
  popup(anchor, el('div', { class: 'acct-menu' }, head, st, list), { alignRight: true });
}

function signOutDialog() {
  const out = async (clear) => {
    try { await cloud.signOut(); } catch (e) { toast(e.message, 'error'); return; }
    if (clear) { store.clearAll(); location.reload(); return; }
    toast('Signed out. Your data is still saved in your account.', 'info', 3000);
  };
  dialog({
    title: 'Sign out', width: 400,
    body: el('p', { class: 'muted' }, 'Your charts, drawings, alerts and everything else stay saved in your Google account. Do you also want to remove them from this device?'),
    buttons: [{ label: 'Cancel', left: true }, { label: 'Sign out & clear device', onClick: () => { out(true); } }, { label: 'Sign out', primary: true, onClick: () => { out(false); } }],
  });
}

export function signInDialog(a) {
  closePopup();
  if (!cloud.configured) return setupDialog(a);
  const err = el('div', { class: 'acct-err' }, cloud.status === 'error' && cloud.error ? cloud.error : '');
  const gbtn = el('button', { class: 'gbtn', html: `${I.google}<span>Continue with Google</span>` });
  const d = dialog({
    title: 'Sign in', width: 420, cls: 'dlg-signin',
    body: el('div', { class: 'signin' },
      el('div', { class: 'signin-logo', html: I.logo }),
      el('h3', {}, 'Save everything to your account'),
      el('p', { class: 'muted' }, 'Sign in with your Google account to keep your charts, drawings, indicators, alerts, watchlists and paper-trading account safe and synced across all your devices.'),
      gbtn, err,
      el('p', { class: 'muted xs' }, 'We only use your Google name, email and profile picture to identify your account. Your data is stored privately in your own account space.')),
  });
  gbtn.addEventListener('click', async () => {
    if (cloud.status === 'loading') { err.textContent = 'Still connecting, try again in a moment…'; return; }
    gbtn.disabled = true; gbtn.classList.add('busy'); err.textContent = '';
    try {
      await cloud.signIn();
      if (cloud.user) { d.close(); toast(`Signed in as ${cloud.user.name}. Your data is now saved to your account.`, 'success'); }
    } catch (e) { err.textContent = e.message; }
    gbtn.disabled = false; gbtn.classList.remove('busy');
  });
  const off = cloud.on('user', (u) => { if (u) { d.close(); off(); } });
}

function parseConfig(text) {
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('Paste the firebaseConfig object, e.g. { apiKey: "…", authDomain: "…", projectId: "…", appId: "…" }');
  let s = m[0].replace(/\/\/.*$/gm, '').replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
  const c = JSON.parse(s);
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) if (!c[k]) throw new Error(`Missing "${k}" in config`);
  return c;
}

function setupDialog(a) {
  const ta = el('textarea', { class: 'inp code-in', rows: 8, placeholder: 'const firebaseConfig = {\n  apiKey: "AIza…",\n  authDomain: "your-project.firebaseapp.com",\n  projectId: "your-project",\n  storageBucket: "your-project.appspot.com",\n  messagingSenderId: "…",\n  appId: "1:…:web:…"\n};' });
  const err = el('div', { class: 'acct-err' });
  const host = location.hostname || 'localhost';
  dialog({
    title: 'Set up Google sign-in', width: 560,
    body: el('div', { class: 'setup' },
      el('p', {}, 'Google sign-in and cloud saving use a free Firebase project that you own. One-time setup (≈5 minutes):'),
      el('ol', {},
        el('li', {}, 'Open ', el('a', { href: 'https://console.firebase.google.com', target: '_blank', rel: 'noopener' }, 'console.firebase.google.com'), ' and create a project.'),
        el('li', {}, el('b', {}, 'Authentication'), ' → Get started → Sign-in method → enable ', el('b', {}, 'Google'), '. Under Settings → Authorized domains add ', el('code', {}, host), '.'),
        el('li', {}, el('b', {}, 'Firestore Database'), ' → Create database. In the ', el('b', {}, 'Rules'), ' tab paste the rules from ', el('code', {}, 'firestore.rules'), ' and Publish.'),
        el('li', {}, el('b', {}, 'Project settings'), ' → Your apps → add a Web app (</>) and copy its ', el('code', {}, 'firebaseConfig'), '.'),
        el('li', {}, 'Paste it below to try it on this browser — and paste the same object into ', el('code', {}, 'js/firebase-config.js'), ' in the repository so every visitor can sign in.')),
      ta, err),
    buttons: [{ label: 'Cancel' }, {
      label: 'Save & connect', primary: true, onClick: () => {
        try { const c = parseConfig(ta.value); cloud.saveConfig(c); toast('Firebase config saved — connecting…', 'success'); setTimeout(() => location.reload(), 600); }
        catch (e) { err.textContent = e.message; return false; }
      },
    }],
  });
}
