// ── LABBER 기록 증폭 실험 (labber-amplification.html) ─────────────
// 실험 결과(연구기록 수량 / 과자 봉지 조각 여부)는 전부 서버 RPC `play_record_amplification()` 이 결정한다.
// 비용·확률·일일 한도는 서버 상수이며 클라이언트는 어떤 값도 서버에 넘기지 않는다(인자 없는 RPC).
// 이 파일의 연출("분석 중" → "증폭 중" → 결과)은 서버 응답을 받은 "뒤에" 결과를 꾸며 보여줄 뿐이다.
//
// DB: supabase/labber_record_amplification_0920.sql
//   - get_record_amplification_status() : 잔액 / 오늘 사용 횟수 / 비용 / 한도
//   - play_record_amplification()       : 실행 (한 트랜잭션)
// 상단 hero + NPC(D) 대화 씬은 _labber.scss 의 .labber-* 재사용, 실험 카드는 _labber-amplification.scss(.labberamp-*).

// ── NPC 대사 ────────────────────────────────────────────
const LABBER_AMP_NPC_LINE = '연구기록 넣어봐, 많이 나올 수도 있어! ....아마!';
const LABBER_AMP_SNACK_LINE = '어? 이건 왜 들어있지?';   // 조각이 나오면 연구기록 대사보다 우선
const LABBER_AMP_RESULT_LINES = {
  10:  '……다시 넣으면 늘어날지도?',
  20:  '조금 줄었네? 이상하다!',
  30:  '그대로잖아!',
  40:  '거봐! 늘어난다니까!',
  50:  '거봐! 늘어난다니까!',
  70:  '우와! 많이 나왔다!',
  100: '……어? 이만큼 나오는 거였어?',
};

// ── 연출 타이밍 (전체 약 1.6초) ──────────────────────────
const LABBER_AMP_STEP1_MS = 700;   // "연구기록 분석 중..."
const LABBER_AMP_STEP2_MS = 900;   // "증폭 중..."

// 화면 표시용 상태 — 진실은 항상 서버 응답(status / play 결과)이다.
let _amp = { balance: 0, cost: 30, used: 0, limit: null };   // limit 은 서버(daily_limit)가 알려준 값만 사용
let _ampBusy = false;
let _ampReady = false;   // 상태 조회 성공 여부(실패 시 버튼 잠금 유지)
let _ampTypingTimer = null;

