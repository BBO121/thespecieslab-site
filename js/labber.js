// ── 수상한 연구실: 열쇠 → 연구기록 교환 + 납품 ──────────────────
// 탭 2개: [열쇠 교환] (exchange_keys_for_research_records RPC — 기존 그대로)
//         [납품]      (deliver_labber_task RPC — supabase/labber_delivery_setup_0925.sql)
const LABBER_RATE = 25;
const LABBER_LINE_DEFAULT = '열쇠는 가져왔습니까?';
const LABBER_LINE_SUCCESS = '가짜는 아니겠죠? 여기 있습니다.';
// 납품 탭 NPC A 대사 — 임시(미확정). 확정 시 이 상수만 고침.
const LABBER_DELIV_LINE_DEFAULT = '제가 부탁드린 건 잊지 않으셨겠죠.';
const LABBER_DELIV_LINE_SUCCESS = '간만에 쓸모가 있군요. 보상입니다.';

const LABBER_ERROR_MSG = {
  NOT_AUTHENTICATED: '로그인이 필요합니다.',
  INVALID_QUANTITY:  '교환 수량이 올바르지 않습니다.',
  INSUFFICIENT_KEYS: '보유한 열쇠가 부족합니다.',
  WALLET_NOT_FOUND:  '지갑 정보를 찾을 수 없습니다.',
};

let _labberUser  = null;
let _labberKeys  = 0;
let _labberQty   = 0;
let _labberBusy  = false;

