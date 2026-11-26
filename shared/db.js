'use strict';
/*
 * لایه دیتابیس: SQLite (ماژول داخلی node:sqlite) — داده‌ها روی دیسک ذخیره
 * می‌شوند و با ری‌استارت سرور از بین نمی‌روند.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { lifetimeSeconds, RENEW_INTERVAL_SECONDS } = require('./session-policy');
const { normalizeMemberDetails } = require('./member-details');
const storage = require('./storage');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.ARSLAN_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.ARSLAN_DB || path.join(DATA_DIR, 'arslan-dojo.db');

/* اگر env var RESET_DB=1 ست شده باشد، دیتابیس قبلی پاک می‌شود */
if (process.env.RESET_DB === '1') {
  try { fs.unlinkSync(DB_PATH); console.log('[DB] دیتابیس قبلی پاک شد'); } catch { /* نبود که مشکلی نیست */ }
}

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

/* خواب همگام (برای تلاش مجدد وقتی دو سرور هم‌زمان دیتابیس را می‌سازند) */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/* دو پروسه (سایت مربی و سایت شاگردان) ممکن است هم‌زمان اجرا شوند */
function execWithRetry(sql, tries = 20) {
  for (let i = 0; i < tries; i += 1) {
    try { db.exec(sql); return; } catch (err) {
      if (err && (err.errcode === 5 || err.errcode === 6) /* SQLITE_BUSY/LOCKED */ && i < tries - 1) { sleepSync(120 * (i + 1)); continue; }
      throw err;
    }
  }
}

try { db.exec('PRAGMA busy_timeout = 15000;'); } catch { /* غیرحیاتی */ }

/*
 * تغییر journal_mode به WAL نیازمند قفل انحصاری است و اگر دو سایت هم‌زمان
 * بالا بیایند ممکن است SQLITE_BUSY برگرداند؛ بنابراین با تلاش مجدد انجام می‌شود
 * و در بدترین حالت بدون WAL ادامه می‌دهیم (برنامه کار می‌کند).
 */
let walEnabled = false;
for (let attempt = 0; attempt < 25; attempt += 1) {
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    walEnabled = true;
    break;
  } catch (err) {
    const busy = err && (err.errcode === 5 || err.errcode === 6);
    if (busy && attempt < 24) { sleepSync(100 * (attempt + 1)); continue; }
    console.warn('[db] فعال‌سازی WAL ممکن نشد؛ با journal_mode پیش‌فرض ادامه می‌دهیم.');
    break;
  }
}

try {
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA cache_size = -16000;');
} catch { /* غیرحیاتی */ }

db.exec('PRAGMA foreign_keys = ON;');

/* ------------------------------ ابزار پرس‌وجو ----------------------------- */

function clean(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    return p;
  });
}

function all(sql, ...params) { return db.prepare(sql).all(...clean(params)); }
function get(sql, ...params) { return db.prepare(sql).get(...clean(params)) || null; }
function run(sql, ...params) { return db.prepare(sql).run(...clean(params)); }

/* --------------------------------- اسکیم --------------------------------- */

execWithRetry(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('coach','member')),
  full_name      TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  gender         TEXT,
  birth_date     TEXT,
  age            INTEGER,
  weight_kg      REAL,
  height_cm      REAL,
  belt           TEXT DEFAULT 'سفید',
  style          TEXT,
  experience     TEXT,
  join_date      TEXT,
  notes          TEXT,
  avatar_color   TEXT DEFAULT '#e2483d',
  avatar_photo   TEXT,
  avatar_updated_at TEXT,
  insurance_file TEXT,
  insurance_file_name TEXT,
  insurance_updated_at TEXT,
  last_seen_at   TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  category    TEXT DEFAULT 'تمرین',
  difficulty  TEXT DEFAULT 'متوسط',
  starts_on   TEXT,
  due_on      TEXT,
  duration    TEXT,
  target_all  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_assignments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  completed_at TEXT,
  member_note  TEXT,
  coach_note   TEXT,
  assigned_at  TEXT NOT NULL,
  UNIQUE(plan_id, user_id)
);

CREATE TABLE IF NOT EXISTS progress (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  sessions    INTEGER,
  endurance   INTEGER,
  strength    INTEGER,
  technique   INTEGER,
  flexibility INTEGER,
  discipline  INTEGER,
  weight_kg   REAL,
  overall     INTEGER,
  note        TEXT,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(user_id, year, month)
);

CREATE TABLE IF NOT EXISTS self_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL,
  sessions    INTEGER,
  feeling     TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, year, month)
);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  category   TEXT DEFAULT 'عمومی',
  pinned     INTEGER NOT NULL DEFAULT 0,
  target_all INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcement_targets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT NOT NULL,
  UNIQUE(announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS impersonations (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT UNIQUE NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'default',
  permissions TEXT DEFAULT 'read',
  active     INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  last_used  TEXT
);

CREATE TABLE IF NOT EXISTS member_attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('present','absent','excused')),
  note         TEXT,
  recorded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(user_id, session_date)
);

