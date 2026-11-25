/* ══ CardStack — Responsive Pricing Cards Fan ══
   Vanilla JS. Supports all disciplines, responsive mobile bounds,
   hover fan-out on desktop, and tap/click/chip selection on mobile.
*/

(function() {
  'use strict';

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createCardStack(container, options) {
    if (!container) return;
    var cards = (options && options.cards) || [];
    if (!cards.length) return;
    var n = cards.length;

    container.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'stk-wrap';

    var stack = document.createElement('div');
    stack.className = 'stk-cardstack';
    stack.setAttribute('role', 'region');
    stack.setAttribute('aria-label', 'تعرفه شهریه رشته‌های ورزشی');

    var chipsRow = document.createElement('div');
    chipsRow.className = 'stk-chips';
    chipsRow.setAttribute('role', 'tablist');
    chipsRow.setAttribute('aria-label', 'انتخاب رشته برای مشاهده شهریه');

    var hintEl = document.createElement('div');
    hintEl.className = 'stk-hint';
    hintEl.textContent = 'روی هر کارت یا نام رشته بزنید تا شهریه آن نمایش داده شود';

    var activeIdx = null;
    var hoveredIdx = null;
    var cardEls = [];
    var chipEls = [];
    var metrics = null;

    function computeMetrics() {
      var hostW = container.clientWidth || wrap.clientWidth || (window.innerWidth - 32) || 340;
      var availW = Math.max(250, Math.min(hostW, 660));
      var compact = availW < 460;

      var cardW = compact
        ? Math.max(114, Math.min(144, Math.floor(availW * 0.42)))
        : 156;
      var cardH = compact
        ? Math.round(cardW * 1.32)
        : 212;
      var stackOffset = compact ? 5 : 6;
      var lift = compact ? 18 : 24;
      var padY = compact ? 26 : 30;
      var containerW = availW;
      var containerH = cardH + padY * 2 + lift;

      var maxHalfCount = Math.max(1, (n - 1) / 2);
      var maxOuterAngleDeg = compact ? 14 : 24;
      var fanAngle = Math.min(compact ? 4.8 : 7.5, maxOuterAngleDeg / maxHalfCount);
      var outerRad = (fanAngle * maxHalfCount * Math.PI) / 180;
      var rotHalfW = (cardW / 2) * Math.cos(outerRad) + (cardH / 2) * Math.sin(outerRad);
      var safeMargin = compact ? 6 : 12;
      var maxSpreadHalf = Math.max(24, containerW / 2 - rotHalfW - safeMargin);
      var fanSpread = Math.min(compact ? maxSpreadHalf * 2 : 300, maxSpreadHalf * 2);

      metrics = {
        compact: compact,
        cardW: cardW,
        cardH: cardH,
        stackOffset: stackOffset,
        lift: lift,
        containerW: containerW,
        containerH: containerH,
        centerX: containerW / 2,
        centerY: containerH / 2 + (compact ? 6 : 8),
        fanAngle: fanAngle,
        fanSpread: fanSpread,
        pivotY: cardH + (compact ? 170 : 210)
      };

      stack.style.width = metrics.containerW + 'px';
      stack.style.height = metrics.containerH + 'px';
    }

    function applyLayout() {
      if (!metrics) computeMetrics();
      var focusIdx = hoveredIdx !== null ? hoveredIdx : activeIdx;
      var isOpen = focusIdx !== null;

      for (var j = 0; j < n; j++) {
        var el = cardEls[j];
        var chip = chipEls[j];
        var isFocus = j === focusIdx;

        el.style.width = metrics.cardW + 'px';
        el.style.height = metrics.cardH + 'px';
        el.style.left = metrics.centerX + 'px';
        el.style.top = metrics.centerY + 'px';
        el.style.transformOrigin = '50% ' + metrics.pivotY + 'px';

        if (!isOpen) {
          var ro = -(n - 1 - j) * metrics.stackOffset;
          var rr = (j - (n - 1) / 2) * (metrics.compact ? 1.1 : 1.5);
          el.style.transform = 'translate(-50%, calc(-50% + ' + ro + 'px)) rotate(' + rr.toFixed(2) + 'deg)';
          el.style.zIndex = String(j + 1);
          el.classList.remove('is-active');
        } else {
          var norm = n > 1 ? (j - (n - 1) / 2) / ((n - 1) / 2) : 0;
          var fx = norm * (metrics.fanSpread / 2);
          var fr = (j - (n - 1) / 2) * metrics.fanAngle;
          var arcY = Math.abs(norm) * Math.abs(norm) * (metrics.compact ? 8 : 12);

          if (isFocus) {
            el.style.transform =
              'translate(calc(-50% + ' + fx.toFixed(1) + 'px), calc(-50% - ' + metrics.lift + 'px)) rotate(0deg) scale(' + (metrics.compact ? 1.07 : 1.06) + ')';
            el.style.zIndex = '100';
            el.classList.add('is-active');
          } else {
            el.style.transform =
              'translate(calc(-50% + ' + fx.toFixed(1) + 'px), calc(-50% + ' + arcY.toFixed(1) + 'px)) rotate(' + fr.toFixed(2) + 'deg)';
            el.style.zIndex = String(j + 1);
            el.classList.remove('is-active');
          }
        }

        if (chip) {
          chip.classList.toggle('active', j === activeIdx || j === focusIdx);
          chip.setAttribute('aria-selected', j === activeIdx ? 'true' : 'false');
        }
      }
    }

    function selectCard(idx, fromChip) {
      if (activeIdx === idx && !fromChip) {
        activeIdx = (idx + 1) % n;
      } else {
        activeIdx = idx;
      }
      hoveredIdx = null;
      applyLayout();
    }

    for (var i = 0; i < n; i++) {
      (function(idx) {
        var card = cards[idx] || { discipline: 'رشته ' + (idx + 1), price: '—' };
        var el = document.createElement('div');
        el.className = 'stk-cs-card';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', card.discipline + ' — ' + card.price + ' هزار تومان');

        el.innerHTML =
          '<div class="stk-cs-face">' +
            '<div class="stk-cs-num">' + (idx + 1) + '</div>' +
            '<div class="stk-cs-body">' +
              '<div class="stk-cs-disc">' + escapeHtml(card.discipline) + '</div>' +
              '<div class="stk-cs-price">' + escapeHtml(card.price) + '</div>' +
              '<div class="stk-cs-unit">هزار تومان / ماه</div>' +
            '</div>' +
          '</div>';

        el.addEventListener('pointerenter', function(e) {
          if (e.pointerType === 'touch') return;
          hoveredIdx = idx;
          applyLayout();
        });

        el.addEventListener('pointerleave', function(e) {
          if (e.pointerType === 'touch') return;
          if (hoveredIdx === idx) hoveredIdx = null;
          applyLayout();
        });

        el.addEventListener('click', function(e) {
          e.stopPropagation();
          selectCard(idx, false);
        });

        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectCard(idx, false);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            selectCard((idx + 1) % n, true);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            selectCard((idx - 1 + n) % n, true);
          }
        });

        cardEls.push(el);
        stack.appendChild(el);

        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'stk-chip';
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', 'false');
        chip.textContent = card.discipline;
        chip.addEventListener('click', function(e) {
          e.stopPropagation();
          selectCard(idx, true);
        });
        chipEls.push(chip);
        chipsRow.appendChild(chip);
      })(i);
    }

    stack.addEventListener('pointerleave', function(e) {
      if (e.pointerType === 'touch') return;
      hoveredIdx = null;
      applyLayout();
    });

    document.addEventListener('click', function(e) {
      if (!wrap.contains(e.target) && activeIdx !== null) {
        activeIdx = null;
        hoveredIdx = null;
        applyLayout();
      }
    });

    wrap.appendChild(stack);
    wrap.appendChild(chipsRow);
    wrap.appendChild(hintEl);
    container.appendChild(wrap);

    computeMetrics();
    applyLayout();

    var onResize = function() {
      computeMetrics();
      applyLayout();
    };
    window.addEventListener('resize', onResize, { passive: true });
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(onResize);
      ro.observe(container);
    }
  }

  window.CardStack = {
    mount: function(container, options) {
      createCardStack(container, options);
    }
  };
})();
