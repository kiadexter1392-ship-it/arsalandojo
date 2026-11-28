'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arslan-prod-harden-'));
const GATEWAY_PORT = 4480;
const MEMBER_PORT = 4473;
const COACH_PORT = 4474;
const STORAGE_PORT = 4475;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitUp(url, deadline = Date.now() + 12000) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch { /* wait */ }
    await sleep(120);
  }
  throw new Error('Timeout waiting for ' + url);
}

function startGateway(extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'start.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(GATEWAY_PORT),
      MEMBER_PORT: String(MEMBER_PORT),
      COACH_PORT: String(COACH_PORT),
      STORAGE_PORT: String(STORAGE_PORT),
      ARSLAN_DATA_DIR: DATA_DIR,
      ARSLAN_STORAGE_SECRET: '0123456789abcdef0123456789abcdef',
      ARSLAN_INTERNAL_PROXY_TOKEN: 'internal-token-0123456789abcdef',
      DOJO_TEST_FIXTURES: '1',
      NODE_ENV: 'test',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d; });
  proc.stderr.on('data', (d) => { logs += d; });
  return { proc, getLogs: () => logs };
}

async function stopGateway(proc) {
  if (!proc || proc.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 6000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill('SIGTERM');
  });
}

function cookieFrom(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  // 1. Static CSS, JS, Deployment & Security Audit (320px–1440px, no hardcoded secrets, CSV safety)
  const styleCss = fs.readFileSync(path.join(ROOT, 'shared/public/ui/style.css'), 'utf8');
  const shellCss = fs.readFileSync(path.join(ROOT, 'shared/public/ui/shell.css'), 'utf8');
  const academyCss = fs.readFileSync(path.join(ROOT, 'shared/public/ui/academy.css'), 'utf8');
  const academyJs = fs.readFileSync(path.join(ROOT, 'shared/public/ui/academy.js'), 'utf8');
  const dashJs = fs.readFileSync(path.join(ROOT, 'coach/public/dashboard.js'), 'utf8');
  const careJs = fs.readFileSync(path.join(ROOT, 'coach/public/care.js'), 'utf8');
  const panelJs = fs.readFileSync(path.join(ROOT, 'members/public/panel.js'), 'utf8');
  const railwayJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'railway.json'), 'utf8'));
  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

  assert.match(shellCss, /\.chip-row\s*\{[^}]*flex-wrap:\s*wrap/, '.chip-row must wrap for 320px screens');
  assert.match(shellCss, /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.modal\s*\{/, 'mobile modal breakpoint required');
  assert.match(styleCss, /minmax\(min\(240px,\s*100%\),\s*1fr\)/, '.features-grid must clamp at 320px');
  assert.match(styleCss, /minmax\(min\(220px,\s*100%\),\s*1fr\)/, '.contact-grid must clamp at 320px');
  assert.match(styleCss, /#toastBox,\s*#toasts\s*\{[^}]*max-width:\s*calc\(100vw - 32px\)/, 'toasts must fit 320px');
  assert.match(academyCss, /\.dash-person-stats\s*\{[^}]*flex-wrap:\s*wrap/, '.dash-person-stats must wrap');
  assert.match(panelJs, /minmax\(min\(250px,\s*100%\),1fr\)/, 'member support grid must clamp at 320px');
  assert.doesNotMatch(dashJs, /window\.open\([^)]*\/api\/export\//, 'dashboard CSV exports must not use popup window.open');
  assert.doesNotMatch(careJs, /window\.open\([^)]*\/api\/export\//, 'care CSV exports must not use popup window.open');
  assert.ok(academyJs.includes('AndroidDojoBridge.saveDataUrlFile'), 'academy.js CSV export must bridge Android WebView');
  assert.equal(railwayJson.deploy.healthcheckPath, '/health', 'railway.json must point to /health');
  assert.ok(envExample.includes('ARSLAN_DATA_DIR=') && envExample.includes('GEMINI_API_KEY='), '.env.example must document required vars');

  // Verify shared/server keeps long keepAliveTimeout for Railway proxy
  const sharedServerSrc = fs.readFileSync(path.join(ROOT, 'shared/server.js'), 'utf8');
  assert.ok(sharedServerSrc.includes('keepAliveTimeout = 65000') && sharedServerSrc.includes('headersTimeout = 66000'));

  // 2. Runtime tests: GEMINI_API_KEY unset -> "تنظیم نشده"
  const env1 = { ...process.env };
  delete env1.GEMINI_API_KEY;
  let gw = startGateway({ GEMINI_API_KEY: '' });
  try {
    const base = `http://127.0.0.1:${GATEWAY_PORT}`;
    const storageBase = `http://127.0.0.1:${STORAGE_PORT}`;

    const gwHealthRes = await waitUp(base + '/health');
    const gwHealth = await gwHealthRes.json();
    assert.equal(gwHealth.ok, true);
    assert.equal(gwHealth.status, 'healthy');

    const [gwHealthzRes, stHealthRes, coachHealthRes, memberCfgRes, coachCfgRes] = await Promise.all([
      fetch(base + '/healthz'),
      fetch(storageBase + '/health'),
      fetch(base + '/coach/health'),
      fetch(base + '/api/config'),
      fetch(base + '/coach/api/config')
    ]);
    assert.equal(gwHealthzRes.status, 200);
    assert.equal(stHealthRes.status, 200);
    assert.equal(coachHealthRes.status, 200);

    const memberCfg = await memberCfgRes.json();
    const coachCfg = await coachCfgRes.json();
    assert.equal(memberCfg.geminiConfigured, false);
    assert.equal(memberCfg.geminiStatus, 'تنظیم نشده');
    assert.equal(coachCfg.geminiConfigured, false);
    assert.equal(coachCfg.geminiStatus, 'تنظیم نشده');
    assert.equal(JSON.stringify(memberCfg).includes('GEMINI_API_KEY'), false);

    // Coach login must NOT leak demo credentials in /api/me
    const coachLogin = await fetch(base + '/coach/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'arsalan', password: 'arsalan123' })
    });
    assert.equal(coachLogin.status, 200);
    const coachCookie = cookieFrom(coachLogin);

    const coachMeRes = await fetch(base + '/coach/api/me', { headers: { cookie: coachCookie } });
    const coachMe = await coachMeRes.json();
    assert.equal(coachMe.ok, true);
    assert.equal('demo' in coachMe, false, '/api/me must never leak plaintext demo passwords');

    // Reverse-proxy x-forwarded-host CSRF compatibility
    const csrfOk = await fetch(base + '/coach/api/me', {
      method: 'PUT',
      headers: {
        cookie: coachCookie,
        'Content-Type': 'application/json',
        origin: 'https://arsalan.up.railway.app',
        'x-forwarded-host': 'arsalan.up.railway.app'
      },
      body: JSON.stringify({ notes: 'test note' })
    });
    assert.equal(csrfOk.status, 200);

    // CSV formula injection sanitization on members export
    await fetch(base + '/coach/api/me', {
      method: 'PUT',
      headers: { cookie: coachCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'ok' })
    });
    const memListRes = await fetch(base + '/coach/api/members', { headers: { cookie: coachCookie } });
    const memList = await memListRes.json();
    const kia = memList.members.find((m) => m.username === 'kia');
    assert.ok(kia, 'kia fixture member exists');

    // Update a member phone/belt or inspect export CSV + invalid :id rejection
    const badPersonRes = await fetch(base + '/coach/api/academy/dashboard/person/not-an-id', {
      headers: { cookie: coachCookie }
    });
    assert.equal(badPersonRes.status, 400);

    // Coach must be strictly blocked from /admin routes & private nutrition/invoices/orders
    for (const restricted of [
      '/admin/api/config',
      '/admin/api/records/attendance',
      '/coach/api/academy/records/attendance',
      '/coach/api/academy/records/meetings',
      '/coach/api/academy/records/discounts',
      '/coach/api/academy/records/nutrition',
      '/coach/api/academy/records/invoices',
      '/coach/api/academy/records/orders'
    ]) {
      const r = await fetch(base + restricted, { headers: { cookie: coachCookie } });
      assert.ok([401, 403].includes(r.status), `Expected 401/403 for ${restricted}, got ${r.status}`);
    }

    // Impersonated member cannot mutate profile or password via /api/me or /api/password
    const impRes = await fetch(base + `/coach/api/members/${kia.id}/impersonate`, {
      method: 'POST',
      headers: { cookie: coachCookie, 'Content-Type': 'application/json' },
      body: '{}'
    });
    const impData = await impRes.json();
    assert.equal(impData.ok, true);
    const impVisit = await fetch(base + '/impersonate?token=' + encodeURIComponent(impData.token), { redirect: 'manual' });
    const impCookie = cookieFrom(impVisit);
    assert.equal((await fetch(base + '/api/me', {
      method: 'PUT',
      headers: { cookie: impCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: 'Hacked Name' })
    })).status, 403);
    assert.equal((await fetch(base + '/api/password', {
      method: 'POST',
      headers: { cookie: impCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: '123456', next: 'abcdef' })
    })).status, 403);

    // Storage cross-origin CORP + CORS headers on signed /s/:token URL
    const kiaLogin = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kia', password: '123456' })
    });
    const kiaCookie = cookieFrom(kiaLogin);
    const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2S0AAAAASUVORK5CYII=';
    const uploadPhoto = await fetch(base + '/api/me/photo', {
      method: 'POST',
      headers: { cookie: kiaCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_data: PNG_1PX })
    });
    assert.equal(uploadPhoto.status, 200);
    process.env.ARSLAN_DATA_DIR = DATA_DIR;
    process.env.ARSLAN_STORAGE_SECRET = '0123456789abcdef0123456789abcdef';
    const storage = require('../shared/storage');
    const db = require('../shared/db');
    const row = db.get('SELECT avatar_key FROM users WHERE id = ?', kia.id);
    db.closeDb();
    assert.ok(row && row.avatar_key, 'avatar stored on isolated storage');
    const token = storage.signAccessToken(row.avatar_key, { ownerId: kia.id });
    const signedRes = await fetch(`${storageBase}/s/${encodeURIComponent(token)}`);
    assert.equal(signedRes.status, 200);
    assert.equal(signedRes.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(signedRes.headers.get('access-control-allow-origin'), '*');
    // Internal storage route keeps same-site CORP & requires auth
    const unauthInt = await fetch(`${storageBase}/internal/stats`);
    assert.equal(unauthInt.status, 401);
    assert.equal(unauthInt.headers.get('cross-origin-resource-policy'), 'same-site');

    // Insert a custom workout log and verify survival after graceful SIGTERM restart
    const addLog = await fetch(base + '/api/wellness/progress', {
      method: 'POST',
      headers: { cookie: kiaCookie, 'Content-Type': 'application/json', 'x-wellness-request': '1' },
      body: JSON.stringify({ category: 'workout', title: '=Persistence Test', duration: 45, readiness: 90, note: 'OK' })
    });
    assert.equal(addLog.status, 200);

    // Also create a member with formula name to test CSV neutralization end-to-end
    const badNameMem = await fetch(base + '/coach/api/members', {
      method: 'POST',
      headers: { cookie: coachCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: '=CMD()', username: 'csv_guard_user', password: 'testpass123', belt: 'سفید' })
    });
    assert.equal(badNameMem.status, 200);
    const exportRes = await fetch(base + '/coach/api/export/members', { headers: { cookie: coachCookie } });
    assert.equal(exportRes.status, 200);
    const csvText = await exportRes.text();
    assert.ok(csvText.includes('"\'=CMD()"'), 'CSV export must neutralize formula injection');
    const coachServerSrc = fs.readFileSync(path.join(ROOT, 'coach/server.js'), 'utf8');
    assert.ok(coachServerSrc.includes('/^[\\s\\uFEFF]*[=+\\-@]/'), 'coach csvRow must neutralize leading whitespace formula cells');
  } finally {
    await stopGateway(gw.proc);
  }

  // 3. Restart server with GEMINI_API_KEY set & confirm SQLite volume persistence across restart
  gw = startGateway({ GEMINI_API_KEY: 'dummy-test-gemini-value-never-returned' });
  try {
    const base = `http://127.0.0.1:${GATEWAY_PORT}`;
    await waitUp(base + '/health');
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.equal(cfg.geminiConfigured, true);
    assert.equal(cfg.geminiStatus, 'پیکربندی شده');
    assert.equal(JSON.stringify(cfg).includes('dummy-test-gemini-value-never-returned'), false, 'secret key must never appear in config JSON');

    const kiaLogin = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kia', password: '123456' })
    });
    const kiaCookie = cookieFrom(kiaLogin);
    const progRes = await fetch(base + '/api/wellness/progress', { headers: { cookie: kiaCookie } });
    const prog = await progRes.json();
    assert.ok(prog.logs.some((l) => l.title === '=Persistence Test'), 'SQLite records must survive graceful SIGTERM restart');
  } finally {
    await stopGateway(gw.proc);
  }

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('PASS: production hardening, healthchecks, SQLite persistence, security isolation, CSV sanitization & 320px responsiveness');
}

main().catch((err) => {
  console.error(err);
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
