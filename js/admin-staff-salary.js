// ── 월급계산기 (스태프 월급 가챠권) ──────────────────
// 어드민 > 월급계산기 탭. 권한 판정·추첨·지급 검증은 전부 서버가 한다
// (staff_salary_list / create / draw RPC + 지급 SQL 트리거). 여기는 표시와 호출만.
// 의존: sb (auth.js), createPager · escapeHtml (main.js)

const SALARY_SIZE = {
  small:  { label: '소형', range: '10~30' },
  medium: { label: '중형', range: '30~70' },
  large:  { label: '대형', range: '50~100' },
};

const SALARY_ERROR_TEXT = {
  NOT_AUTHENTICATED: '로그인이 필요해요.',
  FORBIDDEN:         '권한이 없어요.',
  NOT_FOUND:         '가챠권을 찾을 수 없어요.',
  NOT_OWNER:         '본인 가챠권만 돌릴 수 있어요.',
  INVALID_SIZE:      '규모를 선택해주세요.',
  TASK_REQUIRED:     '작업명을 입력해주세요.',
  TASK_TOO_LONG:     '작업명은 100자 이내로 입력해주세요.',
  TARGET_NOT_OPERATOR: '관리자·스태프만 지급 대상으로 선택할 수 있어요.',
  CANCELED:          '지급 취소된 가챠권이에요.',
  ALREADY_PAID:      '이미 재화가 지급된 건이라 삭제·취소할 수 없어요.',
  ALREADY_DRAWN:     '이미 추첨된 건이에요. 삭제 대신 지급 취소를 사용해주세요.',
  NOT_DRAWN:         '추첨 전 건이에요. 지급 취소 대신 삭제를 사용해주세요.',
};

const SALARY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let salaryViewerId   = null;
let salaryViewerRole = null;
let salaryTickets    = [];
const salaryDrawing  = new Set();   // 중복 클릭 방지 (서버도 행 잠금으로 막는다)
const salaryBusy     = new Set();   // 삭제·취소 중복 클릭 방지
let salarySqlTicket  = null;

const salaryPager = createPager(renderSalaryRows, 'pgSalary');

function salaryErrorText(code, fallback) {
  return SALARY_ERROR_TEXT[code] || fallback || '처리 중 오류가 발생했어요.';
}

function salaryStatus(t) {
  if (t.canceled_at)           return { key: 'canceled',  label: '지급 취소' };
  if (t.result_amount == null) return { key: 'wait_draw', label: '추첨 대기' };
  if (!t.paid)                 return { key: 'wait_pay',  label: '지급 대기' };
  return                              { key: 'paid',      label: '지급 완료' };
}

function salaryDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\. /g, '.').replace(/\.$/, '');
}

// ── 불러오기 ──────────────────────────────
async function loadStaffSalary() {
  const empty = document.getElementById('salaryEmpty');
  const { data, error } = await sb.rpc('staff_salary_list');

  if (error || !data?.ok) {
    salaryTickets = [];
    salaryPager.load([]);
    empty.textContent = error ? '목록을 불러오지 못했어요.' : salaryErrorText(data?.code);
    empty.style.display = 'block';
    document.getElementById('salaryAdminForm').style.display = 'none';
    return;
  }

  salaryViewerId   = data.viewer_id;
  salaryViewerRole = data.viewer_role;
  salaryTickets    = data.tickets || [];

  const isAdmin = salaryViewerRole === 'admin';
  document.getElementById('salaryAdminForm').style.display = isAdmin ? 'flex' : 'none';
  if (isAdmin) renderSalaryStaffOptions(data.staff_options || []);

  applySalaryFilter();
}

function renderSalaryStaffOptions(list) {
  const sel  = document.getElementById('salaryStaff');
  const prev = sel.value;
  sel.innerHTML = '<option value="">대상 선택</option>' + list.map(s =>
    `<option value="${escapeHtml(s.id)}">${escapeHtml(s.nickname || '(닉네임 없음)')}${s.role === 'admin' ? ' (관리자)' : ''}${s.id === salaryViewerId ? ' · 나' : ''}</option>`
  ).join('');
  if (prev && list.some(s => s.id === prev)) sel.value = prev;
}

