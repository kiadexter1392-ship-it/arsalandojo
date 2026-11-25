/* ============================================================
   ماژول حضور و غیاب، بررسی فیش شهریه و یادآوری سریع — پنل مربی
   ============================================================ */
(function (root) {
  'use strict';

  const { api, toast, modal, closeModal, esc, fa, avatar, PATH_PREFIX } = UI;
  const J = root.Jalali;

  const RECEIPT_STATUS = {
    pending: { label: 'در انتظار تایید', cls: 'gold' },
    approved: { label: 'تایید شده', cls: 'green' },
    rejected: { label: 'رد شده', cls: 'red' }
  };

  const TUITION_STATUS = {
    paid: { label: 'پرداخت‌شده', cls: 'green' },
    pending: { label: 'فیش در انتظار', cls: 'gold' },
    due_soon: { label: 'نزدیک سررسید', cls: 'gold' },
    overdue: { label: 'معوق', cls: 'red' },
    unpaid: { label: 'ثبت‌نشده', cls: 'dark' }
  };

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  async function render(box, { tab = 'attendance', onTabChange, onDataChanged, members = [] } = {}) {
    let activeTab = tab;

    box.innerHTML = `
      <div class="card">
        <div class="card-head wrap">
          <div class="card-title"><span class="dot"></span> مدیریت حضور و غیاب و شهریه</div>
          <div class="chip-row">
            <button type="button" class="chip ${activeTab === 'attendance' ? 'active' : ''}" data-care-tab="attendance">حضور و غیاب روزانه</button>
            <button type="button" class="chip ${activeTab === 'tuition' ? 'active' : ''}" data-care-tab="tuition">بررسی فیش و شهریه</button>
          </div>
        </div>
        <div id="careBody"><div class="center" style="padding:36px"><span class="loader"></span></div></div>
      </div>`;

    box.querySelectorAll('[data-care-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.careTab;
        if (onTabChange) onTabChange(activeTab);
        box.querySelectorAll('[data-care-tab]').forEach((c) => c.classList.toggle('active', c.dataset.careTab === activeTab));
        loadTab();
      });
    });

    async function loadTab() {
      const target = box.querySelector('#careBody');
      target.innerHTML = '<div class="center" style="padding:36px"><span class="loader"></span></div>';
      if (activeTab === 'attendance') await renderAttendanceTab(target, onDataChanged);
      else await renderTuitionTab(target, { onDataChanged, members });
    }

    await loadTab();
  }

  async function renderAttendanceTab(target, onDataChanged) {
    let selectedDate = todayISO();
    let discFilter = '';

    async function loadAndDraw() {
      const d = await api('/api/attendance?date=' + encodeURIComponent(selectedDate));
      const allMembers = d.members || [];
      const disciplines = [...new Set(allMembers.map((m) => m.discipline).filter(Boolean))];
      const rows = allMembers.filter((m) => !discFilter || m.discipline === discFilter);
      const jalaliLabel = J.formatJalali(new Date(selectedDate + 'T12:00:00'));

      target.innerHTML = `
        <div class="stack">
          <div class="row between wrap" style="gap:10px">
            <div class="row wrap" style="gap:8px;align-items:center">
              <label class="tiny bold" for="attDateInp">تاریخ جلسه:</label>
              <input type="date" id="attDateInp" value="${esc(selectedDate)}" max="${todayISO()}" class="en" dir="ltr" style="width:155px">
              <span class="badge dark">${esc(jalaliLabel)}</span>
              <select id="attDiscFilter" style="width:140px">
                <option value="">همه رشته‌ها</option>
                ${disciplines.map((x) => `<option value="${esc(x)}" ${discFilter === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
              </select>
            </div>
            <div class="row wrap" style="gap:8px">
              <button type="button" class="btn sm ghost" id="attMarkAllPresent">همه حاضر ✓</button>
              <button type="button" class="btn sm primary" id="attSaveAllBtn">ذخیره حضور و غیاب</button>
            </div>
          </div>

          ${rows.length ? `
            <div class="table-wrap"><table class="data compact" id="attTable">
              <thead><tr>
                <th>شاگرد</th><th>رشته</th><th>وضعیت جلسه</th><th>یادداشت</th><th>وضعیت پیگیری</th>
              </tr></thead>
              <tbody>
                ${rows.map((m) => `
                  <tr data-att-uid="${m.id}">
                    <td>
                      <div class="row" style="gap:8px">
                        ${avatar(m, 'sm')}
                        <div>
                          <div class="bold">${esc(m.full_name)}</div>
                          <div class="tiny muted">${esc(m.belt || '—')}</div>
                        </div>
                      </div>
                    </td>
                    <td>${esc(m.discipline || '—')}</td>
                    <td>
                      <div class="chip-row" role="group" aria-label="وضعیت حضور ${esc(m.full_name)}">
                        <button type="button" class="chip ${m.status === 'present' ? 'active' : ''}" data-att-set="present">حاضر</button>
                        <button type="button" class="chip ${m.status === 'absent' ? 'active' : ''}" data-att-set="absent">غایب</button>
                        <button type="button" class="chip ${m.status === 'excused' ? 'active' : ''}" data-att-set="excused">موجه</button>
                      </div>
                    </td>
                    <td><input type="text" class="att-note-inp" value="${esc(m.note || '')}" placeholder="توضیح کوتاه..." style="min-width:140px"></td>
                    <td>
                      ${m.consecutive_absences >= 2 ? `
                        <div class="row wrap" style="gap:6px">
                          <span class="badge red">${fa(m.consecutive_absences)} غیبت متوالی</span>
                          <button type="button" class="btn sm ghost" data-remind-absence="${m.id}">یادآوری غیبت</button>
                        </div>` : `<span class="tiny muted">${m.consecutive_absences === 1 ? '۱ غیبت اخیر' : 'منظم'}</span>`}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table></div>` : '<div class="empty"><span class="big">📋</span>شاگرد فعالی یافت نشد</div>'}
        </div>`;

      target.querySelector('#attDateInp')?.addEventListener('change', (e) => {
        if (!e.target.value) return;
        selectedDate = e.target.value;
        loadAndDraw();
      });
      target.querySelector('#attDiscFilter')?.addEventListener('change', (e) => {
        discFilter = e.target.value;
        loadAndDraw();
      });

      target.querySelectorAll('[data-att-set]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('tr');
          row.dataset.selectedStatus = btn.dataset.attSet;
          row.querySelectorAll('[data-att-set]').forEach((c) => c.classList.toggle('active', c === btn));
        });
      });

      target.querySelector('#attMarkAllPresent')?.addEventListener('click', () => {
        target.querySelectorAll('#attTable tbody tr').forEach((row) => {
          row.dataset.selectedStatus = 'present';
          row.querySelectorAll('[data-att-set]').forEach((c) => c.classList.toggle('active', c.dataset.attSet === 'present'));
        });
      });

      target.querySelector('#attSaveAllBtn')?.addEventListener('click', async () => {
        const entries = [];
        target.querySelectorAll('#attTable tbody tr').forEach((row) => {
          const activeChip = row.querySelector('[data-att-set].active');
          const status = row.dataset.selectedStatus || (activeChip ? activeChip.dataset.attSet : null);
          if (!status) return;
          const note = row.querySelector('.att-note-inp')?.value || '';
          entries.push({ user_id: Number(row.dataset.attUid), status, note });
        });
        if (!entries.length) {
          toast('حداقل وضعیت یک شاگرد را انتخاب کنید', 'warn');
          return;
        }
        const btn = target.querySelector('#attSaveAllBtn');
        btn.disabled = true;
        try {
          const r = await api('/api/attendance', { method: 'POST', body: { session_date: selectedDate, entries } });
          toast(`حضور و غیاب ${fa(r.saved)} شاگرد ذخیره شد ✓`, 'ok');
          if (onDataChanged) await onDataChanged();
          await loadAndDraw();
        } catch (err) {
          toast(err.message, 'warn');
          btn.disabled = false;
        }
      });

      target.querySelectorAll('[data-remind-absence]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await api(`/api/members/${btn.dataset.remindAbsence}/remind`, { method: 'POST', body: { kind: 'absence' } });
            toast('پیام پیگیری غیبت برای شاگرد ارسال شد ✓', 'ok');
          } catch (err) {
            toast(err.message, 'warn');
            btn.disabled = false;
          }
        });
      });
    }

    await loadAndDraw();
  }

  async function renderTuitionTab(target, { onDataChanged, members = [] } = {}) {
    let statusFilter = 'pending';

    async function loadAndDraw() {
      const [recData, memData] = await Promise.all([
        api('/api/tuition/receipts' + (statusFilter ? '?status=' + encodeURIComponent(statusFilter) : '')),
        members.length ? Promise.resolve({ members }) : api('/api/members')
      ]);
      const receipts = recData.receipts || [];
      const memberList = memData.members || [];
      const followupMembers = memberList.filter((m) => m.active && m.tuition_status !== 'paid' && m.tuition_status !== 'pending');

      target.innerHTML = `
        <div class="stack">
          <div class="row between wrap" style="gap:10px">
            <div class="chip-row">
              <button type="button" class="chip ${statusFilter === 'pending' ? 'active' : ''}" data-rec-filter="pending">در انتظار (${fa(recData.pendingCount || 0)})</button>
              <button type="button" class="chip ${statusFilter === '' ? 'active' : ''}" data-rec-filter="">همه فیش‌ها</button>
              <button type="button" class="chip ${statusFilter === 'approved' ? 'active' : ''}" data-rec-filter="approved">تاییدشده</button>
              <button type="button" class="chip ${statusFilter === 'rejected' ? 'active' : ''}" data-rec-filter="rejected">ردشده</button>
            </div>
            <button type="button" class="btn sm ghost" id="exportTuitionCsvBtn">خروجی اکسل شهریه (CSV)</button>
          </div>

          <div class="stack" style="gap:10px">
            ${receipts.length ? receipts.map((r) => {
              const st = RECEIPT_STATUS[r.status] || RECEIPT_STATUS.pending;
              return `
                <div class="card" style="background:var(--bg-2);padding:16px" data-receipt-card="${r.id}">
                  <div class="row between wrap" style="gap:12px">
                    <div class="row" style="gap:10px">
                      ${avatar({ full_name: r.full_name, avatar_color: r.avatar_color }, 'sm')}
                      <div>
                        <div class="bold">${esc(r.full_name)} <span class="badge ${st.cls}">${esc(st.label)}</span></div>
                        <div class="tiny muted">
                          ${esc(J.MONTHS[r.month - 1] || r.month)} ${fa(r.year)}
                          · ${fa(Number(r.amount_toman).toLocaleString('en-US'))} تومان
                          · کد پیگیری: <span class="en">${esc(r.tracking_code)}</span>
                          ${r.card_last4 ? ` · کارت ****${esc(r.card_last4)}` : ''}
                        </div>
                        ${r.note ? `<div class="tiny" style="margin-top:4px">یادداشت شاگرد: ${esc(r.note)}</div>` : ''}
                      </div>
                    </div>
                    <div class="row wrap" style="gap:6px">
                      ${r.receipt_image ? `<button type="button" class="btn sm ghost" data-show-receipt-img="${r.id}">مشاهده تصویر فیش</button>` : '<span class="tiny muted">بدون تصویر</span>'}
                    </div>
                  </div>
                  <div class="row wrap" style="gap:8px;margin-top:12px;align-items:center">
                    <input type="text" class="grow" data-coach-note="${r.id}" value="${esc(r.coach_note || '')}" placeholder="توضیح مربی برای شاگرد (اختیاری)..." style="min-width:190px">
                    <button type="button" class="btn sm primary" data-review-id="${r.id}" data-review-status="approved">تایید فیش ✓</button>
                    <button type="button" class="btn sm danger" data-review-id="${r.id}" data-review-status="rejected">رد فیش</button>
                  </div>
                </div>`;
            }).join('') : '<div class="empty"><span class="big">🧾</span>فیشی در این وضعیت یافت نشد</div>'}
          </div>

          <div class="card" style="background:var(--bg-2)">
            <div class="card-head wrap">
              <div class="card-title"><span class="dot" style="background:var(--red)"></span> شاگردان نیازمند یادآوری شهریه ماه جاری</div>
              <span class="badge dark">${fa(followupMembers.length)} نفر</span>
            </div>
            ${followupMembers.length ? followupMembers.map((m) => {
              const ts = TUITION_STATUS[m.tuition_status] || TUITION_STATUS.unpaid;
              return `
                <div class="list-item">
                  ${avatar(m, 'sm')}
                  <div class="grow">
                    <div class="title">${esc(m.full_name)} <span class="badge ${ts.cls}">${esc(ts.label)}</span></div>
                    <div class="tiny muted">${esc(m.discipline || m.style || '—')} · ${esc(m.belt || '—')}</div>
                  </div>
                  <button type="button" class="btn sm ghost" data-remind-tuition="${m.id}">ارسال یادآوری شهریه</button>
                </div>`;
            }).join('') : '<p class="tiny muted">همه شاگردان فعال شهریه ماه جاری را ثبت یا پرداخت کرده‌اند ✓</p>'}
          </div>
        </div>`;

      target.querySelectorAll('[data-rec-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          statusFilter = btn.dataset.recFilter;
          loadAndDraw();
        });
      });

      target.querySelector('#exportTuitionCsvBtn')?.addEventListener('click', () => {
        window.open(PATH_PREFIX + '/api/export/tuition', '_blank');
      });

      target.querySelectorAll('[data-show-receipt-img]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const rec = receipts.find((x) => String(x.id) === btn.dataset.showReceiptImg);
          if (!rec || !rec.receipt_image) return;
          modal({
            title: `فیش ${rec.full_name} — ${J.MONTHS[rec.month - 1]} ${fa(rec.year)}`,
            wide: true,
            body: `<div style="text-align:center"><img src="${rec.receipt_image}" alt="فیش پرداخت" style="max-width:100%;max-height:72vh;border-radius:12px"></div>`,
            actions: [{ label: 'بستن', class: 'ghost', onClick: closeModal }]
          });
        });
      });

      target.querySelectorAll('[data-review-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.reviewId;
          const status = btn.dataset.reviewStatus;
          const noteInput = target.querySelector(`[data-coach-note="${id}"]`);
          const coach_note = noteInput ? noteInput.value : '';
          btn.disabled = true;
          try {
            await api(`/api/tuition/receipts/${id}/review`, { method: 'POST', body: { status, coach_note } });
            toast(status === 'approved' ? 'فیش تایید و به شاگرد اطلاع داده شد ✓' : 'فیش رد و به شاگرد اطلاع داده شد', 'ok');
            if (onDataChanged) await onDataChanged();
            await loadAndDraw();
          } catch (err) {
            toast(err.message, 'warn');
            btn.disabled = false;
          }
        });
      });

      target.querySelectorAll('[data-remind-tuition]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await api(`/api/members/${btn.dataset.remindTuition}/remind`, { method: 'POST', body: { kind: 'tuition' } });
            toast('یادآوری شهریه برای شاگرد ارسال شد ✓', 'ok');
          } catch (err) {
            toast(err.message, 'warn');
            btn.disabled = false;
          }
        });
      });
    }

    await loadAndDraw();
  }

  root.CoachCare = { render, TUITION_STATUS };
}(window));
