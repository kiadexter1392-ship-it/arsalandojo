/* ============================================================
   افزونه‌های پنل شاگرد: نمودار پیشرفته، فیش شهریه، اعلان هدفمند، نصب PWA
   ============================================================ */
(function (root) {
  'use strict';

  const { api, toast, modal, closeModal, esc, fa, heatClass } = UI;
  const J = root.Jalali;

  const NOTIF_TYPES = {
    reminder_tuition: { label: 'یادآوری شهریه', cls: 'gold' },
    reminder_absence: { label: 'پیگیری غیبت', cls: 'red' },
    tuition_review: { label: 'بررسی فیش', cls: 'blue' },
    plan: { label: 'تمرین جدید', cls: 'blue' },
    feedback: { label: 'بازخورد مربی', cls: 'green' },
    progress: { label: 'ثبت پیشرفت', cls: 'gold' },
    welcome: { label: 'خوش‌آمدگویی', cls: 'green' },
    message: { label: 'پیام مربی', cls: 'dark' }
  };

  const CHART_METRICS = [
    { key: 'overall', label: 'نمره کل', max: 100, unit: '٪' },
    { key: 'endurance', label: 'استقامت', max: 100, unit: '٪' },
    { key: 'strength', label: 'قدرت', max: 100, unit: '٪' },
    { key: 'technique', label: 'تکنیک', max: 100, unit: '٪' },
    { key: 'flexibility', label: 'انعطاف', max: 100, unit: '٪' },
    { key: 'discipline', label: 'انضباط', max: 100, unit: '٪' },
    { key: 'sessions', label: 'جلسات تمرین', max: null, unit: 'جلسه' },
    { key: 'weight_kg', label: 'وزن', max: null, unit: 'کیلوگرم' }
  ];

  const RECEIPT_STATUS = {
    pending: { label: 'در انتظار تایید مربی', cls: 'gold' },
    approved: { label: 'تایید شده ✓', cls: 'green' },
    rejected: { label: 'نیاز به بررسی مجدد', cls: 'red' }
  };

  const TUITION_STATUS = {
    paid: { label: 'شهریه این ماه تایید شد ✓', cls: 'green' },
    pending: { label: 'فیش در انتظار بررسی مربی', cls: 'gold' },
    due_soon: { label: 'در انتظار پرداخت شهریه', cls: 'gold' },
    overdue: { label: 'فیش این ماه ثبت نشده', cls: 'red' },
    unpaid: { label: 'هنوز فیشی برای این ماه ثبت نشده', cls: 'dark' }
  };

  /* -------------------- Feature 4: PWA Install Helper -------------------- */
  let deferredInstallPrompt = null;
  let installDone = false;
  const DISMISS_KEY = 'arslan_pwa_dismissed_v1';

  root.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    root.dispatchEvent(new CustomEvent('arslan-pwa-ready'));
  });
  root.addEventListener('appinstalled', () => {
    installDone = true;
    deferredInstallPrompt = null;
    toast('اپلیکیشن ارسلان دوجو روی دستگاه شما نصب شد ✓', 'ok');
  });

  function isStandaloneOrBridge() {
    if (installDone) return true;
    if (root.AndroidDojoBridge) return true;
    if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return true;
    if (root.navigator && root.navigator.standalone === true) return true;
    return false;
  }

  function openPwaGuideModal() {
    const ua = String(navigator.userAgent || '');
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    modal({
      title: 'راهنمای نصب ارسلان دوجو روی موبایل',
      body: `
        <div class="stack" style="gap:12px">
          ${isIOS ? `
            <div class="card" style="background:var(--bg-2)">
              <div class="bold" style="margin-bottom:6px">آیفون و آیپد (Safari)</div>
              <ol class="small muted" style="margin:0;padding-inline-start:20px;line-height:1.9">
                <li>دکمه اشتراک‌گذاری (Share / مربع با فلش بالا) را در پایین سافاری بزنید.</li>
                <li>گزینه <b>Add to Home Screen</b> (افزودن به صفحه اصلی) را انتخاب کنید.</li>
                <li>روی <b>Add</b> بزنید تا آیکون باشگاه روی صفحه اصلی ظاهر شود.</li>
              </ol>
            </div>` : `
            <div class="card" style="background:var(--bg-2)">
              <div class="bold" style="margin-bottom:6px">اندروید (Google Chrome)</div>
              <ol class="small muted" style="margin:0;padding-inline-start:20px;line-height:1.9">
                <li>روی منوی سه‌نقطه (⋮) بالای مرورگر کروم بزنید.</li>
                <li>گزینه <b>Install app</b> یا <b>Add to Home screen</b> را انتخاب کنید.</li>
                <li>نصب را تایید کنید تا دسترسی سریع بدون نیاز به مرورگر داشته باشید.</li>
              </ol>
            </div>`}
          <p class="tiny muted">با نصب نسخه وب‌اپ، پنل شاگرد با ظاهر تمام‌صفحه و دسترسی سریع‌تر اجرا می‌شود.</p>
        </div>`,
      actions: [{ label: 'متوجه شدم', class: 'primary', onClick: closeModal }]
    });
  }

  function renderPwaCard(container, options = {}) {
    if (!container) return;
    const forceShow = !!options.alwaysShowIfEligible;
    if (isStandaloneOrBridge()) {
      container.innerHTML = '';
      return;
    }
    try {
      if (!forceShow && localStorage.getItem(DISMISS_KEY) === '1') {
        container.innerHTML = '';
        return;
      }
    } catch { /* ignore */ }

    const hasPrompt = !!deferredInstallPrompt;
    container.innerHTML = `
      <div class="card pwa-install-card">
        <div class="row between wrap" style="gap:12px">
          <div class="grow">
            <div class="bold">نصب نسخه وب‌اپ ارسلان دوجو روی گوشی</div>
            <p class="tiny muted" style="margin:4px 0 0">دسترسی یک‌کلیکی از صفحه اصلی موبایل بدون نیاز به باز کردن مرورگر و تایپ آدرس.</p>
          </div>
          <div class="row wrap" style="gap:8px">
            ${hasPrompt ? '<button type="button" class="btn sm primary" id="pwaDirectInstallBtn">نصب مستقیم وب‌اپ</button>' : ''}
            <button type="button" class="btn sm ${hasPrompt ? 'ghost' : 'primary'}" id="pwaGuideBtn">راهنمای نصب موبایل</button>
            ${forceShow ? '' : '<button type="button" class="btn sm ghost" id="pwaDismissBtn">فعلاً نه</button>'}
          </div>
        </div>
      </div>`;

    const directBtn = container.querySelector('#pwaDirectInstallBtn');
    if (directBtn) {
      directBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return openPwaGuideModal();
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
        deferredInstallPrompt = null;
        if (choice && choice.outcome === 'accepted') {
          container.innerHTML = '';
        } else {
          renderPwaCard(container, options);
        }
      });
    }
    container.querySelector('#pwaGuideBtn')?.addEventListener('click', openPwaGuideModal);
    container.querySelector('#pwaDismissBtn')?.addEventListener('click', () => {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
      container.innerHTML = '';
    });
  }

  /* --------------- Feature 5: Targeted Unread Notifications -------------- */
  function notifMeta(type) {
    return NOTIF_TYPES[type] || { label: 'اعلان', cls: 'dark' };
  }

  function renderUnreadBanner(container, { notifications = [], announcements = [], onRefresh }) {
    if (!container) return;
    const unreadNotifs = notifications.filter((n) => !n.read);
    const unreadAnns = announcements.filter((a) => !a.read);
    const total = unreadNotifs.length + unreadAnns.length;
    if (!total) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="card unread-banner-card" role="region" aria-label="اعلان‌ها و پیام‌های خوانده‌نشده">
        <div class="card-head wrap" style="margin-bottom:10px">
          <div class="card-title">
            <span class="dot" style="background:var(--red);box-shadow:0 0 10px var(--red)"></span>
            پیام‌ها و یادآوری‌های جدید
            <span class="badge red">${fa(total)}</span>
          </div>
          ${unreadNotifs.length ? '<button type="button" class="btn sm ghost" id="readAllNotifsBtn">همه اعلان‌ها را خواندم ✓</button>' : ''}
        </div>
        <div class="stack" style="gap:8px">
          ${unreadNotifs.slice(0, 5).map((n) => {
            const meta = notifMeta(n.type);
            return `
              <div class="unread-item" data-notif-row="${n.id}">
                <div class="grow">
                  <div class="row wrap" style="gap:6px;margin-bottom:2px">
                    <span class="badge ${meta.cls}">${esc(meta.label)}</span>
                    <strong style="font-size:13.5px">${esc(n.title)}</strong>
                  </div>
                  ${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}
                  <div class="tiny muted">${J.timeAgo(n.created_at)}</div>
                </div>
                <button type="button" class="btn sm primary" data-mark-notif="${n.id}">خوانده شد ✓</button>
              </div>`;
          }).join('')}
          ${unreadAnns.slice(0, 3).map((a) => `
            <div class="unread-item" data-ann-row="${a.id}">
              <div class="grow">
                <div class="row wrap" style="gap:6px;margin-bottom:2px">
                  <span class="badge blue">${esc(a.category || 'اطلاعیه')}</span>
                  <strong style="font-size:13.5px">${a.pinned ? '📌 ' : ''}${esc(a.title)}</strong>
                </div>
                <div class="tiny muted">${J.timeAgo(a.created_at)}</div>
              </div>
              <div class="row" style="gap:6px">
                <button type="button" class="btn sm ghost" data-open-ann="${a.id}">مشاهده</button>
                <button type="button" class="btn sm" data-mark-ann="${a.id}">خوانده شد ✓</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    container.querySelectorAll('[data-mark-notif]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api(`/api/notifications/${btn.dataset.markNotif}/read`, { method: 'POST' });
          if (onRefresh) await onRefresh();
        } catch (err) {
          toast(err.message, 'warn');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-mark-ann]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api(`/api/announcements/${btn.dataset.markAnn}/read`, { method: 'POST' });
          if (onRefresh) await onRefresh();
        } catch (err) {
          toast(err.message, 'warn');
          btn.disabled = false;
        }
      });
    });

    const allBtn = container.querySelector('#readAllNotifsBtn');
    if (allBtn) {
      allBtn.addEventListener('click', async () => {
        allBtn.disabled = true;
        try {
          await api('/api/notifications/read', { method: 'POST' });
          toast('همه اعلان‌ها خوانده شد', 'ok');
          if (onRefresh) await onRefresh();
        } catch (err) {
          toast(err.message, 'warn');
          allBtn.disabled = false;
        }
      });
    }
  }

  /* -------------- Feature 2: Advanced Progress Analytics Chart ----------- */
  function renderProgressAnalytics(container, { progress, year, months }) {
    if (!container) return;
    let selectedRange = 'all';
    let selectedMetric = 'overall';

    function draw() {
      const metric = CHART_METRICS.find((m) => m.key === selectedMetric) || CHART_METRICS[0];
      const recordedAll = [];
      for (let m = 1; m <= 12; m += 1) {
        const row = progress[m];
        if (row && row[metric.key] !== null && row[metric.key] !== undefined && Number.isFinite(Number(row[metric.key]))) {
          recordedAll.push({ month: m, val: Number(row[metric.key]), row });
        }
      }

      let filtered = recordedAll;
      if (selectedRange === 'h1') filtered = recordedAll.filter((r) => r.month <= 6);
      else if (selectedRange === 'h2') filtered = recordedAll.filter((r) => r.month >= 7);
      else if (selectedRange === 'last3') filtered = recordedAll.slice(-3);

      const maxVal = metric.max || Math.max(10, ...filtered.map((r) => r.val), 1);

      // Trend delta between the latest two recorded observations in filtered (or full year)
      let deltaHTML = '<span class="tiny muted">برای محاسبه روند تغییر، حداقل دو ماه ثبت‌شده لازم است.</span>';
      if (filtered.length >= 2) {
        const prev = filtered[filtered.length - 2];
        const curr = filtered[filtered.length - 1];
        const diff = Number((curr.val - prev.val).toFixed(1));
        const sign = diff > 0 ? '+' : '';
        const cls = diff > 0 ? 'green' : diff < 0 ? 'red' : 'dark';
        deltaHTML = `
          <span class="badge ${cls}">
            ${sign}${fa(diff)} ${esc(metric.unit)} نسبت به ${esc(months[prev.month - 1])}
          </span>
          <span class="tiny muted">(${esc(months[prev.month - 1])}: ${fa(prev.val)} ← ${esc(months[curr.month - 1])}: ${fa(curr.val)})</span>`;
      }

      // Two-month full comparison card using real recorded months of the year
      const allRecordedMonths = Object.keys(progress).map(Number).sort((a, b) => a - b);
      let compareHTML = '<p class="tiny muted">برای مقایسه دو ماه، باید حداقل دو ماه در جدول پیشرفت سال ثبت شده باشد.</p>';
      if (allRecordedMonths.length >= 2) {
        const mPrev = allRecordedMonths[allRecordedMonths.length - 2];
        const mCurr = allRecordedMonths[allRecordedMonths.length - 1];
        const rPrev = progress[mPrev];
        const rCurr = progress[mCurr];
        const rowsHtml = CHART_METRICS.map((cm) => {
          const v1 = rPrev[cm.key];
          const v2 = rCurr[cm.key];
          if ((v1 === null || v1 === undefined) && (v2 === null || v2 === undefined)) return '';
          let badge = '<span class="tiny">—</span>';
          if (v1 !== null && v1 !== undefined && v2 !== null && v2 !== undefined) {
            const d = Number((Number(v2) - Number(v1)).toFixed(1));
            const cls = cm.key === 'weight_kg' ? 'dark' : (d > 0 ? 'green' : d < 0 ? 'red' : 'dark');
            badge = `<span class="badge ${cls}">${d > 0 ? '+' : ''}${fa(d)}</span>`;
          }
          return `
            <tr>
              <td class="bold">${esc(cm.label)}</td>
              <td>${v1 === null || v1 === undefined ? '—' : fa(v1)}</td>
              <td>${v2 === null || v2 === undefined ? '—' : fa(v2)}</td>
              <td>${badge}</td>
            </tr>`;
        }).filter(Boolean).join('');

        compareHTML = rowsHtml ? `
          <div class="table-wrap"><table class="data compact">
            <thead><tr>
              <th>شاخص</th>
              <th>${esc(months[mPrev - 1])} ${fa(year)}</th>
              <th>${esc(months[mCurr - 1])} ${fa(year)}</th>
              <th>تغییر</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>` : '<p class="tiny muted">شاخص قابل مقایسه‌ای بین دو ماه اخیر ثبت نشده است.</p>';
      }

      container.innerHTML = `
        <div class="stack">
          <div class="card member-progress-dashboard">
            <div class="card-head wrap">
              <div>
                <div class="card-title">نمودار تحلیلی پیشرفت (${esc(metric.label)})</div>
                <div class="row wrap" style="gap:8px;margin-top:6px">${deltaHTML}</div>
              </div>
              <div class="row wrap" style="gap:8px">
                <select id="progMetricSel" aria-label="انتخاب شاخص نمودار" style="width:150px">
                  ${CHART_METRICS.map((m) => `<option value="${m.key}" ${m.key === selectedMetric ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
                </select>
                <div class="chip-row">
                  <button type="button" class="chip ${selectedRange === 'all' ? 'active' : ''}" data-prange="all">کل سال</button>
                  <button type="button" class="chip ${selectedRange === 'h1' ? 'active' : ''}" data-prange="h1">نیمه اول</button>
                  <button type="button" class="chip ${selectedRange === 'h2' ? 'active' : ''}" data-prange="h2">نیمه دوم</button>
                  <button type="button" class="chip ${selectedRange === 'last3' ? 'active' : ''}" data-prange="last3">۳ ماه اخیر</button>
                </div>
              </div>
            </div>
            ${filtered.length ? `
              <div class="member-progress-chart" role="list" aria-label="نمره‌های واقعی ${esc(metric.label)}">
                ${filtered.map((item) => {
                  const pct = Math.max(4, Math.min(100, Math.round((item.val / maxVal) * 100)));
                  return `
                    <div class="member-progress-column" role="listitem" aria-label="${esc(months[item.month - 1])}: ${fa(item.val)}">
                      <span>${fa(item.val)}</span>
                      <div class="member-progress-track"><i style="height:${pct}%"></i></div>
                      <small>${esc(months[item.month - 1])}</small>
                    </div>`;
                }).join('')}
              </div>` : `<div class="empty"><span class="big">📊</span>در این بازه داده‌ای برای «${esc(metric.label)}» ثبت نشده است</div>`}
          </div>

          <div class="card">
            <div class="card-head">
              <div class="card-title"><span class="dot" style="background:var(--purple,#6d28d9)"></span> مقایسه دو ماه ثبت‌شده اخیر</div>
            </div>
            ${compareHTML}
          </div>
        </div>`;

      container.querySelector('#progMetricSel').addEventListener('change', (e) => {
        selectedMetric = e.target.value;
        draw();
      });
      container.querySelectorAll('[data-prange]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedRange = btn.dataset.prange;
          draw();
        });
      });
    }

    draw();
  }

  /* -------------- Feature 3: Tuition Receipt Upload & History ------------ */
  function compressReceiptFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
        return reject(new Error('لطفاً فقط تصویر با فرمت PNG، JPG یا WEBP انتخاب کنید'));
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('خواندن فایل تصویر ناموفق بود'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('فایل تصویر معتبر نیست'));
        img.onload = () => {
          const maxDim = 1200;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            const scale = Math.min(maxDim / w, maxDim / h);
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          if (dataUrl.length > 1700000) {
            return reject(new Error('حجم تصویر پس از فشرده‌سازی همچنان بالاست؛ تصویر کم‌حجم‌تری انتخاب کنید'));
          }
          resolve(dataUrl);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderTuitionReceiptSection(container, { paymentData, currentPeriod, care, receipts, onSubmitted }) {
    if (!container) return;
    let compressedImage = null;
    const statusInfo = TUITION_STATUS[(care && care.tuition_status) || 'unpaid'] || TUITION_STATUS.unpaid;

    container.innerHTML = `
      <div class="stack">
        <div class="card">
          <div class="card-head wrap">
            <div class="card-title"><span class="dot" style="background:var(--green)"></span> ارسال و ثبت فیش شهریه</div>
            <span class="badge ${statusInfo.cls}">${esc(statusInfo.label)}</span>
          </div>
          <p class="tiny muted" style="margin-bottom:12px">
            پس از کارت‌به‌کارت، اطلاعات رسید را همین‌جا ثبت کنید تا برای مربی ارسال شود و در سوابق شما بماند.
          </p>

          <div class="row wrap" style="gap:6px;margin-bottom:14px">
            <span class="tiny muted">مبلغ سریع بر اساس رشته:</span>
            ${(paymentData.pricing || []).map((p) => {
              const toman = Number(p.priceNum || 0) * 1000;
              return `<button type="button" class="btn sm ghost" data-fill-amount="${toman}">${esc(p.discipline)} (${esc(p.price)})</button>`;
            }).join('')}
          </div>

          <form id="tuitionReceiptForm" class="col" style="gap:12px">
            <div class="grid-3">
              <div class="field"><label>ماه شهریه *</label>
                <select name="month" required>
                  ${J.MONTHS.map((mn, i) => `<option value="${i + 1}" ${(currentPeriod && currentPeriod.month === i + 1) ? 'selected' : ''}>${esc(mn)}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>سال *</label>
                <input name="year" type="number" min="1400" max="1450" value="${esc(currentPeriod ? currentPeriod.year : J.toJalali(new Date()).jy)}" required>
              </div>
              <div class="field"><label>مبلغ واریزی (تومان) *</label>
                <input name="amount_toman" id="receiptAmountInput" type="number" min="1000" step="1000" placeholder="مثلاً 1900000" required>
              </div>
            </div>
            <div class="grid-2">
              <div class="field"><label>شماره پیگیری / ارجاع *</label>
                <input name="tracking_code" class="en" dir="ltr" minlength="3" maxlength="64" placeholder="مثلاً 98451230" required>
              </div>
              <div class="field"><label>۴ رقم آخر کارت مبدأ (اختیاری)</label>
                <input name="card_last4" class="en" dir="ltr" maxlength="4" pattern="\\d{4}" placeholder="مثلاً 6279">
              </div>
            </div>
            <div class="field"><label>تصویر رسید یا اسکرین‌شات (اختیاری — PNG/JPG)</label>
              <input type="file" id="receiptFileInput" accept="image/png,image/jpeg,image/webp">
              <div id="receiptPreviewBox" style="margin-top:8px"></div>
            </div>
            <div class="field"><label>توضیحات (اختیاری)</label>
              <textarea name="note" rows="2" maxlength="500" placeholder="مثلاً: واریز شهریه فروردین از کارت ملت"></textarea>
            </div>
            <div><button type="submit" class="btn primary">ارسال فیش برای تایید مربی</button></div>
          </form>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title"><span class="dot"></span> فیش‌های ارسالی من <span class="badge dark">${fa((receipts || []).length)}</span></div>
          </div>
          ${(receipts && receipts.length) ? `
            <div class="stack" style="gap:10px">
              ${receipts.map((r) => {
                const st = RECEIPT_STATUS[r.status] || RECEIPT_STATUS.pending;
                return `
                  <div class="card" style="background:var(--bg-2);padding:14px">
                    <div class="row between wrap" style="gap:10px">
                      <div class="grow">
                        <div class="row wrap" style="gap:8px;align-items:center">
                          <strong>${esc(J.MONTHS[r.month - 1] || r.month)} ${fa(r.year)}</strong>
                          <span class="badge ${st.cls}">${esc(st.label)}</span>
                          <span class="badge gold">${fa(Number(r.amount_toman).toLocaleString('en-US'))} تومان</span>
                        </div>
                        <div class="tiny muted" style="margin-top:6px">
                          کد پیگیری: <span class="en">${esc(r.tracking_code)}</span>
                          ${r.card_last4 ? ` · کارت ****${esc(r.card_last4)}` : ''}
                          · ثبت: ${J.timeAgo(r.created_at)}
                        </div>
                        ${r.note ? `<div class="tiny" style="margin-top:4px">یادداشت شما: ${esc(r.note)}</div>` : ''}
                        ${r.coach_note ? `<div class="hint" style="margin-top:8px">پاسخ مربی: ${esc(r.coach_note)}</div>` : ''}
                      </div>
                      ${(r.has_receipt_image || r.receipt_image) ? `<button type="button" class="btn sm ghost" data-view-receipt-img="${r.id}">مشاهده تصویر فیش</button>` : ''}
                    </div>
                  </div>`;
              }).join('')}
            </div>` : '<div class="empty"><span class="big">🧾</span>هنوز فیشی از این پنل ارسال نکرده‌اید</div>'}
        </div>
      </div>`;

    container.querySelectorAll('[data-fill-amount]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inp = container.querySelector('#receiptAmountInput');
        if (inp) inp.value = btn.dataset.fillAmount;
      });
    });

    const fileInput = container.querySelector('#receiptFileInput');
    const previewBox = container.querySelector('#receiptPreviewBox');
    fileInput?.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) {
        compressedImage = null;
        previewBox.innerHTML = '';
        return;
      }
      previewBox.innerHTML = '<span class="tiny muted">در حال آماده‌سازی تصویر...</span>';
      try {
        compressedImage = await compressReceiptFile(f);
        previewBox.innerHTML = `
          <div class="row wrap" style="gap:10px;align-items:center">
            <img src="${esc(compressedImage)}" decoding="async" alt="پیش‌نمایش فیش" style="max-height:96px;border-radius:10px;border:1px solid var(--line)">
            <button type="button" class="btn sm danger" id="clearReceiptImgBtn">حذف تصویر</button>
          </div>`;
        previewBox.querySelector('#clearReceiptImgBtn')?.addEventListener('click', () => {
          compressedImage = null;
          fileInput.value = '';
          previewBox.innerHTML = '';
        });
      } catch (err) {
        compressedImage = null;
        fileInput.value = '';
        previewBox.innerHTML = '';
        toast(err.message, 'warn');
      }
    });

    const form = container.querySelector('#tuitionReceiptForm');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const body = {};
        new FormData(form).forEach((v, k) => { body[k] = v; });
        if (compressedImage) body.receipt_image = compressedImage;
        await api('/api/tuition/receipts', { method: 'POST', body });
        toast('فیش شهریه با موفقیت ثبت و برای مربی ارسال شد ✓', 'ok');
        if (onSubmitted) await onSubmitted();
      } catch (err) {
        toast(err.message, 'warn', 5000);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    container.querySelectorAll('[data-view-receipt-img]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rec = (receipts || []).find((x) => String(x.id) === btn.dataset.viewReceiptImg);
        if (!rec || (!rec.has_receipt_image && !rec.receipt_image)) return;
        const src = rec.receipt_image || `${UI.PATH_PREFIX}/api/tuition/receipts/${encodeURIComponent(rec.id)}/image`;
        modal({
          title: `تصویر فیش ${J.MONTHS[rec.month - 1]} ${fa(rec.year)}`,
          wide: true,
          body: `<div style="text-align:center"><img src="${esc(src)}" decoding="async" alt="تصویر فیش پرداخت" style="max-width:100%;max-height:70vh;border-radius:12px"></div>`,
          actions: [{ label: 'بستن', class: 'ghost', onClick: closeModal }]
        });
      });
    });
  }

  root.MemberExtras = {
    NOTIF_TYPES,
    notifMeta,
    renderPwaCard,
    openPwaGuideModal,
    renderUnreadBanner,
    renderProgressAnalytics,
    renderTuitionReceiptSection
  };
}(window));
