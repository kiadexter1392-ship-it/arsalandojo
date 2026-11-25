'use strict';
/*
 * سایت شماره ۲ — پنل شاگردان «باشگاه آنلاین ارسلان دوجو»
 * پورت داخلی پیش‌فرض: ۴۱۷۳؛ ورودی عمومی شاگردان: ۸۰۸۰
 */

const path = require('node:path');
const fs = require('node:fs');
const { readPorts } = require('../shared/ports');
const { createServer, rateLimit, sanitize } = require('../shared/server');
const db = require('../shared/db');
const authSession = require('../shared/auth-session');
const { seedIfEmpty, DEMO } = require('../shared/seed');
const { JALALI_MONTHS, todayJalali, formatJalali, faNum, enNum } = require('../shared/jalali');

const { member: PORT, coach: COACH_PORT } = readPorts();
const SITE = 'member';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_PUBLIC = path.join(__dirname, '..', 'shared', 'public');

seedIfEmpty();

const app = createServer({
  name: 'members-site',
  cookieName: 'arslan_member_session',
  publicDirs: [PUBLIC_DIR, SHARED_PUBLIC]
});

/* -------------------------------- ابزارها -------------------------------- */

function member(ctx) {
  return authSession.restore(ctx, app.cookieName, SITE, u => u.role === 'member');
}

function needMember(ctx) {
  const u = member(ctx);
  if (!u) {
    ctx.json({ ok: false, error: 'ابتدا وارد پنل کاربری شوید' }, 401);
    return null;
  }
  return u;
}

function bad(ctx, msg, status = 400) {
  ctx.json({ ok: false, error: msg }, status);
  return null;
}

require('../shared/member-wellness').mount(app, needMember);

/* ------------------------------ صفحه‌های HTML ----------------------------- */

function serveMemberHtml(ctx, filename) {
  const file = path.join(PUBLIC_DIR, filename);
  if (ctx.req.headers['x-dojo-mount'] !== '/member') return ctx.file(file);
  // Root-absolute asset URLs need the mount too; API calls use UI.PATH_PREFIX.
  const html = fs.readFileSync(file, 'utf8').replace(/\b(src|href|action)="\/(?!\/)/g, '$1="/member/');
  ctx.text(html, 200, 'text/html; charset=utf-8');
}

app.get('/manifest.json', (ctx) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8'));
  if (ctx.req.headers['x-dojo-mount'] === '/member') {
    manifest.start_url = manifest.scope = '/member/';
    manifest.icons.forEach(icon => { icon.src = '/member' + icon.src; });
  }
  ctx.json(manifest);
});

app.get('/', (ctx) => {
  if (member(ctx)) return ctx.redirect('/panel');
  serveMemberHtml(ctx, 'index.html');
});

app.get('/panel', (ctx) => {
  if (!member(ctx)) return ctx.redirect('/');
  serveMemberHtml(ctx, 'panel.html');
});

/* ورود مربی به پنل یک شاگرد (از سایت اول) */
app.get('/impersonate', (ctx) => {
  const token = ctx.query.token;
  const row = token ? db.get('SELECT * FROM impersonations WHERE token = ?', token) : null;
  if (!row || row.used_at) return ctx.redirect('/?error=bad-token');
  if (Date.now() - new Date(row.created_at).getTime() > 5 * 60 * 1000) return ctx.redirect('/?error=expired');
  const u = db.findById(row.user_id);
  if (!u) return ctx.redirect('/?error=bad-token');
  db.run('UPDATE impersonations SET used_at = ? WHERE token = ?', db.now(), token);
  const { token: sessionToken } = db.createSession(u.id, SITE, 1);
  db.run('UPDATE sessions SET impersonated=1 WHERE token=?', sessionToken);
  ctx.setCookie(sessionToken, { maxAgeSeconds: 86400 }); /* 1 day for coach impersonation */
  ctx.redirect('/panel');
});

