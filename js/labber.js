// ── 수상한 연구실: 열쇠 → 연구기록 교환 ──────────────────
const LABBER_RATE = 25;
const LABBER_LINE_DEFAULT = '열쇠는 가져왔습니까?';
const LABBER_LINE_SUCCESS = '가짜는 아니겠죠? 여기 있습니다.';

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
  setTimeout(() => setLabberNpcLine(LABBER_LINE_DEFAULT), 2600);

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

  if (reduceMotion) {
    el.textContent = LABBER_LINE_DEFAULT;
    panel.classList.add('show');
    return;
  }

  const speed = 55; // 글자당 40~70ms
  let i = 0;
  el.textContent = '';
  el.classList.add('labber-typing'); // 픽셀 커서 표시 (::after) — 타이핑 중에만

  (function tick() {
    if (i < LABBER_LINE_DEFAULT.length) {
      el.textContent += LABBER_LINE_DEFAULT[i];
      i++;
      setTimeout(tick, speed);
    } else {
      el.classList.remove('labber-typing');
      panel.classList.add('show');
    }
  })();
}

initPage();
