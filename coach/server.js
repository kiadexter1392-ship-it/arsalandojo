'use strict';
/*
 * سایت شماره ۱ — پنل مربی «باشگاه آنلاین ارسلان دوجو»
 * پورت پیش‌فرض: ۴۱۷۴
 */

const path = require('node:path');
const { readPorts } = require('../shared/ports');
const { proxy } = require('../shared/proxy');
const { createServer, rateLimit, sanitize, getClientIp, parseId } = require('../shared/server');
const db = require('../shared/db');
const authSession = require('../shared/auth-session');
const { seedIfEmpty } = require('../shared/seed');
const { JALALI_MONTHS, todayJalali, formatJalali, faNum } = require('../shared/jalali');

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function csvRow(cells) {
  return cells.map((c) => {
    let s = String(c === null || c === undefined ? '' : c);
    if (/^[\s\uFEFF]*[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  }).join(',');
}

const { coach: PORT, member: MEMBER_PORT } = readPorts();
const SITE = 'coach';
const memberUrl = (process.env.MEMBERS_SITE_URL || '').trim();
const MEMBERS_SITE_URL = ['', 'null', 'undefined'].includes(memberUrl) ? null : memberUrl;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_PUBLIC = path.join(__dirname, '..', 'shared', 'public');

seedIfEmpty();

const app = createServer({
  name: 'coach-site',
  cookieName: 'arslan_coach_session',
  publicDirs: [PUBLIC_DIR, SHARED_PUBLIC],
  onRequest(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return false; }
    if (url.pathname === '/member') {
      res.writeHead(302, { Location: '/member/' + url.search });
      res.end();
      return true;
    }
    if (url.pathname.startsWith('/member/')) {
      req.url = req.url.slice('/member'.length);
      proxy(MEMBER_PORT, { prefix: '/member' })(req, res);
      return true;
    }
    // Keep previously saved /coach links working on the dedicated coach domain.
    if (url.pathname === '/coach' || url.pathname.startsWith('/coach/')) {
      res.writeHead(307, { Location: (url.pathname.slice('/coach'.length) || '/') + url.search });
      res.end();
      return true;
    }
    return false;
  }
});

/* -------------------------------- ابزارها -------------------------------- */

function coach(ctx) {
  return authSession.restore(ctx, app.cookieName, SITE, u => u.role === 'coach' && !db.get('SELECT user_id FROM academy_admins WHERE user_id=?',u.id));
}

function needCoach(ctx) {
  const u = coach(ctx);
  if (!u) {
    ctx.json({ ok: false, error: 'ابتدا وارد پنل مربی شوید' }, 401);
    return null;
  }
  return u;
}

function bad(ctx, msg, status = 400) {
  ctx.json({ ok: false, error: msg }, status);
  return null;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('مقدار عددی معتبر نیست'),{status:400});
  return n;
}

function clampScore(v) {
  const n = numOrNull(v);
  if (n === null) return null;
  if (n<0 || n>100) throw Object.assign(new Error('نمره باید بین صفر و صد باشد'),{status:400});
  return n;
}

/* ------------------------------ صفحه‌های HTML ----------------------------- */

app.get('/', (ctx) => {
  if (coach(ctx)) return ctx.redirect('/dashboard');
  ctx.file(path.join(PUBLIC_DIR, 'index.html'));
});

// Old bookmarks from the former student site must not strand users after the port swap.
app.get('/panel', (ctx) => ctx.redirect('/dashboard'));

app.get('/dashboard', (ctx) => {
  if (!coach(ctx)) return ctx.redirect('/');
  ctx.file(path.join(PUBLIC_DIR, 'dashboard.html'));
});

app.get('/healthz', (ctx) => {
  try {
    db.get('SELECT 1 AS ok');
    const stats = db.storage.storageStats();
    ctx.json({ ok: true, status: 'healthy', site: SITE, storageSeparate: true, storedFiles: stats.files });
  } catch {
    ctx.json({ ok: false, status: 'unhealthy', site: SITE }, 503);
  }
});

app.get('/health', (ctx) => {
  try {
    db.get('SELECT 1 AS ok');
    const stats = db.storage.storageStats();
    ctx.json({ ok: true, status: 'healthy', site: SITE, storageSeparate: true, storedFiles: stats.files });
  } catch {
    ctx.json({ ok: false, status: 'unhealthy', site: SITE }, 503);
  }
});

/* -------------------------------- پیکربندی -------------------------------- */

app.get('/api/config', (ctx) => {
  const j = todayJalali();
  const hasGemini = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
  ctx.json({
    ok: true,
    features: { academy: 'v1', independentAdmin: true, sampleData: false, isolatedStorage: true },
    release: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
    site: 'coach',
    club: 'باشگاه آنلاین ارسلان دوجو',
    jalaliYear: j.jy,
    jalaliMonth: j.jm,
    memberPort: MEMBER_PORT,
    peerSiteUrl: ctx.req.headers['x-dojo-proxy'] === '1' ? '/' : '/member/',
    membersSiteUrl: MEMBERS_SITE_URL,
    months: JALALI_MONTHS,
    belts: ['سفید', 'زرد', 'نارنجی', 'سبز', 'آبی', 'قهوه‌ای', 'مشکی دان ۱', 'مشکی دان ۲', 'مشکی دان ۳', 'مشکی دان ۴'],
    disciplines: ['کاراته', 'کراسفیت', 'بوکس', 'ژیمناستیک', 'موی تای'],
    supportPhone: '+989016399804',
    baleLink: 'https://ble.ir/+989016399804',
    geminiConfigured: hasGemini,
    geminiStatus: hasGemini ? 'پیکربندی شده' : 'تنظیم نشده'
  });
});

/* ------------------------------ ورود و خروج ------------------------------ */

