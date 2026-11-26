// Entry point: boots the app and the mobile UI
import { app } from './app.js';
import { initMobile } from './mobile.js';
import { $ } from './util.js';

initMobile(app);
// close the drawing-tools drawer when tapping the chart on mobile
$('#chartsWrap').addEventListener('pointerdown', () => { if (document.body.classList.contains('lt-open') && !app.tool) document.body.classList.remove('lt-open'); });
