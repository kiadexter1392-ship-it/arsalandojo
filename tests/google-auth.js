'use strict';
process.env.DOJO_TEST_FIXTURES = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

async function port() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const p = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return p;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-google-auth-'));
  const CLIENT_ID = '5918828036-9eq5ut53ujmrub4i1t7039gep5s9a6vi.apps.googleusercontent.com';

  const mockTokenServer = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const token = reqUrl.searchParams.get('id_token') || '';
    res.setHeader('Content-Type', 'application/json');
    const futureExp = String(Math.floor(Date.now() / 1000) + 3600);
    const pastExp = String(Math.floor(Date.now() / 1000) - 3600);
    const map = {
      'tok-unregistered': { aud: CLIENT_ID, email: 'NewAthlete@Gmail.com', email_verified: 'true', name: 'ورزشکار جدید', exp: futureExp },
      'tok-kia': { aud: CLIENT_ID, email: 'kia.linked@gmail.com', email_verified: true, name: 'Kia', exp: futureExp },
      'tok-wrong-aud': { aud: 'other-client.apps.googleusercontent.com', email: 'other@gmail.com', email_verified: 'true', exp: futureExp },
      'tok-unverified': { aud: CLIENT_ID, email: 'unverified@gmail.com', email_verified: 'false', exp: futureExp },
      'tok-expired': { aud: CLIENT_ID, email: 'expired@gmail.com', email_verified: 'true', exp: pastExp },
      'tok-coach': { aud: CLIENT_ID, email: 'coach@arslandojo.ir', email_verified: 'true', name: 'مربی', exp: futureExp },
      'tok-inactive': { aud: CLIENT_ID, email: 'inactive@gmail.com', email_verified: 'true', exp: futureExp }
    };
    const payload = map[token];
    if (!payload) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => mockTokenServer.listen(0, '127.0.0.1', resolve));
  const mockVerifyUrl = `http://127.0.0.1:${mockTokenServer.address().port}/tokeninfo`;

  const env = {
    ...process.env,
    RESET_DB: '0',
    ARSLAN_DATA_DIR: dir,
    ARSLAN_DB: path.join(dir, 'test.db'),
    ARSLAN_GOOGLE_VERIFY_URL: mockVerifyUrl,
    PORT: String(await port()),
    COACH_PORT: String(await port()),
    MEMBER_PORT: String(await port())
  };

  const child = spawn(process.execPath, ['start.js'], {
    env,
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const base = 'http://127.0.0.1:' + env.PORT;

  try {
    await new Promise((resolve, reject) => {
      let logs = '';
      const timer = setTimeout(() => reject(new Error(logs)), 15000);
      const read = (chunk) => {
        logs += chunk;
        if (logs.includes('[coach-site] آماده') && logs.includes('[members-site] آماده')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
    });

    async function api(route, body, cookie, method = body ? 'POST' : 'GET') {
      const response = await fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {})
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.getSetCookie()[0]?.split(';')[0]
      };
    }

    // 1. Unregistered Gmail triggers prefill flow (registered: false) without cookie
    const unreg = await api('/api/auth/google', { idToken: 'tok-unregistered' });
    assert.equal(unreg.status, 200, JSON.stringify(unreg.body));
    assert.equal(unreg.body.ok, true);
    assert.equal(unreg.body.registered, false);
    assert.equal(unreg.body.email, 'newathlete@gmail.com');
    assert.equal(unreg.cookie, undefined);

    // 2. Register user with that Gmail, then Google button logs directly into /panel
    const reg = await api('/api/register', {
      full_name: 'ورزشکار جدید',
      username: 'newathlete',
      email: 'NewAthlete@Gmail.com',
      discipline: 'کاراته',
      password: 'password123',
      password2: 'password123'
    });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.user.email, 'newathlete@gmail.com');

    const directLogin = await api('/api/auth/google', { idToken: 'tok-unregistered' });
    assert.equal(directLogin.status, 200, JSON.stringify(directLogin.body));
    assert.equal(directLogin.body.registered, true);
    assert.equal(directLogin.body.redirect, '/panel');
    assert.ok(directLogin.cookie, 'Expected member session cookie on Google login');

    const meRes = await api('/api/me', null, directLogin.cookie);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.username, 'newathlete');
    assert.equal(meRes.body.user.email, 'newathlete@gmail.com');

    // 3. Existing account links Gmail via PUT /api/me, duplicate rejected with 409, then logs in with Google
    const kiaLogin = await api('/api/login', { username: 'kia', password: '123456' });
    assert.equal(kiaLogin.status, 200);
    const dupAttempt = await api('/api/me', { email: 'newathlete@gmail.com' }, kiaLogin.cookie, 'PUT');
    assert.equal(dupAttempt.status, 409);

    const kiaLinked = await api('/api/me', { email: 'kia.linked@gmail.com' }, kiaLogin.cookie, 'PUT');
    assert.equal(kiaLinked.status, 200);
    assert.equal(kiaLinked.body.user.email, 'kia.linked@gmail.com');

    const kiaGoogle = await api('/api/auth/google', { idToken: 'tok-kia' });
    assert.equal(kiaGoogle.status, 200);
    assert.equal(kiaGoogle.body.registered, true);
    assert.equal(kiaGoogle.body.user.username, 'kia');
    assert.ok(kiaGoogle.cookie);

    // 4. Negative security checks
    assert.equal((await api('/api/auth/google', { idToken: 'tok-wrong-aud' })).status, 401);
    assert.equal((await api('/api/auth/google', { idToken: 'tok-unverified' })).status, 401);
    assert.equal((await api('/api/auth/google', { idToken: 'tok-expired' })).status, 401);
    assert.equal((await api('/api/auth/google', { idToken: 'tok-invalid' })).status, 401);
    assert.equal((await api('/api/auth/google', {})).status, 400);

    // Register inactive member and coach email cases via isolated DB inspection helper in coach API
    const coach = await api('/coach/api/login', { username: 'arsalan', password: 'arsalan123' });
    assert.equal(coach.status, 200);
    // Register & deactivate member with inactive@gmail.com
    const regInactive = await api('/api/register', {
      full_name: 'کاربر غیرفعال',
      username: 'inactiveuser',
      email: 'inactive@gmail.com',
      discipline: 'بوکس',
      password: 'password123',
      password2: 'password123'
    });
    assert.equal(regInactive.status, 200);
    const inactiveId = regInactive.body.user.id;
    const toggleRes = await api(`/coach/api/members/${inactiveId}`, { active: 0 }, coach.cookie, 'PUT');
    assert.equal(toggleRes.status, 200);

    const inactiveGoogle = await api('/api/auth/google', { idToken: 'tok-inactive' });
    assert.equal(inactiveGoogle.status, 403);

    // 5. Verify website exposes Google Client ID, GIS button/widget, purple glass CSS, and compatible CSP/COOP headers
    const cfgRes = await api('/api/config');
    assert.equal(cfgRes.status, 200);
    assert.equal(cfgRes.body.googleClientId, CLIENT_ID);

    const landingRes = await fetch(base + '/');
    assert.equal(landingRes.status, 200);
    const csp = landingRes.headers.get('content-security-policy') || '';
    const coop = landingRes.headers.get('cross-origin-opener-policy') || '';
    assert.ok(csp.includes('https://accounts.google.com/gsi/client'), 'CSP must allow GIS script');
    assert.ok(csp.includes('https://accounts.google.com/gsi/'), 'CSP must allow GIS frame/connect');
    assert.equal(coop, 'same-origin-allow-popups');
    const landingHtml = await landingRes.text();
    assert.ok(landingHtml.includes('id="dojo-google-auth-wrap"'), 'Landing page includes Google auth box');
    assert.ok(landingHtml.includes('id="dojo-google-auth-btn"'), 'Landing page includes Continue with Google button');
    assert.ok(landingHtml.includes('id="dojo-google-web-btn"'), 'Landing page includes web GIS button slot');
    assert.ok(landingHtml.includes('https://accounts.google.com/gsi/client'), 'Landing page loads GIS client');

    const cssRes = await fetch(base + '/ui/style.css');
    assert.equal(cssRes.status, 200);
    const cssText = await cssRes.text();
    assert.ok(cssText.includes('#f3ebff') && cssText.includes('#e9d8fd'), 'Website CSS uses royal purple ambient backdrop');

    console.log('PASS: Google OAuth member sign-in, unregistered prefill, registration linking, duplicate protection, web GIS/CSS/CSP checks, and security checks');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit').catch(() => {});
    mockTokenServer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