app.post('/api/login', (ctx) => {
  const ip = getClientIp(ctx.req);
  if (!rateLimit('coach-login:' + ip, 10, 300000)) {
    return bad(ctx, 'تعداد تلاش بیش از حد — لطفاً ۵ دقیقه صبر کنید', 429);
  }
  const { username, password } = ctx.body || {};
  const user = db.findByUsername(username);
  if (!user || user.role !== 'coach' || db.get('SELECT user_id FROM academy_admins WHERE user_id=?', user.id) || !db.verifyPassword(password, user.password_hash, user.password_salt)) {
    return bad(ctx, 'نام کاربری یا رمز عبور اشتباه است', 401);
  }
  if (!user.active) return bad(ctx, 'این حساب غیرفعال شده است', 403);
  authSession.signIn(ctx, user.id, SITE, app.cookieName);
  db.logActivity(user.id, user.full_name, 'وارد پنل مربی شد', null);
  ctx.json({ ok: true, user: db.publicUser(user) });
});

app.post('/login', (ctx) => {
  const ip = getClientIp(ctx.req);
  if (!rateLimit('coach-login:' + ip, 10, 300000)) {
    ctx.redirect('/?error=' + encodeURIComponent('تعداد تلاش بیش از حد — لطفاً ۵ دقیقه صبر کنید'));
    return;
  }
  const b = ctx.body || {};
  const user = db.findByUsername(b.username);
  if (!user || user.role !== 'coach' || db.get('SELECT user_id FROM academy_admins WHERE user_id=?', user.id) || !db.verifyPassword(b.password, user.password_hash, user.password_salt)) {
    ctx.redirect('/?error=' + encodeURIComponent('نام کاربری یا رمز عبور اشتباه است'));
    return;
  }
  if (!user.active) {
    ctx.redirect('/?error=' + encodeURIComponent('این حساب غیرفعال شده است'));
    return;
  }
  authSession.signIn(ctx, user.id, SITE, app.cookieName);
  db.logActivity(user.id, user.full_name, 'وارد پنل مربی شد', null);
  ctx.redirect('/dashboard');
});

app.post('/api/logout', (ctx) => {
  authSession.signOut(ctx, app.cookieName, SITE);
  ctx.json({ ok: true });
});

/* --------------------------- API Key Management --------------------------- */

/* middleware: احراز هویت با API key یا session */
function coachOrApiKey(ctx) {
  /* اول session */
  const u = coach(ctx);
  if (u) return u;
  /* بعد API key */
  const authHeader = ctx.req.headers['authorization'] || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ctx.req.headers['x-api-key'];
  if (apiKey) {
    const keyUser = db.apiKeyUser(apiKey);
    if (keyUser && keyUser.role === 'coach') return keyUser;
  }
  return null;
}

app.get('/api/api-keys', (ctx) => {
  const u = coach(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  ctx.json({ ok: true, keys: db.listApiKeys(u.id).map(k => ({
    ...k,
    key: k.key.slice(0, 15) + '...' + k.key.slice(-6) /* فقط بخشی از key نمایش داده بشه */
  })) });
});

app.post('/api/api-keys', (ctx) => {
  const u = coach(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  const { name, permissions } = ctx.body || {};
  const result = db.createApiKey(u.id, name || 'default', permissions || 'read');
  db.logActivity(u.id, u.full_name, 'API key جدید ساخت', name || 'default');
  ctx.json({ ok: true, key: result }); /* فقط همین‌بار key کامل نشون داده می‌شه */
});

app.delete('/api/api-keys/:id', (ctx) => {
  const u = coach(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه نامعتبر است');
  db.deleteApiKey(id, u.id);
  ctx.json({ ok: true });
});

app.get('/api/me', (ctx) => {
  const u = coach(ctx);
  if (!u) return ctx.json({ ok: false, user: null });
  ctx.json({ ok: true, user: db.publicUser(u) });
});

app.put('/api/me', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const updated = db.updateUser(u.id, {
    full_name: b.full_name !== undefined ? sanitize(String(b.full_name), 120) : undefined,
    phone: b.phone !== undefined ? sanitize(String(b.phone), 20) : undefined,
    belt: b.belt !== undefined ? sanitize(String(b.belt), 40) : undefined,
    notes: b.notes !== undefined ? sanitize(String(b.notes), 1000) : undefined,
    style: b.style !== undefined ? sanitize(String(b.style), 60) : undefined
  });
  ctx.json({ ok: true, user: db.publicUser(updated) });
});

app.post('/api/password', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  if (!rateLimit('pass-coach:' + u.id + ':' + getClientIp(ctx.req), 8, 600000)) {
    return bad(ctx, 'تعداد تلاش تغییر رمز بیش از حد است؛ ۱۰ دقیقه صبر کنید', 429);
  }
  const { current, next } = ctx.body || {};
  if (!db.verifyPassword(current, u.password_hash, u.password_salt)) return bad(ctx, 'رمز فعلی درست نیست');
  if (!next || String(next).length < 6) return bad(ctx, 'رمز جدید باید حداقل ۶ حرف باشد');
  db.setPassword(u.id, next);
  authSession.signIn(ctx, u.id, SITE, app.cookieName);
  ctx.json({ ok: true });
});

/* -------------------------------- نمای کلی -------------------------------- */

app.get('/api/overview', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const j = todayJalali();
  const doneFeed = db.all(
    `SELECT pa.*, u.full_name, u.avatar_color, (u.avatar_key IS NOT NULL OR (u.avatar_photo IS NOT NULL AND u.avatar_photo != '')) AS has_photo, u.avatar_updated_at AS photo_updated_at, u.belt, p.title AS plan_title
     FROM plan_assignments pa JOIN users u ON u.id = pa.user_id JOIN plans p ON p.id = pa.plan_id
     WHERE pa.verified=1 AND p.verified=1 AND u.verified=1 AND pa.status = 'done' ORDER BY pa.completed_at DESC LIMIT 8`
  );
  const selfReports = db.all(
    `SELECT sr.*, u.full_name FROM self_reports sr JOIN users u ON u.id = sr.user_id
     WHERE sr.verified=1 AND u.verified=1 ORDER BY sr.created_at DESC LIMIT 8`
  );
  const latestMembers = db.all(
    "SELECT id, full_name, username, belt, avatar_color, (avatar_key IS NOT NULL OR (avatar_photo IS NOT NULL AND avatar_photo != '')) AS has_photo, avatar_updated_at AS photo_updated_at, last_seen_at, join_date, created_at FROM users WHERE verified=1 AND role='member' ORDER BY created_at DESC LIMIT 5"
  ).map((m) => ({
    ...m,
    has_photo: !!m.has_photo,
    is_online: db.isUserOnline(m.last_seen_at)
  }));
  const pendingReceipts = db.get(
    "SELECT COUNT(*) AS c FROM tuition_receipts r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' AND u.verified = 1"
  ).c;
  const activeMembers = db.listMembers({ active: 1 });
  const onlineCount = activeMembers.filter((m) => db.isUserOnline(m.last_seen_at)).length;
  const careAlerts = activeMembers.map((m) => {
    const care = db.memberCareStatus(m.id, j.jy, j.jm, j.jd);
    return {
      id: m.id,
      full_name: m.full_name,
      username: m.username,
      discipline: m.discipline || m.style || '',
      belt: m.belt || '',
      avatar_color: m.avatar_color,
      has_photo: !!(m.avatar_key || m.avatar_photo),
      photo_updated_at: m.avatar_updated_at || null,
      last_seen_at: m.last_seen_at || null,
      is_online: db.isUserOnline(m.last_seen_at),
      ...care
    };
  }).filter((m) => m.needs_absence_followup || m.tuition_status === 'overdue' || m.tuition_status === 'due_soon');
  ctx.json({
    ok: true,
    stats: { ...db.stats(), onlineMembers: onlineCount },
    pendingReceipts,
    careAlerts,
    today: formatJalali(new Date()),
    jalali: { year: j.jy, month: j.jm, day: j.jd, monthName: JALALI_MONTHS[j.jm - 1] },
    activity: db.recentActivity(12),
    doneFeed,
    selfReports,
    latestMembers,
    plans: db.listPlans().slice(0, 5),
    announcements: db.listAnnouncements().slice(0, 5),
    notifications: db.notificationsFor(u.id, 15)
  });
});

