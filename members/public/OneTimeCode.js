/* ══ One-Time Code — Vanilla JS ════════════════════════════
   Six cells, caret, merge capsule with goo filter.
   Spring physics + SVG goo filter in vanilla JS.
*/

(function() {
  'use strict';

  const W = 40;
  const H = 50;
  const G = 8;
  const CAP = 160;
  const POP_MS = 180;
  const SHAKE_MS = 620;

  const MERGE_K = 0.075;
  const MERGE_D = 1 - 2 * 0.42 * Math.sqrt(MERGE_K);

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) {
    var u = clamp((v - a) / (b - a), 0, 1);
    return u * u * (3 - 2 * u);
  }

  function normalizeDigits(str) {
    return String(str || '')
      .replace(/[۰-۹]/g, function(ch) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)); })
      .replace(/[٠-٩]/g, function(ch) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)); })
      .replace(/\D/g, '');
  }

  function OneTimeCode(container, options) {
    if (!container) return;
    options = options || {};
    var length = options.length || 6;
    var answer = options.answer || 'Accept';
    var onVerify = options.onVerify || function() {};
    var onChange = options.onChange || function() {};

    var code = '';
    var phase = 'type'; /* type | check | ok | no */
    var focus = false;

    var caret = { x: W / 2, v: 0 };
    var popAt = [];
    var mergeState = { m: 0, v: 0, to: 0 };
    var shookAt = 0;
    var rafId = 0;
    var verifyTimer = 0;
    var resetTimer = 0;

    /* Build goo filter SVG */
    var gooId = 'otp-goo-' + Math.random().toString(36).slice(2, 8);
    var svgDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgDefs.setAttribute('class', 'liq-defs');
    svgDefs.setAttribute('aria-hidden', 'true');
    svgDefs.innerHTML =
      '<defs><filter id="' + gooId + '" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="smear"/>' +
      '<feColorMatrix in="smear" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12"/>' +
      '</filter></defs>';

    /* Root */
    var root = document.createElement('div');
    root.className = 'otp';
    root.appendChild(svgDefs);

    var rowW = length * W + (length - 1) * G;

    /* Row */
    var row = document.createElement('div');
    row.className = 'otp-row';
    row.setAttribute('dir', 'ltr');
    row.style.width = rowW + 'px';
    row.style.height = H + 'px';

    /* Goo layer (cells + capsule) */
    var gooLayer = document.createElement('div');
    gooLayer.className = 'otp-goo';
    row.appendChild(gooLayer);

    /* Slots (digits) */
    var slots = [];
    var slotValues = new Array(length).fill('');
    for (var i = 0; i < length; i++) {
      var slot = document.createElement('span');
      slot.className = 'otp-slot';
      slot.style.width = W + 'px';
      slots.push(slot);
      row.appendChild(slot);
    }

    /* Caret */
    var caretEl = document.createElement('i');
    caretEl.className = 'otp-caret';
    row.appendChild(caretEl);

    /* OK label */
    var okEl = document.createElement('span');
    okEl.className = 'otp-ok';
    okEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> تأیید شد';
    row.appendChild(okEl);

    /* Hidden input */
    var input = document.createElement('input');
    input.className = 'otp-field';
    input.type = 'text';
    input.dir = 'ltr';
    input.inputMode = 'numeric';
    input.setAttribute('autocomplete', 'one-time-code');
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('maxlength', length);
    input.setAttribute('aria-label', length + '-digit code');
    input.spellcheck = false;
    row.appendChild(input);

    root.appendChild(row);
    container.appendChild(root);

    function clearPendingTimers() {
      if (verifyTimer) { clearTimeout(verifyTimer); verifyTimer = 0; }
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = 0; }
    }

    /* Animation loop */
    function wake() {
      if (rafId) return;
      var prev = 0;
      function tick(t) {
        var dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
        prev = t;
        var busy = false;

        /* Caret spring */
        var target = Math.min(code.length, length - 1) * (W + G) + W / 2;
        caret.v += (target - caret.x) * 0.25 * dt;
        caret.v *= Math.pow(0.6, dt);
        caret.x += caret.v * dt;
        if (Math.abs(target - caret.x) < 0.05 && Math.abs(caret.v) < 0.05) {
          caret.x = target; caret.v = 0;
        } else { busy = true; }

        /* Merge spring */
        var mg = mergeState;
        if (mg.m !== mg.to || mg.v !== 0) {
          mg.v += (mg.to - mg.m) * MERGE_K * dt;
          mg.v *= Math.pow(MERGE_D, dt);
          mg.m += mg.v * dt;
          if (Math.abs(mg.to - mg.m) < 0.0008 && Math.abs(mg.v) < 0.0008) {
            mg.m = mg.to; mg.v = 0;
          } else { busy = true; }
        }

        /* Shake / check / pop timing */
        if (phase === 'check') busy = true;
        if (shookAt && performance.now() - shookAt < SHAKE_MS + 200) busy = true;

        for (var pi = 0; pi < popAt.length; pi++) {
          if (popAt[pi] !== undefined && performance.now() - popAt[pi] < POP_MS) { busy = true; break; }
        }

        render();
        rafId = busy ? requestAnimationFrame(tick) : 0;
      }
      rafId = requestAnimationFrame(tick);
    }

    function fuse(to) {
      mergeState = { m: mergeState.m, v: mergeState.v, to: to };
      wake();
    }

    function render() {
      var now = performance.now();
      var raw = mergeState.m;
      var m = clamp(raw, 0, 1);
      var mid = (rowW - W) / 2;
      var since = now - shookAt;
      var shaking = phase === 'no' && since < SHAKE_MS;

      /* Cell positions */
      var cells = gooLayer.querySelectorAll('.otp-cell');
      for (var i = 0; i < length; i++) {
        var home = i * (W + G);
        var shake = shaking ? 5 * Math.exp(-since / 190) * Math.sin((since / 1000) * Math.PI * 2 * 10 + i * 0.55) : 0;
        var x = mix(home, mid, m) + shake;

        /* Pop scale */
        var at = popAt[i];
        var popScale = 1;
        if (at !== undefined) {
          var u = (now - at) / POP_MS;
          if (u > 0 && u < 1) popScale = 1 + 0.04 * Math.sin(Math.PI * u);
        }

        /* Breath during check */
        var breathScale = popScale;
        if (phase === 'check') {
          var bu = ((now % 900) / 900) * (length + 2) - i;
          if (bu > 0 && bu < 2) breathScale *= 1 - 0.07 * Math.sin((bu / 2) * Math.PI);
        }

        var cellR = mix(10, H / 2, smooth(0.15, 0.7, m));

        if (cells[i]) {
          cells[i].style.transform = 'translateX(' + x.toFixed(2) + 'px) scale(' + breathScale.toFixed(3) + ')';
          cells[i].style.borderRadius = cellR + 'px';
        }
      }

      /* Capsule */
      var capsule = gooLayer.querySelector('.otp-capsule');
      var over = raw - 1;
      var capW = CAP * smooth(0.3, 1, m) * (1 + Math.max(-0.12, over) * 0.9);
      var capSy = 1 - Math.max(-0.12, over) * 0.55;
      if (capsule && capW > 0.5) {
        capsule.style.display = '';
        capsule.style.width = capW.toFixed(1) + 'px';
        capsule.style.transform = 'translateX(' + ((rowW - capW) / 2).toFixed(2) + 'px) scaleY(' + capSy.toFixed(3) + ')';
      } else if (capsule) {
        capsule.style.display = 'none';
      }

      /* Digits — update DOM only when a slot digit actually changes so CSS entry stays smooth and instant */
      for (var i = 0; i < length; i++) {
        var d = code[i] || '';
        var home = i * (W + G);
        var shake = shaking ? 5 * Math.exp(-since / 190) * Math.sin((since / 1000) * Math.PI * 2 * 10 + i * 0.55) : 0;
        var x = mix(home, mid, m) + shake;

        slots[i].style.transform = 'translateX(' + x.toFixed(2) + 'px)';
        slots[i].style.opacity = 1 - smooth(0, 0.45, m);

        if (slotValues[i] !== d) {
          slotValues[i] = d;
          if (d) {
            var span = document.createElement('span');
            span.className = 'otp-digit';
            span.textContent = d;
            slots[i].textContent = '';
            slots[i].appendChild(span);
          } else {
            slots[i].textContent = '';
          }
        }

        if (d && slots[i].firstChild) {
          var out = phase === 'no' ? smooth(0, 1, (since - 300 - (length - 1 - i) * 45) / 220) : 0;
          slots[i].firstChild.style.translate = out ? ('0 ' + (out * 8).toFixed(2) + 'px') : 'none';
          slots[i].firstChild.style.opacity = out ? String(1 - out) : '1';
        }
      }

      /* Caret */
      var typing = phase === 'type' && focus;
      caretEl.setAttribute('data-on', typing && code.length < length && m < 0.08 ? 'true' : '');
      caretEl.style.transform = 'translateX(' + (caret.x - 1).toFixed(2) + 'px) scaleX(' + (1 + Math.min(5, Math.abs(caret.v) * 0.9)).toFixed(3) + ')';

      /* OK label */
      okEl.style.opacity = smooth(0.72, 1, m);
      okEl.style.transform = 'scale(' + mix(0.92, 1, smooth(0.72, 1, m)) + ')';

      /* Phase attribute */
      root.setAttribute('data-phase', phase);

      /* Goo filter */
      gooLayer.style.filter = 'url(#' + gooId + ')';
    }

    /* Build cell elements */
    function buildCells() {
      gooLayer.innerHTML = '';
      for (var i = 0; i < length; i++) {
        var cell = document.createElement('span');
        cell.className = 'otp-cell';
        cell.style.width = W + 'px';
        cell.style.borderRadius = '10px';
        gooLayer.appendChild(cell);
      }
      var capsule = document.createElement('span');
      capsule.className = 'otp-cell otp-capsule';
      capsule.style.borderRadius = (H / 2) + 'px';
      capsule.style.display = 'none';
      gooLayer.appendChild(capsule);
    }
    buildCells();

    function reopenForEdit(newCode) {
      clearPendingTimers();
      phase = 'type';
      mergeState = { m: 0, v: 0, to: 0 };
      shookAt = 0;
      if (typeof newCode === 'string') {
        code = newCode;
        input.value = newCode;
      }
      render();
      wake();
    }

    /* Keydown handling so Backspace/Delete works even when in check/ok phase */
    input.addEventListener('keydown', function(e) {
      if ((e.key === 'Backspace' || e.key === 'Delete') && (phase === 'ok' || phase === 'check')) {
        e.preventDefault();
        var trimmed = code.slice(0, -1);
        for (var j = trimmed.length; j < length; j++) popAt[j] = undefined;
        reopenForEdit(trimmed);
        onChange(code);
        return;
      }
      if (phase === 'ok' && /^[0-9۰-۹٠-٩]$/.test(e.key)) {
        e.preventDefault();
        var d = normalizeDigits(e.key);
        popAt[0] = performance.now();
        reopenForEdit(d);
        onChange(code);
      }
    });

    /* Input handling */
    input.addEventListener('input', function(e) {
      var next = normalizeDigits(e.target.value).slice(0, length);
      if (e.target.value !== next) e.target.value = next;

      if (phase === 'check' || phase === 'ok') {
        clearPendingTimers();
        phase = 'type';
        mergeState = { m: 0, v: 0, to: 0 };
      }
      if (phase !== 'type') return;

      /* Pop animation for newly added digits; clear stale pops when deleting */
      if (next.length > code.length) {
        var t0 = performance.now();
        for (var i = code.length; i < next.length; i++) {
          popAt[i] = t0 + (i - code.length) * 35;
        }
      } else if (next.length < code.length) {
        for (var j = next.length; j < length; j++) {
          popAt[j] = undefined;
        }
      }

      code = next;
      onChange(code);
      render();
      wake();

      if (code.length < length) return;

      /* Full code entered */
      phase = 'check';
      render();
      wake();

      verifyTimer = setTimeout(function() {
        verifyTimer = 0;
        if (answer !== 'Reject') {
          phase = 'ok';
          fuse(1);
          render();
          input.blur();
          if (onVerify) onVerify(code);
        } else {
          phase = 'no';
          shookAt = performance.now();
          render();
          wake();
          resetTimer = setTimeout(function() {
            resetTimer = 0;
            code = '';
            phase = 'type';
            input.value = '';
            buildCells();
            onChange('');
            render();
            wake();
          }, SHAKE_MS + length * 45 + 160);
        }
      }, 160);
    });

    input.addEventListener('focus', function() { focus = true; render(); wake(); });
    input.addEventListener('blur', function() { focus = false; render(); });

    /* Click capsule or row when completed to reopen and edit */
    row.addEventListener('click', function() {
      if (phase === 'ok') {
        reopenForEdit('');
        onChange('');
        input.focus();
        return;
      }
      input.focus();
    });

    /* Initial render */
    render();

    return {
      getValue: function() { return code; },
      reset: function() {
        clearPendingTimers();
        code = '';
        phase = 'type';
        mergeState = { m: 0, v: 0, to: 0 };
        shookAt = 0;
        popAt = [];
        input.value = '';
        buildCells();
        onChange('');
        render();
      },
      focus: function() { input.focus(); }
    };
  }

  window.OneTimeCode = {
    mount: function(container, options) {
      return OneTimeCode(container, options);
    }
  };
})();
