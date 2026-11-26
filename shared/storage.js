'use strict';
/*
 * فضای ذخیره‌سازی اختصاصی و ایزوله (خارج از دامنهٔ وب و خارج از SQLite)
 * - بررسی بایت‌های واقعی فایل (Magic Bytes) برای جلوگیری از تزریق فایل‌های جعلی
 * - ذخیره روی دیسک با کلیدهای تصادفی رمزنگاری‌شده و سطح دسترسی ۰۷۰۰/۰۶۰۰
 * - صدور توکن امضاشدهٔ HMAC-SHA256 با انقضای کوتاه‌مدت برای دسترسی امن یا دامنهٔ فایل جداگانه
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.ARSLAN_DATA_DIR || path.join(__dirname, '..', 'data');
const STORAGE_DIR = path.resolve(process.env.ARSLAN_STORAGE_DIR || path.join(DATA_DIR, 'storage'));
const KEY_FILE = path.join(DATA_DIR, '.storage.key');

const ALLOWED_BUCKETS = new Set(['avatars', 'insurance', 'receipts']);
const EXT_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(STORAGE_DIR, 0o700); } catch { /* Windows or restricted FS */ }

let _cachedSecret = null;
function getStorageSecret() {
  if (_cachedSecret) return _cachedSecret;
  if (process.env.ARSLAN_STORAGE_SECRET && process.env.ARSLAN_STORAGE_SECRET.length >= 16) {
    _cachedSecret = process.env.ARSLAN_STORAGE_SECRET;
    return _cachedSecret;
  }
  try {
    const existing = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (existing.length >= 32) {
      _cachedSecret = existing;
      return _cachedSecret;
    }
  } catch { /* create new key below */ }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(KEY_FILE, generated, { mode: 0o600, flag: 'wx' });
    _cachedSecret = generated;
  } catch {
    try {
      _cachedSecret = fs.readFileSync(KEY_FILE, 'utf8').trim() || generated;
    } catch {
      _cachedSecret = generated;
    }
  }
  return _cachedSecret;
}

function inspectBinary(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return 'image/jpeg';
  }
  // WebP: "RIFF" .... "WEBP"
  if (buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // PDF: "%PDF-"
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

function parseDataUrl(dataUrl, { allowedMimes = ['image/png', 'image/jpeg', 'image/webp'], maxBytes = 1500000 } = {}) {
  const raw = String(dataUrl || '').trim();
  const match = /^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match) {
    throw Object.assign(new Error('فرمت فایل مجاز نیست'), { status: 400 });
  }
  const declaredMime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  if (!allowedMimes.includes(declaredMime)) {
    throw Object.assign(new Error('نوع فایل برای این بخش مجاز نیست'), { status: 400 });
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > maxBytes) {
    throw Object.assign(new Error('حجم فایل خارج از محدوده مجاز است'), { status: 400 });
  }
  const actualMime = inspectBinary(buffer);
  if (!actualMime || actualMime !== declaredMime || !allowedMimes.includes(actualMime)) {
    throw Object.assign(new Error('محتوای واقعی فایل با پسوند و فرمت اعلام‌شده مطابقت ندارد'), { status: 400 });
  }
  return {
    mime: actualMime,
    ext: MIME_TO_EXT[actualMime],
    buffer
  };
}

function resolveSafeKey(key) {
  if (typeof key !== 'string') return null;
  const normalized = key.replace(/\\/g, '/').trim();
  const parts = normalized.split('/');
  if (parts.length !== 3) return null;
  const [bucket, ym, filename] = parts;
  if (!ALLOWED_BUCKETS.has(bucket)) return null;
  if (!/^\d{6}$/.test(ym)) return null;
  if (!/^[a-f0-9]{24,64}\.(png|jpg|webp|pdf)$/.test(filename)) return null;
  const fullPath = path.resolve(STORAGE_DIR, bucket, ym, filename);
  if (!fullPath.startsWith(STORAGE_DIR + path.sep)) return null;
  return { key: `${bucket}/${ym}/${filename}`, bucket, ym, filename, fullPath };
}

