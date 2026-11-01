// 업적 지급 공통 함수
// 실패해도 원래 기능을 차단하지 않음 — 에러는 console.error로만 처리

// DB 카운터 증가 후 새 count 반환 (실패 시 0 반환, 기능 차단 없음)
window.incrementAchCounter = async function(counterKey) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('increment_achievement_counter', {
      p_counter_key: counterKey,
    });
    if (error) { console.error('[업적] 카운터 증가 실패:', counterKey, error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 카운터 증가 예외:', counterKey, e);
    return 0;
  }
};

// pending: true  → redirect 직전 페이지, 다음 페이지에서 토스트 표시
// pending: false → 현재 페이지에서 즉시 토스트 표시 (기본값)
//
// 서버 단일 RPC(award_achievement)가 달성 기록/보상 지급/알림 생성을
// 하나의 트랜잭션으로 원자적으로 처리한다. 클라이언트는 결과를 받아
// 토스트만 표시하며, 중간 단계가 실패해도 DB에는 반쪽짜리 상태가 남지
// 않는다(award_achievement.sql 참고 — 실패 시 함수 전체 롤백).
window.awardAchievement = async function(code, { pending = false } = {}) {
  try {
    console.log('[업적DBG] ▶ awardAchievement 진입 — code:', code, '/ pending:', pending);

    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) { console.warn('[업적DBG] user 없음 → return'); return; }

    const { data: result, error } = await sb.rpc('award_achievement', { p_code: code });
    console.log('[업적DBG] award_achievement — result:', result, '/ error:', error);

    if (error) {
      console.error('[업적] award_achievement RPC 오류 — code:', code, '/ message:', error.message, '/ details:', error.details, '/ hint:', error.hint, '/ code:', error.code);
      return;
    }

    if (!result?.success) {
      console.warn('[업적] award_achievement 실패:', code, result);
      return;
    }

    if (!result.newly_unlocked) {
      console.log('[업적DBG] 이미 달성된 업적 — 신규 지급 없음:', code);
      return;
    }

    if (pending) {
      const p = JSON.parse(sessionStorage.getItem('_ach_pending') || '[]');
      p.push({ name: result.name, desc: result.description || '' });
      sessionStorage.setItem('_ach_pending', JSON.stringify(p));
      console.log('[업적DBG] pending 저장 완료 — sessionStorage._ach_pending:', JSON.stringify(p));
    } else {
      console.log('[업적DBG] 즉시 토스트 표시');
      _showAchievementToast(result.name, result.description || '');
    }

    if (typeof updateHeaderCurrencyDisplay === 'function') {
      updateHeaderCurrencyDisplay({ research_records: result.new_balance });
    }
  } catch (e) {
    console.error('[업적DBG] 예외 발생 — code:', code, '/ e:', e);
  }
};

// [2026-10-01] LABBER 업적 공개 — 서버가 조건을 직접 판정해서 만족한 것만 지급(sync_labber_achievements RPC, 멱등).
// 서버 잠금: award_achievement 가 LABBER 업적은 항상 조건 검증(labber_achievements_enforce_1001.sql)
//           + 지급 스위치(achievement_security_config.labber_achievements_award). 스위치 off 면 서버가 locked 로 즉시 반환.
// 기존 사용자 소급 달성 경로이기도 하다. 새로 달성한 업적은 토스트로 표시. 실패해도 원래 기능을 막지 않는다.
window.LABBER_ACHIEVEMENT_SYNC_ENABLED = true;

// [2026-10-17] 업적란 방문 없이 즉시 달성
//   · 활동 성공 직후: 각 활동 JS 가 syncLabberAchievements({ afterActivity: true }) 호출
//   · 페이지 로드 시: _autoSyncLabberAchievements() — 받은 전송/운영진 승인처럼 본인이 직접 하지 않은 변화 + 기존 미지급 복구.
//     같은 브라우저의 모든 탭이 공유하는 localStorage 시각으로 LABBER_ACH_AUTO_SYNC_MS 에 1번만.
//   · 동시 호출은 한 요청으로 합친다. 요청 도중 새 활동이 끝나면 끝난 뒤 1번 더 판정(앞 요청이 활동 반영 전에 읽었을 수 있음).
//   지급/중복 방지는 전부 서버(award_achievement UNIQUE + ON CONFLICT) — 여러 탭이 동시에 불러도 토스트는 실제로 지급한 요청 1곳만.
//   제한 시각(localStorage)은 사용자별 키. 성공한 판정만 "판정 완료 시각"을 남긴다 — 실패는 다음 진입 때 바로 다시 시도.
//   자동 복구 시작 표시(claim)는 다른 탭과 겹치지 않게 하는 짧은 잠금이며, 실패하면 즉시 지운다.
//   5분 제한은 자동 복구에만 적용된다. 활동 직후(afterActivity) 판정은 제한 없이 항상 실행.
const LABBER_ACH_AUTO_SYNC_MS   = 5 * 60 * 1000;
const LABBER_ACH_CLAIM_MS       = 30 * 1000;   // 다른 탭이 자동 복구 중인 것으로 보는 시간(탭이 도중에 닫혀도 30초 뒤 해제)
const LABBER_ACH_RECENT_MS      = 15 * 1000;   // 활동이 아닌 재확인이 같은 사용자의 직전 성공 판정과 겹치면 생략
const LABBER_ACH_RETRY_DELAY_MS = 2000;        // 활동 직후 판정 실패 시 1회만 재시도
let _labberAchInflight = null;
let _labberAchRerun    = false;
let _labberAchLastOk   = { uid: null, at: 0 };