app.get('/api/config', (ctx) => {
  const j = todayJalali();
  ctx.json({
    ok: true,
    features: { academy: 'v1', independentAdmin: true, sampleData: false },
    release: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
    site: 'member',
    club: 'باشگاه آنلاین ارسلان دوجو',
    jalaliYear: j.jy,
    jalaliMonth: j.jm,
    coachPort: COACH_PORT,
    peerSiteUrl: ctx.req.headers['x-dojo-proxy'] === '1'
      ? (ctx.req.headers['x-dojo-mount'] === '/member' ? '/' : '/coach/') : null,
    months: JALALI_MONTHS,
    belts: ['سفید', 'زرد', 'نارنجی', 'سبز', 'آبی', 'قهوه‌ای', 'مشکی دان ۱', 'مشکی دان ۲'],
    disciplines: ['کاراته', 'کراسفیت', 'بوکس', 'ژیمناستیک', 'موی تای'],
    supportPhone: '+989016399804',
    baleLink: 'https://ble.ir/+989016399804',
    googleClientId: PUBLIC_GOOGLE_CLIENT_ID
  });
});

/* --------------------------- اطلاعات پرداخت و شهریه --------------------------- */

app.get('/api/payment', (ctx) => {
  ctx.json({
    ok: true,
    cards: [
      { number: '6219861938986279', holder: 'نوید احمدی', label: 'شماره کارت شهریه آقایان' },
      { number: '6219861903417334', holder: 'خانم توکلی شانجانی', label: 'شماره کارت شهریه بانوان' }
    ],
    pricing: [
      { discipline: 'کاراته جوانان و بزرگسالان', price: 'یک میلیون و نهصد هزار تومان', priceNum: 1900 },
      { discipline: 'کاراته نونهالان', price: 'یک میلیون و هشتصد هزار تومان', priceNum: 1800 },
      { discipline: 'کراسفیت کودک', price: 'یک میلیون و هشتصد هزار تومان', priceNum: 1800 },
      { discipline: 'کراسفیت بزرگسالان و نوجوانان', price: 'یک میلیون و هشتصد هزار تومان', priceNum: 1800 },
      { discipline: 'بوکس', price: 'یک میلیون و هشتصد هزار تومان', priceNum: 1800 },
      { discipline: 'ژیمناستیک', price: 'یک میلیون و پانصد هزار تومان', priceNum: 1500 },
      { discipline: 'موی تای بانوان', price: 'یک میلیون و پانصد هزار تومان', priceNum: 1500 }
    ],
    supportPhone: '+989016399804',
    baleLink: 'https://ble.ir/+989016399804'
  });
});

/* --------------------------- سوالات متداول --------------------------- */

