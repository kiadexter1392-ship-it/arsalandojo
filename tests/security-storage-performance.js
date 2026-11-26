'use strict';
process.env.DOJO_TEST_FIXTURES = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

async function freePort() {
  const s = net.createServer().listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FAKE_PNG = 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>', 'utf8').toString('base64');
const FAKE_PDF = 'data:application/pdf;base64,' + Buffer.from('not-actually-a-pdf', 'utf8').toString('base64');
const VALID_PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8').toString('base64');

async function spawnDojo(env) {
  const child = spawn(process.execPath, ['start.js'], {
    env,
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    let logs = '';
    const timer = setTimeout(() => reject(new Error('Startup timeout:\n' + logs)), 15000);
    const read = (chunk) => {
      logs += chunk;
      if (
        logs.includes('[storage] آماده') &&
        logs.includes('[coach-site] آماده') &&
        logs.includes('[members-site] آماده')
      ) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Exited (${code}):\n${logs}`));
    });
  });
  return child;
}

function rawHttpGet(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-sec-'));
  const storageDir = path.join(rootDir, 'isolated-storage');
  const dbPath = path.join(rootDir, 'test.db');
  const storagePort = await freePort();
  const env = {
    ...process.env,
    RESET_DB: '0',
    ARSLAN_DATA_DIR: rootDir,
    ARSLAN_STORAGE_DIR: storageDir,
    ARSLAN_DB: dbPath,
    PORT: String(await freePort()),
    COACH_PORT: String(await freePort()),
    MEMBER_PORT: String(await freePort()),
    STORAGE_PORT: String(storagePort),
    STORAGE_PUBLIC_URL: `http://127.0.0.1:${storagePort}`
  };

  let child = await spawnDojo(env);
  const base = 'http://127.0.0.1:' + env.PORT;
  const storageBase = 'http://127.0.0.1:' + storagePort;

  async function api(route, body, cookie, method = body ? 'POST' : 'GET', extraHeaders = {}) {
    const res = await fetch(base + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extraHeaders
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* raw */ }
    return { status: res.status, body: parsed, headers: res.headers, cookie: res.headers.getSetCookie()[0]?.split(';')[0] };
  }

  try {
    // 1. Two-part split health checks & directory isolation
    const gwHealth = await api('/healthz');
    assert.equal(gwHealth.status, 200);
    assert.equal(gwHealth.body.ok, true);
    assert.equal(gwHealth.body.storagePort, storagePort);

    const storageHealth = await fetch(storageBase + '/healthz');
    assert.equal(storageHealth.status, 200);
    const storageJson = await storageHealth.json();
    assert.equal(storageJson.service, 'storage');

    const unauthInternal = await fetch(storageBase + '/internal/stats');
    assert.equal(unauthInternal.status, 401);

    // Ensure storageDir is outside public webdirs and mode 0700
    assert.equal(storageDir.includes('public'), false);
    const stStat = fs.statSync(storageDir);
    assert.equal(stStat.mode & 0o777, 0o700);

    // Log in users
    const kiaLogin = await api('/api/login', { username: 'kia', password: '123456' });
    assert.equal(kiaLogin.status, 200);
    const kiaCookie = kiaLogin.cookie;
    const kiaId = kiaLogin.body.user.id;

    const reg = await api('/api/register', {
      username: 'sec_student2',
      full_name: 'شاگرد تست امنیت',
      password: 'password123',
      password2: 'password123',
      discipline: 'کاراته'
    });
    assert.equal(reg.status, 200);
    const secondCookie = reg.cookie;

    const coachLogin = await api('/coach/api/login', { username: 'arsalan', password: 'arsalan123' });
    assert.equal(coachLogin.status, 200);
    const coachCookie = coachLogin.cookie;

    // 2. Magic-byte rejection for spoofed MIME/data URLs
    assert.equal((await api('/api/me/photo', { photo_data: FAKE_PNG }, kiaCookie)).status, 400);
    assert.equal((await api('/api/me/insurance', { file_data: FAKE_PDF, file_name: 'fake.pdf' }, kiaCookie)).status, 400);
    assert.equal((await api('/api/tuition/receipts', {
      amount_toman: 1500000,
      tracking_code: 'TRK-FAKE',
      receipt_image: FAKE_PNG
    }, kiaCookie)).status, 400);

    // 3. Valid uploads stored off-domain & out of SQLite blobs
    const photoUp = await api('/api/me/photo', { photo_data: PNG_1PX }, kiaCookie);
    assert.equal(photoUp.status, 200);
    assert.equal(photoUp.body.user.has_photo, true);

    const insUp = await api('/api/me/insurance', { file_data: VALID_PDF, file_name: 'ins-1405.pdf' }, kiaCookie);
    assert.equal(insUp.status, 200);
    assert.equal(insUp.body.user.has_insurance, true);

    const insGet = await api('/api/me/insurance', null, kiaCookie);
    assert.equal(insGet.status, 200);
    assert.ok(insGet.body.file_data.startsWith('data:application/pdf;base64,'));
    assert.ok(insGet.body.storage_url.startsWith(storageBase + '/s/'));

    // Signed URL on separate storage server returns PDF with strict CSP & nosniff
    const signedRes = await fetch(insGet.body.storage_url);
    assert.equal(signedRes.status, 200);
    assert.equal(signedRes.headers.get('content-type'), 'application/pdf');
    assert.equal(signedRes.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(signedRes.headers.get('content-security-policy').includes("default-src 'none'"));

    // Tampered token on storage server fails 403
    const badTokenRes = await fetch(insGet.body.storage_url + 'tampered');
    assert.equal(badTokenRes.status, 403);

    // Tuition receipt stored externally, omitted from list payload, streamed via /image endpoint
    const recCreate = await api('/api/tuition/receipts', {
      amount_toman: 1900000,
      tracking_code: 'TRK-OFFDOMAIN',
      receipt_image: PNG_1PX,
      note: 'رسید تست'
    }, kiaCookie);
    assert.equal(recCreate.status, 201);
    const recId = recCreate.body.receipt.id;
    assert.equal(recCreate.body.receipt.has_receipt_image, true);
    assert.equal(recCreate.body.receipt.receipt_image, undefined);

    const recList = await api('/api/tuition/receipts', null, kiaCookie);
    assert.equal(recList.status, 200);
    const listed = recList.body.receipts.find((r) => r.id === recId);
    assert.equal(listed.has_receipt_image, true);
    assert.equal(listed.receipt_image, undefined);

    // Member binary endpoint works for owner, blocked (404) for other student (IDOR check)
    const ownImgRes = await fetch(base + `/api/tuition/receipts/${recId}/image`, { headers: { cookie: kiaCookie } });
    assert.equal(ownImgRes.status, 200);
    assert.equal(ownImgRes.headers.get('content-type'), 'image/png');
    const idorImgRes = await fetch(base + `/api/tuition/receipts/${recId}/image`, { headers: { cookie: secondCookie } });
    assert.equal(idorImgRes.status, 404);

    // Coach binary endpoint works
    const coachRecList = await api('/coach/api/tuition/receipts', null, coachCookie);
    assert.equal(coachRecList.status, 200);
    const coachListed = coachRecList.body.receipts.find((r) => r.id === recId);
    assert.equal(coachListed.has_receipt_image, true);
    assert.equal(coachListed.receipt_image, undefined);
    const coachImgRes = await fetch(base + `/coach/api/tuition/receipts/${recId}/image`, { headers: { cookie: coachCookie } });
    assert.equal(coachImgRes.status, 200);

    // Verify SQLite cleared inline blobs & uses keys
    const sqlDb = new DatabaseSync(dbPath, { readOnly: true });
    const userRow = sqlDb.prepare('SELECT avatar_photo, avatar_key, insurance_file, insurance_key FROM users WHERE id = ?').get(kiaId);
    assert.equal(userRow.avatar_photo, null);
    assert.ok(userRow.avatar_key && userRow.avatar_key.startsWith('avatars/'));
    assert.equal(userRow.insurance_file, null);
    assert.ok(userRow.insurance_key && userRow.insurance_key.startsWith('insurance/'));
    const recRow = sqlDb.prepare('SELECT receipt_image, receipt_key FROM tuition_receipts WHERE id = ?').get(recId);
    assert.equal(recRow.receipt_image, null);
    assert.ok(recRow.receipt_key && recRow.receipt_key.startsWith('receipts/'));
    sqlDb.close();

    // 4. Security hardening: CSRF, spoofed proxy headers, invalid IDs, empty announcement orphan prevention, CSV injection, rate limiting
    assert.equal((await api('/api/profile', { full_name: 'X' }, kiaCookie, 'PUT', { origin: 'https://evil.ir' })).status, 403);
    assert.equal((await api('/api/profile', { full_name: 'X' }, kiaCookie, 'PUT', { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await api('/api/profile', { full_name: 'X' }, kiaCookie, 'PUT', { origin: 'null' })).status, 403);

    // Invalid IDs return 400
    assert.equal((await api('/coach/api/members/abc', null, coachCookie)).status, 400);
    assert.equal((await api('/api/announcements/notanid/read', {}, kiaCookie)).status, 400);

    // Empty announcement target fails BEFORE inserting orphan row
    const annBefore = await api('/coach/api/announcements', null, coachCookie);
    const emptyAnn = await api('/coach/api/announcements', { title: 'اعلان تست', body: 'متن اعلان تست', member_ids: [] }, coachCookie);
    assert.equal(emptyAnn.status, 400);
    const annAfter = await api('/coach/api/announcements', null, coachCookie);
    assert.equal(annAfter.body.announcements.length, annBefore.body.announcements.length);

    // CSV formula injection escaping
    const injMember = await api('/coach/api/members', {
      full_name: '=CMD|calc!A0',
      username: 'csv_inj_user',
      password: 'password123',
      discipline: 'کاراته'
    }, coachCookie);
    assert.equal(injMember.status, 200);
    const csvRes = await api('/coach/api/export/members', null, coachCookie);
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.body.includes(`"'=CMD|calc!A0"`));

    // Rate limiting on login (10 attempts/15m on member /api/login)
    let got429 = false;
    for (let i = 0; i < 14; i++) {
      const r = await api('/api/login', { username: 'kia', password: 'wrong-password' });
      if (r.status === 429) { got429 = true; break; }
    }
    assert.equal(got429, true);

    // 5. Performance: gzip compression & 304 Not Modified ETag on static assets
    const uiRes1 = await rawHttpGet(base + '/ui/ui.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(uiRes1.status, 200);
    assert.equal(uiRes1.headers['content-encoding'], 'gzip');
    assert.ok(uiRes1.headers.etag);

    const uiRes304 = await rawHttpGet(base + '/ui/ui.js', {
      'Accept-Encoding': 'gzip',
      'If-None-Match': uiRes1.headers.etag
    });
    assert.equal(uiRes304.status, 304);

    // 6. Legacy inline blob automatic startup migration test
    child.kill('SIGTERM');
    await once(child, 'exit');

    const rwDb = new DatabaseSync(dbPath);
    rwDb.prepare('UPDATE users SET avatar_photo = ?, avatar_key = NULL WHERE id = ?').run(PNG_1PX, kiaId);
    rwDb.close();

    child = await spawnDojo(env);

    const migratedPhoto = await fetch(base + '/api/me/photo', { headers: { cookie: kiaCookie } });
    assert.equal(migratedPhoto.status, 200);
    assert.equal(migratedPhoto.headers.get('content-type'), 'image/png');

    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    const migratedRow = verifyDb.prepare('SELECT avatar_photo, avatar_key FROM users WHERE id = ?').get(kiaId);
    assert.equal(migratedRow.avatar_photo, null);
    assert.ok(migratedRow.avatar_key && migratedRow.avatar_key.startsWith('avatars/'));
    verifyDb.close();

    console.log('✓ Security, off-domain storage & performance test suite passed');
  } finally {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
})();
