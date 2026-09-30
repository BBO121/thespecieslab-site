// ── 이벤트 출석 (출석 페이지 탭) ─────────────────────────────
// 서버 RPC get_event_attendance_status() 가 노출 기간(서버 KST 날짜)인 이벤트만 내려준다.
// LOCAL/DEV 는 sidebar.js fetchEventAttendanceStatus() 가 미리보기 RPC(운영진 전용, 서버 판정)를 먼저 쓴다 — UI 미리보기만.
//   → 이벤트가 없으면(공개 전 포함) 탭/출석판 DOM 을 아예 만들지 않는다. 일일 출석 화면은 그대로.
//   → 이벤트명/보상 문구는 이 파일에 없다(전부 서버 응답). 공개 여부 판정에 클라이언트 시계를 쓰지 않는다.
// 수령은 claim_event_attendance(event_code) 만 호출 — 일차/보상/날짜는 서버가 결정한다.
// 일일 출석(attendance.js / record_attendance)은 건드리지 않는다.

// 모든 일차 카드 중앙 = 기존 일일 출석 도장 1종(보상별 아이템 이미지 없음). 미출석=희미 / 출석 완료=선명 (CSS)
const EVT_STAMP_IMG = '../images/attendance_stamp.png';

let _evtEvents  = [];     // 서버가 내려준 공개 이벤트
let _evtCurrent = null;   // null = 일일 출석 탭, 아니면 event code
let _evtBusy    = false;
let _evtReady   = false;  // 로그인 확인 후 true — 자정 재동기화는 로그인 사용자 화면에서만

async function initEventAttendance() {
  try {
    const user = await getUser();
    if (!user) return;
    _evtReady = true;

    const data = typeof fetchEventAttendanceStatus === 'function' ? await fetchEventAttendanceStatus(true) : null;
    if (!data || data.events.length === 0) return;   // 공개 이벤트 없음 → 아무것도 렌더링 안 함

    _evtEvents = data.events;
    renderEventTabs();

    const want = new URLSearchParams(location.search).get('event');
    if (want && _evtEvents.some(e => e.code === want)) switchAttendanceTab(want, false);
  } catch (e) {
    console.error('[event-attendance] init 오류:', e);   // 실패해도 일일 출석은 그대로
  }
}

// ── 상단 탭 [일일 출석] [이벤트…] ─────────────────────────────
function renderEventTabs() {
  const header = document.querySelector('#pageContent .list-page-header');
  const daily  = document.querySelector('#pageContent .attn-page');
  if (!header || !daily || document.getElementById('attnTabRow')) return;

  const row = document.createElement('div');
  row.id = 'attnTabRow';
  row.className = 'shop-tab-row labberlab-tab-row attn-tab-row';
  row.innerHTML =
    `<button type="button" class="shop-tab-btn active" data-tab="">일일 출석</button>` +
    _evtEvents.map(ev =>
      `<button type="button" class="shop-tab-btn" data-tab="${escapeHtml(ev.code)}">${escapeHtml(ev.title)}</button>`
    ).join('');
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('.shop-tab-btn');
    if (btn) switchAttendanceTab(btn.dataset.tab || null, true);
  });
  header.after(row);

  const panel = document.createElement('div');
  panel.id = 'attnEventPanel';
  panel.className = 'attn-event';
  panel.style.display = 'none';
  daily.after(panel);
}