async function initPage() {
  try {
    _labberUser = await getUser();
    if (!_labberUser) { window.location.href = 'login.html'; return; }

    const { data: wallet } = await getMyWallet(_labberUser.id);
    _labberKeys = wallet?.keys ?? 0;

    renderLabberWallet();
    setupLabberExchangeUI();
    setupLabberRoomTabs();
    runLabberTyping();

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[labber] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

function renderLabberWallet() {
  _labberQty = _labberKeys > 0 ? 1 : 0;
  document.getElementById('labberKeysAmt').textContent = _labberKeys.toLocaleString() + '개';
  updateLabberQtyUI();
}

function updateLabberQtyUI() {
  const qtyEl       = document.getElementById('labberQty');
  const receiveEl   = document.getElementById('labberReceive');
  const minusBtn    = document.getElementById('labberQtyMinus');
  const plusBtn     = document.getElementById('labberQtyPlus');
  const exchangeBtn = document.getElementById('labberExchangeBtn');
  const emptyState  = document.getElementById('labberEmptyState');

  if (_labberKeys <= 0) {
    qtyEl.textContent = '0';
    receiveEl.textContent = '0개';
    minusBtn.disabled = true;
    plusBtn.disabled = true;
    exchangeBtn.disabled = true;
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';
  qtyEl.textContent = _labberQty;
  receiveEl.textContent = (_labberQty * LABBER_RATE).toLocaleString() + '개';
  minusBtn.disabled = _labberBusy || _labberQty <= 1;
  plusBtn.disabled  = _labberBusy || _labberQty >= _labberKeys;
  exchangeBtn.disabled = _labberBusy;
}

function setupLabberExchangeUI() {
  document.getElementById('labberQtyMinus').addEventListener('click', () => {
    if (_labberBusy || _labberQty <= 1) return;
    _labberQty--;
    updateLabberQtyUI();
  });

  document.getElementById('labberQtyPlus').addEventListener('click', () => {
    if (_labberBusy || _labberQty >= _labberKeys) return;
    _labberQty++;
    updateLabberQtyUI();
  });

  document.getElementById('labberExchangeBtn').addEventListener('click', doLabberExchange);
}

async function doLabberExchange() {
  if (_labberBusy) return;
  if (_labberKeys <= 0 || _labberQty < 1 || _labberQty > _labberKeys) return;

  _labberBusy = true;
  const btn = document.getElementById('labberExchangeBtn');
  btn.disabled = true;
  btn.textContent = '교환 중...';
  updateLabberQtyUI();

  const qtyRequested = _labberQty;

  const { data, error } = await sb.rpc('exchange_keys_for_research_records', {
    p_quantity: qtyRequested,
  });

  // 디버깅용 상세 로그 — 사용자에게 노출되는 alert 문구는 그대로, 콘솔에만 원인을 남긴다.
  console.log('[수상한 연구실 교환 RPC] 호출 RPC명:', 'exchange_keys_for_research_records');
  console.log('[수상한 연구실 교환 RPC] p_quantity 값/타입:', qtyRequested, typeof qtyRequested);
  console.log('[수상한 연구실 교환 RPC] data:', data);
  console.error('[수상한 연구실 교환 RPC] error:', error);
  if (error) {
    console.log('[수상한 연구실 교환 RPC] error.message:', error.message);
    console.log('[수상한 연구실 교환 RPC] error.code:', error.code);
    console.log('[수상한 연구실 교환 RPC] error.details:', error.details);
    console.log('[수상한 연구실 교환 RPC] error.hint:', error.hint);
  }

  if (error || !data?.success) {
    console.error('[labber] 교환 실패:', error, data);
    alert(LABBER_ERROR_MSG[data?.error] || '교환에 실패했어요. 잠시 후 다시 시도해주세요.');
    _labberBusy = false;
    btn.textContent = '교환하기';
    updateLabberQtyUI();
    return;
  }

  _labberKeys = data.new_keys;
  _labberBusy = false;
  btn.textContent = '교환하기';
  renderLabberWallet();

  setLabberNpcLine(LABBER_LINE_SUCCESS);
  setTimeout(() => setLabberNpcLine(labberRoomDefaultLine()), 2600);

  alert(`연구기록 ${data.gained.toLocaleString()}개를 받았어요!`);
}

function setLabberNpcLine(text) {
  const el = document.getElementById('labberNpcLine');
  if (el) el.textContent = text;
}

function runLabberTyping() {
  const el = document.getElementById('labberNpcLine');
  const panel = document.getElementById('labberExchangePanel');
  if (!el || !panel) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const line = labberRoomDefaultLine(); // ?tab=delivery 로 들어오면 납품 대사로 시작

  if (reduceMotion) {
    el.textContent = line;
    panel.classList.add('show');
    return;
  }

  const speed = 55; // 글자당 40~70ms
  let i = 0;
  el.textContent = '';
  el.classList.add('labber-typing'); // 픽셀 커서 표시 (::after) — 타이핑 중에만

  (function tick() {
    if (i < line.length) {
      el.textContent += line[i];
      i++;
      setTimeout(tick, speed);
    } else {
      el.classList.remove('labber-typing');
      panel.classList.add('show');
    }
  })();
}

// ══════════════════════════════════════════════════════════
// 탭: 열쇠 교환 / 납품
// ══════════════════════════════════════════════════════════
let _labberRoomTab = new URLSearchParams(window.location.search).get('tab') === 'delivery' ? 'delivery' : 'exchange';

function labberRoomDefaultLine() {
  return _labberRoomTab === 'delivery' ? LABBER_DELIV_LINE_DEFAULT : LABBER_LINE_DEFAULT;
}

function setupLabberRoomTabs() {
  document.querySelectorAll('[data-room-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchLabberRoomTab(btn.dataset.roomTab));
  });
  applyLabberRoomTab();
}

function switchLabberRoomTab(tab) {
  if (tab === _labberRoomTab) return;
  _labberRoomTab = tab;
  applyLabberRoomTab();
  setLabberNpcLine(labberRoomDefaultLine());

  // 새로고침해도 같은 탭 유지 (?tab=delivery)
  const url = new URL(window.location.href);
  if (tab === 'delivery') url.searchParams.set('tab', 'delivery');
  else url.searchParams.delete('tab');
  history.replaceState(null, '', url);
}

function applyLabberRoomTab() {
  const isDeliv = _labberRoomTab === 'delivery';
  document.querySelectorAll('[data-room-tab]').forEach(btn => {
    const on = btn.dataset.roomTab === _labberRoomTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  // .labber-exchange-card 는 display:flex 라 hidden 속성이 안 먹음 → style 로 전환
  document.getElementById('labberExchangeCard').style.display = isDeliv ? 'none' : '';
  document.getElementById('labberDeliveryBoard').hidden = !isDeliv;
  if (isDeliv && !_delivLoaded) loadLabberDelivery({ syncAchievements: true });
}

// ══════════════════════════════════════════════════════════
// 납품
//   과제/요구 아이템/보상 정의는 DB(labber_delivery_*)에서 읽어 화면에만 쓴다.
//   납품 가능 여부·차감·보상·업적 판정은 전부 서버 RPC deliver_labber_task(task_code) 가 한다.
//   (버튼 활성/비활성은 편의 표시일 뿐 — 서버가 다시 전부 검증)
// ══════════════════════════════════════════════════════════
const LABBER_DELIV_ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const LABBER_DELIV_LOCK_SVG = '<svg class="labdeliv-stage-mark" aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const LABBER_DELIV_ERROR_MSG = {
  NOT_AUTHENTICATED:       '로그인이 필요해요.',
  INVALID_TASK:            '존재하지 않는 납품 요청이에요.',
  ALREADY_COMPLETED:       '이미 완료한 납품이에요.',
  PREVIOUS_STAGE_REQUIRED: '이전 단계를 먼저 완료해주세요.',
  TASK_MISCONFIGURED:      '납품 정보가 아직 준비되지 않았어요. 운영진에게 문의해주세요.',
  ALREADY_COMPLETED_TODAY: '오늘은 이미 완료한 납품이에요. 내일 00:00 이후 다시 납품할 수 있어요.',
};

let _delivLoaded   = false;
let _delivBusy     = false;
let _delivLines    = [];          // [{ code, name, tasks: [task...] (stage 오름차순) }]
let _delivDone     = new Set();   // 완료한 task_code
let _delivItems    = {};          // item_code -> { name, image, quantity }
let _delivSelected = {};          // line_code -> 보고 있는 stage (기본: 현재 진행 단계)

// 일일 반복 납품 (deliver_labber_daily_task RPC — supabase/labber_delivery_daily_0926.sql)
//   "오늘" 은 서버 KST 날짜(labber_kst_today)로 판정. 하루 1회 보장은 서버 PK(user_id, task_code, kst_date).
let _delivDaily      = null;      // [{ code, name, reward_*, reqs }] — null = 로드 실패(일반 납품은 그대로 표시)
let _delivDailyDone  = new Set(); // 오늘(KST) 완료한 daily task_code
let _delivRolloverTimer = null;   // 00:00 KST 지나면 자동 새로고침
let _delivSubTab     = 'normal';  // 납품 하위 탭: 'normal' | 'daily'

const delivRoman = stage => LABBER_DELIV_ROMAN[stage] || String(stage);
const delivQty   = code => _delivItems[code]?.quantity || 0;

// 일일 납품 정의 + 오늘 완료 기록. 실패해도 일반 납품 화면은 막지 않는다(null 반환).
async function loadLabberDailyDelivery(uid) {
  try {
    const { data: today, error: dayErr } = await sb.rpc('labber_kst_today');
    if (dayErr) throw dayErr;
    const [tasksRes, reqsRes, doneRes] = await Promise.all([
      sb.from('labber_daily_delivery_tasks')
        .select('code,name,reward_research_records,reward_keys,sort_order')
        .eq('is_active', true).order('sort_order'),
      sb.from('labber_daily_delivery_requirements').select('task_code,item_code,quantity,sort_order').order('sort_order'),
      sb.from('labber_daily_delivery_completions').select('task_code').eq('user_id', uid).eq('kst_date', today),
    ]);
    const err = tasksRes.error || reqsRes.error || doneRes.error;
    if (err) throw err;
    return { tasks: tasksRes.data || [], reqs: reqsRes.data || [], done: doneRes.data || [] };
  } catch (e) {
    console.warn('[labber] 일일 납품 정보 로드 실패:', e);
    return null;
  }
}

// 다음 00:00 KST 에 납품 보드를 다시 불러와 "오늘 완료" 표시를 풀어준다 (표시용 — 판정은 서버).
function scheduleDeliveryRollover() {
  clearTimeout(_delivRolloverTimer);
  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const nowKst = Date.now() + KST_OFFSET;
  const msToMidnight = 86400000 - (nowKst % 86400000) + 1500; // 경계 직후 여유 1.5초
  _delivRolloverTimer = setTimeout(() => {
    if (!_delivBusy) loadLabberDelivery();
    else scheduleDeliveryRollover();
  }, msToMidnight);
}

async function loadLabberDelivery({ syncAchievements = false } = {}) {
  const board = document.getElementById('labberDeliveryBoard');
  try {
    const uid = _labberUser.id;
    const [linesRes, tasksRes, reqsRes, doneRes, daily] = await Promise.all([
      sb.from('labber_delivery_lines').select('code,name,sort_order').order('sort_order'),
      sb.from('labber_delivery_tasks')
        .select('code,line_code,stage,reward_research_records,reward_keys')
        .eq('is_active', true).order('stage'),
      sb.from('labber_delivery_requirements').select('task_code,item_code,quantity,sort_order').order('sort_order'),
      // RLS 가 본인 행만 주지만, 명시 필터로 한 번 더 고정 (운영진 계정 오판정 방지 패턴)
      sb.from('labber_delivery_completions').select('task_code').eq('user_id', uid),
      loadLabberDailyDelivery(uid),
    ]);
    const err = linesRes.error || tasksRes.error || reqsRes.error || doneRes.error;
    if (err) throw err;

    const reqsByTask = {};
    (reqsRes.data || []).forEach(r => {
      if (!reqsByTask[r.task_code]) reqsByTask[r.task_code] = [];
      reqsByTask[r.task_code].push(r);
    });

    _delivLines = (linesRes.data || []).map(l => ({
      code: l.code,
      name: l.name,
      tasks: (tasksRes.data || [])
        .filter(t => t.line_code === l.code)
        .sort((a, b) => a.stage - b.stage)
        .map(t => ({ ...t, reqs: reqsByTask[t.code] || [] })),
    })).filter(l => l.tasks.length > 0);

    _delivDone = new Set((doneRes.data || []).map(c => c.task_code));

    if (daily) {
      const dailyReqs = {};
      daily.reqs.forEach(r => {
        if (!dailyReqs[r.task_code]) dailyReqs[r.task_code] = [];
        dailyReqs[r.task_code].push(r);
      });
      _delivDaily = daily.tasks.map(t => ({ ...t, reqs: dailyReqs[t.code] || [] }));
      _delivDailyDone = new Set(daily.done.map(c => c.task_code));
    } else {
      _delivDaily = null;
      _delivDailyDone = new Set();
    }

    const codes = [...new Set([
      ...(reqsRes.data || []).map(r => r.item_code),
      ...(daily ? daily.reqs.map(r => r.item_code) : []),
    ])];
    _delivItems = {};
    if (codes.length) {
      const { data: items, error: itemErr } = await sb
        .from('my_item_collection')
        .select('code,name,image_url,quantity')
        .in('code', codes);
      if (itemErr) throw itemErr;
      (items || []).forEach(it => {
        _delivItems[it.code] = { name: it.name || it.code, image: it.image_url || null, quantity: it.quantity || 0 };
      });
    }

    _delivLoaded = true;
    renderDeliveryBoard();
    scheduleDeliveryRollover();
  } catch (e) {
    console.error('[labber] 납품 정보 로드 실패:', e);
    board.innerHTML = '<p class="labdeliv-placeholder">납품 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>';
    return;
  }

  // 업적 복구 경로: 납품 직후 업적 처리가 실패했던 경우를 대비해 탭 첫 진입 시 1회 재확인(서버가 조건 검증, 멱등).
  // [2026-09-25] LABBER 업적 공개 전 잠금 — js/achievements.js LABBER_ACHIEVEMENT_SYNC_ENABLED 가 true 일 때만.
  if (syncAchievements && window.LABBER_ACHIEVEMENT_SYNC_ENABLED === true) {
    try {
      const { data } = await sb.rpc('sync_labber_delivery_achievements');
      showDeliveryAchievements(data?.unlocked);
    } catch (e) {
      console.warn('[labber] 납품 업적 재확인 실패:', e);
    }
  }
}

// 라인의 "현재 단계" = 아직 완료하지 않은 가장 낮은 단계. 전부 완료면 null.
function delivCurrentTask(line) {
  return line.tasks.find(t => !_delivDone.has(t.code)) || null;
}

function delivTaskState(line, task) {
  if (_delivDone.has(task.code)) return 'done';
  return delivCurrentTask(line)?.code === task.code ? 'current' : 'locked';
}

function renderDeliveryBoard() {
  const board = document.getElementById('labberDeliveryBoard');
  const normalHtml = _delivLines.length
    ? _delivLines.map(renderDeliveryLine).join('')
    : '<p class="labdeliv-placeholder">지금은 받을 수 있는 납품 요청이 없어요.</p>';

  let dailyHtml;
  if (_delivDaily === null) {
    dailyHtml = '<p class="labdeliv-placeholder">일일 납품 정보를 불러오지 못했어요.</p>';
  } else if (!_delivDaily.length) {
    dailyHtml = '<p class="labdeliv-placeholder">오늘은 받을 수 있는 일일 납품이 없어요.</p>';
  } else {
    dailyHtml = _delivDaily.map(renderDailyDeliveryTask).join('');
  }

  // 하위 탭 — 관리소 하위 탭 pill(.labber-trait-subtabs/.labber-trait-subtab) 재사용. 전환은 다시 그리기만(재조회 없음).
  const isDaily = _delivSubTab === 'daily';
  board.innerHTML = `
    <div class="labber-trait-subtabs labdeliv-subtabs" role="tablist" aria-label="납품 종류">
      <button type="button" class="labber-trait-subtab${isDaily ? '' : ' active'}" data-deliv-subtab="normal"
        role="tab" aria-selected="${!isDaily}">일반 납품</button>
      <button type="button" class="labber-trait-subtab${isDaily ? ' active' : ''}" data-deliv-subtab="daily"
        role="tab" aria-selected="${isDaily}">일일 반복 납품</button>
    </div>
    <p class="labdeliv-section-desc">${isDaily ? '항목별 하루 1회 · 매일 00:00 (KST) 초기화' : '단계별 최초 1회 완료'}</p>
    ${isDaily ? dailyHtml : normalHtml}`;

  board.querySelectorAll('[data-deliv-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_delivSubTab === btn.dataset.delivSubtab) return;
      _delivSubTab = btn.dataset.delivSubtab;
      renderDeliveryBoard();
    });
  });

  board.querySelectorAll('[data-deliv-stage]').forEach(btn => {
    btn.addEventListener('click', () => {
      _delivSelected[btn.dataset.line] = Number(btn.dataset.delivStage);
      renderDeliveryBoard();
    });
  });
  board.querySelectorAll('[data-deliver]').forEach(btn => {
    btn.addEventListener('click', () => doLabberDeliver(btn.dataset.deliver, btn));
  });
  board.querySelectorAll('[data-deliver-daily]').forEach(btn => {
    btn.addEventListener('click', () => doLabberDeliver(btn.dataset.deliverDaily, btn, { daily: true }));
  });
}