function putObject(bucket, buffer, mime) {
  if (!ALLOWED_BUCKETS.has(bucket)) {
    throw Object.assign(new Error('مخزن فایل نامعتبر است'), { status: 400 });
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('دادهٔ فایل نامعتبر است'), { status: 400 });
  }
  const actualMime = inspectBinary(buffer);
  if (!actualMime || actualMime !== mime || !MIME_TO_EXT[actualMime]) {
    throw Object.assign(new Error('محتوای باینری فایل نامعتبر است'), { status: 400 });
  }
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const ext = MIME_TO_EXT[actualMime];
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const key = `${bucket}/${ym}/${filename}`;
  const dir = path.join(STORAGE_DIR, bucket, ym);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, filename);
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  fs.renameSync(tmp, target);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { key, mime: actualMime, size: buffer.length, sha256 };
}

function putDataUrl(bucket, dataUrl, opts = {}) {
  const parsed = parseDataUrl(dataUrl, opts);
  return putObject(bucket, parsed.buffer, parsed.mime);
}

function getObject(key) {
  const safe = resolveSafeKey(key);
  if (!safe) return null;
  let stat;
  try { stat = fs.statSync(safe.fullPath); } catch { return null; }
  if (!stat.isFile()) return null;
  const buffer = fs.readFileSync(safe.fullPath);
  const ext = path.extname(safe.filename).toLowerCase();
  const mime = inspectBinary(buffer) || EXT_TO_MIME[ext] || 'application/octet-stream';
  const etag = `"${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 20)}"`;
  return { key: safe.key, mime, buffer, size: buffer.length, etag, mtimeMs: stat.mtimeMs };
}

function deleteObject(key) {
  const safe = resolveSafeKey(key);
  if (!safe) return false;
  try {
    fs.unlinkSync(safe.fullPath);
    return true;
  } catch {
    return false;
  }
}

function toDataUrl(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || !mime) return null;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function getObjectDataUrl(key) {
  const obj = getObject(key);
  if (!obj) return null;
  return toDataUrl(obj.buffer, obj.mime);
}

function signAccessToken(key, { ttlSec = 300, ownerId = null } = {}) {
  const safe = resolveSafeKey(key);
  if (!safe) throw Object.assign(new Error('کلید فایل نامعتبر است'), { status: 400 });
  const payload = {
    k: safe.key,
    exp: Math.floor(Date.now() / 1000) + Math.max(10, Math.min(3600, Math.floor(ttlSec))),
    ...(ownerId ? { uid: Number(ownerId) } : {})
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getStorageSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyAccessToken(token) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', getStorageSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || !payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
  const safe = resolveSafeKey(payload.k);
  if (!safe) return null;
  return { key: safe.key, exp: Number(payload.exp), ownerId: payload.uid || null };
}

function publicStorageBaseUrl() {
  const raw = String(process.env.STORAGE_PUBLIC_URL || process.env.ARSLAN_STORAGE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function signedPublicUrl(key, opts = {}) {
  const base = publicStorageBaseUrl();
  if (!base || !key) return null;
  return `${base}/s/${encodeURIComponent(signAccessToken(key, opts))}`;
}

function storageStats() {
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !entry.name.startsWith('.tmp-')) {
        files += 1;
        try { bytes += fs.statSync(full).size; } catch { /* ignore */ }
      }
    }
  };
  walk(STORAGE_DIR);
  return { storageDir: STORAGE_DIR, files, bytes };
}

module.exports = {
  STORAGE_DIR,
  ALLOWED_BUCKETS,
  getStorageSecret,
  inspectBinary,
  parseDataUrl,
  resolveSafeKey,
  putObject,
  putDataUrl,
  getObject,
  deleteObject,
  toDataUrl,
  getObjectDataUrl,
  signAccessToken,
  verifyAccessToken,
  publicStorageBaseUrl,
  signedPublicUrl,
  storageStats
};
