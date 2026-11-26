// Entry point: boots the app and wires the mobile navigation
import { app } from './app.js';
import { I } from './icons.js';
import { $, $$ } from './util.js';
import { menu } from './ui.js';
import * as D from './dialogs.js';
import { CHART_TYPES } from './icons.js';
import { cloud } from './cloud.js';
import * as Account from './account.js';

const icons = { tools: 'pencil', ind: 'fx', watchlist: 'watchlist', alerts: 'alarm', trading: 'trade', more: 'dots' };
for (const b of $$('#mobilenav button')) {
  const k = b.dataset.m || b.dataset.p || b.dataset.b;
  b.querySelector('.ico').innerHTML = I[icons[k]];
  b.addEventListener('click', () => {
    if (b.dataset.p) { app.bottom.close(); app.panels.toggle(b.dataset.p); document.body.classList.remove('lt-open'); return; }
    if (b.dataset.b) { app.panels.show(null); app.bottom.toggle(b.dataset.b); document.body.classList.remove('lt-open'); return; }
    if (k === 'tools') { document.body.classList.toggle('lt-open'); return; }
    if (k === 'ind') { D.indicatorsDialog(app); return; }
    if (k === 'more') {
      menu(b, [
        { label: 'Chart type', icon: 'candles', sub: CHART_TYPES.map((t) => ({ label: t.name, icon: t.icon, checked: t.id === app.active.cfg.type, onClick: () => { app.active.setType(t.id); app.updateTopbar(); } })) },
        { label: 'Compare symbol', icon: 'plusCircle', onClick: () => D.symbolSearch(app, (s) => app.active.addCompare(s.id), { compare: true }) },
        { label: 'Create alert', icon: 'alarm', onClick: () => D.alertDialog(app) },
        { label: 'Bar replay', icon: 'replay', onClick: () => app.toggleReplay() },
        { label: 'Undo', icon: 'undo', onClick: () => app.active.chart.undo() },
        { label: 'Redo', icon: 'redo', onClick: () => app.active.chart.redo() },
        { divider: true },
        { label: 'Stock Screener', icon: 'screener', onClick: () => { app.panels.show(null); app.bottom.open('screener'); } },
        { label: 'Strategy Tester', icon: 'strategy', onClick: () => { app.panels.show(null); app.bottom.open('strategy'); } },
        { label: 'Script Editor', icon: 'code', onClick: () => { app.panels.show(null); app.bottom.open('editor'); } },
        { label: 'Data Window', icon: 'datawindow', onClick: () => { app.bottom.close(); app.panels.show('datawindow'); } },
        { label: 'Object Tree', icon: 'objtree', onClick: () => { app.bottom.close(); app.panels.show('objtree'); } },
        { label: 'Hotlists', icon: 'hotlist', onClick: () => { app.bottom.close(); app.panels.show('hotlist'); } },
        { divider: true },
        { label: 'Layout', icon: 'layout', onClick: () => app.layoutMenu(b) },
        { label: 'Chart settings', icon: 'gear', onClick: () => D.chartSettings(app) },
        { label: 'Take a snapshot', icon: 'camera', onClick: () => app.screenshot() },
        { label: 'Save / export', icon: 'save', onClick: () => app.saveMenu(b) },
        { divider: true },
        cloud.user ? { label: `Account (${cloud.user.name})`, icon: 'user', onClick: () => Account.menu(app, b) } : { label: 'Sign in with Google', icon: 'user', onClick: () => Account.signInDialog(app) },
      ]);
    }
  });
}
// close the drawing toolbar overlay when tapping the chart on mobile
$('#chartsWrap').addEventListener('pointerdown', () => { if (document.body.classList.contains('lt-open') && !app.tool) document.body.classList.remove('lt-open'); });