// 요구 아이템 목록 — showHave=false 면 보유량 대신 납품 수량만 (완료 상태)
function delivReqsHtml(reqs, showHave) {
  return reqs.map(r => {
    const item = _delivItems[r.item_code] || { name: r.item_code, image: null };
    const have = delivQty(r.item_code);
    const ok = have >= r.quantity;
    return `
      <li class="labdeliv-req${showHave ? (ok ? ' is-ok' : ' is-short') : ''}">
        <div class="labdeliv-thumb">${item.image
          ? `<img src="${escapeHtml(item.image)}" alt="">`
          : '<span class="labdeliv-thumb-ph" aria-hidden="true"></span>'}</div>
        <span class="labdeliv-req-name">${escapeHtml(item.name)}</span>
        <span class="labdeliv-req-qty">${showHave
          ? `보유 <strong>${have.toLocaleString()}</strong> / 필요 ${r.quantity.toLocaleString()}`
          : `×${r.quantity.toLocaleString()}`}</span>
      </li>`;
  }).join('');
}

function delivRewardHtml(task) {
  return [
    task.reward_research_records > 0
      ? `<span class="labdeliv-reward-item"><img src="../images/icons/currency-record.png" alt="" class="labber-currency-icon">연구기록 ${task.reward_research_records.toLocaleString()}</span>` : '',
    task.reward_keys > 0
      ? `<span class="labdeliv-reward-item"><img src="../images/icons/currency-key.png" alt="" class="labber-currency-icon">열쇠 ${task.reward_keys.toLocaleString()}</span>` : '',
  ].join('');
}

