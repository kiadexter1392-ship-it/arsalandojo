'use strict';
process.env.DOJO_TEST_FIXTURES = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

async function freePort() {
  const s = net.createServer().listen(0, '127.0.0.1');
  await once(s, 'listening');
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-care-'));
  const env = {
    ...process.env,
    RESET_DB: '0',
    ARSLAN_DATA_DIR: dir,
    ARSLAN_DB: path.join(dir, 'test.db'),
    PORT: String(await freePort()),
    COACH_PORT: String(await freePort()),
    MEMBER_PORT: String(await freePort())
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
      const res = await fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const text = await res.text();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch { /* csv/text */ }
      return { status: res.status, body: parsed, headers: res.headers, cookie: res.headers.getSetCookie()[0]?.split(';')[0] };
    }

    // 1. Auth guards
    assert.equal((await api('/api/tuition/receipts')).status, 401);
    assert.equal((await api('/coach/api/attendance')).status, 401);
    assert.equal((await api('/coach/api/tuition/receipts')).status, 401);
    assert.equal((await api('/coach/api/export/members')).status, 401);
    assert.equal((await api('/coach/api/export/tuition')).status, 401);

    // Log in two members + coach
    const kiaLogin = await api('/api/login', { username: 'kia', password: '123456' });
    assert.equal(kiaLogin.status, 200);
    const kiaCookie = kiaLogin.cookie;
    const kiaId = kiaLogin.body.user.id;

    const reg = await api('/api/register', {
      username: 'secondstudent',
      full_name: 'شاگرد دوم',
      password: 'password123',
      password2: 'password123',
      discipline: 'بوکس'
    });
    assert.equal(reg.status, 200);
    const secondCookie = reg.cookie;

    const coachLogin = await api('/coach/api/login', { username: 'arsalan', password: 'arsalan123' });
    assert.equal(coachLogin.status, 200);
    const coachCookie = coachLogin.cookie;

    // 2. Tuition receipt validation & submission
    const badSvg = await api('/api/tuition/receipts', {
      amount_toman: 1800000,
      tracking_code: 'TRK-111',
      receipt_image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    }, kiaCookie);
    assert.equal(badSvg.status, 400);

    const badCard = await api('/api/tuition/receipts', {
      amount_toman: 1800000,
      tracking_code: 'TRK-111',
      card_last4: '12'
    }, kiaCookie);
    assert.equal(badCard.status, 400);

    const created = await api('/api/tuition/receipts', {
      amount_toman: 1900000,
      tracking_code: 'TRK-998877',
      card_last4: '۶۲۷۹',
      receipt_image: PNG_1PX,
      note: 'واریز شهریه ماه جاری'
    }, kiaCookie);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.receipt.card_last4, '6279');
    assert.equal(created.body.receipt.status, 'pending');

    // Cross-member receipt isolation
    const secondRecs = await api('/api/tuition/receipts', null, secondCookie);
    assert.equal(secondRecs.status, 200);
    assert.equal(secondRecs.body.receipts.length, 0);

    // Coach reviews and approves receipt
    const coachPending = await api('/coach/api/tuition/receipts?status=pending', null, coachCookie);
    assert.equal(coachPending.status, 200);
    assert.ok(coachPending.body.receipts.some((r) => r.id === created.body.receipt.id));

    const reviewed = await api(`/coach/api/tuition/receipts/${created.body.receipt.id}/review`, {
      status: 'approved',
      coach_note: 'دریافت شد، متشکرم'
    }, coachCookie);
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.receipt.status, 'approved');

    const kiaMeAfter = await api('/api/me', null, kiaCookie);
    assert.equal(kiaMeAfter.body.care.tuition_status, 'paid');

    // 3. Attendance tracking & consecutive absence alert
    const today = new Date();
    const d1 = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
    const d2 = new Date(today.getTime() - 1 * 86400000).toISOString().slice(0, 10);
    const future = new Date(today.getTime() + 5 * 86400000).toISOString().slice(0, 10);

    assert.equal((await api('/coach/api/attendance', { session_date: future, entries: [{ user_id: kiaId, status: 'present' }] }, coachCookie)).status, 400);
    assert.equal((await api('/coach/api/attendance', { session_date: d1, entries: [{ user_id: kiaId, status: 'absent', note: 'سفر' }] }, coachCookie)).status, 200);
    assert.equal((await api('/coach/api/attendance', { session_date: d2, entries: [{ user_id: kiaId, status: 'absent', note: 'غیبت دوم' }] }, coachCookie)).status, 200);

    const attList = await api('/coach/api/attendance?date=' + d2, null, coachCookie);
    const kiaAtt = attList.body.members.find((m) => m.id === kiaId);
    assert.equal(kiaAtt.status, 'absent');
    assert.equal(kiaAtt.consecutive_absences, 2);

    // 4. Coach reminders & targeted notification single-item read + isolation
    const rem = await api(`/coach/api/members/${kiaId}/remind`, { kind: 'absence' }, coachCookie);
    assert.equal(rem.status, 200);

    const kiaNotifs = await api('/api/notifications', null, kiaCookie);
    const unreadNotif = kiaNotifs.body.notifications.find((n) => !n.read && n.type === 'reminder_absence');
    assert.ok(unreadNotif, 'expected unread absence reminder notification');

    // Other member cannot mark Kia's notification as read
    const stolenRead = await api(`/api/notifications/${unreadNotif.id}/read`, {}, secondCookie);
    assert.equal(stolenRead.status, 200);
    assert.equal(stolenRead.body.changed, false);

    // Kia marks her own notification read
    const beforeUnread = kiaNotifs.body.unread;
    const ownRead = await api(`/api/notifications/${unreadNotif.id}/read`, {}, kiaCookie);
    assert.equal(ownRead.status, 200);
    assert.equal(ownRead.body.changed, true);
    assert.equal(ownRead.body.unread, beforeUnread - 1);

    // 5. Enriched coach overview, filtered members, and CSV exports
    const overview = await api('/coach/api/overview', null, coachCookie);
    assert.equal(overview.status, 200);
    assert.ok(overview.body.careAlerts.some((a) => a.id === kiaId && a.needs_absence_followup));

    const boxers = await api('/coach/api/members?discipline=' + encodeURIComponent('بوکس'), null, coachCookie);
    assert.equal(boxers.status, 200);
    assert.ok(boxers.body.members.some((m) => m.username === 'secondstudent'));
    assert.ok(!boxers.body.members.some((m) => m.username === 'kia' && m.discipline !== 'بوکس'));

    async function fetchCsv(route, cookie) {
      const res = await fetch(base + route, { headers: { cookie } });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, buf, text: buf.toString('utf8') };
    }

    const memCsv = await fetchCsv('/coach/api/export/members', coachCookie);
    assert.equal(memCsv.status, 200);
    assert.deepEqual([...memCsv.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(memCsv.text, /غیبت متوالی/);

    const tuiCsv = await fetchCsv('/coach/api/export/tuition', coachCookie);
    assert.equal(tuiCsv.status, 200);
    assert.deepEqual([...tuiCsv.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(tuiCsv.text, /TRK-998877/);

    const progFullCsv = await fetchCsv('/coach/api/export/progress?detail=full', coachCookie);
    assert.equal(progFullCsv.status, 200);
    assert.deepEqual([...progFullCsv.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(progFullCsv.text, /استقامت/);

    // 6. Static assets & PWA manifests
    for (const staticPath of ['/panel-extras.js', '/coach/care.js', '/sw.js', '/coach/sw.js']) {
      assert.equal((await fetch(base + staticPath)).status, 200, staticPath);
    }
    const mManifest = await api('/manifest.json');
    assert.equal(mManifest.body.theme_color, '#6d28d9');
    const cManifest = await api('/coach/manifest.json');
    assert.equal(cManifest.body.theme_color, '#6d28d9');

    // 7. CardSwap/CardStack valid JPEG assets, bank card LTR isolation, no stk-chips, strict mobile fan bounds, and payment CTA
    const cardImages = [
      'card-karate.jpg',
      'card-karate-kids.jpg',
      'card-crossfit-kids.jpg',
      'card-crossfit.jpg',
      'card-boxing.jpg',
      'card-muaythai.jpg',
      'card-gym.jpg'
    ];
    for (const img of cardImages) {
      const imgRes = await fetch(base + '/images/' + img);
      assert.equal(imgRes.status, 200, img);
      assert.match(imgRes.headers.get('content-type') || '', /image\/jpeg/);
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], img + ' must be valid JPEG');
    }
    const paymentRes = await api('/api/payment');
    assert.equal(paymentRes.status, 200);
    assert.ok(paymentRes.body.pricing.length >= 7);
    assert.ok(paymentRes.body.pricing.some((p) => p.discipline.includes('موی تای')));
    assert.ok(paymentRes.body.pricing.every((p) => p.price.includes('میلیون') && Number(p.priceNum) >= 1500));

    const faqRes = await api('/api/faq');
    assert.equal(faqRes.status, 200);
    assert.ok(!JSON.stringify(faqRes.body).includes('۱۲ هر ماه') && !JSON.stringify(faqRes.body).includes('دوازدهم'));

    const homeHtml = await (await fetch(base + '/')).text();
    assert.ok(!homeHtml.includes('d.pricing.slice(0, 6)'), 'index.html must not truncate disciplines');
    assert.match(homeHtml, /class="number"\s+dir="ltr"/);
    assert.match(homeHtml, /id="openPaymentBtn"/);
    assert.match(homeHtml, /https:\/\/ble\.ir\/\+989016399804/);
    assert.match(homeHtml, /\/panel\?view=payment/);
    assert.ok(!homeHtml.includes('۱۲ هر ماه') && !homeHtml.includes('مهلت پرداخت'));
    assert.ok(!homeHtml.includes('تمرینت رو دنبال کن'));
    assert.ok(!homeHtml.includes('چرا ارسلان دوجو؟'));
    assert.ok(!homeHtml.includes('همه در یک پنل'));
    assert.ok(!homeHtml.includes('ساعت کاری') && !homeHtml.includes('ساعات کاری'));

    const panelJs = await (await fetch(base + '/panel.js')).text();
    assert.match(panelJs, /new URLSearchParams\(location\.search\)\.get\('view'\)/);
    assert.ok(!panelJs.includes('۱۲ هر ماه'));

    const cardStackJs = await (await fetch(base + '/CardStack.js')).text();
    assert.ok(!cardStackJs.includes('Math.min(cards.length, 6)'), 'CardStack must not truncate at 6 cards');
    assert.ok(!cardStackJs.includes('stk-chip'), 'CardStack must not render bottom stk-chip buttons');
    assert.ok(!cardStackJs.includes('هزار تومان / ماه'), 'CardStack must not display هزار تومان unit');
    assert.match(cardStackJs, /stk-cs-bg/);
    assert.match(cardStackJs, /card-karate-kids\.jpg/);
    assert.match(cardStackJs, /card-crossfit-kids\.jpg/);

    // Execute CardStack._computeFanMetrics across mobile & tablet widths to prove zero horizontal overflow
    const vm = require('node:vm');
    const sandbox = { window: {} };
    vm.runInNewContext(cardStackJs, sandbox);
    const computeFanMetrics = sandbox.window.CardStack && sandbox.window.CardStack._computeFanMetrics;
    assert.equal(typeof computeFanMetrics, 'function');
    for (const width of [280, 320, 360, 390, 480, 768]) {
      const n = 7;
      const m = computeFanMetrics(width, n);
      const outerRad = (m.fanAngle * ((n - 1) / 2) * Math.PI) / 180;
      const pivotReachY = Math.max(m.cardH / 2, m.pivotY);
      const rotatedHalfW = ((m.cardW / 2) * Math.cos(outerRad) + pivotReachY * Math.sin(outerRad)) * m.activeScale;
      const minLeftEdge = m.centerX - m.maxSpreadHalf - rotatedHalfW;
      const maxRightEdge = m.centerX + m.maxSpreadHalf + rotatedHalfW;
      assert.ok(minLeftEdge >= 0, `width=${width} left overflow: ${minLeftEdge}`);
      assert.ok(maxRightEdge <= m.containerW + 0.01, `width=${width} right overflow: ${maxRightEdge} > ${m.containerW}`);
    }

    const uiCss = await (await fetch(base + '/ui/style.css')).text();
    assert.ok(!uiCss.includes('.stk-chip'), 'style.css must not keep .stk-chip styles');
    assert.match(uiCss, /\.bank-back \.number[\s\S]*?direction:\s*ltr/);
    assert.match(uiCss, /\.bank-back \.number[\s\S]*?white-space:\s*nowrap/);
    assert.match(uiCss, /\.payment-cta-btn/);

    console.log('PASS: tuition receipts, attendance streaks, targeted notifications, coach reminders, filters, CSV exports, PWA manifests, 7 card artworks, mobile CardStack bounds & payment CTA');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