/* -------------------------------- شاگردان -------------------------------- */

app.get('/api/members', (ctx) => {
  if (!needCoach(ctx)) return;
  const rows = db.listMembers({ q: ctx.query.q, belt: ctx.query.belt });
  const j = todayJalali();
  const discFilter = String(ctx.query.discipline || '').trim();
  const activeFilter = ctx.query.active;
  const members = rows
    .filter((m) => {
      if (discFilter && (m.discipline || m.style || '') !== discFilter) return false;
      if (activeFilter === '1' && !m.active) return false;
      if (activeFilter === '0' && m.active) return false;
      return true;
    })
    .map((m) => {
      const { rows: pr } = db.progressYear(m.id, j.jy);
      const filled = pr.filter((r) => r.overall !== null);
      const last = [...pr].sort((a, b) => b.month - a.month)[0] || null;
      const pending = db.get('SELECT COUNT(*) AS c FROM plan_assignments WHERE verified=1 AND plan_id IN (SELECT id FROM plans WHERE verified=1) AND user_id = ? AND status != ?', m.id, 'done').c;
      const care = db.memberCareStatus(m.id, j.jy, j.jm, j.jd);
      return {
        ...db.publicUser(m),
        avg: filled.length ? Math.round(filled.reduce((s, r) => s + r.overall, 0) / filled.length) : null,
        last_overall: last ? last.overall : null,
        last_month: last ? last.month : null,
        pending,
        ...care
      };
    });
  ctx.json({
    ok: true,
    members,
    belts: db.all("SELECT DISTINCT belt FROM users WHERE verified=1 AND role='member' AND belt IS NOT NULL ORDER BY belt").map((r) => r.belt),
    disciplines: db.all("SELECT DISTINCT COALESCE(discipline, style) AS d FROM users WHERE verified=1 AND role='member' AND COALESCE(discipline, style) IS NOT NULL AND COALESCE(discipline, style) != '' ORDER BY d").map((r) => r.d)
  });
});

app.get('/api/members/presence', (ctx) => {
  if (!needCoach(ctx)) return;
  const rows = db.all("SELECT id, last_seen_at FROM users WHERE verified = 1 AND role = 'member'");
  const members = rows.map((m) => ({
    id: m.id,
    last_seen_at: m.last_seen_at || null,
    is_online: db.isUserOnline(m.last_seen_at)
  }));
  const online_count = members.filter((m) => m.is_online).length;
  ctx.json({ ok: true, server_time: db.now(), window_ms: db.ONLINE_WINDOW_MS, online_count, members });
});

app.post('/api/members', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const fullName = sanitize(String(b.full_name || ''), 120);
  const username = String(b.username || '').trim().toLowerCase();
  if (!fullName) return bad(ctx, 'نام و نام خانوادگی الزامی است');
  if (!username || !/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
    return bad(ctx, 'نام کاربری باید انگلیسی و حداقل ۳ حرف باشد');
  }
  if (db.findByUsername(username)) return bad(ctx, 'این نام کاربری قبلاً گرفته شده است');
  const password = b.password;
  if (!password || String(password).length < 4) return bad(ctx, 'رمز عبور باید حداقل ۴ حرف باشد');
  const member = db.createUser({
    ...b,
    full_name: fullName,
    username,
    password,
    notes: b.notes !== undefined ? sanitize(String(b.notes), 1000) : undefined,
    experience: b.experience !== undefined ? sanitize(String(b.experience), 160) : undefined
  }, 'member');
  db.logActivity(u.id, u.full_name, 'شاگرد جدید ثبت کرد', member.full_name);

  // اگر تمرین‌های «برای همه» فعال باشند، به او هم اختصاص بده
  for (const plan of db.all('SELECT * FROM plans WHERE verified=1 AND target_all = 1')) {
    db.run('INSERT OR IGNORE INTO plan_assignments (plan_id, user_id, status, assigned_at) VALUES (?,?,?,?)',
      plan.id, member.id, 'todo', db.now());
  }
  db.pushNotification(member.id, {
    type: 'welcome',
    title: 'به باشگاه آنلاین ارسلان دوجو خوش آمدید',
    body: 'پنل کاربری شما ساخته شد. تمرینات و جدول پیشرفت در دسترس شماست.'
  });
  ctx.json({ ok: true, member: db.publicUser(member) });
});