// 일일 반복 납품 카드 — 일반 납품 카드(.labdeliv-line)와 같은 마크업, 단계 버튼만 없음
function renderDailyDeliveryTask(task) {
  const done = _delivDailyDone.has(task.code);
  const canDeliver = !done && task.reqs.length > 0 && task.reqs.every(r => delivQty(r.item_code) >= r.quantity);

  let statusText, statusCls, btnText;
  if (done) {
    statusText = '오늘 완료'; statusCls = 'is-done'; btnText = '오늘 납품 완료 · 내일 00:00 초기화';
  } else {
    statusText = canDeliver ? '오늘 납품 가능' : '물품 부족'; statusCls = canDeliver ? 'is-ready' : 'is-short'; btnText = '납품하기';
  }

  return `
    <article class="labdeliv-line labdeliv-daily${done ? ' is-all-done' : ''}" data-line-card="daily-${escapeHtml(task.code)}">
      <div class="labdeliv-task-head">
        <h3 class="labdeliv-line-title">${escapeHtml(task.name)}</h3>
        <span class="labdeliv-status ${statusCls}">${statusText}</span>
      </div>
      <ul class="labdeliv-reqs">${delivReqsHtml(task.reqs, !done)}</ul>
      <div class="labdeliv-reward">
        <span class="labdeliv-reward-label">보상</span>
        ${delivRewardHtml(task)}
      </div>
      <button type="button" class="labdeliv-btn" ${done ? '' : `data-deliver-daily="${escapeHtml(task.code)}"`}
        ${canDeliver && !_delivBusy ? '' : 'disabled'}>${btnText}</button>
      <p class="labdeliv-msg" id="delivMsg-daily-${escapeHtml(task.code)}" role="status"></p>
    </article>`;
}

