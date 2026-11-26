// Google sign-in (Firebase Auth) + cloud sync of all saved state (Cloud Firestore).
// Every localStorage key managed by `store` is mirrored to users/{uid}/kv/{key}
// with a timestamp; the newest version of each key wins.
import { Emitter, store, uid } from './util.js';
import { firebaseConfig as FILE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CFG_KEY = 'ta_fbcfg', DEVICE_KEY = 'ta_device', SYNCED_KEY = 'ta_synced_uid';
const docId = (k) => encodeURIComponent(k).replace(/\./g, '%2E');

export class Cloud extends Emitter {
  constructor() {
    super();
    this.user = null;
    this.status = 'off'; // off | loading | signedout | syncing | synced | error
    this.error = null;
    this.lastSync = 0;
    this.pending = new Set();
    this.timer = null;
    this.device = localStorage.getItem(DEVICE_KEY) || uid();
    localStorage.setItem(DEVICE_KEY, this.device);
    store.onChange((k) => this.queue(k));
    window.addEventListener('beforeunload', () => { if (this.pending.size) this.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && this.pending.size) this.flush(); });
  }
  get config() {
    if (FILE_CONFIG && FILE_CONFIG.apiKey) return FILE_CONFIG;
    try { const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); return c && c.apiKey ? c : null; } catch { return null; }
  }
  get configured() { return !!this.config; }
  get configFromFile() { return !!(FILE_CONFIG && FILE_CONFIG.apiKey); }
  setStatus(s, err) { this.status = s; this.error = err || null; this.emit('status', s); }

  async init() {
    const cfg = this.config;
    if (!cfg) { this.setStatus('off'); return; }
    this.setStatus('loading');
    try {
      const [appMod, authMod, fsMod] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
      this.A = authMod; this.F = fsMod;
      this.app = appMod.initializeApp(cfg);
      this.auth = authMod.getAuth(this.app);
      this.db = fsMod.getFirestore(this.app);
      authMod.getRedirectResult(this.auth).catch((e) => this.setStatus('error', friendly(e)));
      authMod.onAuthStateChanged(this.auth, (u) => this.onUser(u));
    } catch (e) {
      console.warn('Cloud init failed', e);
      this.setStatus('error', 'Could not load the sign-in service. Check your connection or Firebase config.');
    }
  }
  saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  clearConfig() { localStorage.removeItem(CFG_KEY); }

  async signIn() {
    if (!this.auth) throw new Error('Sign-in is not available yet');
    const provider = new this.A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await this.A.signInWithPopup(this.auth, provider);
    } catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
        await this.A.signInWithRedirect(this.auth, provider);
      } else if (e.code !== 'auth/popup-closed-by-user') throw new Error(friendly(e));
    }
  }
  async signOut() {
    await this.flush();
    if (this.unsub) { this.unsub(); this.unsub = null; }
    await this.A.signOut(this.auth);
  }

  async onUser(u) {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.user = u ? { uid: u.uid, name: u.displayName || u.email, email: u.email, photo: u.photoURL } : null;
    this.emit('user', this.user);
    if (!u) { this.setStatus('signedout'); return; }
    this.setStatus('syncing');
    try {
      const reload = await this.initialSync();
      if (reload) { location.reload(); return; }
      this.listen();
      this.setStatus('synced');
    } catch (e) {
      console.warn('Initial sync failed', e);
      this.setStatus('error', friendly(e));
    }
  }
  col() { return this.F.collection(this.db, 'users', this.user.uid, 'kv'); }

  // Merge local and cloud copies. Returns true when local data changed and the app must reload.
  async initialSync() {
    const F = this.F;
    const snap = await F.getDocs(this.col());
    const remote = new Map();
    snap.forEach((d) => { const x = d.data(); if (x && x.k) remote.set(x.k, x); });
    const prevUid = localStorage.getItem(SYNCED_KEY);
    const firstOnDevice = prevUid !== this.user.uid;
    let changed = false;
    if (firstOnDevice && prevUid && remote.size) {
      // A different account used this device before: start from this account's cloud copy only.
      store.clearAll(); changed = true;
    }
    const meta = store.meta();
    for (const [k, r] of remote) {
      const lt = meta[k] || 0;
      const remoteWins = firstOnDevice ? true : r.t > lt;
      if (!remoteWins) continue;
      const cur = store.getRaw(k);
      const val = r.del ? null : r.v;
      if (cur !== val) { store.setRaw(k, val, r.t); changed = true; } else { meta[k] = r.t; }
    }
    store.setMeta({ ...store.meta(), ...meta });
    const up = [];
    for (const k of new Set([...store.keys(), ...Object.keys(store.meta())])) {
      const r = remote.get(k), lt = store.meta()[k] || 0;
      if (!r ? store.getRaw(k) != null : (!firstOnDevice && lt > r.t)) up.push(k);
    }
    await this.write(up);
    localStorage.setItem(SYNCED_KEY, this.user.uid);
    this.lastSync = Date.now();
    return changed;
  }
  listen() {
    this.unsub = this.F.onSnapshot(this.col(), (snap) => {
      let n = 0;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const r = ch.doc.data(); if (!r || !r.k || r.dev === this.device) continue;
        if (r.t > (store.meta()[r.k] || 0)) { store.setRaw(r.k, r.del ? null : r.v, r.t); n++; }
      }
      if (n) { this.lastSync = Date.now(); this.emit('remote', n); this.setStatus('synced'); }
    }, (e) => this.setStatus('error', friendly(e)));
  }
  queue(k) {
    if (!this.user) return;
    this.pending.add(k);
    if (this.status !== 'error') this.setStatus('syncing');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1200);
  }
  async flush() {
    clearTimeout(this.timer);
    if (!this.user || !this.pending.size) return;
    const keys = [...this.pending]; this.pending.clear();
    try { await this.write(keys); this.lastSync = Date.now(); this.setStatus('synced'); }
    catch (e) { keys.forEach((k) => this.pending.add(k)); this.setStatus('error', friendly(e)); this.timer = setTimeout(() => this.flush(), 10000); }
  }
  async write(keys) {
    if (!keys.length) return;
    const F = this.F, meta = store.meta();
    for (let i = 0; i < keys.length; i += 400) {
      const batch = F.writeBatch(this.db);
      for (const k of keys.slice(i, i + 400)) {
        const v = store.getRaw(k), t = meta[k] || Date.now();
        const ref = F.doc(this.db, 'users', this.user.uid, 'kv', docId(k));
        batch.set(ref, v == null ? { k, del: true, t, dev: this.device } : { k, v, t, dev: this.device });
      }
      await batch.commit();
    }
  }
  async syncNow() {
    if (!this.user) return;
    this.setStatus('syncing');
    for (const k of store.keys()) this.pending.add(k);
    await this.flush();
  }
  async wipeCloud() {
    if (!this.user) return;
    const snap = await this.F.getDocs(this.col());
    const docs = []; snap.forEach((d) => docs.push(d.ref));
    for (let i = 0; i < docs.length; i += 400) { const b = this.F.writeBatch(this.db); docs.slice(i, i + 400).forEach((r) => b.delete(r)); await b.commit(); }
  }
}

function friendly(e) {
  const c = e?.code || '';
  if (c === 'auth/unauthorized-domain') return `This domain (${location.hostname}) is not authorized for sign-in. Add it in Firebase → Authentication → Settings → Authorized domains.`;
  if (c === 'auth/operation-not-allowed' || c === 'auth/configuration-not-found') return 'Google sign-in is not enabled. Enable it in Firebase → Authentication → Sign-in method.';
  if (c === 'auth/invalid-api-key' || c === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.') return 'The Firebase API key is invalid. Check the config.';
  if (c === 'auth/network-request-failed') return 'Network error while signing in. Check your connection.';
  if (c === 'permission-denied') return 'Cloud database refused access. Publish the rules from firestore.rules in Firebase → Firestore → Rules.';
  if (c === 'failed-precondition' || c === 'not-found') return 'Cloud Firestore is not set up. Create a Firestore database in the Firebase console.';
  if (c === 'unavailable') return 'Cloud is unreachable — changes are kept locally and will sync later.';
  return e?.message || String(e);
}

export const cloud = new Cloud();