app.get('/api/members/:id', (ctx) => {
  if (!needCoach(ctx)) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const years = db.all('SELECT DISTINCT year FROM progress WHERE verified=1 ORDER BY year DESC').map((r) => r.year);
  const year = Number(ctx.query.year) || todayJalali().jy;
  const prog = db.progressYear(m.id, year);
  const reports = db.all('SELECT * FROM self_reports WHERE verified=1 AND user_id = ? ORDER BY year DESC, month DESC', m.id);
  const plans = db.all(
    `SELECT pa.*, p.title, p.category, p.due_on FROM plan_assignments pa JOIN plans p ON p.id = pa.plan_id
     WHERE pa.verified=1 AND p.verified=1 AND pa.user_id = ? ORDER BY p.created_at DESC`, m.id
  );
  ctx.json({
    ok: true,
    member: db.publicUser(m),
    years: years.includes(year) ? years : [year, ...years],
    year,
    progress: prog.months,
    reports,
    plans,
    activity: db.all('SELECT * FROM activity WHERE verified=1 AND actor_id = ? ORDER BY created_at DESC LIMIT 10', m.id)
  });
});

app.get('/api/members/:id/insurance', (ctx) => {
  if (!needCoach(ctx)) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const ins = db.getUserInsurance(m.id);
  ctx.json({ ok: true, ...(ins || { has_insurance: false, file_data: null, file_name: null, storage_url: null, updated_at: null }) });
});

app.get('/api/members/:id/photo', (ctx) => {
  if (!needCoach(ctx)) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const photo = db.getUserPhoto(m.id);
  if (!photo || (!photo.buffer && !photo.photo_data)) return bad(ctx, 'عکس پروفایل ثبت نشده است', 404);
  if (photo.buffer) return ctx.binary(photo.buffer, photo.mime, { etag: photo.etag });
  ctx.image(photo.photo_data);
});

app.put('/api/members/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const b = ctx.body || {};
  const patch = { ...b };
  if (patch.full_name !== undefined) patch.full_name = sanitize(String(patch.full_name), 120);
  if (patch.notes !== undefined && patch.notes !== null) patch.notes = sanitize(String(patch.notes), 1000);
  if (patch.experience !== undefined && patch.experience !== null) patch.experience = sanitize(String(patch.experience), 160);
  const updated = db.updateUser(m.id, patch);
  db.logActivity(u.id, u.full_name, 'اطلاعات شاگرد را ویرایش کرد', updated.full_name);
  ctx.json({ ok: true, member: db.publicUser(updated) });
});

app.post('/api/members/:id/password', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  if (!rateLimit('reset-pw:' + u.id, 30, 300000)) return bad(ctx, 'تعداد درخواست بیش از حد است', 429);
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const next = (ctx.body || {}).password;
  if (!next || String(next).length < 4) return bad(ctx, 'رمز عبور باید حداقل ۴ حرف باشد');
  db.setPassword(m.id, next);
  db.logActivity(u.id, u.full_name, 'رمز عبور شاگرد را بازنشانی کرد', m.full_name);
  ctx.json({ ok: true });
});

app.delete('/api/members/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  if (db.get('SELECT record_id FROM academy_record_people WHERE user_id=? LIMIT 1', m.id) || db.get('SELECT id FROM academy_records WHERE user_id=? OR author_id=? LIMIT 1', m.id, m.id)) return bad(ctx, 'برای حفظ سوابق، حساب را غیرفعال کنید؛ این فرد سابقهٔ آکادمی دارد', 409);
  db.deleteUser(m.id);
  db.logActivity(u.id, u.full_name, 'شاگرد را حذف کرد', m.full_name);
  ctx.json({ ok: true });
});

app.post('/api/members/:id/impersonate', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  if (!rateLimit('impersonate:' + u.id, 30, 300000)) return bad(ctx, 'تعداد درخواست بیش از حد است', 429);
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member' || !m.active) return bad(ctx, 'شاگرد پیدا نشد', 404);
  const token = require('node:crypto').randomBytes(24).toString('hex');
  db.run('INSERT INTO impersonations (token, user_id, created_at) VALUES (?,?,?)', token, m.id, db.now());
  db.logActivity(u.id, u.full_name, 'پنل شاگرد را مشاهده کرد', m.full_name);
  ctx.json({ ok: true, token });
});

app.post('/api/members/:id/remind', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const m = db.findById(id);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const b = ctx.body || {};
  const kind = ['tuition', 'absence', 'custom'].includes(b.kind) ? b.kind : 'tuition';
  const j = todayJalali();
  const defaults = {
    tuition: {
      type: 'reminder_tuition',
      title: `یادآوری تمدید شهریه ${JALALI_MONTHS[j.jm - 1]}`,
      body: `سلام ${m.full_name} عزیز، لطفاً پس از واریز شهریه ماه ${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy)}، فیش پرداختی را در بخش «پرداخت شهریه» ثبت کنید.`
    },
    absence: {
      type: 'reminder_absence',
      title: 'پیگیری غیبت در کلاس‌های دوجو',
      body: `سلام ${m.full_name} عزیز، در چند جلسه اخیر غایب بودید. امیدواریم سلامت باشید؛ برای هماهنگی تمرین جایگزین یا زمان بازگشت با مربی در ارتباط باشید.`
    },
    custom: {
      type: 'message',
      title: 'پیام یادآوری از مربی',
      body: 'لطفاً وضعیت تمرین و برنامه خود را در پنل بررسی کنید.'
    }
  };
  const title = sanitize(String(b.title || defaults[kind].title).trim()).slice(0, 140);
  const body = sanitize(String(b.body || defaults[kind].body).trim()).slice(0, 600);
  if (!title) return bad(ctx, 'عنوان یادآوری الزامی است');
  db.pushNotification(m.id, { type: defaults[kind].type, title, body });
  db.logActivity(u.id, u.full_name, 'یادآوری ارسال کرد', `${m.full_name} — ${title}`);
  ctx.json({ ok: true });
});

/* --------------------------- حضور و غیاب و شهریه -------------------------- */

