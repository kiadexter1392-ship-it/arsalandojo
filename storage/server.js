'use strict';
/*
 * سرویس مستقل ذخیره‌سازی و تحویل فایل‌های باشگاه ارسلان دوجو (بخش دوم معماری)
 * - فایل‌ها کاملاً خارج از دامنهٔ وب و روت استاتیک نگهداری می‌شوند
 * - تحویل مستقیم فقط با توکن امضاشدهٔ کوتاه‌مدت (/s/:token)
 * - نوشتن/حذف فقط برای سرویس‌های داخلی احراز هویت‌شده با X-Storage-Auth
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { readStoragePort } = require('../shared/ports');
const storage = require('../shared/storage');

const PORT = readStoragePort();
const AUTH_SECRET = storage.getStorageSecret();
const HOST = process.env.STORAGE_BIND_HOST || '127.0.0.1';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Content-Security-Policy': "default-src 'none'; sandbox"
};

function timingSafeMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sendJson(res, status, data) {
  const buf = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS
  });
  res.end(buf);
}

function readRawBody(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createStorageHttpServer() {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(res, 400, { ok: false, error: 'نشانی نامعتبر' });
    }
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && url.pathname === '/healthz') {
      const stats = storage.storageStats();
      return sendJson(res, 200, { ok: true, service: 'storage', files: stats.files, bytes: stats.bytes });
    }

    // Public/Cross-Origin read ONLY via cryptographic expiring HMAC token
    if ((method === 'GET' || method === 'HEAD') && url.pathname.startsWith('/s/')) {
      const token = decodeURIComponent(url.pathname.slice(3));
      const verified = storage.verifyAccessToken(token);
      if (!verified) return sendJson(res, 403, { ok: false, error: 'لینک فایل نامعتبر یا منقضی است' });
      const obj = storage.getObject(verified.key);
      if (!obj) return sendJson(res, 404, { ok: false, error: 'فایل پیدا نشد' });

      if (req.headers['if-none-match'] === obj.etag) {
        res.writeHead(304, { ETag: obj.etag, 'Cache-Control': 'private, max-age=120', ...SECURITY_HEADERS });
        return res.end();
      }
      const disp = obj.mime === 'application/pdf' ? 'attachment' : 'inline';
      res.writeHead(200, {
        'Content-Type': obj.mime,
        'Content-Length': obj.size,
        'Content-Disposition': disp,
        ETag: obj.etag,
        'Cache-Control': 'private, max-age=120',
        ...SECURITY_HEADERS
      });
      return method === 'HEAD' ? res.end() : res.end(obj.buffer);
    }

    // Internal authenticated management routes
    if (url.pathname.startsWith('/internal/')) {
      const auth = String(req.headers['x-storage-auth'] || '');
      if (!timingSafeMatch(auth, AUTH_SECRET)) {
        return sendJson(res, 401, { ok: false, error: 'Unauthorized storage access' });
      }
      if (method === 'GET' && url.pathname === '/internal/stats') {
        return sendJson(res, 200, { ok: true, ...storage.storageStats() });
      }
      if (method === 'POST' && url.pathname === '/internal/objects') {
        try {
          const raw = await readRawBody(req);
          const body = JSON.parse(raw.toString('utf8'));
          const saved = storage.putDataUrl(body.bucket, body.dataUrl, {
            allowedMimes: Array.isArray(body.allowedMimes) ? body.allowedMimes : ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
            maxBytes: Number(body.maxBytes) || 2000000
          });
          return sendJson(res, 201, { ok: true, object: saved });
        } catch (err) {
          return sendJson(res, err.status || 400, { ok: false, error: err.message || 'Invalid object' });
        }
      }
      if (method === 'DELETE' && url.pathname === '/internal/objects') {
        const key = url.searchParams.get('key') || '';
        const removed = storage.deleteObject(key);
        return sendJson(res, 200, { ok: true, removed });
      }
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  });
}

if (require.main === module) {
  if (!PORT) {
    console.log('[storage] STORAGE_PORT=0 — سرویس مستقل غیرفعال');
    process.exit(0);
  }
  const server = createStorageHttpServer();
  server.listen(PORT, HOST, () => {
    console.log(`[storage] آماده روی http://${HOST}:${PORT}`);
  });
}

module.exports = { createStorageHttpServer };
