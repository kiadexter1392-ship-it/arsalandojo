'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeNode(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    children: [],
    style: {},
    attrs: {},
    listeners: {},
    value: '',
    _textContent: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    addEventListener(ev, fn) {
      this.listeners[ev] = this.listeners[ev] || [];
      this.listeners[ev].push(fn);
    },
    dispatchEvent(ev) {
      const list = this.listeners[ev.type] || [];
      for (const fn of list) fn(ev);
    },
    focus() {},
    blur() {},
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (cls && String(c.className || '').split(/\s+/).includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    get firstChild() { return this.children[0] || null; },
    set innerHTML(v) {
      this._innerHTML = String(v);
      if (v === '') this.children = [];
    },
    get innerHTML() { return this._innerHTML || ''; },
    set textContent(v) {
      this._textContent = String(v);
      if (v === '') this.children = [];
    },
    get textContent() {
      if (this.children.length) return this.children.map((c) => c.textContent).join('');
      return this._textContent;
    }
  };
  return el;
}

(async () => {
  const rootDir = path.join(__dirname, '..');
  const otpSrc = fs.readFileSync(path.join(rootDir, 'members/public/OneTimeCode.js'), 'utf8');

  let rafQueue = [];
  const win = {
    OneTimeCode: null,
    performance: { now: () => Date.now() },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    setTimeout,
    clearTimeout
  };
  win.window = win;
  const ctx = vm.createContext({
    ...win,
    document: {
      createElement: (t) => makeNode(t),
      createElementNS: (_ns, t) => makeNode(t)
    }
  });
  vm.runInContext(otpSrc, ctx);

  const container = makeNode('div');
  let latestChange = '';
  let verifiedCode = '';
  const otp = ctx.window.OneTimeCode.mount(container, {
    length: 6,
    answer: 'Accept',
    onChange: (c) => { latestChange = c; },
    onVerify: (c) => { verifiedCode = c; }
  });

  const row = container.querySelectorAll('.otp-row')[0];
  const slots = container.querySelectorAll('.otp-slot');
  const input = container.querySelectorAll('.otp-field')[0];
  const otpRoot = container.children[0];

  assert.equal(slots.length, 6);
  assert.equal(row.getAttribute('dir'), 'ltr');

  // 1. Typing ASCII digit appears immediately on the same tick (even BEFORE requestAnimationFrame runs!)
  input.value = '1';
  input.dispatchEvent({ type: 'input', target: input });
  assert.equal(slots[0].textContent, '1');
  assert.equal(latestChange, '1');
  const firstDigitNode = slots[0].firstChild;

  // Running animation frames must NOT destroy & recreate the existing digit span
  if (rafQueue.length) {
    const cb = rafQueue.shift();
    cb(Date.now() + 16);
  }
  assert.equal(slots[0].firstChild, firstDigitNode);

  // 2. Typing Persian digit '۲' immediately normalizes and appears as '2'
  input.value = '1۲';
  input.dispatchEvent({ type: 'input', target: input });
  assert.equal(slots[0].textContent, '1');
  assert.equal(slots[1].textContent, '2');
  assert.equal(input.value, '12');
  assert.equal(latestChange, '12');

  // 3. Deleting digit immediately removes it on the same tick
  input.value = '1';
  input.dispatchEvent({ type: 'input', target: input });
  assert.equal(slots[0].textContent, '1');
  assert.equal(slots[1].textContent, '');
  assert.equal(latestChange, '1');

  // Deleting last remaining digit clears slot 0 immediately
  input.value = '';
  input.dispatchEvent({ type: 'input', target: input });
  assert.equal(slots[0].textContent, '');
  assert.equal(latestChange, '');

  // 4. Completing 6 digits transitions to check -> ok, and Backspace during ok reopens and deletes 6th digit
  input.value = '123456';
  input.dispatchEvent({ type: 'input', target: input });
  assert.equal(otpRoot.getAttribute('data-phase'), 'check');
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(otpRoot.getAttribute('data-phase'), 'ok');
  assert.equal(verifiedCode, '123456');

  let prevented = false;
  input.dispatchEvent({ type: 'keydown', key: 'Backspace', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(otpRoot.getAttribute('data-phase'), 'type');
  assert.equal(otp.getValue(), '12345');
  assert.equal(latestChange, '12345');
  assert.equal(slots[5].textContent, '');
  assert.equal(slots[4].textContent, '5');

  // 5. CSS Grid responsive single-column checks on login & registration forms
  const sharedCss = fs.readFileSync(path.join(rootDir, 'shared/public/ui/style.css'), 'utf8');
  const memberCss = fs.readFileSync(path.join(rootDir, 'members/public/style.css'), 'utf8');
  const coachLoginCss = fs.readFileSync(path.join(rootDir, 'coach/public/login.css'), 'utf8');
  const academyCss = fs.readFileSync(path.join(rootDir, 'shared/public/ui/academy.css'), 'utf8');
  const memberHtml = fs.readFileSync(path.join(rootDir, 'members/public/index.html'), 'utf8');

  assert.match(memberHtml, /<form id="loginForm" class="auth-form-grid"/);
  assert.match(memberHtml, /<form id="registerForm" class="auth-form-grid hidden"/);
  assert.match(sharedCss, /\.auth-form-grid\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(sharedCss, /@media\s*\(max-width:\s*768px\)\s*\{[^}]*\.form-row,\s*\.form-row-3,\s*\.auth-form-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(memberCss, /\.form-row,\s*\n\s*\.form-row-3\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(coachLoginCss, /\.coach-login-card form\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(academyCss, /\.academy-login-form form\s*\{[^}]*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);

  console.log('✓ OneTimeCode instant input/delete + CSS Grid auth form checks passed');
})();