CREATE TABLE IF NOT EXISTS tuition_receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_toman  INTEGER NOT NULL,
  card_last4    TEXT,
  tracking_code TEXT NOT NULL,
  receipt_image TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  coach_note    TEXT,
  reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_assign_user ON plan_assignments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_att_user_date ON member_attendance(user_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_user_ym ON tuition_receipts(user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_receipts_status_created ON tuition_receipts(status, created_at DESC);
`);

/* -------- مهاجرت: افزودن ستون discipline در صورت نبود -------- */
try {
  const cols = all("PRAGMA table_info('users')").map(c => c.name);
  if (!cols.includes('discipline')) {
    db.exec("ALTER TABLE users ADD COLUMN discipline TEXT DEFAULT NULL;");
  }
} catch { /* نادیده */ }

try {
  const cols2 = all("PRAGMA table_info('plans')").map(c => c.name);
  if (!cols2.includes('sport')) {
    db.exec("ALTER TABLE plans ADD COLUMN sport TEXT DEFAULT NULL;");
  }
} catch { /* نادیده */ }

/* Adding nullable fields preserves all existing members; both servers may start together. */
execWithRetry('BEGIN IMMEDIATE');
try {
  const userCols = new Set(all("PRAGMA table_info('users')").map(c => c.name));
  if (!userCols.has('blood_group')) db.exec('ALTER TABLE users ADD COLUMN blood_group TEXT DEFAULT NULL');
  if (!userCols.has('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL');
  if (!userCols.has('avatar_photo')) db.exec('ALTER TABLE users ADD COLUMN avatar_photo TEXT DEFAULT NULL');
  if (!userCols.has('avatar_key')) db.exec('ALTER TABLE users ADD COLUMN avatar_key TEXT DEFAULT NULL');
  if (!userCols.has('avatar_updated_at')) db.exec('ALTER TABLE users ADD COLUMN avatar_updated_at TEXT DEFAULT NULL');
  if (!userCols.has('insurance_file')) db.exec('ALTER TABLE users ADD COLUMN insurance_file TEXT DEFAULT NULL');
  if (!userCols.has('insurance_key')) db.exec('ALTER TABLE users ADD COLUMN insurance_key TEXT DEFAULT NULL');
  if (!userCols.has('insurance_file_name')) db.exec('ALTER TABLE users ADD COLUMN insurance_file_name TEXT DEFAULT NULL');
  if (!userCols.has('insurance_updated_at')) db.exec('ALTER TABLE users ADD COLUMN insurance_updated_at TEXT DEFAULT NULL');
  if (!userCols.has('last_seen_at')) db.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT DEFAULT NULL');

  const recCols = new Set(all("PRAGMA table_info('tuition_receipts')").map(c => c.name));
  if (!recCols.has('receipt_key')) db.exec('ALTER TABLE tuition_receipts ADD COLUMN receipt_key TEXT DEFAULT NULL');

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(lower(email)) WHERE email IS NOT NULL AND email != ''");
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}

/* Preserve an on-disk SQLite snapshot before the one-time provenance migration.
   VACUUM INTO produces a consistent backup even when the source uses WAL. */
if (!all("PRAGMA table_info('users')").some(c => c.name === 'verified') && get('SELECT COUNT(*) AS c FROM users').c > 0) {
  const backups = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const snapshot = path.join(backups, `before-academy-${Date.now()}-${process.pid}.db`);
  db.exec("VACUUM INTO '" + snapshot.replace(/'/g, "''") + "'");
  fs.chmodSync(snapshot, 0o600);
  console.log('[db] Consistent pre-migration backup saved in the configured private data directory.');
}

/* Legacy imports have no reliable provenance. Preserve them for administrator review,
   but never treat them as measured statistics until explicitly verified. */
execWithRetry('BEGIN IMMEDIATE');
try {
  if (!all("PRAGMA table_info('sessions')").some(c => c.name === 'impersonated')) db.exec('ALTER TABLE sessions ADD COLUMN impersonated INTEGER NOT NULL DEFAULT 0');
  for (const table of ['users','progress','plans','plan_assignments','announcements','announcement_reads','activity','notifications','self_reports']) {
    if (!all(`PRAGMA table_info('${table}')`).some(c => c.name === 'verified')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS verified_new_${table} AFTER INSERT ON ${table}
      BEGIN UPDATE ${table} SET verified=1 WHERE id=NEW.id; END`);
  }
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }

execWithRetry(`
CREATE INDEX IF NOT EXISTS idx_users_role_act ON users(role, active);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_created ON plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_ym ON self_reports(user_id, year, month);
`);

/* انتقال خودکار فایل‌های Base64 قدیمی از داخل دیتابیس به فضای ذخیره‌سازی مجزا */
function migrateLegacyBlobsToStorage() {
  try {
    const oldAvatars = all("SELECT id, avatar_photo FROM users WHERE avatar_photo IS NOT NULL AND avatar_photo != '' AND avatar_key IS NULL");
    for (const row of oldAvatars) {
      try {
        const saved = storage.putDataUrl('avatars', row.avatar_photo, {
          allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
          maxBytes: 2 * 1024 * 1024
        });
        run('UPDATE users SET avatar_key = ?, avatar_photo = NULL WHERE id = ? AND avatar_key IS NULL', saved.key, row.id);
      } catch { /* keep unparseable legacy rows intact without crashing startup */ }
    }
    const oldIns = all("SELECT id, insurance_file FROM users WHERE insurance_file IS NOT NULL AND insurance_file != '' AND insurance_key IS NULL");
    for (const row of oldIns) {
      try {
        const saved = storage.putDataUrl('insurance', row.insurance_file, {
          allowedMimes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
          maxBytes: 2 * 1024 * 1024
        });
        run('UPDATE users SET insurance_key = ?, insurance_file = NULL WHERE id = ? AND insurance_key IS NULL', saved.key, row.id);
      } catch { /* ignore */ }
    }
    const oldReceipts = all("SELECT id, receipt_image FROM tuition_receipts WHERE receipt_image IS NOT NULL AND receipt_image != '' AND receipt_key IS NULL");
    for (const row of oldReceipts) {
      try {
        const saved = storage.putDataUrl('receipts', row.receipt_image, {
          allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
          maxBytes: 2 * 1024 * 1024
        });
        run('UPDATE tuition_receipts SET receipt_key = ?, receipt_image = NULL WHERE id = ? AND receipt_key IS NULL', saved.key, row.id);
      } catch { /* ignore */ }
    }
  } catch { /* ignore transient lock during concurrent boot */ }
}
migrateLegacyBlobsToStorage();

/* -------------------------------- رمز عبور -------------------------------- */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  try {
    const calc = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
    const given = Buffer.from(String(hash), 'hex');
    return given.length === calc.length && crypto.timingSafeEqual(calc, given);
  } catch {
    return false;
  }
}

/* --------------------------------- کاربران -------------------------------- */

const now = () => new Date().toISOString();
const ONLINE_WINDOW_MS = 60 * 1000;
const _presenceTouchCache = new Map();

function isUserOnline(lastSeenAt, windowMs = ONLINE_WINDOW_MS) {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return false;
  const diff = Date.now() - t;
  return diff >= -5000 && diff <= windowMs;
}

function touchUserPresence(userId, force = false) {
  const id = Number(userId);
  if (!id) return null;
  const ms = Date.now();
  const prev = _presenceTouchCache.get(id) || 0;
  if (!force && ms - prev < 15000) return new Date(prev).toISOString();
  const ts = new Date(ms).toISOString();
  _presenceTouchCache.set(id, ms);
  try {
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', ts, id);
  } catch { /* ignore transient lock */ }
  return ts;
}

