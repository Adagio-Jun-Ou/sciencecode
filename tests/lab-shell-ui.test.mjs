import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'lab', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'lab', 'styles.css'), 'utf8');

test('Lab boot is explicit, busy, and non-actionable until verified state arrives', () => {
  assert.match(html, /class="skip-link" href="#main-stage"/);
  assert.match(html, /id="main-stage"[^>]*aria-busy="true"/);
  assert.match(html, /id="chat-messages"[^>]*aria-busy="true"/);
  assert.match(html, /initial-workspace-state loading/);
  assert.match(html, /id="new-chat-button"[^>]*disabled/);
  assert.match(html, /id="chat-input"[^>]*disabled/);
  assert.match(html, /id="send-button"[^>]*disabled/);
  assert.match(app, /let stateReady = false;/);
  assert.match(app, /function setStateBusy\(value\)/);
  assert.match(app, /if \(!stateReady\) renderInitialStateFailure/);
  assert.match(app, /if \(loaded && stateReady\)/);
});

test('Lab navigation communicates selection and restores focus across hidden views', () => {
  assert.match(html, /data-view="chat"[^>]*aria-current="page"/);
  assert.match(html, /id="chat-title" tabindex="-1"/);
  assert.match(html, /id="archive-title" tabindex="-1"/);
  assert.match(html, /id="record-detail"[^>]*role="region"[^>]*tabindex="-1"/);
  assert.match(app, /button\.setAttribute\('aria-current', 'page'\)/);
  assert.match(app, /elements\.archiveView\.hidden = chat/);
  assert.match(app, /function focusRecordDetail\(\)/);
  assert.match(app, /showView\(button\.dataset\.view, \{ focus: true \}\)/);
});

test('Harness tabs expose a complete tab keyboard model', () => {
  assert.match(html, /class="harness-tabs"[^>]*role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.match(app, /button\.setAttribute\('aria-selected', String\(selected\)\)/);
  assert.match(app, /event\.key === 'ArrowRight'/);
  assert.match(app, /event\.key === 'ArrowLeft'/);
  assert.match(app, /event\.key === 'Home'/);
  assert.match(app, /event\.key === 'End'/);
});

test('Narrow layouts retain integrity state and keep every workspace view on one rail', () => {
  const mobileStart = styles.indexOf('@media (max-width: 680px)');
  const compactStart = styles.indexOf('@media (max-width: 420px)');
  assert.ok(mobileStart >= 0 && compactStart > mobileStart);
  const mobile = styles.slice(mobileStart, compactStart);
  assert.doesNotMatch(mobile, /\.connection\s*\{[^}]*display:\s*none/s);
  assert.match(mobile, /\.connection-label \{ max-width: 100px; \}/);
  assert.match(mobile, /\.workspace-nav \{\s*display: flex;/s);
  assert.match(mobile, /\.workspace-link \{\s*min-width: 82px;\s*flex: 0 0 82px;/s);
  assert.match(styles, /\.skip-link:focus \{ transform: translateY\(0\); \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('Verified integrity labels survive subsequent conversation selection', () => {
  assert.match(html, /class="connection-label">Connecting<\/span>/);
  assert.match(app, /function setIntegrityConnection\(\)/);
  assert.match(app, /Local · verified snapshot/);
  assert.match(app, /async function selectChat[\s\S]*?setIntegrityConnection\(\);/);
  assert.doesNotMatch(app, /setConnection\('online', 'Local'\)/);
});