app.get('/api/attendance', (ctx) => {
  if (!needCoach(ctx)) return;
  const date = String(ctx.query.date || todayISODate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(ctx, 'تاریخ معتبر نیست');
  const rows = db.listAttendanceByDate(date);
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  const j = todayJalali();
  const members = db.listMembers({ active: 1 }).map((m) => {
    const rec = byUser.get(m.id);
    const care = db.memberCareStatus(m.id, j.jy, j.jm, j.jd);
    return {
      id: m.id,
      full_name: m.full_name,
      username: m.username,
      discipline: m.discipline || m.style || '',
      belt: m.belt || '',
      avatar_color: m.avatar_color,
      has_photo: !!(m.avatar_key || m.avatar_photo),
      photo_updated_at: m.avatar_updated_at || null,
      last_seen_at: m.last_seen_at || null,
      is_online: db.isUserOnline(m.last_seen_at),
      status: rec ? rec.status : null,
      note: rec ? (rec.note || '') : '',
      consecutive_absences: care.consecutive_absences,
      tuition_status: care.tuition_status
    };
  });
  ctx.json({ ok: true, date, members });
});

app.post('/api/attendance', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const session_date = String(b.session_date || todayISODate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session_date)) return bad(ctx, 'تاریخ جلسه معتبر نیست');
  if (session_date > todayISODate()) return bad(ctx, 'امکان ثبت حضور و غیاب برای تاریخ آینده وجود ندارد');

  const entries = Array.isArray(b.entries)
    ? b.entries
    : (b.user_id ? [{ user_id: b.user_id, status: b.status, note: b.note }] : []);
  if (!entries.length) return bad(ctx, 'حداقل یک وضعیت حضور ارسال کنید');

  const saved = [];
  for (const item of entries) {
    const uid = parseId(item && item.user_id);
    if (!uid) continue;
    const m = db.findById(uid);
    if (!m || m.role !== 'member') continue;
    const rec = db.recordAttendance({
      user_id: m.id,
      session_date,
      status: item.status,
      note: item.note ? sanitize(String(item.note), 300) : null
    }, u.id);
    saved.push(rec);
  }
  if (!saved.length) return bad(ctx, 'شاگرد معتبری در لیست یافت نشد', 404);
  db.logActivity(u.id, u.full_name, 'حضور و غیاب را ثبت کرد', `${session_date} (${faNum(saved.length)} نفر)`);
  ctx.json({ ok: true, saved: saved.length, date: session_date });
});

app.get('/api/tuition/receipts', (ctx) => {
  if (!needCoach(ctx)) return;
  const status = ['pending', 'approved', 'rejected'].includes(ctx.query.status) ? ctx.query.status : undefined;
  const year = ctx.query.year ? Number(ctx.query.year) : undefined;
  const month = ctx.query.month ? Number(ctx.query.month) : undefined;
  const receipts = db.listTuitionReceipts({ status, year, month, limit: 150 });
  const pendingCount = db.get("SELECT COUNT(*) AS c FROM tuition_receipts r JOIN users u ON u.id = r.user_id WHERE r.status = 'pending' AND u.verified = 1").c;
  ctx.json({ ok: true, receipts, pendingCount });
});

app.get('/api/tuition/receipts/:id/image', (ctx) => {
  if (!needCoach(ctx)) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه فیش نامعتبر است');
  const item = db.getTuitionReceiptImage(id);
  if (!item) return bad(ctx, 'فیش پیدا نشد', 404);
  if (item.buffer) return ctx.binary(item.buffer, item.mime, { etag: item.etag });
  if (item.dataUrl) return ctx.image(item.dataUrl);
  return bad(ctx, 'تصویر فیش ثبت نشده است', 404);
});

app.post('/api/tuition/receipts/:id/review', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه فیش نامعتبر است');
  const b = ctx.body || {};
  const status = b.status;
  if (!['approved', 'rejected'].includes(status)) return bad(ctx, 'وضعیت بررسی باید تایید یا رد باشد');
  const coach_note = b.coach_note ? sanitize(String(b.coach_note).trim(), 500) : '';
  const updated = db.reviewTuitionReceipt(id, { status, coach_note }, u.id);
  if (!updated) return bad(ctx, 'فیش مورد نظر پیدا نشد', 404);

  const member = db.findById(updated.user_id);
  const periodLabel = `${JALALI_MONTHS[updated.month - 1]} ${faNum(updated.year)}`;
  db.pushNotification(updated.user_id, {
    type: 'tuition_review',
    title: status === 'approved' ? `فیش شهریه ${periodLabel} تایید شد ✓` : `فیش شهریه ${periodLabel} تایید نشد`,
    body: coach_note || (status === 'approved' ? `پرداخت با کد پیگیری ${updated.tracking_code} تایید گردید.` : 'لطفاً جزئیات فیش را بررسی و مجدداً ارسال کنید.')
  });
  db.logActivity(u.id, u.full_name, status === 'approved' ? 'فیش شهریه را تایید کرد' : 'فیش شهریه را رد کرد', `${member ? member.full_name : 'شاگرد'} — ${periodLabel}`);
  ctx.json({ ok: true, receipt: updated });
});

/* -------------------------------- تمرینات -------------------------------- */

app.get('/api/plans', (ctx) => {
  if (!needCoach(ctx)) return;
  ctx.json({ ok: true, plans: db.listPlans() });
});

app.post('/api/plans', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const title = sanitize(String(b.title || ''), 160);
  if (!title) return bad(ctx, 'عنوان تمرین الزامی است');
  let targets = Array.isArray(b.member_ids) ? b.member_ids.map(parseId).filter(Boolean) : [];
  if (!targets.length && !b.all_members) return bad(ctx, 'حداقل یک شاگرد را انتخاب کنید');
  if (b.all_members) targets = [];
  const plan = db.createPlan({
    author_id: u.id,
    title,
    body: b.body ? sanitize(String(b.body), 4000) : '',
    category: b.category ? sanitize(String(b.category), 50) : 'تمرین',
    difficulty: b.difficulty ? sanitize(String(b.difficulty), 30) : 'متوسط',
    starts_on: b.starts_on,
    due_on: b.due_on,
    duration: b.duration ? sanitize(String(b.duration), 60) : null,
    targets,
    all_members: !!b.all_members,
    sport: b.sport ? sanitize(String(b.sport), 60) : null
  });
  db.logActivity(u.id, u.full_name, 'تمرین ارسال کرد', `${plan.title} — ${plan.total} شاگرد`);
  ctx.json({ ok: true, plan });
});