function clearUserPresence(userId) {
  const id = Number(userId);
  if (!id) return;
  _presenceTouchCache.delete(id);
  try {
    run('UPDATE users SET last_seen_at = NULL WHERE id = ?', id);
  } catch { /* ignore */ }
}

function normalizeEmail(email) {
  if (email === undefined) return undefined;
  if (email === null) return null;
  const cleaned = String(email).trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    throw Object.assign(new Error('آدرس جیمیل / ایمیل معتبر نیست'), { status: 400 });
  }
  return cleaned;
}

function findByUsername(username) {
  return get('SELECT * FROM users WHERE username = ?', String(username || '').trim().toLowerCase());
}

function findByEmail(email) {
  const cleaned = String(email || '').trim().toLowerCase();
  if (!cleaned) return null;
  return get('SELECT * FROM users WHERE lower(email) = ?', cleaned);
}

function findById(id) {
  return get('SELECT * FROM users WHERE id = ?', Number(id));
}

function publicUser(u) {
  if (!u) return null;
  // Unreviewed imported sporting claims must not appear as facts, even in a profile.
  if (!u.verified) u = { ...u, belt:null, experience:null, notes:null, join_date:null };
  return {
    id: u.id,
    role: u.role,
    verified: !!u.verified,
    full_name: u.full_name,
    username: u.username,
    email: u.email || null,
    phone: u.phone,
    gender: u.gender,
    birth_date: u.birth_date,
    blood_group: u.blood_group || null,
    age: u.age,
    weight_kg: u.weight_kg,
    height_cm: u.height_cm,
    belt: u.belt,
    style: u.style,
    experience: u.experience,
    join_date: u.join_date,
    notes: u.notes,
    avatar_color: u.avatar_color,
    has_photo: !!(u.avatar_key || u.avatar_photo),
    photo_updated_at: u.avatar_updated_at || null,
    discipline: u.discipline || null,
    has_insurance: !!(u.insurance_key || u.insurance_file),
    insurance_file_name: u.insurance_file_name || null,
    insurance_updated_at: u.insurance_updated_at || null,
    last_seen_at: u.last_seen_at || null,
    is_online: isUserOnline(u.last_seen_at),
    active: !!u.active,
    created_at: u.created_at
  };
}

