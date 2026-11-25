'use strict';
// Private member-only personal progress log routes. No AI or public credentials.
const db = require('./db');

db.execWithRetry(`
CREATE TABLE IF NOT EXISTS member_progress_logs (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category TEXT NOT NULL, title TEXT NOT NULL, duration INTEGER, weight REAL, readiness INTEGER,
 note TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS member_progress_logs_owner ON member_progress_logs(user_id,id);
`);

const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

function bounded(value, min, max, integer = false) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!integer || Number.isInteger(n)) && n >= min && n <= max ? n : NaN;
}

function safeWrite(ctx) {
  if (ctx.req.headers['x-wellness-request'] !== '1') return false;
  const origin = ctx.req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === (ctx.req.headers['x-dojo-origin-host'] || ctx.req.headers.host); } catch { return false; }
}

function direct(ctx, needMember) {
  const u = needMember(ctx);
  if (!u) return null;
  if (u.impersonated || !u.verified) {
    ctx.json({ ok: false, error: 'برای این بخش ورود مستقیم به حساب تأییدشده لازم است' }, 403);
    return null;
  }
  return u;
}

function mount(app, needMember) {
  app.get('/api/wellness/progress', ctx => {
    const u = direct(ctx, needMember);
    if (!u) return;
    ctx.json({
      ok: true,
      logs: db.all(
        'SELECT id,category,title,duration,weight,readiness,note,created_at FROM member_progress_logs WHERE user_id=? ORDER BY id DESC LIMIT 100',
        u.id
      )
    });
  });

  app.post('/api/wellness/progress', ctx => {
    const u = direct(ctx, needMember);
    if (!u) return;
    if (!safeWrite(ctx)) return ctx.json({ ok: false, error: 'درخواست امن معتبر نیست' }, 403);
    const b = ctx.body || {};
    const title = text(b.title, 120);
    const note = text(b.note, 1000);
    const category = b.category;
    const duration = bounded(b.duration, 0, 1440, true);
    const weight = bounded(b.weight, 10, 400);
    const readiness = bounded(b.readiness, 0, 100, true);
    if (!title || !['workout', 'milestone'].includes(category) || [duration, weight, readiness].some(Number.isNaN)) {
      return ctx.json({ ok: false, error: 'اطلاعات تمرین معتبر نیست' }, 400);
    }
    const info = db.run(
      'INSERT INTO member_progress_logs(user_id,category,title,duration,weight,readiness,note,created_at) VALUES (?,?,?,?,?,?,?,?)',
      u.id, category, title, duration, weight, readiness, note, db.now()
    );
    ctx.json({ ok: true, id: Number(info.lastInsertRowid) });
  });

  app.post('/api/wellness/progress/:id/delete', ctx => {
    const u = direct(ctx, needMember);
    if (!u) return;
    if (!safeWrite(ctx)) return ctx.json({ ok: false, error: 'درخواست امن معتبر نیست' }, 403);
    const id = Number(ctx.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return ctx.json({ ok: false, error: 'شناسه معتبر نیست' }, 400);
    const result = db.run('DELETE FROM member_progress_logs WHERE id=? AND user_id=?', id, u.id);
    if (!result.changes) return ctx.json({ ok: false, error: 'سابقه پیدا نشد' }, 404);
    ctx.json({ ok: true });
  });
}

module.exports = { mount };