app.get('/api/faq', (ctx) => {
  ctx.json({
    ok: true,
    faqs: [
      {
        q: 'شهریه ماهانه چقدر است؟',
        a: 'کاراته جوانان و بزرگسالان: یک میلیون و نهصد هزار تومان · کاراته نونهالان، کراسفیت کودک، کراسفیت بزرگسالان و نوجوانان و بوکس: یک میلیون و هشتصد هزار تومان · ژیمناستیک و موی تای بانوان: یک میلیون و پانصد هزار تومان.'
      },
      {
        q: 'چطور می‌توانم شهریه را پرداخت کنم؟',
        a: 'مبلغ شهریه را به شماره کارت ۶۲۱۹-۸۶۱۹-۳۸۹۸-۶۲۷۹ به نام نوید احمدی (آقایان) یا ۶۲۱۹-۸۶۱۹-۰۳۴۱-۷۳۳۴ به نام خانم توکلی شانجانی (بانوان) واریز کنید و رسید آن را از پنل کاربری ثبت کرده یا در پیام‌رسان بله به +989016399804 بفرستید.'
      },
      {
        q: 'ساعت کلاس‌های باشگاه چگونه است؟',
        a: 'روزها و ساعات فقط از برنامهٔ ثبت‌شده توسط مربی در بخش کلاس‌های آکادمی مشخص می‌شود. اگر برنامه‌ای ثبت نشده باشد، با باشگاه تماس بگیرید.'
      },
      {
        q: 'آیا امکان شرکت در جلسه آزمایشی وجود دارد؟',
        a: 'هماهنگی جلسه آزمایشی فقط با تأیید مدیر باشگاه انجام می‌شود.'
      },
      {
        q: 'آیا امکان تغییر رشته وجود دارد؟',
        a: 'بله، شما می‌توانید با هماهنگی مربی و اطلاع به بخش پشتیبانی، رشته ورزشی خود را تغییر دهید. برای این کار از طریق پیام‌رسان بله با ما در ارتباط باشید.'
      },
      {
        q: 'چگونه جدول پیشرفت من پر می‌شود؟',
        a: 'جدول پیشرفت ماهانه توسط مربی و بر اساس عملکرد شما در تمرینات پر می‌شود. شاخص‌هایی مانند استقامت، قدرت، تکنیک، انعطاف و انضباط هر ماه ارزیابی و نمره‌دهی می‌شوند. شما همچنین می‌توانید خودارزیابی ماهانه ثبت کنید.'
      },
      {
        q: 'اگر تمرین را نتوانم به‌موقع انجام دهم چه کنم؟',
        a: 'در صورت عدم امکان انجام تمرین در مهلت مقرر، می‌توانید از طریق یادداشت در پنل کاربری یا تماس با مربی از طریق بله، موضوع را اطلاع دهید. مربی می‌تواند مهلت را تمدید یا برنامه جایگزین ارائه دهد.'
      }
    ]
  });
});

/* --------------------------- ثبت‌نام و ورود --------------------------- */

const DEFAULT_GOOGLE_CLIENT_ID = '5918828036-9eq5ut53ujmrub4i1t7039gep5s9a6vi.apps.googleusercontent.com';
const PUBLIC_GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim() || DEFAULT_GOOGLE_CLIENT_ID;
const ALLOWED_GOOGLE_CLIENT_IDS = new Set(
  String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

async function verifyGoogleIdToken(idToken) {
  const token = String(idToken || '').trim();
  if (!token || token.length > 4096) {
    throw Object.assign(new Error('توکن گوگل معتبر نیست'), { status: 400 });
  }
  const baseUrl = String(process.env.ARSLAN_GOOGLE_VERIFY_URL || 'https://oauth2.googleapis.com/tokeninfo').trim();
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}id_token=${encodeURIComponent(token)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    throw Object.assign(new Error('امکان تایید حساب گوگل در سرور وجود ندارد؛ اتصال اینترنت را بررسی کنید'), { status: 502 });
  }
  let info = {};
  try { info = await res.json(); } catch { info = {}; }
  if (!res.ok || !info || info.error) {
    throw Object.assign(new Error('توکن گوگل نامعتبر یا منقضی شده است'), { status: 401 });
  }
  const aud = String(info.aud || '').trim();
  if (!ALLOWED_GOOGLE_CLIENT_IDS.has(aud)) {
    throw Object.assign(new Error('توکن گوگل متعلق به این برنامه نیست'), { status: 401 });
  }
  const verified = info.email_verified === true || info.email_verified === 'true';
  const email = String(info.email || '').trim().toLowerCase();
  if (!verified || !email) {
    throw Object.assign(new Error('جیمیل حساب گوگل تایید نشده است'), { status: 401 });
  }
  if (info.exp && Number(info.exp) * 1000 < Date.now() - 60000) {
    throw Object.assign(new Error('اعتبار ورود گوگل منقضی شده است؛ لطفاً دوباره تلاش کنید'), { status: 401 });
  }
  return {
    email,
    name: sanitize(String(info.name || '')).slice(0, 120)
  };
}