function createUser(data, role = 'member') {
  data = { ...data, ...normalizeMemberDetails(data) };
  const email = data.email !== undefined ? normalizeEmail(data.email) : null;
  if (email && findByEmail(email)) {
    throw Object.assign(new Error('این جیمیل قبلاً ثبت شده است'), { status: 409 });
  }
  const { hash, salt } = hashPassword(data.password);
  const ts = now();
  const colors = ['#e2483d', '#d9a441', '#3fa7d6', '#5cb85c', '#a06cd5', '#ef7f57', '#2fa8a0'];
  const color = data.avatar_color || colors[(data.full_name || 'a').length % colors.length];
  const info = run(
    `INSERT INTO users (role, full_name, username, email, phone, password_hash, password_salt, gender, birth_date, age,
      weight_kg, height_cm, belt, style, experience, join_date, notes, avatar_color, active, created_at, updated_at, discipline, blood_group)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    role,
    String(data.full_name || '').trim(),
    String(data.username || '').trim().toLowerCase(),
    email,
    data.phone || null,
    hash,
    salt,
    data.gender || null,
    data.birth_date || null,
    data.age ? Number(data.age) : null,
    data.weight_kg ? Number(data.weight_kg) : null,
    data.height_cm ? Number(data.height_cm) : null,
    data.belt || null,
    data.style || data.discipline || null,
    data.experience || null,
    data.join_date || ts.slice(0, 10),
    data.notes || null,
    color,
    data.active === undefined ? 1 : (data.active ? 1 : 0),
    ts,
    ts,
    data.discipline || data.style || null,
    data.blood_group || null
  );
  return findById(info.lastInsertRowid);
}

function updateUser(id, data) {
  data = { ...data, ...normalizeMemberDetails(data) };
  const fields = [];
  const values = [];
  const allowed = ['full_name', 'email', 'phone', 'gender', 'birth_date', 'blood_group', 'age', 'weight_kg', 'height_cm',
    'belt', 'style', 'experience', 'notes', 'active', 'avatar_color', 'join_date', 'discipline'];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      let v = data[key];
      if (key === 'email') {
        v = normalizeEmail(v);
        if (v) {
          const existing = findByEmail(v);
          if (existing && existing.id !== Number(id)) {
            throw Object.assign(new Error('این جیمیل قبلاً برای حساب دیگری ثبت شده است'), { status: 409 });
          }
        }
      } else {
        if (['age', 'weight_kg', 'height_cm'].includes(key)) v = v === null || v === '' ? null : Number(v);
        if (key === 'active') v = v ? 1 : 0;
        if (v === '') v = null;
      }
      fields.push(`${key} = ?`);
      values.push(v);
    }
  }
  if (!fields.length) return findById(id);
  fields.push('updated_at = ?');
  values.push(now());
  values.push(Number(id));
  run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, ...values);
  if (data.active === false || data.active === 0) run('DELETE FROM sessions WHERE user_id=?', Number(id));
  return findById(id);
}

function getUserInsurance(id) {
  const row = get('SELECT id, insurance_key, insurance_file, insurance_file_name, insurance_updated_at FROM users WHERE id = ?', Number(id));
  if (!row) return null;
  let fileData = null;
  let storageUrl = null;
  if (row.insurance_key) {
    fileData = storage.getObjectDataUrl(row.insurance_key);
    storageUrl = storage.signedPublicUrl(row.insurance_key, { ownerId: row.id });
  } else if (row.insurance_file) {
    fileData = row.insurance_file;
  }
  return {
    has_insurance: !!fileData,
    file_data: fileData,
    file_name: row.insurance_file_name || null,
    storage_url: storageUrl,
    updated_at: row.insurance_updated_at || null
  };
}

function setUserInsurance(id, { fileData = null, fileName = null } = {}) {
  const uid = Number(id);
  const prev = get('SELECT insurance_key FROM users WHERE id = ?', uid);
  const ts = now();
  let newKey = null;
  if (fileData) {
    const saved = storage.putDataUrl('insurance', fileData, {
      allowedMimes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
      maxBytes: 1850000
    });
    newKey = saved.key;
  }
  run(
    'UPDATE users SET insurance_key = ?, insurance_file = NULL, insurance_file_name = ?, insurance_updated_at = ?, updated_at = ? WHERE id = ?',
    newKey,
    newKey ? (fileName || null) : null,
    newKey ? ts : null,
    ts,
    uid
  );
  if (prev && prev.insurance_key && prev.insurance_key !== newKey) {
    storage.deleteObject(prev.insurance_key);
  }
  return findById(uid);
}

function getUserPhoto(id) {
  const row = get('SELECT id, avatar_key, avatar_photo, avatar_updated_at FROM users WHERE id = ?', Number(id));
  if (!row) return null;
  if (row.avatar_key) {
    const obj = storage.getObject(row.avatar_key);
    if (obj) {
      return {
        has_photo: true,
        buffer: obj.buffer,
        mime: obj.mime,
        etag: obj.etag,
        photo_data: storage.toDataUrl(obj.buffer, obj.mime),
        storage_url: storage.signedPublicUrl(row.avatar_key, { ownerId: row.id }),
        updated_at: row.avatar_updated_at || null
      };
    }
  }
  if (row.avatar_photo) {
    return {
      has_photo: true,
      buffer: null,
      mime: null,
      etag: null,
      photo_data: row.avatar_photo,
      storage_url: null,
      updated_at: row.avatar_updated_at || null
    };
  }
  return { has_photo: false, buffer: null, mime: null, etag: null, photo_data: null, storage_url: null, updated_at: null };
}

function setUserPhoto(id, photoData = null) {
  const uid = Number(id);
  const prev = get('SELECT avatar_key FROM users WHERE id = ?', uid);
  const ts = now();
  let newKey = null;
  if (photoData) {
    const saved = storage.putDataUrl('avatars', photoData, {
      allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 1050000
    });
    newKey = saved.key;
  }
  run(
    'UPDATE users SET avatar_key = ?, avatar_photo = NULL, avatar_updated_at = ?, updated_at = ? WHERE id = ?',
    newKey,
    newKey ? ts : null,
    ts,
    uid
  );
  if (prev && prev.avatar_key && prev.avatar_key !== newKey) {
    storage.deleteObject(prev.avatar_key);
  }
  return findById(uid);
}

function deleteUser(id) {
  const uid = Number(id);
  const prev = get('SELECT avatar_key, insurance_key FROM users WHERE id = ?', uid);
  const recs = all('SELECT receipt_key FROM tuition_receipts WHERE user_id = ? AND receipt_key IS NOT NULL', uid);
  run('DELETE FROM users WHERE id = ?', uid);
  if (prev && prev.avatar_key) storage.deleteObject(prev.avatar_key);
  if (prev && prev.insurance_key) storage.deleteObject(prev.insurance_key);
  for (const r of recs) {
    if (r.receipt_key) storage.deleteObject(r.receipt_key);
  }
}

function listMembers(query = {}) {
  const where = ["role = 'member'", 'verified = 1'];
  const params = [];
  if (query.q) {
    where.push('(full_name LIKE ? OR username LIKE ? OR phone LIKE ?)');
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }
  if (query.belt) { where.push('belt = ?'); params.push(query.belt); }
  if (query.active !== undefined) { where.push('active = ?'); params.push(query.active ? 1 : 0); }
  return all(
    `SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY
       CASE WHEN active = 1 THEN 0 ELSE 1 END, full_name COLLATE NOCASE`,
    ...params
  );
}

/* --------------------------------- نشست‌ها -------------------------------- */

let _lastSessionPrune = 0;
function createSession(userId, site, days = 30) {
  const token = crypto.randomBytes(32).toString('hex');
  const ts = now();
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  if (Date.now() - _lastSessionPrune > 300000) {
    _lastSessionPrune = Date.now();
    try { run('DELETE FROM sessions WHERE expires_at <= ?', ts); } catch { /* ignore */ }
  }
  run('INSERT INTO sessions (token, user_id, site, created_at, expires_at) VALUES (?,?,?,?,?)',
    token, Number(userId), site, ts, expires);
  return { token, expires };
}

function sessionUser(token, site) {
  if (!token) return null;
  const row = get(
    `SELECT s.*, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.site = ? AND s.expires_at > ?`,
    token, site, now()
  );
  if (!row) return null;
  const user = findById(row.user_id);
  if (!user || !user.active) return null;
  user.impersonated = !!row.impersonated;
  return user;
}

function renewSession(token, site) {
  if (!token) return null;
  const ts = now();
  const row = get(`SELECT s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.site=? AND s.expires_at>? AND s.impersonated=0 AND u.active=1`, token, site, ts);
  if (!row) return null;
  const expires = new Date(Date.now() + lifetimeSeconds(site) * 1000).toISOString();
  if (Date.parse(row.expires_at) > Date.parse(expires) - RENEW_INTERVAL_SECONDS * 1000) return null;
  // A concurrent logout/password reset must never be undone by renewing a token.
  const result = run(`UPDATE sessions SET expires_at=? WHERE token=? AND site=?
    AND expires_at>? AND impersonated=0 AND user_id IN (SELECT id FROM users WHERE active=1)`, expires, token, site, ts);
  return Number(result.changes) ? { expires } : null;
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

function setPassword(userId, password) {
  const { hash, salt } = hashPassword(password);
  run('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?', hash, salt, now(), Number(userId));
  run('DELETE FROM sessions WHERE user_id = ?', Number(userId));
}

/* ------------------------------- اطلاعیه‌ها ------------------------------- */

function createAnnouncement({ author_id, title, body, category = 'عمومی', pinned = 0, targets = [] }) {
  const info = run(
    'INSERT INTO announcements (author_id, title, body, category, pinned, target_all, created_at) VALUES (?,?,?,?,?,?,?)',
    author_id || null, title, body || '', category, pinned ? 1 : 0, targets.length ? 0 : 1, now()
  );
  const id = Number(info.lastInsertRowid);
  for (const uid of targets) {
    run('INSERT OR IGNORE INTO announcement_targets (announcement_id, user_id) VALUES (?,?)', id, Number(uid));
  }
  notifyTargets(id, {
    type: 'announcement',
    title: `اطلاعیه جدید: ${title}`,
    body: (body || '').slice(0, 140),
    targets,
    all: targets.length === 0
  });
  return getAnnouncement(id);
}

function notifyTargets(_announcementId, { type, title, body, targets, all }) {
  const users = all ? listMembers({ active: 1 }) : targets.map((t) => findById(t)).filter(Boolean);
  for (const u of users) {
    run('INSERT INTO notifications (user_id, type, title, body, read, created_at) VALUES (?,?,?,?,0,?)',
      u.id, type, title, body || null, now());
  }
}

function getAnnouncement(id) {
  const a = get('SELECT * FROM announcements WHERE id = ?', Number(id));
  if (!a) return null;
  a.targets = all('SELECT user_id FROM announcement_targets WHERE announcement_id = ?', a.id).map((r) => r.user_id);
  a.author = a.author_id ? (get('SELECT full_name FROM users WHERE id = ?', a.author_id) || {}).full_name : null;
  a.read_count = get('SELECT COUNT(*) AS c FROM announcement_reads WHERE verified=1 AND announcement_id = ?', a.id).c;
  a.reach = a.target_all ? listMembers({ active: 1 }).length : a.targets.length;
  return a;
}

function listAnnouncements() {
  return all('SELECT * FROM announcements WHERE verified=1 ORDER BY pinned DESC, created_at DESC').map((a) => getAnnouncement(a.id));
}

function announcementsFor(userId) {
  return all(
    `SELECT a.* FROM announcements a
     LEFT JOIN announcement_targets t ON t.announcement_id = a.id
     WHERE a.verified=1 AND (a.target_all = 1 OR t.user_id = ?)
     GROUP BY a.id ORDER BY a.pinned DESC, a.created_at DESC`,
    Number(userId)
  ).map((a) => {
    const read = get('SELECT id FROM announcement_reads WHERE verified=1 AND announcement_id = ? AND user_id = ?', a.id, Number(userId));
    a.read = !!read;
    a.author = a.author_id ? (get('SELECT full_name FROM users WHERE id = ?', a.author_id) || {}).full_name : null;
    return a;
  });
}

function markAnnouncementRead(id, userId) {
  run('UPDATE announcement_reads SET verified=1 WHERE announcement_id=? AND user_id=?',Number(id),Number(userId));
  run('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?,?,?)',
    Number(id), Number(userId), now());
}

function updateAnnouncement(id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['title', 'body', 'category', 'pinned']) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === 'pinned' ? (patch[key] ? 1 : 0) : patch[key]);
    }
  }
  if (patch.targets !== undefined) {
    fields.push('target_all = ?');
    values.push(patch.targets.length ? 0 : 1);
    run('DELETE FROM announcement_targets WHERE announcement_id = ?', Number(id));
    for (const uid of patch.targets) {
      run('INSERT OR IGNORE INTO announcement_targets (announcement_id, user_id) VALUES (?,?)', Number(id), Number(uid));
    }
  }
  if (fields.length) {
    values.push(Number(id));
    run(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  return getAnnouncement(id);
}

function deleteAnnouncement(id) {
  run('DELETE FROM announcements WHERE id = ?', Number(id));
}

/* -------------------------------- اعلان‌ها -------------------------------- */

function pushNotification(userId, { type, title, body }) {
  run('INSERT INTO notifications (user_id, type, title, body, read, created_at) VALUES (?,?,?,?,0,?)',
    Number(userId), type, title, body || null, now());
}

function notificationsFor(userId, limit = 40) {
  return all('SELECT * FROM notifications WHERE verified=1 AND user_id = ? ORDER BY created_at DESC LIMIT ?', Number(userId), Number(limit));
}

function unreadCount(userId) {
  return get('SELECT COUNT(*) AS c FROM notifications WHERE verified=1 AND user_id = ? AND read = 0', Number(userId)).c;
}

function markNotificationsRead(userId) {
  run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', Number(userId));
}

function markNotificationRead(id, userId) {
  const res = run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', Number(id), Number(userId));
  return Number(res.changes) > 0;
}

/* ----------------------------- حضور و غیاب و شهریه ----------------------------- */

function recordAttendance({ user_id, session_date, status, note }, recorded_by) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session_date || ''))) {
    throw Object.assign(new Error('تاریخ جلسه نامعتبر است'), { status: 400 });
  }
  if (!['present', 'absent', 'excused'].includes(status)) {
    throw Object.assign(new Error('وضعیت حضور نامعتبر است'), { status: 400 });
  }
  const ts = now();
  const cleanNote = note ? String(note).trim().slice(0, 300) : null;
  const existing = get('SELECT id FROM member_attendance WHERE user_id = ? AND session_date = ?', Number(user_id), session_date);
  if (existing) {
    run('UPDATE member_attendance SET status = ?, note = ?, recorded_by = ?, updated_at = ? WHERE id = ?',
      status, cleanNote, recorded_by || null, ts, existing.id);
    return get('SELECT * FROM member_attendance WHERE id = ?', existing.id);
  }
  const info = run(
    'INSERT INTO member_attendance (user_id, session_date, status, note, recorded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    Number(user_id), session_date, status, cleanNote, recorded_by || null, ts, ts
  );
  return get('SELECT * FROM member_attendance WHERE id = ?', Number(info.lastInsertRowid));
}

function listAttendanceByDate(session_date) {
  return all(
    `SELECT a.*, u.full_name, u.belt, u.discipline
     FROM member_attendance a
     JOIN users u ON u.id = a.user_id
     WHERE a.session_date = ? AND u.verified = 1 AND u.role = 'member'`,
    session_date
  );
}

function consecutiveAbsences(userId) {
  const rows = all(
    'SELECT status FROM member_attendance WHERE user_id = ? ORDER BY session_date DESC LIMIT 12',
    Number(userId)
  );
  let streak = 0;
  for (const r of rows) {
    if (r.status === 'absent') streak += 1;
    else break;
  }
  return streak;
}

function createTuitionReceipt({ user_id, year, month, amount_toman, card_last4, tracking_code, receipt_image, note }) {
  const ts = now();
  let receiptKey = null;
  if (receipt_image) {
    const saved = storage.putDataUrl('receipts', receipt_image, {
      allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 1350000
    });
    receiptKey = saved.key;
  }
  const info = run(
    `INSERT INTO tuition_receipts (user_id, year, month, amount_toman, card_last4, tracking_code, receipt_key, receipt_image, note, status, created_at)
     VALUES (?,?,?,?,?,?,?,NULL,?, 'pending', ?)`,
    Number(user_id), Number(year), Number(month), Number(amount_toman),
    card_last4 || null, String(tracking_code).trim(), receiptKey,
    note ? String(note).trim().slice(0, 500) : null, ts
  );
  const row = get(
    `SELECT id, user_id, year, month, amount_toman, card_last4, tracking_code, note, status, coach_note, reviewed_by, reviewed_at, created_at,
            (receipt_key IS NOT NULL OR (receipt_image IS NOT NULL AND receipt_image != '')) AS has_receipt_image
     FROM tuition_receipts WHERE id = ?`,
    Number(info.lastInsertRowid)
  );
  if (row) row.has_receipt_image = !!row.has_receipt_image;
  return row;
}

function getTuitionReceiptImage(id) {
  const row = get('SELECT id, user_id, year, month, receipt_key, receipt_image FROM tuition_receipts WHERE id = ?', Number(id));
  if (!row) return null;
  if (row.receipt_key) {
    const obj = storage.getObject(row.receipt_key);
    if (obj) {
      return {
        receipt: { id: row.id, user_id: row.user_id, year: row.year, month: row.month },
        buffer: obj.buffer,
        mime: obj.mime,
        etag: obj.etag,
        storage_url: storage.signedPublicUrl(row.receipt_key, { ownerId: row.user_id })
      };
    }
  }
  if (row.receipt_image) {
    return {
      receipt: { id: row.id, user_id: row.user_id, year: row.year, month: row.month },
      dataUrl: row.receipt_image,
      buffer: null,
      mime: null,
      etag: null,
      storage_url: null
    };
  }
  return { receipt: { id: row.id, user_id: row.user_id, year: row.year, month: row.month }, buffer: null, mime: null, etag: null, dataUrl: null, storage_url: null };
}

function listTuitionReceipts({ user_id, status, year, month, limit = 100 } = {}) {
  const where = ['u.verified = 1'];
  const params = [];
  if (user_id !== undefined) { where.push('r.user_id = ?'); params.push(Number(user_id)); }
  if (status) { where.push('r.status = ?'); params.push(status); }
  if (year) { where.push('r.year = ?'); params.push(Number(year)); }
  if (month) { where.push('r.month = ?'); params.push(Number(month)); }
  params.push(Number(limit));
  return all(
    `SELECT r.id, r.user_id, r.year, r.month, r.amount_toman, r.card_last4, r.tracking_code,
            r.note, r.status, r.coach_note, r.reviewed_by, r.reviewed_at, r.created_at,
            (r.receipt_key IS NOT NULL OR (r.receipt_image IS NOT NULL AND r.receipt_image != '')) AS has_receipt_image,
            u.full_name, u.username, u.discipline, u.belt, u.avatar_color,
            (u.avatar_key IS NOT NULL OR (u.avatar_photo IS NOT NULL AND u.avatar_photo != '')) AS has_photo,
            u.avatar_updated_at AS photo_updated_at,
            rv.full_name AS reviewer_name
     FROM tuition_receipts r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN users rv ON rv.id = r.reviewed_by
     WHERE ${where.join(' AND ')}
     ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, r.created_at DESC
     LIMIT ?`,
    ...params
  ).map((r) => ({ ...r, has_receipt_image: !!r.has_receipt_image, has_photo: !!r.has_photo }));
}

function reviewTuitionReceipt(id, { status, coach_note }, coach_id) {
  if (!['approved', 'rejected'].includes(status)) {
    throw Object.assign(new Error('وضعیت بررسی نامعتبر است'), { status: 400 });
  }
  const existing = get('SELECT id FROM tuition_receipts WHERE id = ?', Number(id));
  if (!existing) return null;
  run(
    'UPDATE tuition_receipts SET status = ?, coach_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    status, coach_note ? String(coach_note).trim().slice(0, 500) : null, coach_id || null, now(), existing.id
  );
  const row = get(
    `SELECT id, user_id, year, month, amount_toman, card_last4, tracking_code, note, status, coach_note, reviewed_by, reviewed_at, created_at,
            (receipt_key IS NOT NULL OR (receipt_image IS NOT NULL AND receipt_image != '')) AS has_receipt_image
     FROM tuition_receipts WHERE id = ?`,
    existing.id
  );
  if (row) row.has_receipt_image = !!row.has_receipt_image;
  return row;
}

function memberCareStatus(userId, jy, jm, jd) {
  const rows = all(
    'SELECT id, status, amount_toman, tracking_code, created_at FROM tuition_receipts WHERE user_id = ? AND year = ? AND month = ? ORDER BY created_at DESC',
    Number(userId), Number(jy), Number(jm)
  );
  const approved = rows.find((r) => r.status === 'approved');
  const pending = rows.find((r) => r.status === 'pending');
  let tuition_status = 'unpaid';
  if (approved) tuition_status = 'paid';
  else if (pending) tuition_status = 'pending';
  else if (jd > 12) tuition_status = 'overdue';
  else if (jd >= 9) tuition_status = 'due_soon';

  const absences = consecutiveAbsences(userId);
  return {
    tuition_status,
    consecutive_absences: absences,
    needs_tuition_followup: tuition_status === 'due_soon' || tuition_status === 'overdue' || tuition_status === 'unpaid',
    needs_absence_followup: absences >= 2,
    pending_receipts: rows.filter((r) => r.status === 'pending').length,
    latest_receipt: rows[0] || null
  };
}

/* -------------------------------- تمرینات -------------------------------- */

function createPlan({ author_id, title, body, category, difficulty, starts_on, due_on, duration, targets = [], all_members = false, sport = null }) {
  const info = run(
    `INSERT INTO plans (author_id, title, body, category, difficulty, starts_on, due_on, duration, target_all, created_at, sport)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    author_id || null, title, body || '', category || 'تمرین', difficulty || 'متوسط',
    starts_on || null, due_on || null, duration || null, all_members || targets.length === 0 ? 1 : 0, now(), sport || null
  );
  const id = Number(info.lastInsertRowid);
  const ids = all_members || targets.length === 0 ? listMembers({ active: 1 }).map((m) => m.id) : targets;
  for (const uid of ids) {
    run('INSERT OR IGNORE INTO plan_assignments (plan_id, user_id, status, assigned_at) VALUES (?,?,?,?)',
      id, Number(uid), 'todo', now());
    pushNotification(uid, {
      type: 'plan',
      title: `تمرین جدید: ${title}`,
      body: 'برای دیدن جزئیات به بخش تمرینات من بروید.'
    });
  }
  return getPlan(id);
}

