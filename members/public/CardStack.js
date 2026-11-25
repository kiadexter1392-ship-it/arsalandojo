/* ══ CardStack — Classic Fan Pricing Cards with Responsive Bounds ══
   Vanilla JS. Renders all disciplines with Nano Banana background artwork,
   classic stacked rest & fan-out animation, and strict viewport containment.
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

  function defaultCardImage(discipline) {
    var d = String(discipline || '');
    var prefix = window.UI && window.UI.PATH_PREFIX ? window.UI.PATH_PREFIX : '';
    var file = 'card-karate.jpg';
    if (d.includes('کاراته') && (d.includes('نونهال') || d.includes('کودک'))) file = 'card-karate-kids.jpg';
    else if (d.includes('کاراته')) file = 'card-karate.jpg';
    else if (d.includes('کراسفیت') && (d.includes('کودک') || d.includes('نونهال'))) file = 'card-crossfit-kids.jpg';
    else if (d.includes('کراسفیت')) file = 'card-crossfit.jpg';
    else if (d.includes('بوکس')) file = 'card-boxing.jpg';
    else if (d.includes('ژیمناستیک')) file = 'card-gym.jpg';
    else if (d.includes('موی تای') || d.includes('موی‌تای')) file = 'card-muaythai.jpg';
    return prefix + '/images/' + file + '?v=3';
  }

  function computeFanMetrics(containerW, n) {
    var availW = Math.max(240, Math.min(containerW || 340, 660));
    var compact = availW < 480;

    var cardW = compact
      ? Math.max(108, Math.min(144, Math.floor(availW * 0.37)))
      : 160;
    var cardH = compact
      ? Math.round(cardW * 1.36)
      : 220;
    var stackOffset = 6;
    var lift = compact ? 18 : 24;
    var padY = compact ? 24 : 30;
    var pivotY = compact ? Math.round(cardH * 0.62) : Math.round(cardH * 1.05);

    var maxHalfCount = Math.max(1, (n - 1) / 2);
    var maxOuterAngleDeg = compact ? 11 : 22;
    var fanAngle = Math.min(compact ? 3.8 : 7.5, maxOuterAngleDeg / maxHalfCount);
    var outerRad = (fanAngle * maxHalfCount * Math.PI) / 180;
    var activeScale = 1.05;

    var pivotReachY = Math.max(cardH / 2, pivotY);
    var rotatedHalfW = ((cardW / 2) * Math.cos(outerRad) + pivotReachY * Math.sin(outerRad)) * activeScale;
    var safeMargin = compact ? 10 : 14;
    var maxSpreadHalf = Math.max(8, availW / 2 - rotatedHalfW - safeMargin);
    var fanSpread = Math.min(compact ? maxSpreadHalf * 2 : 240, maxSpreadHalf * 2);

    var containerH = Math.ceil(cardH * activeScale) + padY * 2 + lift;

    return {
      compact: compact,
      cardW: cardW,
      cardH: cardH,
      stackOffset: stackOffset,
      lift: lift,
      activeScale: activeScale,
      containerW: availW,
      containerH: containerH,
      centerX: availW / 2,
      centerY: containerH / 2 + (compact ? 6 : 10),
      fanAngle: fanAngle,
      fanSpread: fanSpread,
      maxSpreadHalf: maxSpreadHalf,
      pivotY: pivotY
    };
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

    var hintEl = document.createElement('div');
    hintEl.className = 'stk-hint';
    hintEl.textContent = 'برای مشاهده قیمت هر رشته، روی کارت بزنید یا نشانگر را نگه دارید';

    var activeIdx = null;
    var hoveredIdx = null;
    var cardEls = [];
    var metrics = null;

    function measureAndCompute() {
      var docW = document.documentElement ? document.documentElement.clientWidth : window.innerWidth;
      var hostW = container.clientWidth || wrap.clientWidth || (docW - 32);
      var boundedW = Math.min(hostW, Math.max(240, docW - 24), 660);
      metrics = computeFanMetrics(boundedW, n);
      stack.style.width = metrics.containerW + 'px';
      stack.style.height = metrics.containerH + 'px';
    }

    function applyLayout() {
      if (!metrics) measureAndCompute();
      var focusIdx = hoveredIdx !== null ? hoveredIdx : activeIdx;
      var isOpen = focusIdx !== null;

      for (var j = 0; j < n; j++) {
        var el = cardEls[j];
        var isFocus = j === focusIdx;

        el.style.width = metrics.cardW + 'px';
        el.style.height = metrics.cardH + 'px';
        el.style.left = metrics.centerX + 'px';
        el.style.top = metrics.centerY + 'px';
        el.style.transformOrigin = '50% ' + metrics.pivotY + 'px';

        if (!isOpen) {
          var ro = -(n - 1 - j) * metrics.stackOffset;
          var rr = (j - (n - 1) / 2) * 1.5;
          el.style.transform =
            'translate(-50%, calc(-50% + ' + ro + 'px)) rotate(' + rr.toFixed(2) + 'deg)';
          el.style.zIndex = String(j + 1);
          el.classList.remove('is-active');
        } else {
          var norm = n > 1 ? (j - (n - 1) / 2) / ((n - 1) / 2) : 0;
          var fx = Math.max(-metrics.maxSpreadHalf, Math.min(metrics.maxSpreadHalf, norm * (metrics.fanSpread / 2)));
          var fr = (j - (n - 1) / 2) * metrics.fanAngle;
          var liftY = isFocus ? metrics.lift : 0;
          var scaleStr = isFocus ? ' scale(' + metrics.activeScale + ')' : '';

          el.style.transform =
            'translate(calc(-50% + ' + fx.toFixed(1) + 'px), calc(-50% - ' + liftY + 'px)) rotate(' + fr.toFixed(2) + 'deg)' + scaleStr;
          el.style.zIndex = isFocus ? '100' : String(j + 1);
          el.classList.toggle('is-active', isFocus);
        }
      }
    }

    function selectCard(idx) {
      if (activeIdx === idx) {
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
        var imgSrc = card.image || defaultCardImage(card.discipline);

        var el = document.createElement('div');
        el.className = 'stk-cs-card';
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', card.discipline + ' — ' + card.price + ' هزار تومان');

        el.innerHTML =
          '<div class="stk-cs-face">' +
            '<img class="stk-cs-bg" src="' + escapeHtml(imgSrc) + '" alt="" loading="eager" decoding="async" draggable="false">' +
            '<div class="stk-cs-scrim" aria-hidden="true"></div>' +
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
          selectCard(idx);
        });

        el.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectCard(idx);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            activeIdx = (idx + 1) % n;
            applyLayout();
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            activeIdx = (idx - 1 + n) % n;
            applyLayout();
          }
        });

        cardEls.push(el);
        stack.appendChild(el);
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
    wrap.appendChild(hintEl);
    container.appendChild(wrap);

    measureAndCompute();
    applyLayout();

    var onResize = function() {
      measureAndCompute();
      applyLayout();
    };
    window.addEventListener('resize', onResize, { passive: true });
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(onResize);
      ro.observe(container);
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(onResize);
    }
  }

  window.CardStack = {
    mount: function(container, options) {
      createCardStack(container, options);
    },
    _computeFanMetrics: computeFanMetrics
  };
})();