function renderDeliveryLine(line) {
  const current = delivCurrentTask(line);
  const allDone = !current;
  const selStage = _delivSelected[line.code]
    ?? (current ? current.stage : line.tasks[line.tasks.length - 1].stage);
  const task = line.tasks.find(t => t.stage === selStage) || line.tasks[0];
  const state = delivTaskState(line, task);

  const stagesHtml = line.tasks.map(t => {
    const st = delivTaskState(line, t);
    const label = st === 'done' ? '완료' : st === 'locked' ? '잠김' : '진행 가능';
    return `<button type="button" class="labdeliv-stage is-${st}${t.stage === task.stage ? ' is-selected' : ''}"
              data-line="${escapeHtml(line.code)}" data-deliv-stage="${t.stage}"
              aria-pressed="${t.stage === task.stage}" aria-label="${delivRoman(t.stage)}단계 · ${label}">
              ${st === 'done' ? '<span class="labdeliv-stage-mark" aria-hidden="true">✓</span>' : ''}${st === 'locked' ? LABBER_DELIV_LOCK_SVG : ''}${delivRoman(t.stage)}
            </button>`;
  }).join('');

  const canDeliver = state === 'current' && task.reqs.every(r => delivQty(r.item_code) >= r.quantity);

  const reqsHtml = delivReqsHtml(task.reqs, state !== 'done'); // 완료 단계는 보유량 대신 납품한 수량만
  const rewardHtml = delivRewardHtml(task);

  let statusText, btnText;
  if (state === 'done') {
    statusText = '납품 완료'; btnText = '납품 완료';
  } else if (state === 'locked') {
    statusText = '잠김'; btnText = `${delivRoman(task.stage - 1)} 단계 완료 후 해금`;
  } else {
    statusText = canDeliver ? '납품 가능' : '물품 부족'; btnText = '납품하기';
  }
  const statusCls = state === 'current' ? (canDeliver ? 'is-ready' : 'is-short') : `is-${state}`;

  return `
    <article class="labdeliv-line${allDone ? ' is-all-done' : ''}" data-line-card="${escapeHtml(line.code)}">
      <header class="labdeliv-line-head">
        <h3 class="labdeliv-line-title">${escapeHtml(line.name)}</h3>
        <div class="labdeliv-stages" role="group" aria-label="단계">${stagesHtml}</div>
      </header>
      <div class="labdeliv-task-head">
        <p class="labdeliv-task-name">${escapeHtml(line.name)} ${delivRoman(task.stage)}</p>
        <span class="labdeliv-status ${statusCls}">${statusText}</span>
      </div>
      <ul class="labdeliv-reqs">${reqsHtml}</ul>
      <div class="labdeliv-reward">
        <span class="labdeliv-reward-label">보상</span>
        ${rewardHtml}
      </div>
      <button type="button" class="labdeliv-btn" ${state === 'current' ? `data-deliver="${escapeHtml(task.code)}"` : ''}
        ${canDeliver && !_delivBusy ? '' : 'disabled'}>${btnText}</button>
      <p class="labdeliv-msg" id="delivMsg-${escapeHtml(line.code)}" role="status"></p>
    </article>`;
}

