'use strict';
/*
 * اجرای ساختار دو‌بخشی (وب اپلیکیشن + سرور ذخیره‌سازی ایزوله):
 *   پورت 8080 → شاگردان (و /coach برای دسترسی سازگار به مربی)
 *   پورت 4174 → مربی؛ پورت 4173 → سرور داخلی شاگردان؛ پورت 4175 → فضای ذخیره‌سازی فایل‌ها
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');

const { readPorts, readStoragePort } = require('./shared/ports');
const { proxy, stripUntrustedProxyHeaders } = require('./shared/proxy');
const storage = require('./shared/storage');

const { gateway: PORT, coach: COACH_PORT, member: MEMBER_PORT } = readPorts();
const STORAGE_PORT = readStoragePort();
const MEMBERS_SITE_URL = process.env.MEMBERS_SITE_URL || null;

// Generate shared intra-cluster secrets so external clients cannot spoof x-dojo-* headers or access internal storage.
if (!process.env.ARSLAN_INTERNAL_PROXY_TOKEN) {
  process.env.ARSLAN_INTERNAL_PROXY_TOKEN = crypto.randomBytes(24).toString('hex');
}
if (!process.env.ARSLAN_STORAGE_SECRET) {
  process.env.ARSLAN_STORAGE_SECRET = storage.getStorageSecret();
}
const STORAGE_INTERNAL_URL = STORAGE_PORT ? `http://127.0.0.1:${STORAGE_PORT}` : '';

const children = [];

function start(label, script, color) {
  const child = spawn(process.execPath, [path.join(__dirname, script)], {
    env: {
      ...process.env,
      COACH_PORT: String(COACH_PORT),
      MEMBER_PORT: String(MEMBER_PORT),
      STORAGE_PORT: String(STORAGE_PORT),
      MEMBERS_SITE_URL: MEMBERS_SITE_URL || '',
      ARSLAN_STORAGE_INTERNAL_URL: STORAGE_INTERNAL_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  child.stdout.on('data', (d) => process.stdout.write(prefix + String(d).replace(/\n$/, '').split('\n').join('\n' + prefix) + '\n'));
  child.stderr.on('data', (d) => process.stderr.write(prefix + String(d)));
  child.on('exit', (code) => {
    console.log(`${prefix}خروج با کد ${code}`);
    shutdown(code === 0 ? 0 : 1);
  });
  children.push(child);
  return child;
}

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach((c) => { try { c.kill('SIGTERM'); } catch { /* ignore */ } });
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('باشگاه آنلاین ارسلان دوجو (معماری دو‌بخشی وب + ذخیره‌سازی ایزوله)');
console.log('──────────────────────────────────────────────────────────');

if (PORT) {
  /* Railway / Custom Domain Gateway: یک پورت عمومی با تفکیک وب و فضای ذخیره‌سازی */
  const proxyServer = http.createServer((req, res) => {
    // Strip any attacker-supplied internal proxy headers before routing
    req.headers = stripUntrustedProxyHeaders(req.headers);

    const url = req.url;
    let parsed;
    try {
      parsed = new URL(url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad Request');
    }

    if (parsed.pathname === '/healthz') {
      const stats = storage.storageStats();
      const body = JSON.stringify({
        ok: true,
        gateway: PORT,
        storagePort: STORAGE_PORT,
        storedFiles: stats.files
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    }

    // Canonical trailing slash makes relative form and asset URLs work correctly.
    if (parsed.pathname === '/coach' || parsed.pathname === '/dashboard') {
      res.writeHead(302, { Location: (parsed.pathname === '/coach' ? '/coach/' : '/coach/dashboard') + parsed.search });
      return res.end();
    }

    if (parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/')) return proxy(COACH_PORT)(req, res);

    /* مسیرهای پنل مربی (با پیشوند /coach) */
    if (parsed.pathname.startsWith('/coach/') || parsed.pathname.startsWith('/v1/')) {
      req.url = url.replace(/^\/coach/, '') || '/';
      return proxy(COACH_PORT, { prefix: '/coach' })(req, res);
    }

    /* بقیه مسیرها → شاگردان (پیش‌فرض) */
    proxy(MEMBER_PORT)(req, res);
  });
  proxyServer.listen(PORT, '0.0.0.0', () => {
    console.log(`  دروازه وب   →  http://0.0.0.0:${PORT}`);
    console.log(`  پنل مربی    →  http://localhost:${COACH_PORT}`);
    console.log(`  پنل شاگردان →  http://localhost:${MEMBER_PORT}`);
    if (STORAGE_PORT) console.log(`  ذخیره‌سازی  →  http://127.0.0.1:${STORAGE_PORT} (ایزوله خارج از دامنه)`);
    console.log('──────────────────────────────────────────────────────────');
    if (STORAGE_PORT) start('فایل', 'storage/server.js', '36');
    start('مربی', 'coach/server.js', '31');
    start('شاگردان', 'members/server.js', '33');
  });
} else {
  /* لوکال: پورت‌های جدا */
  console.log(`  پنل مربی    →  http://localhost:${COACH_PORT}`);
  console.log(`  پنل شاگردان →  http://localhost:${MEMBER_PORT}`);
  if (STORAGE_PORT) console.log(`  ذخیره‌سازی  →  http://127.0.0.1:${STORAGE_PORT}`);
  console.log('──────────────────────────────────────────────────────────');
  if (STORAGE_PORT) start('فایل', 'storage/server.js', '36');
  start('مربی', 'coach/server.js', '31');
  start('شاگردان', 'members/server.js', '33');
}
