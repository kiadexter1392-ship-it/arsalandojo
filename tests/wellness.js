'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-wellness-'));
Object.assign(process.env, {
  ARSLAN_DATA_DIR: dir,
  ARSLAN_DB: path.join(dir, 'test.db'),
  RESET_DB: '0',
  DOJO_TEST_FIXTURES: '0'
});

const wellness = require('../shared/member-wellness');
const db = require('../shared/db');

(async () => {
  try {
    assert.equal(typeof wellness.mount, 'function');
    assert.equal(wellness.generateMealPlan, undefined, 'AI meal plan generator must be removed');

    const user = db.createUser({
      username: 'progress-test-member',
      full_name: 'آزمایش جدول پیشرفت',
      password: 'isolated-test-secret-2026',
      discipline: 'کاراته'
    }, 'member');

    const routes = new Map();
    const fakeApp = {
      get: (p, handler) => routes.set('GET ' + p, handler),
      post: (p, handler) => routes.set('POST ' + p, handler)
    };
    wellness.mount(fakeApp, () => ({ ...user, verified: 1, impersonated: 0 }));

    assert.equal(routes.has('GET /api/wellness/progress'), true);
    assert.equal(routes.has('POST /api/wellness/progress'), true);
    assert.equal(routes.has('POST /api/wellness/progress/:id/delete'), true);
    assert.equal(routes.has('GET /api/wellness/meals'), false, 'AI meal routes must be removed');
    assert.equal(routes.has('POST /api/wellness/meals'), false, 'AI meal routes must be removed');

    let statusCode = 200;
    let payload = null;
    const makeCtx = (body, headers = { 'x-wellness-request': '1' }, params = {}) => ({
      req: { headers },
      body,
      params,
      json: (data, code = 200) => { payload = data; statusCode = code; }
    });

    routes.get('POST /api/wellness/progress')(makeCtx({
      category: 'workout',
      title: 'تمرین کیهون',
      duration: 45,
      weight: 68.5,
      readiness: 85,
      note: 'ثبت آزمایشی'
    }));
    assert.equal(statusCode, 200);
    assert.equal(payload.ok, true);

    routes.get('GET /api/wellness/progress')(makeCtx(undefined, {}));
    assert.equal(statusCode, 200);
    assert.equal(payload.logs.length, 1);
    assert.equal(payload.logs[0].title, 'تمرین کیهون');
    assert.equal(payload.logs[0].duration, 45);

    routes.get('POST /api/wellness/progress')(makeCtx({
      category: 'workout',
      title: '',
      duration: 15
    }));
    assert.equal(statusCode, 400);

    console.log('PASS: personal progress log routes active and AI meal plan completely removed');
  } finally {
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
