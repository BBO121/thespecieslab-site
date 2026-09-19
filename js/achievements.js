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

// 일일 방문 카운터 — localStorage만 먼저 처리, Supabase는 10번째 방문에만 호출
async function _checkDailyVisit() {
  try {
    console.time('[업적] daily');
    const today    = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const stored   = JSON.parse(localStorage.getItem('_daily_visit') || '{}');
    const count    = stored.date !== today ? 1 : (stored.count || 0) + 1;
    localStorage.setItem('_daily_visit', JSON.stringify({ date: today, count }));

    // 10번째 방문이고 오늘 아직 수여 안 했을 때만 Supabase 호출
    const _flagKey = `_work_overtime_awarded_${today}`;
    if (count === 10 && !localStorage.getItem(_flagKey)) {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        localStorage.setItem(_flagKey, '1');
        window.awardAchievement?.('work_overtime_fail');
      }
    }
    console.timeEnd('[업적] daily');
  } catch (e) {
    console.error('[업적] 일일 방문 체크 예외:', e);
  }
}

// 페이지 로드 시 pending 토스트 처리 + 일일 방문 체크
document.addEventListener('DOMContentLoaded', () => {
  const pending = JSON.parse(sessionStorage.getItem('_ach_pending') || '[]');
  if (pending.length) {
    sessionStorage.removeItem('_ach_pending');
    pending.forEach((ach, i) => {
      setTimeout(() => _showAchievementToast(ach.name, ach.desc), i * 900);
    });
  }
  _checkDailyVisit();
});

function _showAchievementToast(name, desc) {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `
    <img class="achievement-toast-icon" src="${window._achBadgePath || '../images/achievement-badge.png'}" alt="업적">
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

function _escapeAch(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
