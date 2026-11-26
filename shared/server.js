'use strict';
/*
 * فریم‌ورک HTTP امن و پرسرعت:
 * مسیریابی، فشرده‌سازی Gzip، ETag/304، محافظت CSRF Same-Origin، Rate Limiter، فایل‌های استاتیک و مدیریت خطا.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const storage = require('./storage');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

const COMPRESSIBLE_EXTS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.csv']);
const LONG_CACHE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico', '.woff2']);

function parseCookies(req) {
  const raw = req.headers.cookie;
  const out = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
    }
  }
  return out;
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('حجم داده ارسالی زیاد است'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const type = String(req.headers['content-type'] || '');
      if (type.includes('application/json')) {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          reject(Object.assign(new Error('JSON نامعتبر'), { status: 400 }));
        }
      } else if (type.includes('application/x-www-form-urlencoded')) {
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      } else {
        try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
      }
    });
    req.on('error', reject);
  });
}

function matchRoute(pattern, pathname) {
  const p = pattern.split('/').filter(Boolean);
  const u = pathname.split('/').filter(Boolean);
  if (p.length !== u.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) {
      try {
        params[p[i].slice(1)] = decodeURIComponent(u[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== u[i]) {
      return null;
    }
  }
  return params;
}

const SAFE_FILE = /^[A-Za-z0-9._\-/\u0600-\u06FF ]+$/;

function parseId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/* Input sanitization */
function sanitize(input, maxLen = 5000) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/\0/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .replace(/(?:javascript|vbscript|data:text\/html)\s*:/gi, '')
    .replace(/\bon\w+\s*=/gi, '')
    .trim()
    .slice(0, maxLen);
}

function buildSecurityHeaders() {
  const storageOrigin = storage.publicStorageBaseUrl();
  const storageSrc = storageOrigin ? ` ${new URL(storageOrigin).origin}` : '';
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://accounts.google.com/gsi/style; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; img-src 'self' data: blob: https:${storageSrc}; frame-src 'self' https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/${storageSrc}; object-src 'none'; base-uri 'self'; form-action 'self';`,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Cross-Origin-Resource-Policy': 'same-site'
  };
}

const SECURITY_HEADERS = buildSecurityHeaders();

function acceptsGzip(req) {
  return String(req && req.headers && req.headers['accept-encoding'] || '').toLowerCase().includes('gzip');
}

function writeBufferCompressed(req, res, status, headers, buf, isHead = false) {
  const finalHeaders = { ...headers, ...SECURITY_HEADERS };
  if (buf.length >= 1024 && acceptsGzip(req)) {
    zlib.gzip(buf, { level: 6 }, (err, gz) => {
      if (err) {
        res.writeHead(status, { ...finalHeaders, 'Content-Length': buf.length });
        return isHead ? res.end() : res.end(buf);
      }
      res.writeHead(status, {
        ...finalHeaders,
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
        'Content-Length': gz.length
      });
      return isHead ? res.end() : res.end(gz);
    });
    return;
  }
  res.writeHead(status, { ...finalHeaders, 'Content-Length': buf.length });
  if (isHead) res.end();
  else res.end(buf);
}

// Small in-memory ETag + gzip cache for static assets to keep repeated page loads instant
const _staticCache = new Map();
const MAX_CACHED_FILE_BYTES = 512 * 1024;

function sendFile(res, filePath, status = 200, req = null) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
  } catch {
    if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('فایل پیدا نشد');
    return;
  }

  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const cacheControl = ext === '.html'
    ? 'no-store'
    : (LONG_CACHE_EXTS.has(ext) ? 'public, max-age=86400' : 'public, max-age=0, must-revalidate');

  if (req && ext !== '.html' && req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': cacheControl,
      'Vary': 'Accept-Encoding',
      ...SECURITY_HEADERS
    });
    return res.end();
  }

  const isHead = req && req.method && req.method.toUpperCase() === 'HEAD';
  const baseHeaders = {
    'Content-Type': type,
    'Cache-Control': cacheControl,
    ...(ext !== '.html' ? { 'ETag': etag } : {}),
    'Vary': 'Accept-Encoding',
    ...SECURITY_HEADERS
  };

  // Serve cached/compressed buffer for JS/CSS/SVG/HTML files up to 512KB
  if (COMPRESSIBLE_EXTS.has(ext) && stat.size <= MAX_CACHED_FILE_BYTES) {
    let entry = _staticCache.get(filePath);
    if (!entry || entry.etag !== etag) {
      try {
        const raw = fs.readFileSync(filePath);
        const gz = raw.length >= 1024 ? zlib.gzipSync(raw, { level: 6 }) : null;
        entry = { etag, raw, gz };
        if (_staticCache.size > 150) _staticCache.clear();
        _staticCache.set(filePath, entry);
      } catch {
        entry = null;
      }
    }
    if (entry) {
      if (entry.gz && req && acceptsGzip(req)) {
        res.writeHead(status, { ...baseHeaders, 'Content-Encoding': 'gzip', 'Content-Length': entry.gz.length });
        return isHead ? res.end() : res.end(entry.gz);
      }
      res.writeHead(status, { ...baseHeaders, 'Content-Length': entry.raw.length });
      return isHead ? res.end() : res.end(entry.raw);
    }
  }

  res.writeHead(status, { ...baseHeaders, 'Content-Length': stat.size });
  if (isHead) return res.end();
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('فایل پیدا نشد');
  });
  stream.pipe(res);
}