async function doLabberDeliver(taskCode, btn, { daily = false } = {}) {
  if (_delivBusy) return;
  _delivBusy = true;

  // 처리 중에는 모든 납품 버튼 잠금 (더블클릭/다른 카드 연타 방지 — 최종 방어는 서버)
  document.querySelectorAll('#labberDeliveryBoard [data-deliver], #labberDeliveryBoard [data-deliver-daily]')
    .forEach(b => { b.disabled = true; });
  btn.textContent = '납품 중...';

  const lineCode = btn.closest('[data-line-card]')?.dataset.lineCard;
  let msg = null;

  try {
    const { data, error } = daily
      ? await sb.rpc('deliver_labber_daily_task', { p_task_code: taskCode })
      : await sb.rpc('deliver_labber_task', { p_task_code: taskCode });
    if (error) throw error;

    if (data?.success) {
      if (!daily) delete _delivSelected[lineCode];   // 다음 단계(또는 완료 상태)로 자동 이동
      _labberKeys = data.new_keys ?? _labberKeys;
      renderLabberWallet();              // 열쇠 교환 탭 보유 열쇠 갱신 (III 보상 열쇠)
      if (typeof updateHeaderCurrencyDisplay === 'function') {
        updateHeaderCurrencyDisplay({ research_records: data.new_research, keys: data.new_keys });
      }

      const parts = [];
      if (data.reward?.research_records > 0) parts.push(`연구기록 +${data.reward.research_records}`);
      if (data.reward?.keys > 0) parts.push(`열쇠 +${data.reward.keys}`);
      msg = { text: `${data.task_name} 납품 완료! ${parts.join(' · ')}`, cls: 'is-success' };

      setLabberNpcLine(LABBER_DELIV_LINE_SUCCESS);
      setTimeout(() => setLabberNpcLine(labberRoomDefaultLine()), 2600);
      showDeliveryAchievements(data.achievements);
    } else if (data?.error === 'INSUFFICIENT_ITEMS') {
      const s = (data.shortages || [])[0];
      msg = { text: s ? `물품이 부족해요. (${s.name} · 보유 ${s.have} / 필요 ${s.need})` : '물품이 부족해요.', cls: 'is-error' };
    } else {
      msg = { text: LABBER_DELIV_ERROR_MSG[data?.error] || '납품에 실패했어요. 잠시 후 다시 시도해주세요.', cls: 'is-error' };
    }
  } catch (e) {
    console.error('[labber] 납품 오류:', e);
    msg = { text: '납품 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.', cls: 'is-error' };
  }

  // 성공/실패 모두 서버 상태로 다시 그린다 (보유 수량·완료 상태 동기화)
  _delivBusy = false;
  await loadLabberDelivery();

  const msgEl = lineCode && document.getElementById('delivMsg-' + lineCode);
  if (msgEl && msg) {
    msgEl.textContent = msg.text;
    msgEl.classList.add(msg.cls);
  }
}

function showDeliveryAchievements(list) {
  if (!Array.isArray(list) || !list.length || typeof _showAchievementToast !== 'function') return;
  list.forEach((a, i) => setTimeout(() => _showAchievementToast(a.name, a.description || ''), i * 900));
}

initPage();