// ── 필터 (기본: 최신순, 지급 취소 건 제외) ─────
function applySalaryFilter() {
  const mine     = document.getElementById('salaryFilterMine').checked;
  const waitPay  = document.getElementById('salaryFilterWaitPay').checked;
  const canceled = document.getElementById('salaryFilterCanceled').checked;
  const list = salaryTickets.filter(t =>
    (canceled || !t.canceled_at) &&
    (!mine    || t.target_user_id === salaryViewerId) &&
    (!waitPay || salaryStatus(t).key === 'wait_pay'));

  const empty = document.getElementById('salaryEmpty');
  empty.textContent = salaryTickets.length ? '조건에 맞는 가챠권이 없어요.' : '등록된 가챠권이 없어요.';
  empty.style.display = list.length ? 'none' : 'block';
  salaryPager.load(list);
}

// ── 목록 ──────────────────────────────────
function renderSalaryRows(slice) {
  const isAdmin = salaryViewerRole === 'admin';
  document.getElementById('salaryTableBody').innerHTML = slice.map(t => {
    const size   = SALARY_SIZE[t.size] || { label: t.size, range: '' };
    const status = salaryStatus(t);
    const id     = escapeHtml(t.id);

    let drawCell;
    if (t.result_amount != null) {
      // 취소 건도 추첨 결과는 보존·표시
      drawCell = `<span class="salary-result${t.canceled_at ? ' salary-result-canceled' : ''}">${Number(t.result_amount)} 연구기록</span>`;
    } else if (t.target_user_id === salaryViewerId) {
      const busy = salaryDrawing.has(t.id);
      drawCell = `<button class="salary-draw-btn" onclick="drawStaffSalary('${id}')" ${busy ? 'disabled' : ''}>${busy ? '추첨 중...' : '가챠 돌리기'}</button>`;
    } else {
      drawCell = `<button class="salary-draw-btn" disabled title="본인 가챠권만 돌릴 수 있어요">가챠 돌리기</button>`;
    }

    const busy = salaryBusy.has(t.id) ? 'disabled' : '';
    let adminBtns = '';
    if (isAdmin && status.key === 'wait_pay') {
      adminBtns = `
      <button class="admin-btn-edit" onclick="openSalarySql('${id}')">지급 SQL 보기</button>
      <button class="admin-btn-edit" onclick="copySalarySql('${id}', this)">지급 SQL 복사</button>
      <button class="admin-btn-delete" onclick="cancelStaffSalary('${id}')" ${busy}>지급 취소</button>`;
    } else if (isAdmin && status.key === 'wait_draw') {
      adminBtns = `<button class="admin-btn-delete" onclick="deleteStaffSalary('${id}')" ${busy}>삭제</button>`;
    }
    const canceledInfo = t.canceled_at
      ? `<span class="admin-card-date">취소 ${salaryDate(t.canceled_at)} · ${escapeHtml(t.canceled_by_nickname || '관리자')}</span>` : '';

    return `
      <div class="admin-card-row">
        <div class="admin-card-left" style="flex-wrap:wrap; row-gap:4px;">
          <span class="admin-card-name" style="flex-shrink:0;">${escapeHtml(t.target_nickname || '(알 수 없음)')}</span>
          <span class="salary-size salary-size-${escapeHtml(t.size)}">${escapeHtml(size.label)}</span>
          <span class="salary-task">${escapeHtml(t.task_name)}</span>
          <span class="admin-card-date">${salaryDate(t.created_at)}</span>
          ${canceledInfo}
        </div>
        <div class="admin-card-right" style="flex-wrap:wrap;">
          ${drawCell}
          <span class="salary-status salary-status-${status.key}">${status.label}</span>
          ${adminBtns}
        </div>
      </div>`;
  }).join('');
}

// ── 등록 (관리자) ──────────────────────────
async function submitStaffSalary() {
  const btn   = document.getElementById('salarySubmitBtn');
  const err   = document.getElementById('salaryFormError');
  const staff = document.getElementById('salaryStaff').value;
  const size  = document.getElementById('salarySize').value;
  const task  = document.getElementById('salaryTask').value.trim();
  err.textContent = '';

  if (!staff) { err.textContent = '지급 대상을 선택해주세요.'; return; }
  if (!size)  { err.textContent = '규모를 선택해주세요.'; return; }
  if (!task)  { err.textContent = '작업명을 입력해주세요.'; return; }

  btn.disabled = true;
  const { data, error } = await sb.rpc('staff_salary_create', {
    p_target_user_id: staff, p_size: size, p_task_name: task,
  });
  btn.disabled = false;

  if (error || !data?.ok) {
    err.textContent = error ? '등록 중 오류가 발생했어요.' : salaryErrorText(data.code);
    return;
  }
  // 같은 사람·규모로 연달아 등록하기 쉽게 작업명만 비운다
  document.getElementById('salaryTask').value = '';
  await loadStaffSalary();
}