/* -------------------- Rate Limiter (در حافظه با پاک‌سازی خودکار) -------------------- */
const _rateBuckets = new Map();
function rateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const bucket = _rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + windowMs; }
  bucket.count += 1;
  _rateBuckets.set(key, bucket);
  return bucket.count <= maxAttempts;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateBuckets) {
    if (now > v.resetAt) _rateBuckets.delete(k);
  }
}, 60000).unref();

function getClientIp(req) {
  if (!req) return 'unknown';
  const xff = req.headers && req.headers['x-forwarded-for'];
  const raw = (typeof xff === 'string' && xff.split(',')[0].trim())
    || (req.headers && req.headers['x-real-ip'])
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
  return String(raw).replace(/^::ffff:/, '').trim() || 'unknown';
}

function stripUntrustedProxyHeadersIfNeeded(req) {
  const expected = process.env.ARSLAN_INTERNAL_PROXY_TOKEN || '';
  const actual = String(req.headers['x-dojo-internal'] || '');
  let trusted = false;
  if (expected) {
    const a = Buffer.from(actual, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    trusted = a.length === b.length && crypto.timingSafeEqual(a, b);
  } else {
    const remote = String(req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    trusted = remote === '127.0.0.1' || remote === '::1';
  }
  if (!trusted) {
    delete req.headers['x-dojo-proxy'];
    delete req.headers['x-dojo-mount'];
    delete req.headers['x-dojo-origin-host'];
    delete req.headers['x-dojo-internal'];
  }
}

function verifySameOrigin(ctx) {
  const req = ctx.req;
  // Requests carrying explicit API key headers are non-cookie programmatic API calls
  if (req.headers['x-api-key'] || String(req.headers['authorization'] || '').startsWith('Bearer ')) {
    return true;
  }
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (secFetchSite === 'cross-site') return false;

  const expectedHost = String(req.headers['x-dojo-origin-host'] || req.headers.host || '').toLowerCase();
  if (!expectedHost) return false;

  const origin = req.headers.origin;
  if (origin) {
    if (origin === 'null') return false;
    try {
      return new URL(origin).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }
  return true;
}

function createServer(options = {}) {
  const {
    name = 'server',
    publicDirs = [],
    cookieName = 'session',
    logger = console,
    csrfGuard = true
  } = options;

  const routes = { GET: [], HEAD: [], POST: [], PUT: [], PATCH: [], DELETE: [] };

  function add(method, pattern, handler) {
    routes[method].push({ pattern, handler });
  }

  const app = {
    name,
    cookieName,
    get: (p, h) => add('GET', p, h),
    head: (p, h) => add('HEAD', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    use: (middleware) => { middlewares.push(middleware); return app; },
    listen
  };

  const middlewares = [];

  async function handle(req, res) {
    stripUntrustedProxyHeadersIfNeeded(req);

    // Mount proxies must receive the untouched request stream, before parsing POST bodies.
    if (options.onRequest && options.onRequest(req, res)) return;

    let url;
    try {
      url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    } catch {
      return json(res, { ok: false, error: 'نشانی درخواست نامعتبر است' }, 400);
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/') || '/';
    } catch {
      return json(res, { ok: false, error: 'مسیر درخواست نامعتبر است' }, 400);
    }
    const method = (req.method || 'GET').toUpperCase();

    if (csrfGuard && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (!verifySameOrigin({ req })) {
        return json(res, { ok: false, error: 'درخواست امن معتبر نیست (CSRF)' }, 403);
      }
    }

    let body = {};
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        body = await readBody(req);
      } catch (err) {
        return json(res, { ok: false, error: err.message || 'خطا در خواندن داده' }, err.status || 400, [], req);
      }
    }

    const cookieJar = parseCookies(req);
    const setCookies = [];

    const ctx = {
      req,
      res,
      method,
      path: pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      url,
      body,
      cookies: cookieJar,
      setCookie(value, opts = {}) {
        const cname = opts.name || cookieName;
        if (!/^[A-Za-z0-9_]+$/.test(cname)) throw new Error('Invalid cookie name');
        const sameSite = opts.sameSite === 'Strict' ? 'Strict' : 'Lax';
        const parts = [`${cname}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
        if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
        if (opts.expires) parts.push(`Expires=${opts.expires}`);
        // Upstream TLS termination forwards original HTTPS scheme
        const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        if (req.socket.encrypted || proto === 'https') parts.push('Secure');
        const previous = setCookies.findIndex(c => c.startsWith(cname + '='));
        if (previous >= 0) setCookies.splice(previous, 1);
        setCookies.push(parts.join('; '));
      },
      clearCookie(opts = {}) {
        this.setCookie('', { ...opts, maxAgeSeconds: 0, expires: 'Thu, 01 Jan 1970 00:00:00 GMT' });
      },
      json(data, status = 200) { return json(res, data, status, setCookies, req); },
      text(data, status = 200, type = 'text/plain; charset=utf-8') {
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''), 'utf8');
        writeBufferCompressed(req, res, status, {
          'Content-Type': type,
          'Cache-Control': 'no-store'
        }, buf, method === 'HEAD');
      },
      redirect(to, status = 302) {
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
        res.writeHead(status, { Location: to, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        res.end();
      },
      file(filePath, status) {
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
        sendFile(res, filePath, status, req);
      },
      binary(buffer, mime, opts = {}) {
        const status = opts.status || 200;
        const actual = storage.inspectBinary(buffer);
        if (!actual || (mime && actual !== mime)) {
          return json(res, { ok: false, error: 'فرمت باینری فایل نامعتبر است' }, 400, setCookies, req);
        }
        if (opts.etag && req.headers['if-none-match'] === opts.etag) {
          if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
          res.writeHead(304, { ETag: opts.etag, 'Cache-Control': 'private, max-age=120', ...SECURITY_HEADERS });
          return res.end();
        }
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
        const disp = actual === 'application/pdf' ? 'attachment' : 'inline';
        res.writeHead(status, {
          'Content-Type': actual,
          'Content-Length': buffer.length,
          'Content-Disposition': disp,
          ...(opts.etag ? { ETag: opts.etag } : {}),
          'Cache-Control': 'private, max-age=120',
          ...SECURITY_HEADERS
        });
        if (method === 'HEAD') res.end();
        else res.end(buffer);
      },
      image(dataUrl, status = 200) {
        let parsed;
        try {
          parsed = storage.parseDataUrl(dataUrl, {
            allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
            maxBytes: 2 * 1024 * 1024
          });
        } catch {
          return json(res, { ok: false, error: 'فرمت تصویر نامعتبر است' }, 400, setCookies, req);
        }
        const etag = `"${crypto.createHash('sha1').update(parsed.buffer).digest('hex').slice(0, 20)}"`;
        return ctx.binary(parsed.buffer, parsed.mime, { status, etag });
      }
    };

    for (const mw of middlewares) {
      const out = await mw(ctx);
      if (res.writableEnded) return out;
      if (out === 'stop') return;
    }

    const matchMethod = method === 'HEAD' ? 'GET' : method;
    const list = routes[matchMethod] || [];
    for (const route of list) {
      const params = matchRoute(route.pattern, pathname);
      if (!params) continue;
      ctx.params = params;
      try {
        await route.handler(ctx);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) logger.error(`[${name}] ${method} ${pathname}`, err);
        if (!res.writableEnded) json(res, { ok: false, error: err.message || 'خطای داخلی سرور' }, status, setCookies, req);
      }
      return;
    }

    // فایل‌های استاتیک
    if (method === 'GET' || method === 'HEAD') {
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      if (!SAFE_FILE.test(rel) || rel.includes('..')) {
        return json(res, { ok: false, error: 'مسیر نامعتبر' }, 400, [], req);
      }
      for (const dir of publicDirs) {
        const resolvedDir = path.resolve(dir);
        const candidate = path.resolve(resolvedDir, rel);
        if ((candidate === resolvedDir || candidate.startsWith(resolvedDir + path.sep)) &&
            fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
          return sendFile(res, candidate, 200, req);
        }
      }
    }

    json(res, { ok: false, error: 'پیدا نشد' }, 404, setCookies, req);
  }

  function json(res, data, status = 200, setCookies = [], req = null) {
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    const payload = Buffer.from(JSON.stringify(data), 'utf8');
    const isHead = req && req.method && req.method.toUpperCase() === 'HEAD';
    writeBufferCompressed(req, res, status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, payload, isHead);
  }

  function listen(port, host = '0.0.0.0', callback) {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        logger.error(`[${name}] unhandled`, err);
        if (!res.writableEnded) {
          try { json(res, { ok: false, error: 'خطای داخلی سرور' }, 500, [], req); } catch { /* ignore */ }
        }
      });
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.listen(port, host, () => {
      logger.log(`[${name}] آماده روی http://${host}:${port}`);
      if (callback) callback(server);
    });
    return server;
  }

  return app;
}

module.exports = {
  createServer,
  parseCookies,
  sendFile,
  MIME,
  rateLimit,
  sanitize,
  getClientIp,
  parseId,
  verifySameOrigin
};