function _labberAchSyncKey(uid)  { return '_labberAchSyncAt:' + uid; }
function _labberAchClaimKey(uid) { return '_labberAchSyncClaim:' + uid; }
function _labberAchLsGet(k)    { try { return Number(localStorage.getItem(k)) || 0; } catch (_) { return 0; } }
function _labberAchLsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }
function _labberAchLsDel(k)    { try { localStorage.removeItem(k); } catch (_) {} }

// 반환: { status: 'ok' | 'failed' | 'skipped', uid, list }
//   skipped = 로그아웃 상태 / 플래그 off → 재시도 대상 아님
async function _runLabberAchievementSync() {
  let uid = null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return { status: 'skipped', uid: null, list: [] };
    if (!window.LABBER_ACHIEVEMENT_SYNC_ENABLED) return { status: 'skipped', uid: null, list: [] };
    uid = session.user.id;
    const { data, error } = await sb.rpc('sync_labber_achievements');
    if (error || !data?.success) {
      console.warn('[업적] LABBER 업적 재확인 실패:', error || data);
      return { status: 'failed', uid, list: [] };
    }
    _labberAchLastOk = { uid, at: Date.now() };
    _labberAchLsSet(_labberAchSyncKey(uid), _labberAchLastOk.at);
    const list = Array.isArray(data.unlocked) ? data.unlocked : [];
    list.forEach((a, i) => setTimeout(() => _showAchievementToast(a.name, a.description || '', true), i * 900));
    if (list.length && typeof updateSidebarLogin === 'function') updateSidebarLogin();   // 보상 반영된 지갑 갱신
    return { status: 'ok', uid, list };
  } catch (e) {
    console.error('[업적] LABBER 업적 재확인 예외:', e);
    return { status: 'failed', uid, list: [] };
  }
}

// afterActivity: true = 방금 활동이 서버에 성공 반영됨 → 생략 없이 반드시 그 이후 상태로 판정
//   · 요청 진행 중이면 끝난 뒤 1번 더 판정(_labberAchRerun) — 새 활동이 있을 때만 생기므로 무한 반복 없음
//   · 활동 판정이 실패하면 1회만 재시도. 그래도 실패하면 성공 시각이 남지 않으므로 다음 페이지 진입 자동 복구가 이어받는다.
window.syncLabberAchievements = function({ afterActivity = false } = {}) {
  if (_labberAchInflight) {
    if (afterActivity) _labberAchRerun = true;
    return _labberAchInflight;
  }
  _labberAchInflight = (async () => {
    let all = [];
    let activity = afterActivity;
    let retried  = false;
    try {
      // 활동이 아닌 재확인: 같은 사용자가 방금(15초 내) 성공 판정했으면 생략
      if (!activity) {
        const { data: { session } } = await sb.auth.getSession();
        const uid = session?.user?.id;
        if (uid && _labberAchLastOk.uid === uid && Date.now() - _labberAchLastOk.at < LABBER_ACH_RECENT_MS) return all;
      }
      for (;;) {
        _labberAchRerun = false;
        const r = await _runLabberAchievementSync();
        all = all.concat(r.list);
        if (_labberAchRerun) { activity = true; continue; }          // 진행 중 새 활동 → 그 이후 상태로 다시
        if (r.status === 'failed' && activity && !retried) {         // 활동 판정 실패 → 1회만 재시도
          retried = true;
          await new Promise(res => setTimeout(res, LABBER_ACH_RETRY_DELAY_MS));
          continue;
        }
        break;
      }
    } catch (e) {
      console.error('[업적] LABBER 업적 재확인 예외:', e);
    } finally {
      _labberAchInflight = null;
    }
    return all;
  })();
  return _labberAchInflight;
};

// 페이지 진입 자동 복구 — 사용자별 5분 제한(성공 기준) + 탭 간 짧은 잠금
async function _autoSyncLabberAchievements() {
  try {
    if (!window.LABBER_ACHIEVEMENT_SYNC_ENABLED) return;
    const { data: { session } } = await sb.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    const now = Date.now();
    if (now - _labberAchLsGet(_labberAchSyncKey(uid)) < LABBER_ACH_AUTO_SYNC_MS) return;   // 최근 성공 판정 있음
    if (now - _labberAchLsGet(_labberAchClaimKey(uid)) < LABBER_ACH_CLAIM_MS) return;      // 다른 탭이 진행 중
    _labberAchLsSet(_labberAchClaimKey(uid), now);
    const before = _labberAchLsGet(_labberAchSyncKey(uid));
    await window.syncLabberAchievements();
    // 성공했으면 판정 완료 시각이 이미 남았다. 실패했으면 잠금을 풀어 다음 진입 때 바로 다시 시도.
    if (_labberAchLsGet(_labberAchSyncKey(uid)) === before) _labberAchLsDel(_labberAchClaimKey(uid));
  } catch (e) {
    console.error('[업적] LABBER 업적 자동 재확인 예외:', e);
  }
}