function switchAttendanceTab(code, updateUrl) {
  const ev = code ? _evtEvents.find(e => e.code === code) : null;
  _evtCurrent = ev ? ev.code : null;

  document.querySelectorAll('#attnTabRow .shop-tab-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.tab || null) === _evtCurrent));

  document.querySelector('#pageContent .attn-page').style.display = ev ? 'none' : '';
  const panel = document.getElementById('attnEventPanel');
  panel.style.display = ev ? '' : 'none';

  // LABBER 이벤트 = 기존 LABBER 페이지와 동일한 body.labber-theme 토글(새 테마 없음). 일일 출석으로 돌아오면 해제.
  document.body.classList.toggle('labber-theme', !!ev && ev.theme === 'labber');

  if (ev) renderEventBoard(ev);

  // 사이드바 출석 depth active 동기화 (sidebar.js refreshEventAttendanceMenu 가 만든 경우에만 존재)
  document.querySelectorAll('#bodyAttendance a').forEach(a =>
    a.classList.toggle('active', (new URL(a.href).searchParams.get('event') || null) === _evtCurrent));

  if (updateUrl) {
    const url = new URL(location.href);
    if (ev) url.searchParams.set('event', ev.code); else url.searchParams.delete('event');
    history.replaceState(null, '', url);
  }
}

// ── 7일 출석판 ────────────────────────────────────────────
function renderEventBoard(ev, resultMsg) {
  const panel = document.getElementById('attnEventPanel');
  if (!panel) return;

  const prog      = ev.progress || { count: 0, claimed_today: false, completed: false, can_claim: false, logs: [] };
  const total     = ev.total_days;
  const count     = prog.count || 0;
  const logByDay  = new Map((prog.logs || []).map(l => [l.day_no, l]));
  const ended     = ev.phase === 'ended';
  const nextDay   = count + 1;

  const cards = (ev.rewards || []).map(r => {
    const log     = logByDay.get(r.day_no);
    const claimed = !!log;
    const isNext  = !claimed && r.day_no === nextDay && (prog.can_claim || ev.preview === true);
    const state   = claimed ? 'is-claimed' : (isNext ? 'is-today' : 'is-locked');
    const got     = claimed && log.reward && Array.isArray(log.reward.items) && r.reward_type === 'item_pool'
      ? log.reward.items.map(i => i.name).join(' / ') : '';

    return `
      <div class="attn-event-card ${state}"${got ? ` title="${escapeHtml(got)}"` : ''}>
        <span class="attn-event-day">${r.day_no}일차</span>
        <div class="attn-event-stamp"><img src="${EVT_STAMP_IMG}" alt="${claimed ? '출석' : ''}"></div>
        <span class="attn-event-label">${escapeHtml(r.label)}</span>
        ${got ? `<span class="attn-event-got">${escapeHtml(got)}</span>` : ''}
      </div>`;
  }).join('');

  let action;
  if (prog.completed)          action = `<div class="attn-checkin-done">${total}일 출석 완료!</div>`;
  else if (ended)              action = `<div class="attn-checkin-done attn-event-ended">이벤트가 종료되었습니다</div>`;
  else if (prog.claimed_today) action = `<div class="attn-checkin-done">오늘 출석 완료! 내일 다시 만나요</div>`;
  else                         action = `<button type="button" class="attn-checkin-btn" id="attnEventClaimBtn">${nextDay}일차 출석하기</button>`;

  panel.innerHTML = `
    <div class="section attn-event-head">
      <h2 class="attn-event-title">${escapeHtml(ev.title)} <span class="attn-event-count">(${count}/${total})</span></h2>
      ${ev.preview ? '<p class="attn-event-preview">미리보기 — LOCAL/DEV 운영진 전용 화면입니다. 실제 출석은 시작일부터 가능합니다.</p>' : ''}
      <p class="attn-event-sub">${fmtEventDate(ev.start_date)} ~ ${fmtEventDate(ev.end_date)} · 기간 중 ${total}일 출석하면 모든 보상을 받을 수 있어요 (연속 출석 필요 없음, 하루 1회)</p>
    </div>
    <div class="section attn-event-board-wrap">
      <div class="attn-event-board">${cards}</div>
    </div>
    <div class="section attn-event-action">
      <div class="attn-checkin-wrap">
        ${action}
        <p class="attn-result-msg" id="attnEventMsg" style="display:none;"></p>
      </div>
    </div>`;

  document.getElementById('attnEventClaimBtn')?.addEventListener('click', () => claimEventAttendance(ev.code));
  if (resultMsg) showEventMsg(resultMsg.text, resultMsg.type);
}

function fmtEventDate(d) {
  return String(d || '').replace(/-/g, '.');
}

// ── 수령 ──────────────────────────────────────────────────
async function claimEventAttendance(code) {
  if (_evtBusy) return;                        // 더블클릭 방지(서버도 잠금 + UNIQUE 로 이중 차단)
  _evtBusy = true;
  const btn = document.getElementById('attnEventClaimBtn');
  if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

  let msg = null;
  try {
    const { data, error } = await sb.rpc('claim_event_attendance', { p_event_code: code });

    if (error || !data?.success) {
      const err = data?.error;
      msg = {
        type: 'error',
        text: err === 'ALREADY_CLAIMED_TODAY' ? '오늘은 이미 출석했어요. 내일 다시 출석해주세요.'
            : err === 'COMPLETED'            ? '모든 출석 보상을 이미 받았어요.'
            : err === 'ENDED'                ? '이벤트가 종료되었습니다.'
            : err === 'NOT_STARTED'          ? '아직 시작 전인 이벤트라 출석할 수 없어요. (NOT_STARTED)'
            : '출석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      };
    } else {
      if (typeof updateHeaderCurrencyDisplay === 'function') {
        updateHeaderCurrencyDisplay({ research_records: data.new_research, keys: data.new_keys });
      }
      msg = { type: 'success', text: eventRewardMessage(data) };
    }
  } catch (e) {
    console.error('[event-attendance] claim 오류:', e);
    msg = { type: 'error', text: '출석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' };
  }

  // 성공/실패 모두 서버 상태로 다시 그린다(날짜가 바뀌었거나 다른 탭에서 받은 경우 포함)
  try {
    const data = await fetchEventAttendanceStatus(true);
    if (data && Array.isArray(data.events)) {
      const fresh = data.events.find(e => e.code === code);
      if (fresh) {
        _evtEvents = _evtEvents.map(e => e.code === code ? fresh : e);
        if (_evtCurrent === code) renderEventBoard(fresh, msg);
      } else {
        removeEventAttendance(code);   // 노출 기간이 끝남(페이지를 열어 둔 채 날짜가 바뀐 경우) → 완전 비노출
      }
    }
  } catch (e) {
    console.error('[event-attendance] 상태 갱신 오류:', e);
    if (msg) showEventMsg(msg.text, msg.type);
  }
  _evtBusy = false;
}

// 서버가 더 이상 내려주지 않는 이벤트 → 탭/출석판/사이드바 항목 제거, 일일 출석으로 복귀
function removeEventAttendance(code) {
  _evtEvents = _evtEvents.filter(e => e.code !== code);
  if (_evtCurrent === code) switchAttendanceTab(null, true);
  document.querySelector(`#attnTabRow [data-tab="${CSS.escape(code)}"]`)?.remove();
  document.querySelectorAll('#bodyAttendance a').forEach(a => {
    if (new URL(a.href).searchParams.get('event') === code) a.remove();
  });
  if (_evtEvents.length === 0) {
    document.getElementById('attnTabRow')?.remove();
    document.getElementById('attnEventPanel')?.remove();
    // 사이드바 depth → 기존 단일 '출석' 링크로 복원 (sidebar.js 원래 마크업과 동일)
    const acc = document.getElementById('accAttendance');
    if (acc) {
      const link = document.createElement('a');
      link.href = 'attendance.html';
      link.id = 'sidebarAttendanceLink';
      link.className = 'sidebar-top-link active';
      link.textContent = '출석';
      acc.replaceWith(link);
    }
  }
}

// sidebar.js 의 KST 자정 재동기화가 호출 — 새로고침 없이 탭 생성/출석판 갱신/탭 제거.
// 공개 여부 판단은 서버 응답(data.events)만 따른다.
function onEventAttendanceSync(data) {
  if (!_evtReady || !document.querySelector('#pageContent .attn-page')) return;
  const events = Array.isArray(data && data.events) ? data.events : [];
  // 서버가 더 이상 내려주지 않는 이벤트 → 제거(노출 기간 종료)
  _evtEvents.filter(e => !events.some(n => n.code === e.code)).map(e => e.code).forEach(removeEventAttendance);
  if (!events.length) return;
  const hadTabs = !!document.getElementById('attnTabRow');
  const sameSet = hadTabs && events.length === _evtEvents.length && events.every(n => _evtEvents.some(e => e.code === n.code));
  _evtEvents = events;
  if (!sameSet) {
    document.getElementById('attnTabRow')?.remove();
    document.getElementById('attnEventPanel')?.remove();
    const keep = _evtCurrent;
    _evtCurrent = null;
    renderEventTabs();
    if (keep && events.some(e => e.code === keep)) switchAttendanceTab(keep, false);
    return;
  }
  const cur = _evtCurrent && events.find(e => e.code === _evtCurrent);
  if (cur) renderEventBoard(cur);   // 날짜가 바뀌어 '오늘 출석 완료' → '다음 일차 출석하기' 등으로 갱신
}

function eventRewardMessage(data) {
  const r    = data.reward || {};
  const head = `${data.day_no}일차 보상 수령!`;
  if (r.type === 'currency') {
    return `${head} ${r.currency === 'keys' ? '열쇠' : '연구기록'} +${Number(r.amount).toLocaleString()}`;
  }
  const names = (r.items || []).map(i => i.name);
  if (r.type === 'item_pool') {
    return `${head} ${r.label}에서 「${names.join(' / ')}」을(를) 획득했습니다. 가방에서 확인하세요.`;
  }
  return `${head} 「${names.join(', ')}」이(가) 가방에 들어왔어요. 가방에서 열어볼 수 있어요.`;
}

function showEventMsg(text, type) {
  const el = document.getElementById('attnEventMsg');
  if (!el) return;
  el.textContent   = text;
  el.className     = `attn-result-msg attn-result-msg--${type}`;
  el.style.display = '';
}

initEventAttendance();
