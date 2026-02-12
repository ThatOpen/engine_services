/**
 * Creates a test app ZIP file that can be uploaded via the test page.
 *
 * Usage:  node test/create-test-app.mjs
 * Output: test/test-app.zip
 *
 * Then upload test-app.zip using the createApp() button on the test page.
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = dirname(fileURLToPath(import.meta.url));

const bundleCode = `(function () {
  var ctx = window.__THATOPEN_CONTEXT__ || {};
  var app = document.getElementById('that-open-app');

  app.innerHTML = [
    '<div style="padding:32px;font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">',
    '  <h1 style="color:#6528e0;margin-bottom:16px">Hello from Test App!</h1>',
    '  <p style="margin-bottom:8px"><strong>App ID:</strong> ' + (ctx.appId || 'N/A') + '</p>',
    '  <p style="margin-bottom:8px"><strong>Project ID:</strong> ' + (ctx.projectId || 'N/A') + '</p>',
    '  <p style="margin-bottom:8px"><strong>API URL:</strong> ' + (ctx.apiUrl || 'N/A') + '</p>',
    '  <p style="margin-bottom:24px"><strong>Token:</strong> ' + (ctx.accessToken ? ctx.accessToken.substring(0, 20) + '...' : 'N/A') + '</p>',
    '  <div id="counter-box" style="padding:16px;background:#f5f0ff;border-radius:8px;text-align:center">',
    '    <p style="margin-bottom:8px">Interactive counter (proves iframe state persists):</p>',
    '    <button id="dec-btn" style="padding:8px 16px;font-size:16px;cursor:pointer">-</button>',
    '    <span id="count" style="display:inline-block;min-width:40px;text-align:center;font-size:24px;font-weight:bold;vertical-align:middle">0</span>',
    '    <button id="inc-btn" style="padding:8px 16px;font-size:16px;cursor:pointer">+</button>',
    '  </div>',
    '</div>',
  ].join('\\n');

  var count = 0;
  var countEl = document.getElementById('count');
  document.getElementById('inc-btn').addEventListener('click', function () {
    count++;
    countEl.textContent = count;
  });
  document.getElementById('dec-btn').addEventListener('click', function () {
    count--;
    countEl.textContent = count;
  });
})();
`;

const zip = new JSZip();
zip.file('bundle', bundleCode);

const buffer = await zip.generateAsync({ type: 'nodebuffer' });
const outPath = join(__dirname, 'test-app.zip');
writeFileSync(outPath, buffer);
console.log(`Created ${outPath} (${buffer.length} bytes)`);