function getPlan(id) {
  const p = get('SELECT * FROM plans WHERE id = ?', Number(id));
  if (!p) return null;
  p.assignments = all(
    `SELECT pa.*, u.full_name, u.belt, u.avatar_color FROM plan_assignments pa
     JOIN users u ON u.id = pa.user_id WHERE pa.verified=1 AND u.verified=1 AND pa.plan_id = ? ORDER BY u.full_name COLLATE NOCASE`,
    p.id
  );
  p.done_count = p.assignments.filter((a) => a.status === 'done').length;
  p.total = p.assignments.length;
  p.author = p.author_id ? (get('SELECT full_name FROM users WHERE id = ?', p.author_id) || {}).full_name : null;
  return p;
}

function listPlans() {
  return all('SELECT * FROM plans WHERE verified=1 ORDER BY created_at DESC').map((p) => getPlan(p.id));
}

function updatePlan(id, patch) {
  const fields = [];
  const values = [];
  for (const key of ['title', 'body', 'category', 'difficulty', 'starts_on', 'due_on', 'duration']) {
    if (patch[key] !== undefined) { fields.push(`${key} = ?`); values.push(patch[key] === '' ? null : patch[key]); }
  }
  if (fields.length) {
    values.push(Number(id));
    run(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  return getPlan(id);
}

function deletePlan(id) { run('DELETE FROM plans WHERE id = ?', Number(id)); }

function plansForUser(userId) {
  const rows = all(
    `SELECT pa.*, p.title, p.body, p.category, p.difficulty, p.starts_on, p.due_on, p.duration, p.created_at AS plan_created_at
     FROM plan_assignments pa JOIN plans p ON p.id = pa.plan_id
     WHERE pa.verified=1 AND p.verified=1 AND pa.user_id = ? ORDER BY
       CASE pa.status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END,
       COALESCE(p.due_on, '9999') ASC, p.created_at DESC`,
    Number(userId)
  );
  return rows;
}

function setAssignmentStatus(assignmentId, userId, status, note) {
  const a = get('SELECT * FROM plan_assignments WHERE id = ? AND user_id = ?', Number(assignmentId), Number(userId));
  if (!a) return null;
  run('UPDATE plan_assignments SET verified=1, status = ?, completed_at = ?, member_note = ? WHERE id = ?',
    status, status === 'done' ? now() : null, note === undefined ? a.member_note : note, a.id);
  const plan = get('SELECT title FROM plans WHERE id = ?', a.plan_id);
  const member = findById(userId);
  if (status === 'done') {
    logActivity(userId, member ? member.full_name : 'شاگرد', 'تمرین را تکمیل کرد', plan ? plan.title : null);
    for (const coach of all("SELECT id FROM users WHERE role = 'coach' AND active = 1")) {
      pushNotification(coach.id, {
        type: 'done',
        title: `${member ? member.full_name : 'شاگرد'} تمرین را تکمیل کرد`,
        body: plan ? plan.title : null
      });
    }
  }
  return get('SELECT * FROM plan_assignments WHERE id = ?', a.id);
}

/* ------------------------------- جدول پیشرفت ------------------------------ */

const METRIC_KEYS = ['sessions', 'endurance', 'strength', 'technique', 'flexibility', 'discipline'];

function computeOverall(row) {
  if (row.overall !== null && row.overall !== undefined) return Number(row.overall);
  const vals = ['endurance', 'strength', 'technique', 'flexibility', 'discipline']
    .map((k) => row[k])
    .filter((v) => v !== null && v !== undefined && v !== '');
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, v) => s + Number(v), 0) / vals.length);
}