const _ampEl = id => document.getElementById(id);
const _ampFmt = n => Number(n ?? 0).toLocaleString();
const _ampSleep = ms => new Promise(r => setTimeout(r, ms));
const _ampReduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function initPage() {
  try {
    const user = await getUser();
    if (!user) { window.location.href = 'login.html'; return; }

    _ampEl('labberAmpBtn').addEventListener('click', onAmpStart);

    await refreshAmpStatus();
    runAmpDefaultTyping();

    _ampEl('pageLoading').style.display = 'none';
    _ampEl('pageContent').style.display = '';
  } catch (e) {
    console.error('[labber-amplification] initPage 오류:', e);
    _ampEl('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

// ── 서버 상태 조회 ───────────────────────────────────────
async function refreshAmpStatus() {
  _ampReady = false;
  try {
    const { data, error } = await sb.rpc('get_record_amplification_status');
    if (error) throw new Error(error.message);
    if (!data || data.success !== true) throw new Error((data && data.error) || 'STATUS_FAILED');
    _amp.balance = data.research_records;
    _amp.cost    = data.cost;
    _amp.used    = data.used_today;
    _amp.limit   = data.daily_limit;
    _ampReady = true;
  } catch (e) {
    console.error('[labber-amplification] 상태 조회 오류:', e);
    setAmpMsg('실험 장치 정보를 불러오지 못했어요. 새로고침 해주세요.', true);
  }
  renderAmpStats();
}

// ── 화면 갱신 ────────────────────────────────────────────
function renderAmpStats() {
  _ampEl('labberAmpBalance').textContent = _ampReady ? _ampFmt(_amp.balance) : '-';
  _ampEl('labberAmpCost').textContent    = _ampFmt(_amp.cost);
  _ampEl('labberAmpUsed').textContent    = _ampReady ? _ampFmt(_amp.used) : '-';
  _ampEl('labberAmpLimit').textContent   = _ampReady ? _ampFmt(_amp.limit) : '-';
  syncAmpButton();
}

// 버튼 활성 조건: 상태 로드됨 + 진행 중 아님 + 잔액 충분 + 오늘 횟수 남음
function syncAmpButton() {
  const btn = _ampEl('labberAmpBtn');
  const outOfTries = _ampReady && _amp.used >= _amp.limit;
  const noMoney    = _ampReady && _amp.balance < _amp.cost;
  btn.disabled = _ampBusy || !_ampReady || outOfTries || noMoney;

  // 안내 문구는 진행 중/결과 공개 직후 메시지를 덮어쓰지 않도록 idle 일 때만 갱신
  if (!_ampBusy && _ampReady) {
    if (outOfTries)     setAmpMsg('오늘의 실험을 모두 사용했어요. 내일(한국시간 자정 이후) 다시 이용할 수 있어요.', false);
    else if (noMoney)   setAmpMsg(`연구기록이 부족해요. (${_ampFmt(_amp.cost)}개 필요)`, false);
    else                setAmpMsg('', false);
  }
}

function setAmpMsg(text, isError) {
  const el = _ampEl('labberAmpMsg');
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

function setAmpStageText(text) {
  const el = _ampEl('labberAmpStageText');
  el.textContent = text;
  el.hidden = false;
}

function hideAmpResult() {
  _ampEl('labberAmpResult').hidden = true;
  _ampEl('labberAmpResultSnack').hidden = true;
  _ampEl('labberAmpStage').removeAttribute('data-tier');
}

// ── 실행 ─────────────────────────────────────────────────
async function onAmpStart() {
  if (_ampBusy) return;            // 연타/중복 방지 (서버도 지갑 락으로 이중 방어)
  if (!_ampReady) return;
  _ampBusy = true;
  syncAmpButton();                 // 즉시 잠금
  setAmpMsg('', false);
  hideAmpResult();
  setAmpStageText('실험 장치에 연구기록을 넣는 중...');
  _ampEl('labberAmpStage').classList.add('is-working');

  let data = null;
  try {
    // 1) 서버가 결과를 확정한다. 연출은 이 응답을 받은 뒤에만 시작한다.
    const res = await sb.rpc('play_record_amplification');
    if (res.error) throw new Error(res.error.message);
    data = res.data;
  } catch (e) {
    console.error('[labber-amplification] 실행 오류:', e);
    await failAmp(null, null);
    return;
  }

  if (!data || data.success !== true) {
    await failAmp(data && data.error, data);
    return;
  }

  // 2) 연출 (서버 결과를 꾸며서 보여주기만 함)
  try {
    const fast = _ampReduceMotion();
    setAmpStageText('연구기록 분석 중...');
    await _ampSleep(fast ? 200 : LABBER_AMP_STEP1_MS);
    setAmpStageText('증폭 중...');
    await _ampSleep(fast ? 200 : LABBER_AMP_STEP2_MS);
  } catch (_) { /* 연출 실패는 결과 표시에 영향 없음 */ }

  // 3) 결과 공개 + 상태 즉시 갱신 (서버가 돌려준 값 기준)
  _amp.balance = data.new_balance;
  _amp.used    = data.used_today;
  _amp.limit   = data.daily_limit;
  revealAmpResult(data);
  _ampBusy = false;
  _ampEl('labberAmpStage').classList.remove('is-working');
  renderAmpStats();
}

// 실패: 성공 연출 없이 오류 메시지 + 버튼 복구. 서버 기준으로 상태를 다시 맞춘다.
async function failAmp(code, data) {
  _ampEl('labberAmpStage').classList.remove('is-working');
  setAmpStageText('연구기록을 넣고 실험을 시작해보세요.');

  let msg;
  switch (code) {
    case 'DAILY_LIMIT_REACHED':
      msg = '오늘의 실험을 모두 사용했어요. 내일(한국시간 자정 이후) 다시 이용할 수 있어요.'; break;
    case 'INSUFFICIENT_BALANCE': {
      const need = data && data.need != null ? data.need : _amp.cost;
      msg = `연구기록이 부족해요. (${_ampFmt(need)}개 필요)`; break;
    }
    case 'NOT_AUTHENTICATED':  msg = '로그인이 필요해요.'; break;
    case 'WALLET_NOT_FOUND':   msg = '지갑 정보를 찾을 수 없어요. 운영진에게 문의해주세요.'; break;
    case 'ITEM_NOT_FOUND':     msg = '실험 데이터가 아직 준비되지 않았어요. 운영진에게 문의해주세요.'; break;
    default:                   msg = '실험 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.';
  }

  _ampBusy = false;
  await refreshAmpStatus();        // 잔액/횟수를 서버 기준으로 재동기화 (버튼 상태 복구 포함)
  setAmpMsg(msg, true);            // refresh 가 덮어쓰지 않도록 마지막에 표시
}

// ── 결과 공개 ────────────────────────────────────────────
function revealAmpResult(data) {
  const reward = data.reward;
  const snack  = data.snack_dropped === true;

  _ampEl('labberAmpStageText').hidden = true;
  _ampEl('labberAmpResultMain').textContent = `연구기록 ${_ampFmt(reward)}개 획득!`;

  const snackBox = _ampEl('labberAmpResultSnack');
  if (snack) {
    const qty = (data.snack_item && data.snack_item.gained) || 1;
    const nm  = (data.snack_item && data.snack_item.name) || '과자 봉지 조각';
    _ampEl('labberAmpResultSnackText').textContent = `${nm} ×${qty} 획득!`;
    snackBox.hidden = false;
  } else {
    snackBox.hidden = true;
  }

  // 결과 크기에 따른 강조 단계 (색/애니메이션 전용 — 서버 결과를 바꾸지 않음)
  const tier = reward >= 100 ? 'jackpot' : reward >= 70 ? 'high' : reward >= 40 ? 'up' : reward >= 30 ? 'same' : 'down';
  const stage = _ampEl('labberAmpStage');
  stage.setAttribute('data-tier', tier);
  _ampEl('labberAmpResult').hidden = false;

  // NPC 대사: 조각이 나왔으면 그 대사를 우선
  const line = snack ? LABBER_AMP_SNACK_LINE : (LABBER_AMP_RESULT_LINES[reward] || LABBER_AMP_RESULT_LINES[30]);
  typeAmpLine(line, 30);
}

// ── NPC 대사 타이핑 ──────────────────────────────────────
function typeAmpLine(text, speed, onDone) {
  const el = _ampEl('labberAmpNpcLine');
  if (!el) return;
  if (_ampTypingTimer) { clearTimeout(_ampTypingTimer); _ampTypingTimer = null; }

  if (_ampReduceMotion()) {
    el.classList.remove('labber-typing');
    el.textContent = text;
    if (onDone) onDone();
    return;
  }

  let i = 0;
  el.textContent = '';
  el.classList.add('labber-typing');
  (function tick() {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      _ampTypingTimer = setTimeout(tick, speed);
    } else {
      _ampTypingTimer = null;
      el.classList.remove('labber-typing');
      if (onDone) onDone();
    }
  })();
}

// 첫 진입: 기본 대사를 타이핑한 뒤 실험 패널 등장 (조합소/상점 패널과 동일 동작)
function runAmpDefaultTyping() {
  const panel = _ampEl('labberAmpPanel');
  typeAmpLine(LABBER_AMP_NPC_LINE, 55, () => panel.classList.add('show'));
}

initPage();