function doRegister(ctx, b) {
  const full_name = sanitize(String(b.full_name || ''));
  const username = String(b.username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
  const password = String(b.password || '');

  if (full_name.length < 3) return 'نام و نام خانوادگی را کامل وارد کنید';
  if (!/^[a-zA-Z0-9._-]{3,20}$/.test(username)) return 'نام کاربری باید انگلیسی، بدون فاصله و حداقل ۳ حرف باشد';
  if (db.findByUsername(username)) return 'این نام کاربری قبلاً ثبت شده است';
  let email = null;
  if (b.email !== undefined && b.email !== null && String(b.email).trim() !== '') {
    try {
      email = db.normalizeEmail(b.email);
    } catch (err) {
      return err.message || 'آدرس جیمیل معتبر نیست';
    }
    if (email && db.findByEmail(email)) return 'این جیمیل قبلاً ثبت شده است';
  }
  if (password.length < 6) return 'رمز عبور باید حداقل ۶ حرف باشد';
  if (b.phone && !/^[0-9+\-\s]{7,15}$/.test(String(b.phone))) return 'شماره موبایل معتبر نیست';
  if (password !== b.password2) return 'تکرار رمز عبور مطابقت ندارد';

  const user = db.createUser({
    full_name,
    username,
    email,
    password,
    phone: b.phone || null,
    gender: b.gender || null,
    birth_date: b.birth_date || null,
    blood_group: b.blood_group || null,
    age: b.age,
    weight_kg: b.weight_kg,
    height_cm: b.height_cm,
    belt: b.belt || 'سفید',
    discipline: b.discipline || b.style || null,
    style: b.discipline || b.style || null,
    experience: b.experience || null,
    join_date: new Date().toISOString().slice(0, 10)
  }, 'member');

  authSession.signIn(ctx, user.id, SITE, app.cookieName);

  db.pushNotification(user.id, {
    type: 'welcome',
    title: 'حساب شما ساخته شد',
    body: 'برنامه‌های تمرینی مربی و اطلاعیه‌های باشگاه در همین پنل ثبت می‌شود.'
  });
  for (const coach of db.all("SELECT id, full_name FROM users WHERE role = 'coach' AND active = 1")) {
    db.pushNotification(coach.id, {
      type: 'new_member',
      title: 'ثبت‌نام شاگرد جدید',
      body: `${full_name} (@${username}) در سایت ثبت‌نام کرد.`
    });
    db.logActivity(coach.id, coach.full_name, 'ثبت‌نام جدید دریافت شد', `${full_name} (@${username})`);
  }
  for (const plan of db.all('SELECT * FROM plans WHERE verified=1 AND target_all = 1')) {
    db.run('INSERT OR IGNORE INTO plan_assignments (plan_id, user_id, status, assigned_at) VALUES (?,?,?,?)',
      plan.id, user.id, 'todo', db.now());
  }
  return null;
}

app.post('/api/register', (ctx) => {
  const b = ctx.body || {};
  const err = doRegister(ctx, b);
  if (err) return bad(ctx, err);
  ctx.json({ ok: true, user: db.publicUser(db.findByUsername(String(b.username || '').trim().toLowerCase())) });
});

/* ثبت‌نام مستقیم (فرم HTML → ریدایرکت) — مرورگر خودش کوکی رو مدیریت می‌کنه */
app.post('/register', (ctx) => {
  const ip = ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '';
  if (!rateLimit('reg:' + ip, 5, 600000)) {
    ctx.redirect('/?error=' + encodeURIComponent('تعداد ثبت‌نام بیش از حد — لطفاً ۱۰ دقیقه صبر کنید'));
    return;
  }
  const b = ctx.body || {};
  const err = doRegister(ctx, b);
  if (err) {
    ctx.redirect('/?error=' + encodeURIComponent(err));
    return;
  }
  ctx.redirect('/panel');
});

app.post('/login', (ctx) => {
  const ip = ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '';
  if (!rateLimit('login:' + ip, 10, 300000)) {
    ctx.redirect('/?error=' + encodeURIComponent('تعداد تلاش بیش از حد — لطفاً ۵ دقیقه صبر کنید'));
    return;
  }
  const b = ctx.body || {};
  const u = db.findByUsername(b.username);
  if (!u || u.role !== 'member' || !db.verifyPassword(b.password, u.password_hash, u.password_salt)) {
    ctx.redirect('/?error=' + encodeURIComponent('نام کاربری یا رمز عبور اشتباه است'));
    return;
  }
  if (!u.active) {
    ctx.redirect('/?error=' + encodeURIComponent('حساب شما غیرفعال است'));
    return;
  }
  authSession.signIn(ctx, u.id, SITE, app.cookieName);
  db.logActivity(u.id, u.full_name, 'وارد پنل کاربری شد', null);
  ctx.redirect('/panel');
});

app.post('/api/login', (ctx) => {
  const { username, password } = ctx.body || {};
  const u = db.findByUsername(username);
  if (!u || u.role !== 'member' || !db.verifyPassword(password, u.password_hash, u.password_salt)) {
    return bad(ctx, 'نام کاربری یا رمز عبور اشتباه است', 401);
  }
  if (!u.active) return bad(ctx, 'حساب کاربری شما غیرفعال است؛ با مربی تماس بگیرید', 403);
  authSession.signIn(ctx, u.id, SITE, app.cookieName);
  db.logActivity(u.id, u.full_name, 'وارد پنل کاربری شد', null);
  ctx.json({ ok: true, user: db.publicUser(u) });
});

app.post('/api/auth/google', async (ctx) => {
  const ip = ctx.req.headers['x-forwarded-for'] || ctx.req.socket.remoteAddress || '';
  if (!rateLimit('google-auth:' + ip, 30, 300000)) {
    return bad(ctx, 'تعداد تلاش بیش از حد — لطفاً چند دقیقه صبر کنید', 429);
  }
  const { idToken } = ctx.body || {};
  const verified = await verifyGoogleIdToken(idToken);
  const u = db.findByEmail(verified.email);
  if (!u) {
    return ctx.json({
      ok: true,
      registered: false,
      email: verified.email,
      name: verified.name
    });
  }
  if (u.role !== 'member') {
    return bad(ctx, 'این جیمیل به پنل مربی یا مدیریت متصل است؛ لطفاً با نام کاربری وارد شوید', 403);
  }
  if (!u.active) {
    return bad(ctx, 'حساب کاربری شما غیرفعال است؛ با مربی تماس بگیرید', 403);
  }
  authSession.signIn(ctx, u.id, SITE, app.cookieName);
  db.logActivity(u.id, u.full_name, 'با گوگل وارد پنل کاربری شد', verified.email);
  ctx.json({
    ok: true,
    registered: true,
    redirect: '/panel',
    user: db.publicUser(u)
  });
});

app.post('/api/logout', (ctx) => {
  authSession.signOut(ctx, app.cookieName, SITE);
  ctx.json({ ok: true });
});

app.get('/api/me', (ctx) => {
  const u = member(ctx);
  if (!u) return ctx.json({ ok: false, user: null });
  const j = todayJalali();
  ctx.json({
    ok: true,
    user: db.publicUser(u),
    unread: db.unreadCount(u.id),
    unreadAnnouncements: db.announcementsFor(u.id).filter((a) => !a.read).length,
    pending: db.get('SELECT COUNT(*) AS c FROM plan_assignments WHERE verified=1 AND plan_id IN (SELECT id FROM plans WHERE verified=1) AND user_id = ? AND status != ?', u.id, 'done').c,
    today: formatJalali(new Date()),
    jalali: { year: j.jy, month: j.jm, day: j.jd, monthName: JALALI_MONTHS[j.jm - 1] },
    care: db.memberCareStatus(u.id, j.jy, j.jm, j.jd)
  });
});

app.put('/api/me', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const b = ctx.body || {};
  if (b.phone && !/^[0-9+\-\s]{7,15}$/.test(String(b.phone))) return bad(ctx, 'شماره موبایل معتبر نیست');
  const updated = db.updateUser(u.id, {
    full_name: b.full_name,
    email: b.email,
    phone: b.phone,
    gender: b.gender,
    birth_date: b.birth_date,
    blood_group: b.blood_group,
    age: b.age,
    weight_kg: b.weight_kg,
    height_cm: b.height_cm,
    belt: b.belt,
    style: b.style,
    experience: b.experience
  });
  ctx.json({ ok: true, user: db.publicUser(updated) });
});