// ── 추첨 (본인) ───────────────────────────
async function drawStaffSalary(ticketId) {
  if (salaryDrawing.has(ticketId)) return;
  salaryDrawing.add(ticketId);
  salaryPager._draw();

  const { data, error } = await sb.rpc('staff_salary_draw', { p_ticket_id: ticketId });
  salaryDrawing.delete(ticketId);

  if (error || !data?.ok) {
    alert(error ? '추첨 중 오류가 발생했어요. 새로고침 후 다시 확인해주세요.' : salaryErrorText(data.code));
    await loadStaffSalary();
    return;
  }

  const t = salaryTickets.find(x => x.id === ticketId);
  if (t) {
    t.result_amount = data.result_amount;
    t.drawn_at      = data.drawn_at;
  }
  salaryPager._draw();
}

// ── 삭제 (관리자, 추첨 전) / 지급 취소 (관리자, 추첨 완료·미지급) ──
// 권한·상태 검증과 행 잠금은 서버 RPC 가 한다. 여기 상태 판단은 버튼 노출용.
function salaryConfirmText(t, action) {
  const size = SALARY_SIZE[t.size]?.label || t.size;
  const head = action === 'delete'
    ? '이 가챠권을 삭제할까요? 삭제하면 되돌릴 수 없어요.'
    : `이 가챠권의 지급을 취소할까요?\n추첨 결과(${Number(t.result_amount)} 연구기록)는 기록으로 남고, 이후 추첨·지급 SQL 실행이 모두 막혀요.`;
  return `${head}\n\n대상: ${t.target_nickname || '(알 수 없음)'}\n규모: ${size}\n작업명: ${t.task_name}`;
}

async function salaryAdminAction(ticketId, action) {
  const t = salaryTickets.find(x => x.id === ticketId);
  if (!t || salaryBusy.has(ticketId)) return;
  if (!confirm(salaryConfirmText(t, action))) return;

  salaryBusy.add(ticketId);
  salaryPager._draw();
  const { data, error } = await sb.rpc(action === 'delete' ? 'staff_salary_delete' : 'staff_salary_cancel',
                                       { p_ticket_id: ticketId });
  salaryBusy.delete(ticketId);

  if (error || !data?.ok) {
    alert(error ? '처리 중 오류가 발생했어요. 새로고침 후 다시 확인해주세요.' : salaryErrorText(data.code));
  }
  // 성공·실패 모두 서버 상태로 다시 그린다(다른 관리자가 먼저 지급·취소했을 수 있음)
  await loadStaffSalary();
}

function deleteStaffSalary(ticketId) { return salaryAdminAction(ticketId, 'delete'); }
function cancelStaffSalary(ticketId) { return salaryAdminAction(ticketId, 'cancel'); }