app.get('/api/plans/:id', (ctx) => {
  if (!needCoach(ctx)) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه تمرین نامعتبر است');
  const plan = db.getPlan(id);
  if (!plan) return bad(ctx, 'تمرین پیدا نشد', 404);
  ctx.json({ ok: true, plan });
});

app.put('/api/plans/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه تمرین نامعتبر است');
  const plan = db.getPlan(id);
  if (!plan) return bad(ctx, 'تمرین پیدا نشد', 404);
  const b = ctx.body || {};
  const patch = {};
  if (b.title !== undefined) patch.title = sanitize(String(b.title), 160);
  if (b.body !== undefined) patch.body = sanitize(String(b.body), 4000);
  if (b.category !== undefined) patch.category = sanitize(String(b.category), 50);
  if (b.difficulty !== undefined) patch.difficulty = sanitize(String(b.difficulty), 30);
  if (b.starts_on !== undefined) patch.starts_on = b.starts_on;
  if (b.due_on !== undefined) patch.due_on = b.due_on;
  if (b.duration !== undefined) patch.duration = sanitize(String(b.duration), 60);
  const updated = db.updatePlan(plan.id, patch);
  db.logActivity(u.id, u.full_name, 'تمرین را ویرایش کرد', updated.title);
  ctx.json({ ok: true, plan: updated });
});

app.delete('/api/plans/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه تمرین نامعتبر است');
  const plan = db.getPlan(id);
  if (!plan) return bad(ctx, 'تمرین پیدا نشد', 404);
  db.deletePlan(plan.id);
  db.logActivity(u.id, u.full_name, 'تمرین را حذف کرد', plan.title);
  ctx.json({ ok: true });
});

app.post('/api/plans/:id/assign', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه تمرین نامعتبر است');
  const plan = db.getPlan(id);
  if (!plan) return bad(ctx, 'تمرین پیدا نشد', 404);
  const ids = Array.isArray((ctx.body || {}).member_ids) ? ctx.body.member_ids.map(parseId).filter(Boolean) : [];
  for (const uid of ids) {
    const m = db.findById(uid);
    if (!m || m.role !== 'member') continue;
    const added = db.run('INSERT OR IGNORE INTO plan_assignments (plan_id, user_id, status, assigned_at) VALUES (?,?,?,?)',
      plan.id, uid, 'todo', db.now());
    if (added.changes > 0) {
      db.pushNotification(uid, { type: 'plan', title: `تمرین جدید: ${plan.title}`, body: 'به پنل تمرینات من سر بزنید.' });
    }
  }
  db.logActivity(u.id, u.full_name, 'تمرین را برای شاگردان بیشتری ارسال کرد', `${plan.title} — ${ids.length} نفر`);
  ctx.json({ ok: true, plan: db.getPlan(plan.id) });
});

app.put('/api/assignments/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه تخصیص نامعتبر است');
  const a = db.get('SELECT * FROM plan_assignments WHERE id = ?', id);
  if (!a) return bad(ctx, 'تخصیص پیدا نشد', 404);
  const { status, coach_note } = ctx.body || {};
  const cleanNote = coach_note === undefined ? undefined : (coach_note === null ? '' : sanitize(String(coach_note), 1000));
  const fields = [];
  const values = [];
  if (status && ['todo', 'doing', 'done'].includes(status)) { fields.push('status = ?'); values.push(status); }
  if (cleanNote !== undefined) { fields.push('coach_note = ?'); values.push(cleanNote); }
  if (fields.length) {
    values.push(a.id);
    db.run(`UPDATE plan_assignments SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  if (cleanNote) {
    const m = db.findById(a.user_id);
    const p = db.get('SELECT title FROM plans WHERE id = ?', a.plan_id);
    db.pushNotification(a.user_id, {
      type: 'feedback',
      title: 'بازخورد مربی',
      body: `${p ? p.title : 'تمرین'}: ${cleanNote}`
    });
    db.logActivity(u.id, u.full_name, 'به تمرین شاگرد بازخورد داد', m ? m.full_name : null);
  }
  ctx.json({ ok: true, assignment: db.get('SELECT * FROM plan_assignments WHERE id = ?', a.id) });
});

/* ------------------------------ جدول پیشرفت ------------------------------ */

app.get('/api/progress', (ctx) => {
  if (!needCoach(ctx)) return;
  const userId = parseId(ctx.query.user_id);
  if (!userId) return bad(ctx, 'شناسه شاگرد معتبر نیست');
  const m = db.findById(userId);
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const year = Number(ctx.query.year) || todayJalali().jy;
  const prog = db.progressYear(userId, year);
  const reports = db.all('SELECT * FROM self_reports WHERE verified=1 AND user_id = ? AND year = ? ORDER BY month', userId, year);
  ctx.json({ ok: true, member: db.publicUser(m), year, progress: prog.months, selfReports: reports });
});

app.put('/api/progress', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const userId = parseId(b.user_id);
  const m = userId ? db.findById(userId) : null;
  if (!m || m.role !== 'member') return bad(ctx, 'شاگرد پیدا نشد', 404);
  const year = Number(b.year);
  const month = Number(b.month);
  if (!year || !month || month < 1 || month > 12) return bad(ctx, 'سال و ماه معتبر وارد کنید');
  const cleanNote = b.note === undefined ? undefined : (b.note === null ? null : sanitize(String(b.note), 1000));
  const row = db.saveProgress({
    user_id: m.id, year, month,
    sessions: b.sessions,
    endurance: clampScore(b.endurance),
    strength: clampScore(b.strength),
    technique: clampScore(b.technique),
    flexibility: clampScore(b.flexibility),
    discipline: clampScore(b.discipline),
    weight_kg: numOrNull(b.weight_kg),
    overall: clampScore(b.overall),
    note: cleanNote
  }, u.id);
  db.pushNotification(m.id, {
    type: 'progress',
    title: `جدول پیشرفت ${JALALI_MONTHS[month - 1]} ${faNum(year)} ثبت شد`,
    body: row.overall !== null ? `نمره کل: ${faNum(row.overall)} از ۱۰۰` : 'مربی مقادیر این ماه را ثبت کرد.'
  });
  db.logActivity(u.id, u.full_name, 'جدول پیشرفت را به‌روزرسانی کرد', `${m.full_name} — ${JALALI_MONTHS[month - 1]} ${year}`);
  ctx.json({ ok: true, progress: row });
});

app.delete('/api/progress/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه رکورد نامعتبر است');
  const row = db.get('SELECT * FROM progress WHERE id = ?', id);
  if (!row) return bad(ctx, 'رکورد پیدا نشد', 404);
  db.deleteProgress(row.id);
  db.logActivity(u.id, u.full_name, 'یک رکورد پیشرفت را حذف کرد', null);
  ctx.json({ ok: true });
});

app.get('/api/progress/club', (ctx) => {
  if (!needCoach(ctx)) return;
  const year = Number(ctx.query.year) || todayJalali().jy;
  ctx.json({ ok: true, year, rows: db.clubMatrix(year) });
});

app.get('/api/years', (ctx) => {
  if (!needCoach(ctx)) return;
  const years = db.all('SELECT DISTINCT year FROM progress WHERE verified=1 ORDER BY year DESC').map((r) => r.year);
  const current = todayJalali().jy;
  if (!years.includes(current)) years.unshift(current);
  ctx.json({ ok: true, years });
});

app.get('/api/export/progress', (ctx) => {
  if (!needCoach(ctx)) return;
  const year = Number(ctx.query.year) || todayJalali().jy;
  if (ctx.query.detail === 'full') {
    const members = db.listMembers();
    const header = ['نام شاگرد', 'رشته', 'کمربند', 'سال', 'ماه', 'شماره ماه', 'جلسات', 'استقامت', 'قدرت', 'تکنیک', 'انعطاف', 'انضباط', 'وزن (کیلوگرم)', 'نمره کل', 'یادداشت مربی'];
    const lines = [csvRow(header)];
    for (const m of members) {
      const { rows } = db.progressYear(m.id, year);
      for (const r of rows) {
        lines.push(csvRow([
          m.full_name,
          m.discipline || m.style || '-',
          m.belt || '-',
          year,
          JALALI_MONTHS[r.month - 1] || String(r.month),
          r.month,
          r.sessions ?? '-',
          r.endurance ?? '-',
          r.strength ?? '-',
          r.technique ?? '-',
          r.flexibility ?? '-',
          r.discipline ?? '-',
          r.weight_kg ?? '-',
          r.overall ?? '-',
          r.note || ''
        ]));
      }
    }
    const csv = '\uFEFF' + lines.join('\r\n');
    ctx.res.setHeader('Content-Disposition', `attachment; filename="progress-full-${year}.csv"`);
    ctx.text(csv, 200, 'text/csv; charset=utf-8');
    return;
  }
  const rows = db.clubMatrix(year);
  const header = ['نام شاگرد', 'کمربند', ...JALALI_MONTHS.map((m) => m + ' ' + year), 'میانگین سال'];
  const lines = [csvRow(header)];
  for (const r of rows) {
    const cells = [r.member.full_name, r.member.belt || '-'];
    for (let mth = 1; mth <= 12; mth += 1) {
      const p = r.months[mth];
      cells.push(p && p.overall !== null ? String(p.overall) : '-');
    }
    cells.push(r.avg === null ? '-' : String(r.avg));
    lines.push(csvRow(cells));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="progress-${year}.csv"`);
  ctx.text(csv, 200, 'text/csv; charset=utf-8');
});