app.get('/api/me/insurance', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const ins = db.getUserInsurance(u.id);
  ctx.json({ ok: true, ...(ins || { has_insurance: false, file_data: null, file_name: null, updated_at: null }) });
});

function saveInsuranceHandler(ctx) {
  const u = needMember(ctx);
  if (!u) return;
  if (u.impersonated) return bad(ctx, 'برای تغییر فایل بیمه ورزشی باید مستقیماً وارد حساب خود شوید', 403);
  const b = ctx.body || {};
  const fileData = String(b.file_data || '').trim();
  if (!fileData) return bad(ctx, 'لطفاً یک فایل انتخاب کنید');
  if (fileData.length > 2500000) {
    return bad(ctx, 'حجم فایل بیمه نباید بیشتر از ۱.۸ مگابایت باشد');
  }
  if (!/^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(fileData)) {
    return bad(ctx, 'فرمت فایل مجاز نیست؛ فقط تصویر (PNG، JPG، WEBP) یا PDF مجاز است');
  }
  const fileName = sanitize(String(b.file_name || 'insurance-card').trim()).slice(0, 120) || 'insurance-card';
  const updated = db.setUserInsurance(u.id, { fileData, fileName });
  db.logActivity(u.id, u.full_name, 'فایل بیمه ورزشی ثبت کرد', fileName);
  ctx.json({ ok: true, user: db.publicUser(updated) });
}
app.post('/api/me/insurance', saveInsuranceHandler);
app.put('/api/me/insurance', saveInsuranceHandler);

