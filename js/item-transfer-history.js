// ── 아이템 전송 내역 (pages/item-transfer-history.html) ─────────────
// 내 가방의 아이템 전송(transfer_item) 로그 = item_logs(type='transfer_send'/'transfer_receive').
// 조회는 서버 RPC get_my_item_transfer_logs 로만 — 본인(auth.uid()) 것만, 페이지 단위로.
// 표시 UI 는 "내 지갑(my-wallet.html) > 거래 내역" 테이블을 그대로 재사용:
//   .list-page-header/.list-page-title · .section/.section-header/.wallet-section-title
//   · .transfer-filter-wrap/.transfer-filter-btn
//   · .transfer-table + .transfer-table-head/.transfer-table-row/.transfer-table-cell (그리드/보더/폰트)
//   · .wallet-log-type-badge + .wallet-log-type--send/--receive (구분 뱃지)
//   · 모바일: 내 지갑과 동일 방식 — PC 셀 숨김 + 컴팩트 라인(.itl-m-*)
//   · .pagination/.pg-btn/.pg-gap (내 지갑 createPager 와 동일 마크업, 여기선 서버 페이지네이션)

const ITL_PER_PAGE = 20;   // 한 번에 20건

let _itlFilter = 'all';    // 'all' | 'send' | 'receive'
let _itlPage   = 1;
let _itlTotal  = 0;
let _itlBusy   = false;

// 내 지갑 fmtDate 와 동일 형식 (YYYY-MM-DD HH:mm, 브라우저 로컬 시각 — 내 지갑도 동일)
function itlFmtDate(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 테이블 헤더 — 내 지갑 거래내역과 동일 구조(.transfer-table-head > .transfer-table-cell)
const ITL_HEAD = `
  <div class="transfer-table-head">
    <div class="transfer-table-cell">일시</div>
    <div class="transfer-table-cell">구분</div>
    <div class="transfer-table-cell">아이템</div>
    <div class="transfer-table-cell">수량</div>
    <div class="transfer-table-cell">상대방</div>
  </div>`;

function itlEmptyText() {
  return _itlFilter === 'send'    ? '보낸 내역이 없습니다.'
       : _itlFilter === 'receive' ? '받은 내역이 없습니다.'
       : '전송 내역이 없습니다.';
}

async function initPage() {
  const user = await getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  document.getElementById('pageLoading').style.display = 'none';
  document.getElementById('pageContent').style.display = 'block';

  document.getElementById('itlFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn || btn.dataset.filter === _itlFilter) return;
    document.querySelectorAll('#itlFilters .transfer-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    _itlFilter = btn.dataset.filter;
    loadItl(1);
  });

  loadItl(1);
}

async function loadItl(page) {
  if (_itlBusy) return;
  _itlBusy = true;
  _itlPage = Math.max(1, page);

  const listEl  = document.getElementById('itlList');
  const pageEl  = document.getElementById('itlPagination');
  const countEl = document.getElementById('itlCount');

  listEl.innerHTML = `<p class="itl-loading">불러오는 중...</p>`;
  pageEl.innerHTML = '';

  try {
    const { data, error } = await sb.rpc('get_my_item_transfer_logs', {
      p_limit:  ITL_PER_PAGE,
      p_offset: (_itlPage - 1) * ITL_PER_PAGE,
      p_filter: _itlFilter,
    });
    if (error) throw error;

    const rows = data || [];
    _itlTotal = rows.length ? Number(rows[0].total_count) || rows.length : 0;
    countEl.textContent = _itlTotal ? `총 ${_itlTotal.toLocaleString()}건` : '';

    if (!rows.length) {
      // 빈 상태 — 테이블 헤더 아래에 안내 한 줄
      listEl.innerHTML = `
        <div class="transfer-table itl-log-table">
          ${ITL_HEAD}
          <div class="itl-empty-row">${itlEmptyText()}</div>
        </div>`;
      return;
    }

    listEl.innerHTML = `
      <div class="transfer-table itl-log-table">
        ${ITL_HEAD}
        ${rows.map(renderItlRow).join('')}
      </div>`;

    renderItlPagination(pageEl);
  } catch (e) {
    console.error('[item-transfer-history] 조회 오류:', e);
    listEl.innerHTML = `<p class="itl-loading">불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>`;
  } finally {
    _itlBusy = false;
  }
}

// 표 한 행 — 내 지갑 거래내역 행(.transfer-table-row > .transfer-table-cell)과 동일 골격.
// PC: 5개 셀 / 모바일: 셀 숨김 + .itl-m-line 컴팩트(내 지갑 .wlog-mobile-line1 방식과 동일).
function renderItlRow(r) {
  const isSend   = r.direction === 'send';
  const badgeCls = isSend ? 'wallet-log-type--send' : 'wallet-log-type--receive';
  const label    = isSend ? '보냄' : '받음';
  const badge    = `<span class="wallet-log-type-badge ${badgeCls}">${label}</span>`;
  const nick     = escapeHtml(r.counterpart_nickname || '(알 수 없음)');   // 닉네임만 (조사·@ 안 붙임)
  const name     = escapeHtml(r.item_name || '');
  const qty      = Number(r.quantity) || 0;
  const date     = itlFmtDate(r.created_at);

  return `
    <div class="transfer-table-row">
      <div class="transfer-table-cell itl-c-date">${date}</div>
      <div class="transfer-table-cell itl-c-type">${badge}</div>
      <div class="transfer-table-cell itl-c-item">${name}</div>
      <div class="transfer-table-cell itl-c-qty">${qty}</div>
      <div class="transfer-table-cell itl-c-nick">${nick}</div>
      <div class="itl-m-line">
        <div class="itl-m-top">
          <span class="wallet-log-type-badge ${badgeCls} itl-m-badge">${label}</span>
          <span class="itl-m-item">${name}</span>
          <span class="itl-m-date">${date}</span>
        </div>
        <div class="itl-m-bot">
          <span class="itl-m-nick">${nick}</span>
          <span class="itl-m-qty">수량 ${qty}</span>
        </div>
      </div>
    </div>`;
}

// 내 지갑 createPager 와 동일한 .pagination / .pg-btn / .pg-gap 마크업 (여기선 서버 호출로 페이지 이동)
function renderItlPagination(wrap) {
  const total = Math.ceil(_itlTotal / ITL_PER_PAGE);
  if (total <= 1) { wrap.innerHTML = ''; return; }

  const page = _itlPage;
  const set = new Set([1, total]);
  for (let i = Math.max(1, page - 2); i <= Math.min(total, page + 2); i++) set.add(i);
  const nums = [...set].sort((a, b) => a - b);

  let html = '<nav class="pagination">';
  html += `<button class="pg-btn" data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>`;
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) html += '<span class="pg-gap">…</span>';
    html += `<button class="pg-btn${n === page ? ' active' : ''}" data-p="${n}">${n}</button>`;
    prev = n;
  }
  html += `<button class="pg-btn" data-p="${page + 1}" ${page === total ? 'disabled' : ''}>›</button>`;
  html += '</nav>';

  wrap.innerHTML = html;
  wrap.querySelectorAll('.pg-btn:not([disabled])').forEach(btn =>
    btn.addEventListener('click', () => {
      loadItl(+btn.dataset.p);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );
}

initPage();