app.get('/api/export/members', (ctx) => {
  if (!needCoach(ctx)) return;
  const j = todayJalali();
  const tuitionLabel = { paid: 'پرداخت شده', pending: 'در انتظار تایید', due_soon: 'نزدیک سررسید', overdue: 'معوق', unpaid: 'ثبت نشده' };
  const rows = db.listMembers();
  const header = ['نام شاگرد', 'نام کاربری', 'رشته', 'کمربند', 'موبایل', 'وضعیت حساب', `میانگین ${j.jy}`, 'تمرین باز', `شهریه ${JALALI_MONTHS[j.jm - 1]}`, 'غیبت متوالی', 'نیاز به پیگیری'];
  const lines = [csvRow(header)];
  for (const m of rows) {
    const { rows: pr } = db.progressYear(m.id, j.jy);
    const filled = pr.filter((r) => r.overall !== null);
    const avg = filled.length ? Math.round(filled.reduce((s, r) => s + r.overall, 0) / filled.length) : '-';
    const pending = db.get('SELECT COUNT(*) AS c FROM plan_assignments WHERE verified=1 AND plan_id IN (SELECT id FROM plans WHERE verified=1) AND user_id = ? AND status != ?', m.id, 'done').c;
    const care = db.memberCareStatus(m.id, j.jy, j.jm, j.jd);
    const followReasons = [];
    if (care.needs_absence_followup) followReasons.push('غیبت متوالی');
    if (care.tuition_status === 'overdue' || care.tuition_status === 'due_soon') followReasons.push('شهریه');
    lines.push(csvRow([
      m.full_name,
      m.username,
      m.discipline || m.style || '-',
      m.belt || '-',
      m.phone || '-',
      m.active ? 'فعال' : 'غیرفعال',
      avg,
      pending,
      tuitionLabel[care.tuition_status] || care.tuition_status,
      care.consecutive_absences,
      followReasons.length ? followReasons.join(' + ') : 'ندارد'
    ]));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="members-${j.jy}-${j.jm}.csv"`);
  ctx.text(csv, 200, 'text/csv; charset=utf-8');
});

app.get('/api/export/tuition', (ctx) => {
  if (!needCoach(ctx)) return;
  const j = todayJalali();
  const year = ctx.query.year ? Number(ctx.query.year) : undefined;
  const statusLabel = { pending: 'در انتظار بررسی', approved: 'تایید شده', rejected: 'رد شده' };
  const receipts = db.listTuitionReceipts({ year, limit: 500 });
  const header = ['نام شاگرد', 'رشته', 'کمربند', 'سال', 'ماه', 'مبلغ (تومان)', '۴ رقم کارت', 'کد پیگیری', 'وضعیت', 'یادداشت شاگرد', 'پاسخ مربی', 'تاریخ ثبت'];
  const lines = [csvRow(header)];
  for (const r of receipts) {
    lines.push(csvRow([
      r.full_name,
      r.discipline || '-',
      r.belt || '-',
      r.year,
      JALALI_MONTHS[r.month - 1] || r.month,
      r.amount_toman,
      r.card_last4 || '-',
      r.tracking_code,
      statusLabel[r.status] || r.status,
      r.note || '',
      r.coach_note || '',
      r.created_at
    ]));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  ctx.res.setHeader('Content-Disposition', `attachment; filename="tuition-receipts-${year || j.jy}.csv"`);
  ctx.text(csv, 200, 'text/csv; charset=utf-8');
});

/* ------------------------------- اطلاع‌رسانی ------------------------------ */

app.get('/api/announcements', (ctx) => {
  if (!needCoach(ctx)) return;
  ctx.json({ ok: true, announcements: db.listAnnouncements() });
});

app.post('/api/announcements', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const title = sanitize(String(b.title || ''), 180);
  const body = sanitize(String(b.body || ''), 4000);
  if (!title) return bad(ctx, 'عنوان اطلاعیه الزامی است');
  if (!body) return bad(ctx, 'متن اطلاعیه الزامی است');
  const targets = Array.isArray(b.member_ids) ? b.member_ids.map(parseId).filter(Boolean) : [];
  if (!targets.length && !b.all_members) return bad(ctx, 'حداقل یک شاگرد را انتخاب کنید');
  const a = db.createAnnouncement({
    author_id: u.id,
    title,
    body,
    category: b.category ? sanitize(String(b.category), 50) : 'عمومی',
    pinned: b.pinned ? 1 : 0,
    targets: b.all_members ? [] : targets
  });
  db.logActivity(u.id, u.full_name, 'اطلاعیه منتشر کرد', a.title);
  ctx.json({ ok: true, announcement: a });
});

app.put('/api/announcements/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه اطلاعیه نامعتبر است');
  const a = db.getAnnouncement(id);
  if (!a) return bad(ctx, 'اطلاعیه پیدا نشد', 404);
  const b = ctx.body || {};
  const patch = {};
  if (b.title !== undefined) patch.title = sanitize(String(b.title), 180);
  if (b.body !== undefined) patch.body = sanitize(String(b.body), 4000);
  if (b.category !== undefined) patch.category = sanitize(String(b.category), 50);
  if (b.pinned !== undefined) patch.pinned = b.pinned ? 1 : 0;
  if (b.member_ids !== undefined) patch.targets = Array.isArray(b.member_ids) ? b.member_ids.map(parseId).filter(Boolean) : [];
  const updated = db.updateAnnouncement(a.id, patch);
  db.logActivity(u.id, u.full_name, 'اطلاعیه را ویرایش کرد', updated.title);
  ctx.json({ ok: true, announcement: updated });
});

app.delete('/api/announcements/:id', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const id = parseId(ctx.params.id);
  if (!id) return bad(ctx, 'شناسه اطلاعیه نامعتبر است');
  const a = db.getAnnouncement(id);
  if (!a) return bad(ctx, 'اطلاعیه پیدا نشد', 404);
  db.deleteAnnouncement(a.id);
  db.logActivity(u.id, u.full_name, 'اطلاعیه را حذف کرد', a.title);
  ctx.json({ ok: true });
});

app.post('/api/messages', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  const b = ctx.body || {};
  const title = sanitize(String(b.title || '').trim(), 160);
  if (!title) return bad(ctx, 'عنوان پیام الزامی است');
  const body = b.body ? sanitize(String(b.body), 1000) : null;
  let ids = Array.isArray(b.member_ids) ? b.member_ids.map(parseId).filter(Boolean) : [];
  if (b.all_members) ids = db.listMembers({ active: 1 }).map((m) => m.id);
  if (!ids.length) return bad(ctx, 'گیرنده‌ای انتخاب نشده است');
  for (const id of ids) {
    db.pushNotification(id, { type: 'message', title, body });
  }
  db.logActivity(u.id, u.full_name, 'پیام مستقیم فرستاد', `${title} — ${ids.length} نفر`);
  ctx.json({ ok: true, sent: ids.length });
});

app.get('/api/notifications', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  ctx.json({ ok: true, notifications: db.notificationsFor(u.id, 40), unread: db.unreadCount(u.id) });
});

app.post('/api/notifications/read', (ctx) => {
  const u = needCoach(ctx);
  if (!u) return;
  db.markNotificationsRead(u.id);
  ctx.json({ ok: true });
});

/* =========================== Public API (با API key) ========================= */
/* این endpoints برای دسترسی از بیرون (اپلیکیشن موبایل، integrations و...) با API key هستن */

app.get('/v1/members', (ctx) => {
  const u = coachOrApiKey(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  ctx.json({ ok: true, members: db.listMembers().map(m => db.publicUser(m)) });
});

app.get('/v1/plans', (ctx) => {
  const u = coachOrApiKey(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  ctx.json({ ok: true, plans: db.listPlans() });
});

app.get('/v1/stats', (ctx) => {
  const u = coachOrApiKey(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  ctx.json({ ok: true, stats: db.stats() });
});

app.get('/v1/progress/:userId', (ctx) => {
  const u = coachOrApiKey(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  const uid = parseId(ctx.params.userId);
  if (!uid) return bad(ctx, 'شناسه شاگرد نامعتبر است');
  const year = Number(ctx.query.year) || todayJalali().jy;
  const prog = db.progressYear(uid, year);
  ctx.json({ ok: true, progress: prog });
});

app.get('/v1/announcements', (ctx) => {
  const u = coachOrApiKey(ctx);
  if (!u) return ctx.json({ ok: false, error: 'unauthorized' }, 401);
  ctx.json({ ok: true, announcements: db.all('SELECT * FROM announcements WHERE verified=1 ORDER BY created_at DESC LIMIT 50') });
});

require('../shared/academy').mount(app, { role: 'coach', user: coach });
require('../shared/academy').mount(app, { admin: true });

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`پنل مربی: http://localhost:${PORT}`);
  console.log(`دیتابیس: ${db.DB_PATH}`);
  console.log(`API endpoints: /v1/members, /v1/plans, /v1/stats, /v1/progress/:id, /v1/announcements`);
});

function closeGracefully() {
  server.close(() => {
    db.closeDb();
    process.exit(0);
  });
  setTimeout(() => {
    db.closeDb();
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);