app.delete('/api/me/insurance', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  if (u.impersonated) return bad(ctx, 'برای حذف فایل بیمه ورزشی باید مستقیماً وارد حساب خود شوید', 403);
  const updated = db.setUserInsurance(u.id, { fileData: null, fileName: null });
  db.logActivity(u.id, u.full_name, 'فایل بیمه ورزشی را حذف کرد', null);
  ctx.json({ ok: true, user: db.publicUser(updated) });
});

app.get('/api/me/photo', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const photo = db.getUserPhoto(u.id);
  if (!photo || !photo.photo_data) return bad(ctx, 'عکس پروفایل ثبت نشده است', 404);
  ctx.image(photo.photo_data);
});

function savePhotoHandler(ctx) {
  const u = needMember(ctx);
  if (!u) return;
  if (u.impersonated) return bad(ctx, 'برای تغییر عکس پروفایل باید مستقیماً وارد حساب خود شوید', 403);
  const b = ctx.body || {};
  const photoData = String(b.photo_data || '').trim();
  if (!photoData) return bad(ctx, 'لطفاً یک تصویر انتخاب کنید');
  if (photoData.length > 1400000) {
    return bad(ctx, 'حجم عکس پروفایل نباید بیشتر از ۱ مگابایت باشد');
  }
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(photoData)) {
    return bad(ctx, 'فرمت تصویر مجاز نیست؛ فقط PNG، JPG یا WEBP مجاز است');
  }
  const updated = db.setUserPhoto(u.id, photoData);
  db.logActivity(u.id, u.full_name, 'عکس پروفایل خود را ذخیره کرد', null);
  ctx.json({ ok: true, user: db.publicUser(updated) });
}
app.post('/api/me/photo', savePhotoHandler);
app.put('/api/me/photo', savePhotoHandler);

app.delete('/api/me/photo', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  if (u.impersonated) return bad(ctx, 'برای حذف عکس پروفایل باید مستقیماً وارد حساب خود شوید', 403);
  const updated = db.setUserPhoto(u.id, null);
  db.logActivity(u.id, u.full_name, 'عکس پروفایل را حذف کرد', null);
  ctx.json({ ok: true, user: db.publicUser(updated) });
});