// ── 지급 SQL (관리자) ──────────────────────
// SQL 에 넣는 값은 형식 검증된 UUID 3개와 정수 1개뿐이다. 작업명·닉네임 같은 자유 입력은
// 넣지 않고, 메모는 DB 가 staff_salary_note(지급건 ID)로 직접 만든다 → 따옴표·줄바꿈이 있어도 SQL 이 깨지지 않는다.
// service_role 키 없음: Supabase SQL Editor 에서 실행하는 SQL 이다.
// adminId 는 "SQL 을 발급한 관리자" 기록용일 뿐 실행자 인증이 아니다(SQL Editor 에는 웹 로그인 정보가 없다).
function buildStaffSalaryPayoutSql(t, adminId) {
  const amount = Number(t?.result_amount);
  if (!SALARY_UUID_RE.test(t?.id || '') || !SALARY_UUID_RE.test(t?.target_user_id || '') || !SALARY_UUID_RE.test(adminId || '')) {
    throw new Error('UUID 형식이 올바르지 않아요.');
  }
  if (!Number.isInteger(amount) || amount < 10 || amount > 100) {
    throw new Error('추첨 결과가 올바르지 않아요.');
  }
  const sizeLabel = SALARY_SIZE[t.size]?.label;
  if (!sizeLabel) throw new Error('규모 값이 올바르지 않아요.');
  // 화면 차단. 실제 차단은 DB(지급 원장 트리거)가 한다 — 취소 전에 복사한 SQL 도 실행 시 전체 롤백
  if (t.canceled_at) throw new Error('지급 취소된 가챠권이라 지급 SQL 을 만들 수 없어요.');
  if (t.paid) throw new Error('이미 지급 완료된 가챠권이에요.');

  return `-- ============================================================
-- 스태프 월급 지급 — 지급건 ${t.id}
-- 규모: ${sizeLabel} / 연구기록 ${amount}
-- Supabase SQL Editor 에서 전체를 한 번에 실행하세요.
--   · 잔액 갱신 + currency_logs 기록 + 지급 완료 처리를 한 트랜잭션에서 한다.
--   · 같은 SQL 을 다시 실행해도 중복 지급되지 않는다(결과 status = already_paid).
--   · 지갑이 없거나 값이 DB 확정값과 다르면 오류 → 전체 롤백(지급 완료로 기록되지 않음).
--   · issued_by = 이 SQL 을 만든 어드민 화면 로그인 관리자. DB 는 "현재 admin 역할" 인지만 검사하며
--     SQL 실행자 본인 확인은 아니다(실행 DB 계정은 executed_db_user 에 따로 기록).
-- ============================================================
BEGIN;

WITH params AS (
  SELECT
    '${t.id}'::uuid AS ticket_id,
    '${t.target_user_id}'::uuid AS target_user_id,
    ${amount}::integer AS research_records_amount,
    0::integer AS keys_amount,
    '${adminId}'::uuid AS issued_by
),
target_ticket AS (
  -- 미지급·추첨 완료·값 일치 건만 잠근다. 동시에 실행돼도 뒤 실행은 지급 완료를 보고 0건이 된다.
  SELECT t.id AS ticket_id, t.target_user_id, public.staff_salary_note(t.id) AS note
    FROM public.staff_salary_tickets t
    JOIN params p ON p.ticket_id = t.id
   WHERE t.target_user_id = p.target_user_id
     AND t.result_amount  = p.research_records_amount
     AND t.paid = false
   FOR UPDATE OF t
),
updated_wallet AS (
  UPDATE public.user_wallets w
     SET research_records = w.research_records + p.research_records_amount,
         keys             = w.keys + p.keys_amount,
         updated_at       = now()
    FROM params p
    JOIN target_ticket tt ON tt.ticket_id = p.ticket_id
   WHERE w.user_id = tt.target_user_id
  RETURNING w.user_id, w.research_records, w.keys
),
inserted_logs AS (
  INSERT INTO public.currency_logs (user_id, type, source, currency, amount, balance_after, note)
  SELECT uw.user_id, 'admin_grant', 'admin_manual_grant', 'research_records',
         p.research_records_amount, uw.research_records, tt.note
    FROM updated_wallet uw
    CROSS JOIN params p
    CROSS JOIN target_ticket tt
   WHERE p.research_records_amount > 0
  RETURNING id, user_id, currency, amount, balance_after, note
),
recorded_payout AS (
  INSERT INTO public.staff_salary_payouts (ticket_id, target_user_id, amount, currency_log_id, issued_by)
  SELECT p.ticket_id, il.user_id, il.amount, il.id, p.issued_by
    FROM inserted_logs il
    CROSS JOIN params p
  RETURNING ticket_id, paid_at
)
SELECT public.staff_salary_payout_result(
         p.ticket_id,
         p.keys_amount,
         (SELECT count(*)::integer FROM target_ticket),
         (SELECT count(*)::integer FROM updated_wallet),
         (SELECT count(*)::integer FROM inserted_logs),
         (SELECT count(*)::integer FROM recorded_payout)
       ) AS result
  FROM params p;

COMMIT;
`;
}

function salarySqlFor(ticketId) {
  const t = salaryTickets.find(x => x.id === ticketId);
  if (!t) throw new Error('가챠권을 찾을 수 없어요.');
  return buildStaffSalaryPayoutSql(t, adminUser?.id);
}

function openSalarySql(ticketId) {
  let sql;
  try { sql = salarySqlFor(ticketId); } catch (e) { alert(e.message); return; }
  const t = salaryTickets.find(x => x.id === ticketId);
  salarySqlTicket = ticketId;
  document.getElementById('salarySqlNote').textContent = t.note ? `메모: ${t.note}` : '';
  document.getElementById('salarySqlPre').textContent = sql;
  document.getElementById('salarySqlModal').style.display = 'flex';
}

function closeSalarySql() {
  document.getElementById('salarySqlModal').style.display = 'none';
  salarySqlTicket = null;
}

async function copySalarySql(ticketId, btn) {
  let sql;
  try { sql = salarySqlFor(ticketId); } catch (e) { alert(e.message); return; }
  try {
    await navigator.clipboard.writeText(sql);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = sql;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  // 복사만으로는 지급 완료가 되지 않는다 — SQL 실행 후 새로고침해야 상태가 바뀐다
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = '복사됨';
    setTimeout(() => { btn.textContent = prev; }, 1500);
  }
}
