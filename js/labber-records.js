// ── LABBER 개체기록실 (labber-records.html) ───────────────────────────
// species.html?id=204 의 "소속 개체" 영역을 LABBER 전용 페이지로 옮긴 것.
// 목록/정렬/분류필터/관리(선택삭제) 로직은 공통 모듈(js/species-character-list.js)을
// species.html 과 그대로 공유한다. 이 파일은 "종족 204 정보 조회 + 권한 판정 + mount" 만 담당.
//
// 개체 수정 / 소유권 이전 은 카드 클릭 → character.html?id=X 이동 후 그 페이지에서 처리되므로
// 여기서 따로 구현하지 않는다(기존과 완전히 동일하게 동작).

// LABBER_SPECIES_ID(=204) 는 js/utils.js 에 정의됨. 개체는 species_name 으로 연결되므로
// (개체 ID 하드코딩 아님) 여기서 종족명을 조회해 그 이름의 개체 전부를 자동으로 불러온다.
//
// 공개 목록과 로그인 확인 분리 (1112):
//   - 공개 목록은 로그인 확인을 기다리지 않고 조회한다. 조회 클라이언트는 js/auth.js 의 sb(로그인 세션 포함)를
//     그대로 쓰고, auth.js 가 로드되지 않았거나 초기화 도중 실패했을 때만 이 파일 안에서 세션 없는 공개 클라이언트를
//     만든다(저장된 토큰·URL 인증 정보를 읽지 않음, anon 권한 + RLS 그대로, 조회 컬럼은 기존과 같음). 전역 sb 는 만들지 않는다.
//   - 로그인 상태: 'pending'(확인 중) | 'user' | 'guest' | 'unknown'(확인 불가: auth.js 없음·실패·시간 초과).
//     관리(선택삭제)는 'user' + 종족주/SUPER_ADMIN + 세션 있는 sb 로 목록을 읽었을 때만 연다.
//     시간 초과 뒤 늦게 온 로그인 응답으로는 상태를 바꾸지 않는다. 삭제 직전에도 다시 확인한다.
//   - 목록 조회 실패·시간 초과는 "등록된 개체가 없어요"가 아니라 오류 문구로 표시한다.

// 조회 대상 판단이므로 utils.js 를 못 읽어도 같은 값을 쓴다 (js/utils.js LABBER_SPECIES_ID 와 동일하게 유지).
const LR_LABBER_ID = typeof LABBER_SPECIES_ID !== 'undefined' ? LABBER_SPECIES_ID : 204;
// js/auth.js 의 SUPABASE_URL·SUPABASE_KEY(publishable) 와 같은 값이어야 한다(바꿀 때 함께 수정).
const LR_FALLBACK_SUPABASE_URL = 'https://tnvkfcqphdxdyvswbkfe.supabase.co';
const LR_FALLBACK_SUPABASE_KEY = 'sb_publishable_iaH_vCaDJfekUiZ85_JO7w_T_iDGNfg';
const LR_AUTH_TIMEOUT_MS  = 8000;    // 로그인 확인
const LR_QUERY_TIMEOUT_MS = 15000;   // 종족 조회 · 소속 개체 페이지 1회
const LR_NICK_TIMEOUT_MS  = 8000;    // 회원 닉네임(부가 정보) — 실패하면 개체에 저장된 소유주 닉네임으로 표시
const LR_ERROR_MSG = '개체 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';

let _lrAuthState  = 'pending';
let _lrUser       = null;
let _lrSpecies    = null;    // { id, name, owner_user_id }
let _lrListReady  = false;
let _lrAuthClient = null;    // 전역 sb (있을 때만)
let _lrDataClient = null;    // 목록 조회에 쓴 클라이언트

// auth.js 초기화가 중간에 실패하면 sb 가 '초기화 전' 상태로 남아 typeof 조차 예외를 던진다.
function lrReadAuthClient() {
  try { return (typeof sb !== 'undefined' && sb && typeof sb.from === 'function') ? sb : null; }
  catch (e) { return null; }
}

function lrCreateSessionlessClient() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
  const emptyStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  return window.supabase.createClient(LR_FALLBACK_SUPABASE_URL, LR_FALLBACK_SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storage: emptyStorage, storageKey: 'labber-records-sessionless' },
  });
}

function lrWithTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 시간 초과(${ms}ms)`)), ms); }),
  ]);
}

async function lrResolveAuth() {
  try {
    // 세션 있는 sb 가 없으면 로그인 여부를 판단하지 않는다(확인 불가).
    if (!_lrAuthClient || typeof getUser !== 'function') return { state: 'unknown', user: null };
    const user = await lrWithTimeout(Promise.resolve().then(() => getUser()), LR_AUTH_TIMEOUT_MS, '로그인 확인');
    return user ? { state: 'user', user } : { state: 'guest', user: null };
  } catch (e) {
    console.warn('[labber-records] 로그인 확인 실패 — 관리 기능 닫힘:', e);
    return { state: 'unknown', user: null };
  }
}

// 관리 기준 — species.html 과 동일: 종족 소유주 또는 슈퍼관리자 계정
function lrIsManager(user) {
  if (!user || !user.id || !_lrSpecies) return false;
  const superId = window.SpeciesCharList && window.SpeciesCharList.SUPER_ADMIN_USER_ID;
  return (!!_lrSpecies.owner_user_id && user.id === _lrSpecies.owner_user_id) || (!!superId && user.id === superId);
}

function lrManageAllowed(state, user) {
  return state === 'user' && !!_lrAuthClient && _lrDataClient === _lrAuthClient && lrIsManager(user);
}

// 목록 표시와 로그인 확인 중 늦게 끝난 쪽에서 호출된다. 확인 중·확인 불가·비로그인이면 닫힌 상태 유지.
function lrApplyManageGate() {
  if (!_lrListReady || !window.SpeciesCharList || typeof window.SpeciesCharList.setManageAllowed !== 'function') return;
  window.SpeciesCharList.setManageAllowed(lrManageAllowed(_lrAuthState, _lrUser));
}

// 삭제 직전 재확인 (공통 모듈 deleteSelected 가 호출). 같은 계정이 지금도 관리 권한이 있을 때만 true.
async function lrCanDeleteNow() {
  if (!lrManageAllowed(_lrAuthState, _lrUser)) return false;
  const fresh = await lrResolveAuth();
  return fresh.state === 'user' && !!fresh.user && fresh.user.id === _lrUser.id && lrManageAllowed('user', fresh.user);
}

async function initLabberRecords() {
  const loadingEl = document.getElementById('pageLoading');
  const contentEl = document.getElementById('pageContent');
  const errEl     = document.getElementById('recordsError');

  _lrAuthClient = lrReadAuthClient();
  _lrDataClient = _lrAuthClient || lrCreateSessionlessClient();

  // 로그인 확인은 목록 조회와 따로 진행한다(목록은 기다리지 않음). 상태는 처음 한 번만 정한다.
  lrResolveAuth().then(auth => {
    if (_lrAuthState !== 'pending') return;
    _lrAuthState = auth.state;
    _lrUser = auth.user;
    lrApplyManageGate();
  });

  try {
    const db = _lrDataClient;
    if (!db) throw new Error('Supabase 클라이언트를 만들 수 없음(supabase-js 미로드)');
    if (!_lrAuthClient) console.warn('[labber-records] 인증 초기화 실패 — 세션 없는 공개 조회로 목록만 표시합니다(관리 기능 닫힘).');
    if (!window.SpeciesCharList) throw new Error('목록 모듈(species-character-list.js) 없음');

    // 닉네임 최신화 맵 (species.html 과 동일하게 get_all_users 사용) — 부가 정보라 실패해도 목록은 표시
    const nickPromise = lrWithTimeout(Promise.resolve().then(() => db.rpc('get_all_users')), LR_NICK_TIMEOUT_MS, '회원 닉네임 조회')
      .then(({ data, error }) => { if (error) throw error; return data || []; })
      .catch(e => { console.warn('[labber-records] 회원 닉네임 조회 실패 — 개체에 저장된 소유주 닉네임으로 표시:', e); return []; });

    // LABBER 종족 정보 (이름 + 소유주)
    const { data: species, error: spErr } = await lrWithTimeout(
      Promise.resolve().then(() => db.from('species').select('id, name, owner_user_id').eq('id', LR_LABBER_ID).single()),
      LR_QUERY_TIMEOUT_MS, 'LABBER 종족 조회');

    if (spErr || !species) {
      throw new Error('LABBER 종족 정보를 불러오지 못했어요.' + (spErr ? ` (${spErr.code || spErr.message})` : ''));
    }
    _lrSpecies = species;

    const idToNick = {};
    (await nickPromise).forEach(u => {
      if (u && u.id && u.nickname) idToNick[u.id] = u.nickname;
    });

    // 콘텐츠를 먼저 노출한 뒤 mount — 분류 필터 "더보기" 높이 계산이
    // 숨겨진 컨테이너(display:none) 안에서는 0으로 잡히기 때문.
    loadingEl.style.display = 'none';
    contentEl.style.display = '';

    const chars = await window.SpeciesCharList.mount({
      speciesName: species.name,
      canManage:   false,           // 로그인 확인 뒤 lrApplyManageGate 에서만 연다
      idToNick,
      // LABBER 표시명 정책(2026-09-24): owner_custom_name 우선 + 카드에 종족명 대신 개체번호.
      // 다른 종족(species.html)은 이 옵션을 안 넘기므로 기존 동작 그대로 유지된다.
      labberDisplay: true,
      client:       db,
      strictErrors: true,
      timeoutMs:    LR_QUERY_TIMEOUT_MS,
      canDelete:    lrCanDeleteNow,
    });
    if (chars === null) return;   // 더 새 목록 요청이 있었음 — 그쪽 결과를 유지
    _lrListReady = true;
    lrApplyManageGate();
  } catch (e) {
    console.error('[labber-records] init 오류:', e);
    loadingEl.style.display = 'none';
    contentEl.style.display = '';
    const section = document.getElementById('charactersSection');
    if (section) section.style.display = 'none';
    if (errEl) {
      errEl.textContent = LR_ERROR_MSG;
      errEl.style.display = '';
    }
  }
}

initLabberRecords();