app.post('/api/password', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const { current, next } = ctx.body || {};
  if (!db.verifyPassword(current, u.password_hash, u.password_salt)) return bad(ctx, 'رمز فعلی درست نیست');
  if (!next || String(next).length < 6) return bad(ctx, 'رمز جدید باید حداقل ۶ حرف باشد');
  db.setPassword(u.id, next);
  authSession.signIn(ctx, u.id, SITE, app.cookieName);
  ctx.json({ ok: true });
});

/* ------------------------------ تمرینات من ------------------------------- */

app.get('/api/plans', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  ctx.json({ ok: true, plans: db.plansForUser(u.id) });
});

app.put('/api/assignments/:id', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const { status, note } = ctx.body || {};
  if (!['todo', 'doing', 'done'].includes(status)) return bad(ctx, 'وضعیت نامعتبر');
  const a = db.setAssignmentStatus(ctx.params.id, u.id, status, note);
  if (!a) return bad(ctx, 'تمرین پیدا نشد', 404);
  ctx.json({ ok: true, assignment: a });
});

/* --------------------------- جدول پیشرفت من ---------------------------- */

app.get('/api/progress', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const year = Number(ctx.query.year) || todayJalali().jy;
  const prog = db.progressYear(u.id, year);
  const reports = db.all('SELECT * FROM self_reports WHERE verified=1 AND user_id = ? AND year = ? ORDER BY month', u.id, year);
  const years = db.all('SELECT DISTINCT year FROM progress WHERE verified=1 AND user_id = ? ORDER BY year DESC', u.id).map((r) => r.year);
  if (!years.includes(year)) years.unshift(year);
  const history = db.all(
    'SELECT year, month, sessions, overall, endurance, strength, technique, flexibility, discipline, weight_kg FROM progress WHERE verified=1 AND user_id = ? ORDER BY year, month',
    u.id
  ).map((r) => ({ ...r, overall: db.computeOverall(r) }));
  ctx.json({ ok: true, year, years, progress: prog.months, selfReports: reports, history });
});

app.post('/api/self-report', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const year = b.year === undefined ? todayJalali().jy : Number(b.year);
  const month = b.month === undefined ? todayJalali().jm : Number(b.month);
  const sessions = b.sessions === '' || b.sessions === null || b.sessions === undefined ? NaN : Number(b.sessions);
  if (!Number.isInteger(year) || year < 1200 || year > 1600 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(sessions) || sessions < 0 || sessions > 31) {
    return bad(ctx, 'سال، ماه و تعداد جلسات معتبر را وارد کنید');
  }
  const row = db.saveSelfReport({
    user_id: u.id, year, month,
    sessions,
    feeling: b.feeling,
    note: b.note
  });
  ctx.json({ ok: true, report: row });
});

/* ------------------------------ اطلاعیه‌ها ------------------------------ */

app.get('/api/announcements', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  ctx.json({ ok: true, announcements: db.announcementsFor(u.id) });
});

app.post('/api/announcements/:id/read', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  db.markAnnouncementRead(ctx.params.id, u.id);
  ctx.json({ ok: true });
});

app.get('/api/notifications', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  ctx.json({ ok: true, notifications: db.notificationsFor(u.id, 40), unread: db.unreadCount(u.id) });
});

app.post('/api/notifications/read', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  db.markNotificationsRead(u.id);
  ctx.json({ ok: true, unread: 0 });
});

app.post('/api/notifications/:id/read', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const changed = db.markNotificationRead(ctx.params.id, u.id);
  ctx.json({ ok: true, changed, unread: db.unreadCount(u.id) });
});

/* -------------------------- فیش پرداخت شهریه -------------------------- */

app.get('/api/tuition/receipts', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  const j = todayJalali();
  ctx.json({
    ok: true,
    receipts: db.listTuitionReceipts({ user_id: u.id, limit: 30 }),
    currentPeriod: { year: j.jy, month: j.jm, day: j.jd, monthName: JALALI_MONTHS[j.jm - 1] },
    care: db.memberCareStatus(u.id, j.jy, j.jm, j.jd)
  });
});