function progressRow(userId, year, month) {
  const row = get('SELECT * FROM progress WHERE user_id = ? AND year = ? AND month = ?',
    Number(userId), Number(year), Number(month));
  return row;
}

function progressYear(userId, year) {
  const rows = all('SELECT * FROM progress WHERE verified=1 AND user_id = ? AND year = ? ORDER BY month',
    Number(userId), Number(year));
  const map = {};
  for (const r of rows) {
    r.overall = computeOverall(r);
    map[r.month] = r;
  }
  return { months: map, rows };
}

function saveProgress({ user_id, year, month, sessions, endurance, strength, technique, flexibility, discipline, weight_kg, overall, note }, updated_by) {
  const invalid = message => { throw Object.assign(new Error(message),{status:400}); };
  if (!Number.isInteger(Number(year)) || Number(year)<1300 || Number(year)>1600 || !Number.isInteger(Number(month)) || Number(month)<1 || Number(month)>12) invalid('سال و ماه معتبر نیست');
  for (const [key,value] of Object.entries({sessions,endurance,strength,technique,flexibility,discipline,weight_kg,overall})) {
    if (value===null || value===undefined || value==='') continue;
    const n=Number(value), max=key==='sessions'?1000:key==='weight_kg'?400:100;
    if (!Number.isFinite(n) || n<0 || n>max || (key==='sessions'&&!Number.isInteger(n))) invalid('مقدار شاخص '+key+' معتبر نیست');
  }
  const existing = progressRow(user_id, year, month);
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const payload = {
    sessions: num(sessions),
    endurance: num(endurance),
    strength: num(strength),
    technique: num(technique),
    flexibility: num(flexibility),
    discipline: num(discipline),
    weight_kg: num(weight_kg),
    overall: num(overall),
    note: note === undefined ? null : note
  };
  if (existing) {
    run(`UPDATE progress SET verified=1, sessions=?, endurance=?, strength=?, technique=?, flexibility=?, discipline=?,
         weight_kg=?, overall=?, note=?, updated_by=?, updated_at=? WHERE id=?`,
    payload.sessions, payload.endurance, payload.strength, payload.technique, payload.flexibility,
    payload.discipline, payload.weight_kg, payload.overall, payload.note, updated_by || null, now(), existing.id);
  } else {
    run(`INSERT INTO progress (user_id, year, month, sessions, endurance, strength, technique, flexibility,
         discipline, weight_kg, overall, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    Number(user_id), Number(year), Number(month), payload.sessions, payload.endurance, payload.strength,
    payload.technique, payload.flexibility, payload.discipline, payload.weight_kg, payload.overall,
    payload.note, updated_by || null, now());
  }
  const saved = progressRow(user_id, year, month);
  saved.overall = computeOverall(saved);
  return saved;
}

function deleteProgress(id) { run('DELETE FROM progress WHERE id = ?', Number(id)); }

function saveSelfReport({ user_id, year, month, sessions, feeling, note }) {
  const existing = get('SELECT id FROM self_reports WHERE user_id = ? AND year = ? AND month = ?',
    Number(user_id), Number(year), Number(month));
  if (existing) {
    run('UPDATE self_reports SET verified=1, sessions=?, feeling=?, note=?, created_at=? WHERE id=?',
      Number(sessions) || 0, feeling || null, note || null, now(), existing.id);
  } else {
    run('INSERT INTO self_reports (user_id, year, month, sessions, feeling, note, created_at) VALUES (?,?,?,?,?,?,?)',
      Number(user_id), Number(year), Number(month), Number(sessions) || 0, feeling || null, note || null, now());
  }
  const member = findById(user_id);
  for (const coach of all("SELECT id FROM users WHERE role = 'coach' AND active = 1")) {
    pushNotification(coach.id, {
      type: 'self_report',
      title: `${member ? member.full_name : 'شاگرد'} خودارزیابی ثبت کرد`,
      body: `ماه ${month} سال ${year}`
    });
  }
  return get('SELECT * FROM self_reports WHERE user_id = ? AND year = ? AND month = ?', Number(user_id), Number(year), Number(month));
}

function clubMatrix(year) {
  const members = listMembers({ active: 1 });
  return members.map((m) => {
    const { months, rows } = progressYear(m.id, year);
    const filled = rows.filter((r) => r.overall !== null);
    const avg = filled.length ? Math.round(filled.reduce((s, r) => s + r.overall, 0) / filled.length) : null;
    const last = [...rows].sort((a, b) => b.month - a.month)[0] || null;
    return { member: publicUser(m), months, avg, last_overall: last ? last.overall : null, filled: filled.length };
  });
}

/* -------------------------------- فعالیت‌ها ------------------------------- */

function logActivity(actor_id, actor_name, action, detail) {
  run('INSERT INTO activity (actor_id, actor_name, action, detail, created_at) VALUES (?,?,?,?,?)',
    actor_id || null, actor_name || null, action, detail || null, now());
}

function recentActivity(limit = 12) {
  return all('SELECT * FROM activity WHERE verified=1 ORDER BY created_at DESC LIMIT ?', Number(limit));
}

/* -------------------------------- آمار کلی -------------------------------- */

function stats() {
  const members = get("SELECT COUNT(*) AS c FROM users WHERE verified=1 AND role = 'member'").c;
  const activeMembers = get("SELECT COUNT(*) AS c FROM users WHERE verified=1 AND role = 'member' AND active = 1").c;
  const plans = get('SELECT COUNT(*) AS c FROM plans WHERE verified=1').c;
  const done = get("SELECT COUNT(*) AS c FROM plan_assignments WHERE verified=1 AND plan_id IN (SELECT id FROM plans WHERE verified=1) AND user_id IN (SELECT id FROM users WHERE verified=1) AND status = 'done'").c;
  const pending = get("SELECT COUNT(*) AS c FROM plan_assignments WHERE verified=1 AND plan_id IN (SELECT id FROM plans WHERE verified=1) AND user_id IN (SELECT id FROM users WHERE verified=1) AND status != 'done'").c;
  const announcements = get('SELECT COUNT(*) AS c FROM announcements WHERE verified=1').c;
  const selfReports = get('SELECT COUNT(*) AS c FROM self_reports WHERE verified=1').c;
  const j = require('./jalali').todayJalali();
  const thisMonth = get(`SELECT COUNT(*) AS c FROM progress WHERE verified=1 AND user_id IN (SELECT id FROM users WHERE verified=1 AND role='member') AND year = ? AND month = ?`, j.jy, j.jm).c;
  return { members, activeMembers, plans, done, pending, announcements, selfReports, thisMonth };
}

/* --------------------------------- API Keys -------------------------------- */

function createApiKey(userId, name = 'default', permissions = 'read') {
  const key = 'arslan_' + crypto.randomBytes(32).toString('hex');
  run('INSERT INTO api_keys (key, user_id, name, permissions, created_at) VALUES (?,?,?,?,?)',
    key, Number(userId), name, permissions, now());
  return { key, name, permissions };
}

function apiKeyUser(key) {
  if (!key || !key.startsWith('arslan_')) return null;
  const row = get(
    'SELECT ak.*, u.role FROM api_keys ak JOIN users u ON u.id = ak.user_id WHERE ak.key = ? AND ak.active = 1',
    key
  );
  if (!row) return null;
  run('UPDATE api_keys SET last_used = ? WHERE key = ?', now(), key);
  const user = findById(row.user_id);
  if (!user || !user.active) return null;
  user.apiPermissions = row.permissions;
  return user;
}

function listApiKeys(userId) {
  return all('SELECT id, key, name, permissions, created_at, last_used FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', Number(userId));
}

function deleteApiKey(keyId, userId) {
  run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', Number(keyId), Number(userId));
}

function revokeApiKey(keyId, userId) {
  run('UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?', Number(keyId), Number(userId));
}

module.exports = {
  db, DB_PATH, DATA_DIR, storage, sleepSync, execWithRetry,
  all, get, run, now,
  hashPassword, verifyPassword,
  findByUsername, findByEmail, normalizeEmail, findById, publicUser, createUser, updateUser, deleteUser, listMembers,
  getUserInsurance, setUserInsurance,
  getUserPhoto, setUserPhoto,
  ONLINE_WINDOW_MS, isUserOnline, touchUserPresence, clearUserPresence,
  createSession, sessionUser, renewSession, destroySession, setPassword,
  createAnnouncement, getAnnouncement, listAnnouncements, announcementsFor,
  markAnnouncementRead, updateAnnouncement, deleteAnnouncement,
  pushNotification, notificationsFor, unreadCount, markNotificationsRead, markNotificationRead,
  recordAttendance, listAttendanceByDate, consecutiveAbsences,
  createTuitionReceipt, getTuitionReceiptImage, listTuitionReceipts, reviewTuitionReceipt, memberCareStatus,
  createPlan, getPlan, listPlans, updatePlan, deletePlan, plansForUser, setAssignmentStatus,
  METRIC_KEYS, computeOverall, progressRow, progressYear, saveProgress, deleteProgress,
  saveSelfReport, clubMatrix, logActivity, recentActivity, stats,
  createApiKey, apiKeyUser, listApiKeys, deleteApiKey, revokeApiKey
};