// 서버 일일 방문 카운트 증가 후 오늘자 방문 횟수 반환 (실패 시 0 반환)
// [2026-09-22 보안 패치] work_overtime_fail 판정을 localStorage 신뢰에서
// 서버(user_daily_visits) 신뢰로 전환. record_daily_visit RPC 참고.
window.recordDailyVisit = async function() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('record_daily_visit');
    if (error) { console.error('[업적] 일일 방문 기록 실패:', error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 일일 방문 기록 예외:', e);
    return 0;
  }
};

// DB 카운터 값 조회 (실패 시 0 반환)
window.getCounterValue = async function(counterKey) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('get_counter_value', { p_counter_key: counterKey });
    if (error) { console.error('[업적] 카운터 조회 실패:', counterKey, error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 카운터 조회 예외:', counterKey, e);
    return 0;
  }
};

// 일일 방문 카운터 — [2026-09-22] 서버(record_daily_visit RPC) 기준으로 전환.
// award_achievement가 자체적으로 멱등(이미 달성 시 즉시 반환)이라
// 매 페이지 로드마다 호출해도 안전하며 별도 localStorage 플래그가 필요 없다.
async function _checkDailyVisit() {
  try {
    console.time('[업적] daily');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    const count = await window.recordDailyVisit?.() || 0;
    if (count >= 10) {
      window.awardAchievement?.('work_overtime_fail');
    }
    console.timeEnd('[업적] daily');
  } catch (e) {
    console.error('[업적] 일일 방문 체크 예외:', e);
  }
}

// <script src="achievements.js" data-daily-visit="off"> — 이 페이지는 일일 방문 수(work_overtime_fail)에 세지 않는다.
//   (2026-10-17 업적 판정용으로 achievements.js 를 새로 붙인 LABBER/출석 페이지 — 기존 방문 업적 기준 유지)
const _achScriptEl = document.currentScript;

// 페이지 로드 시 pending 토스트 처리 + 일일 방문 체크 + LABBER 업적 자동 재확인
document.addEventListener('DOMContentLoaded', () => {
  _autoSyncLabberAchievements();
  const pending = JSON.parse(sessionStorage.getItem('_ach_pending') || '[]');
  if (pending.length) {
    sessionStorage.removeItem('_ach_pending');
    pending.forEach((ach, i) => {
      setTimeout(() => _showAchievementToast(ach.name, ach.desc), i * 900);
    });
  }
  if (_achScriptEl?.dataset?.dailyVisit !== 'off') _checkDailyVisit();
});

// isLabber: LABBER 업적(sync_labber_achievements 결과) — LABBER 전용 뱃지 이미지 사용 (2026-11-01)
function _showAchievementToast(name, desc, isLabber = false) {
  const badge = window._achBadgePath || '../images/achievement-badge.png';
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <img class="achievement-toast-icon" src="${isLabber ? badge.replace('achievement-badge.png', 'achievement-labber-badge.png') : badge}" alt="업적">
    <div class="achievement-toast-body">
      <p class="achievement-toast-label">업적 달성!</p>
      <p class="achievement-toast-name">${_escapeAch(name)}</p>
      ${desc ? `<p class="achievement-toast-desc">${_escapeAch(desc)}</p>` : ''}
    </div>
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3800);
}

// 종족 고유 조회 추적 — 새 종족일 때만 카운트, 현재 총 고유 조회 수 반환
window.trackSpeciesView = async function(speciesId) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('track_species_view', { p_species_id: speciesId });
    if (error) { console.error('[업적] 종족 조회 추적 실패:', error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 종족 조회 추적 예외:', e);
    return 0;
  }
};

// 개체 고유 조회 추적 — 새 개체일 때만 카운트, 현재 총 고유 조회 수 반환
window.trackCharView = async function(charId) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('track_character_view', { p_character_id: charId });
    if (error) { console.error('[업적] 개체 조회 추적 실패:', error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 개체 조회 추적 예외:', e);
    return 0;
  }
};

// 내가 소유한 서로 다른 종족 수 반환
window.getDistinctOwnedSpeciesCount = async function() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('get_distinct_owned_species_count');
    if (error) { console.error('[업적] 다양 종족 수 조회 실패:', error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 다양 종족 수 조회 예외:', e);
    return 0;
  }
};

// 종족 재방문(타인 종족) 카운트 — [2026-09-22] species_revisit_10 전용
// 동적 counter_key(species_revisit_${id}) 방식을 대체
window.recordSpeciesRevisit = async function(speciesId) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.rpc('record_species_revisit', { p_species_id: speciesId });
    if (error) { console.error('[업적] 종족 재방문 기록 실패:', error); return 0; }
    return data || 0;
  } catch (e) {
    console.error('[업적] 종족 재방문 기록 예외:', e);
    return 0;
  }
};

function _escapeAch(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