app.post('/api/tuition/receipts', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  if (u.impersonated) return bad(ctx, 'برای ارسال فیش باید مستقیماً وارد حساب خود شوید', 403);
  const b = ctx.body || {};
  const j = todayJalali();
  const year = b.year === undefined || b.year === '' ? j.jy : Number(enNum(b.year));
  const month = b.month === undefined || b.month === '' ? j.jm : Number(enNum(b.month));
  const amountRaw = enNum(String(b.amount_toman || '').replace(/[,\s٬]/g, ''));
  const amount_toman = Number(amountRaw);
  const tracking_code = sanitize(enNum(String(b.tracking_code || '').trim())).slice(0, 64);
  const cardLast4Raw = b.card_last4 ? enNum(String(b.card_last4).trim()) : '';

  if (!Number.isInteger(year) || year < 1300 || year > 1600 || !Number.isInteger(month) || month < 1 || month > 12) {
    return bad(ctx, 'سال و ماه انتخابی معتبر نیست');
  }
  if (!Number.isInteger(amount_toman) || amount_toman < 1000 || amount_toman > 500000000) {
    return bad(ctx, 'مبلغ واریزی را به تومان و به شکل صحیح وارد کنید');
  }
  if (tracking_code.length < 3) {
    return bad(ctx, 'شماره پیگیری یا مرجع واریز باید حداقل ۳ کاراکتر باشد');
  }
  if (cardLast4Raw && !/^\d{4}$/.test(cardLast4Raw)) {
    return bad(ctx, '۴ رقم آخر کارت مبدأ باید دقیقاً ۴ عدد باشد');
  }

  let receipt_image = null;
  if (b.receipt_image !== undefined && b.receipt_image !== null && String(b.receipt_image).trim() !== '') {
    const img = String(b.receipt_image).trim();
    if (img.length > 1800000) {
      return bad(ctx, 'حجم تصویر فیش نباید بیشتر از ۱.۲ مگابایت باشد');
    }
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) {
      return bad(ctx, 'فرمت تصویر فیش مجاز نیست؛ فقط PNG، JPG یا WEBP مجاز است');
    }
    receipt_image = img;
  }

  const note = b.note ? sanitize(String(b.note).trim()).slice(0, 500) : null;
  const receipt = db.createTuitionReceipt({
    user_id: u.id,
    year,
    month,
    amount_toman,
    card_last4: cardLast4Raw || null,
    tracking_code,
    receipt_image,
    note
  });

  const amountFa = faNum(amount_toman.toLocaleString('en-US'));
  for (const coach of db.all("SELECT id FROM users WHERE role = 'coach' AND active = 1")) {
    db.pushNotification(coach.id, {
      type: 'tuition',
      title: `فیش شهریه جدید از ${u.full_name}`,
      body: `${JALALI_MONTHS[month - 1]} ${faNum(year)} — ${amountFa} تومان (پیگیری: ${tracking_code})`
    });
  }
  db.logActivity(u.id, u.full_name, 'فیش شهریه ثبت کرد', `${JALALI_MONTHS[month - 1]} ${year}`);
  ctx.json({ ok: true, receipt }, 201);
});

app.get('/api/club', (ctx) => {
  const u = needMember(ctx);
  if (!u) return;
  // نمای سالانه باشگاه (فقط نمره کل؛ برای انگیزه و مقایسه سالم)
  const year = Number(ctx.query.year) || todayJalali().jy;
  const rows = db.clubMatrix(year).map((r) => ({
    name: r.member.full_name,
    belt: r.member.belt,
    color: r.member.avatar_color,
    avg: r.avg,
    last: r.last_overall,
    me: r.member.id === u.id
  }));
  ctx.json({ ok: true, year, rows });
});

require('../shared/academy').mount(app, { role: 'member', user: member });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`سایت شاگردان: http://localhost:${PORT}`);
  console.log(`دیتابیس: ${db.DB_PATH}`);
});
