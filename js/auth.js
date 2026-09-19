window.isAdmin        = (role) => role === 'admin';
window.isStaff        = (role) => role === 'staff';
window.isAdminOrStaff = (role) => role === 'admin' || role === 'staff';

const SUPABASE_URL = 'https://tnvkfcqphdxdyvswbkfe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_iaH_vCaDJfekUiZ85_JO7w_T_iDGNfg';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// 비밀번호 복구(recovery) 진입 감지 — pages/reset-password.html 전용.
// createClient() 바로 다음 줄, 같은 <script> 태그의 동기 실행 흐름 안에서
// 즉시 등록한다. PASSWORD_RECOVERY 이벤트는 URL의 recovery 해시를 처리하는
// 비동기(microtask) 과정에서 발생하는데, 이 등록을 reset-password.html 자체의
// 인라인 스크립트(별도 <script> 태그)로 미루면 그 사이 microtask queue가 한 번
// 비워지면서 이벤트를 놓칠 수 있다 — 반드시 여기서 동기적으로 등록해야 안전하다.
// getSession()의 "세션 존재 여부"만으로는 recovery 진입과 일반 로그인 세션을
// 구분할 수 없어(둘 다 세션이 있음) 이 이벤트 기반 판별이 필요하다.
if (location.pathname.endsWith('reset-password.html')) {
  // 만료/재사용된 recovery 링크는 Supabase가 URL 해시에 error 파라미터를 담아
  // 리다이렉트한다. Supabase 내부 처리가 이 해시를 지우기 전에(동기 시점) 직접
  // 캡처해둔다.
  window.__recoveryUrlError = new URLSearchParams(location.hash.replace(/^#/, '')).get('error') || null;

  window.__recoverySessionPromise = new Promise((resolve) => {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') resolve(session);
    });
    // 4초 내 PASSWORD_RECOVERY 이벤트가 없으면 recovery 진입이 아닌 것으로
    // 확정한다(직접 접근 / 일반 로그인 세션만 있는 경우 등).
    setTimeout(() => resolve(null), 4000);
  });
}

// 닉네임 → 가짜 이메일 변환
// Stage 5/6부터 signUp()은 더 이상 이 함수를 쓰지 않는다(신규 회원은 실제
// 이메일로 가입). 기존 회원 과도기 로직/롤백 참고용으로 남겨둔다 — 호출부 없음.
function toEmail(nickname) {
  return `${nickname}@dogam.com`;
}

// 회원가입 (Stage 5/6 — 신규 회원 실제 이메일 가입)
// 더 이상 ${loginId}@dogam.com 가짜 이메일을 만들지 않는다. 사용자가 입력한
// 실제 이메일로 그대로 가입하고, 로그인 ID는 options.data.login_id로 전달해
// handle_new_user_login_id() 트리거(supabase/user_login_ids_setup_0918.sql)가
// public.user_login_ids에 기록하도록 한다 — 이 트리거는 이미 이 경로(1순위:
// raw_user_meta_data.login_id)를 위해 준비돼 있었다.
// Confirm email이 켜져 있으면(요구사항상 반드시 켜져 있어야 함) signUp()
// 성공 시에도 data.session은 null이다 — 이메일 인증을 완료해야 로그인할 수
// 있다. emailRedirectTo는 "가입확인 이메일" 링크 클릭 후 도착할 위치로,
// 로그인 페이지를 가리킨다(Dashboard Redirect URLs에 등록 필요).
//
// 필수 약관 동의(이용약관 + 개인정보 수집·이용):
// 동의한 문서 버전을 options.data(terms_version/privacy_version)에 함께 실어
// 보낸다. signUp 직후에는 세션이 없어 클라이언트가 RPC로 기록할 수 없으므로,
// auth.users INSERT와 같은 트랜잭션에서 handle_new_user_policy_consent()
// 트리거(supabase/user_policy_consents_setup_0919.sql)가 서버 원장
// public.user_policy_consents에 기록한다. 서버는 아래 버전과 "정확히 같은"
// 값만 정상 동의로 인정하므로, 새 약관/방침 버전을 낼 때는 이 두 상수와
// 해당 SQL 함수의 v_terms_current/v_privacy_current를 함께 바꿔야 한다.
// (pages/terms.html 최종 업데이트일 / pages/privacy.html 시행일 기준)
const POLICY_TERMS_VERSION   = '2026-09-19';
const POLICY_PRIVACY_VERSION = '2026-09-19';

// policiesAgreed는 signup.html에서 두 필수 동의가 모두 체크됐을 때만 true로
// 넘긴다. true가 아니면(호출 실수 포함) 가입을 진행하지 않는다 — 동의 없이
// 가입 요청이 나가는 경로를 auth.js에서도 한 번 더 막는 2차 방어선이다.
async function signUp(loginId, email, password, policiesAgreed = false) {
  if (policiesAgreed !== true) {
    return { data: null, error: new Error('policy_consent_required') };
  }

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: {
        login_id: loginId,
        nickname: loginId,
        terms_version: POLICY_TERMS_VERSION,
        privacy_version: POLICY_PRIVACY_VERSION,
      },
      emailRedirectTo: `${window.location.origin}/pages/login.html`,
    },
  });
  return { data, error };
}

// 로그인 — login-with-id Edge Function 경유 (로그인 ID 기반공사 2단계)
// 더 이상 프론트가 ${nickname}@dogam.com을 직접 만들어 Supabase Auth에
// 로그인하지 않는다. 실제 email은 서버(Edge Function)에서만 조회되고
// 클라이언트에는 절대 내려오지 않는다. 반환된 access_token/refresh_token으로
// setSession()을 호출해 기존과 동일한 Supabase Auth 세션을 그대로 수립한다.
async function signIn(loginId, password) {
  const { data, error } = await sb.functions.invoke('login-with-id', {
    body: { login_id: loginId, password },
  });

  if (error || !data?.access_token || !data?.refresh_token) {
    return { data: null, error: error || new Error('login_failed') };
  }

  const { data: sessionData, error: sessionError } = await sb.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  return { data: sessionData, error: sessionError };
}

// 비밀번호 재설정 메일 요청 (로그아웃 상태 셀프 복구용)
// Supabase는 이메일 존재 여부와 무관하게 항상 동일하게 성공(error: null) 응답을
// 반환하도록 설계돼 있다 — 여기서 반환하는 error는 이메일 존재 여부가 아니라
// 요청 자체의 실패(네트워크/서비스 오류 등)만 의미한다. 호출부는 이 error로
// 계정 존재 여부를 추론하지 말고 일반적인 요청 성공/실패만 구분해서 처리한다.
async function requestPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/pages/reset-password.html`,
  });
  return { error };
}

// 현재 로그인 사용자가 "현재 버전" 이용약관/개인정보 동의를 이미 했는지 조회한다.
// user_policy_consents 는 클라이언트 직접 SELECT 가 막혀 있어 본인 전용 RPC
// (get_current_policy_consent_status, supabase/email_verification_policy_consent_0919.sql)
// 로만 확인한다. 조회 실패는 "동의 없음"으로 안전하게 취급한다(agreed=false).
async function getCurrentPolicyConsentStatus() {
  try {
    const { data, error } = await sb.rpc('get_current_policy_consent_status');
    if (error || !data || data.success !== true) return { agreed: false, failed: true };
    return { agreed: data.agreed === true, failed: false };
  } catch (e) {
    return { agreed: false, failed: true };
  }
}

// 실제 이메일 인증 요청 (Stage 4 — 기존 회원 이메일 인증 + 정책 동의)
// 1) 서버 RPC(request_email_verification_with_policy_consent, SECURITY DEFINER)가
//    이메일 검증 + 정책 버전 검증 + 정책 동의 기록 + pending_email_verifications 기록을
//    "한 트랜잭션"으로 처리한다(타인 명의로 기록 불가, user_id 인자 없음).
// 2) RPC 성공 후에만 Supabase 표준 이메일 변경 확인 메일을 발송한다.
//
// policiesAgreed: 이용약관 + 개인정보 수집·이용 두 필수 항목을 이번에 체크했을 때만
//   true. true면 현재 정책 버전(POLICY_*_VERSION)을 함께 보내고 서버가 서버 현재
//   버전과 대조한다. false면 버전을 보내지 않으며, 서버는 이미 현재 버전 동의가 있는
//   사용자에게만 통과시킨다(없으면 POLICY_CONSENT_REQUIRED).
//
// 반환: { error, code }. code 는 서버가 알려준 정책 관련 구분값
//   (POLICY_VERSION_MISMATCH / POLICY_CONSENT_REQUIRED)만 호출부가 별도 안내에 쓴다.
//   그 밖의 실패(이메일 중복/형식 오류 등)는 계정 존재 여부 등이 드러나지 않도록
//   호출부가 구분하지 않고 하나의 일반 오류로만 안내한다(Supabase 원본 메시지 미노출).
//
// ※ 알려진 동작: RPC 성공 뒤 updateUser 가 실패하면(이미 가입된 이메일, rate limit 등)
//   정책 동의 기록과 pending 은 남는다. 동의 자체는 사실이라 무해하고, pending 은
//   기존 흐름과 같이 다음 요청에서 덮어쓰인다. (이메일 인증 완료 trigger 와 +200 정산
//   로직은 이 함수와 무관하며 변경하지 않았다.)
async function requestEmailVerification(email, policiesAgreed = false) {
  const normalized = email.trim().toLowerCase();

  const params = { p_email: normalized };
  if (policiesAgreed === true) {
    params.p_terms_version   = POLICY_TERMS_VERSION;
    params.p_privacy_version = POLICY_PRIVACY_VERSION;
  }

  const { data, error: rpcError } = await sb.rpc('request_email_verification_with_policy_consent', params);
  if (rpcError) return { error: rpcError };
  if (!data || data.success !== true) {
    const code = data?.error || 'REQUEST_FAILED';
    return { error: new Error(code), code };
  }

  const { error: updateError } = await sb.auth.updateUser(
    { email: normalized },
    { emailRedirectTo: `${window.location.origin}/pages/settings.html#email-verification` }
  );

  return { error: updateError };
}

// 로그아웃
async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// 로그아웃 확인 모달 (공통 .modal-overlay/.modal-card 스타일 재사용)
// 헤더/사이드바 등 로그아웃 버튼이 있는 모든 곳에서 공용으로 사용
function ensureLogoutModal() {
  if (document.getElementById('logoutConfirmModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'logoutConfirmModal';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">로그아웃</h3>
      <p class="modal-desc">로그아웃하시겠습니까?</p>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeLogoutConfirm()">취소</button>
        <button class="btn-danger" onclick="signOut()">로그아웃</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showLogoutConfirm() {
  ensureLogoutModal();
  document.getElementById('logoutConfirmModal').style.display = 'flex';
}

function closeLogoutConfirm() {
  const modal = document.getElementById('logoutConfirmModal');
  if (modal) modal.style.display = 'none';
}

// 스크립트 파싱 즉시 fetch 시작 — DOMContentLoaded 대기 없이 최대한 일찍 실행
const _userPromise = sb.auth.getUser().then(({ data: { user } }) => user);
async function getUser() { return _userPromise; }

// ── 종족 목록 공통 캐시 (auth.js에 정의 — 모든 파일보다 먼저 로드됨) ──
// sidebar.js, main.js, 모든 페이지가 공유. 파싱 즉시 정의, 첫 호출 시 fetch 시작.
;(function() {
  let _p = null;
  window._getSpeciesData = function() {
    if (!_p) {
      const cached = sessionStorage.getItem('_sb_species_list');
      _p = cached
        ? Promise.resolve(JSON.parse(cached))
        : sb.from('species').select('id, name').order('name').then(({ data, error }) => {
            if (!error && data) sessionStorage.setItem('_sb_species_list', JSON.stringify(data));
            return data;
          });
    }
    return _p;
  };
})();

// 종족주 여부 — 페이지당 1회만 쿼리, 이후 캐시 반환
let _spOwnerPromise = null;
window._cachedIsSpeciesOwner = async function(userId, roleIsSpeciesOwner) {
  if (roleIsSpeciesOwner) return true;
  if (!userId) return false;
  if (!_spOwnerPromise) {
    _spOwnerPromise = sb.from('species').select('id')
      .eq('owner_user_id', userId).limit(1)
      .then(({ data }) => !!data?.length);
  }
  return _spOwnerPromise;
};

// 관리자/스태프 여부
async function isAdmin() {
  const user = await getUser();
  return isAdminOrStaff(user?.user_metadata?.role);
}

// 프로필 업데이트 (소개글 등)
async function updateProfile(data) {
  const { error } = await sb.auth.updateUser({ data });
  return { error };
}

// 비밀번호 변경
async function updatePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  return { error };
}

// 계정 탈퇴 (로그아웃 처리 - 실제 삭제는 서버사이드 필요)
async function deleteAccount() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// 내 캐릭터 조회 — owner_user_id 기준만, 오프사이트 제외
// owner_contact/designer_contact/designer_external(연락처)은 컬럼 단위로
// anon/authenticated에서 REVOKE돼 있어(privacy_fix_patch2.sql) select('*')가
// 통째로 실패한다 — my-characters.html이 이 값들을 쓰지 않는 걸 확인하고
// 명시적 컬럼 목록으로 바꿨다(연락처 3개만 제외, 그 외 전부 유지).
async function getMyCharacters(userId, nickname) {
  if (!userId) return { data: [], error: null };
  const { data, error } = await sb
    .from('characters')
    .select('id, created_at, name, owner_custom_name, species_name, owner_nickname, description, number, image_url, custom_fields, additional_images, custom_field_values, designer_nickname, is_sensitive, sensitive_note, category_id, category_label, category_color, char_categories, pending_transfer, char_sections, owner_user_id, owner_is_offsite, char_number, allow_free_adoption, allow_resale, allow_paid_adoption, allow_other_adoption, thumbnail_url, folder_id, owner_description, original_image_url, watermark_type, original_additional_images, designer_user_ids, representative_step_id, default_image_index')
    .eq('owner_user_id', userId)
    .neq('owner_is_offsite', true)
    .order('created_at', { ascending: false });
  return { data, error };
}

// 내 종족 조회 — owner_user_id 기준
// LABBER 종족은 제외한다 (개체기록실 전용 — utils.js LABBER_SPECIES_ID 참고).
async function getMySpecies(userId) {
  if (!userId) return { data: [], error: null };
  let builder = sb
    .from('species').select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false });
  if (typeof LABBER_SPECIES_ID !== 'undefined') builder = builder.neq('id', LABBER_SPECIES_ID);
  const { data, error } = await builder;
  return { data: data ?? [], error };
}

// 관리자 액션 로그 기록 (공통 — 모든 페이지에서 호출 가능)
async function logAdminAction(actionType, targetType, targetId, targetName, details = {}) {
  const user = await getUser();
  if (!user || !isAdminOrStaff(user.user_metadata?.role)) return;
  try {
    // 결과의 error는 의도적으로 확인하지 않음 — role이 탭이 열린 사이 회수되어 RLS 403이 나더라도
    // 로그 한 건이 누락될 뿐 본 기능(삭제/승인 등)은 계속 진행되어야 하므로 조용히 무시한다.
    // (재검증을 위해 매 호출마다 auth 네트워크 왕복을 추가하지 않는다)
    await sb.from('admin_logs').insert({
      admin_id:       user.id,
      admin_nickname: user.user_metadata?.display_name || user.user_metadata?.nickname || '',
      action_type:    actionType,
      target_type:    targetType || null,
      target_id:      targetId ? String(targetId) : null,
      target_name:    targetName || null,
      details,
    });
  } catch (e) {
    // insert() 자체는 API 에러(403 등)로 reject하지 않으므로 여기 도달하는 건 네트워크/예외 상황뿐
    console.warn('[logAdminAction] 로그 기록 실패:', e);
  }
}

// 캐릭터 이전 로그 기록
async function logTransfer({ character_id, character_name, species_name, from_nickname, from_user_id, to_nickname, to_user_id, method }) {
  const { error } = await sb.from('character_transfers').insert({
    character_id: character_id || null,
    character_name,
    species_name,
    from_nickname,
    from_user_id: from_user_id || null,
    to_nickname,
    to_user_id:   to_user_id   || null,
    method,
  });
  return { error };
}

// 이전 내역 조회 — user_id 기준 + 구 데이터 nickname fallback
async function getTransferHistory(userId, nicknames) {
  const orParts = userId ? [`from_user_id.eq.${userId}`, `to_user_id.eq.${userId}`] : [];
  const nicks = [...new Set([].concat(nicknames).filter(Boolean))];
  nicks.forEach(n => orParts.push(`from_nickname.eq.${n}`, `to_nickname.eq.${n}`));
  if (!orParts.length) return { data: [], error: null };
  const { data, error } = await sb
    .from('character_transfers')
    .select('*')
    .or(orParts.join(','))
    .order('created_at', { ascending: false });
  const seen = new Set();
  const unique = (data || []).filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
  return { data: unique, error };
}

// 내 지갑 잔액 조회
async function getMyWallet(userId) {
  if (!userId) return { data: null, error: null };
  const { data, error } = await sb
    .from('user_wallets')
    .select('research_records, keys, updated_at')
    .eq('user_id', userId)
    .single();
  return { data, error };
}

// 내 거래 내역 조회
async function getMyCurrencyLogs(userId) {
  if (!userId) return { data: [], error: null };
  const { data, error } = await sb
    .from('currency_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { data: data ?? [], error };
}

// 닉네임 중복 체크 RPC
// 사용 가능하면 true, 중복이면 false, 오류 시 true (저장 단계에서 재확인)
async function checkNicknameAvailable(nickname) {
  const { data, error } = await sb.rpc('check_nickname_available', { p_nickname: nickname });
  if (error) { console.warn('[닉네임 체크] RPC 오류:', error); return true; }
  return data === true;
}

// 로그인 ID 중복 체크 RPC (Stage 5/6 — public.user_login_ids 기준)
// 회원가입 화면의 사전 확인용(UX 편의). 최종 권위는 여전히 user_login_ids의
// UNIQUE(login_id_normalized) 제약 — 이 체크를 통과해도 동시 가입 등으로
// DB에서 최종 거부될 수 있다. 사용 가능하면 true, 중복이면 false, 오류 시
// true(가입 시도 단계에서 DB 제약이 재확인).
async function checkLoginIdAvailable(loginId) {
  const { data, error } = await sb.rpc('check_login_id_available', { p_login_id: loginId });
  if (error) { console.warn('[로그인ID 체크] RPC 오류:', error); return true; }
  return data === true;
}

// 재화 전송 RPC (research_records / keys)
async function transferCurrency(currencyType, toNickname, amount, note) {
  const { data, error } = await sb.rpc('transfer_currency', {
    p_to_nickname: toNickname,
    p_currency:    currencyType,
    p_amount:      amount,
    p_note:        note || null,
  });
  return { data, error };
}

// 헤더 상태 업데이트
async function updateHeader() {
  const user = await getUser();
  const admin = user?.user_metadata?.role === 'admin';
  const staff = user?.user_metadata?.role === 'staff';
  const loginBtn = document.querySelector('.btn-login');

  if (user) {
    const nickname = user.user_metadata?.display_name || user.user_metadata?.nickname || '유저';

    const TESTERS = ['Moulow', 'moulow', 'Sawol'];
    const STAFF_GEN1 = ['아요', '사월', '사월巳月'];
    const isStaffGen1 = STAFF_GEN1.includes(nickname);
    const roleIsSpeciesOwner = user.user_metadata?.role === 'species_owner';
    const isSpeciesOwner = await window._cachedIsSpeciesOwner(user.id, roleIsSpeciesOwner);
    const isTester = TESTERS.includes(nickname);

    if (loginBtn) {
      loginBtn.textContent = nickname;
      loginBtn.href = 'profile.html';
      loginBtn.classList.remove('btn-login');
      loginBtn.classList.add('btn-username');

      // 재화 잔액 조회 (실패 시 0으로 폴백)
      const { data: wallet } = await getMyWallet(user.id).catch(() => ({ data: null }));
      const researchAmt = (wallet?.research_records ?? 0).toLocaleString();
      const keysAmt     = (wallet?.keys ?? 0).toLocaleString();

      // 재화 표시 — 뱃지보다 앞에 삽입
      loginBtn.insertAdjacentHTML('beforebegin', `
        <a href="my-wallet.html" class="header-currencies">
          <span class="header-currency currency-record">
            <img src="../images/icons/currency-record.png" class="currency-icon" alt="연구기록">
            <span class="currency-amount" id="headerResearchAmount">${researchAmt}</span>
          </span>
          <span class="header-currency currency-key">
            <img src="../images/icons/currency-key.png" class="currency-icon" alt="열쇠">
            <span class="currency-amount" id="headerKeysAmount">${keysAmt}</span>
          </span>
        </a>
      `);

      // 뱃지: 관리자 → 테스터 → 종족주 순으로 닉네임 앞에
      const headerBadges = [];
      if (admin)                                        headerBadges.push(`<a href="admin.html" class="badge-admin">관리자</a>`);
      if (staff)                                        headerBadges.push(`<a href="admin.html" class="badge-staff">스태프</a>`);
      if (isStaffGen1)                                  headerBadges.push(`<span class="badge-staff-gen1">스태프(1기)</span>`);
      if (isTester && !staff)                           headerBadges.push(`<span style="font-size:10px; padding:3px 8px; background:#dcfce7; color:#166534; border-radius:4px; font-weight:700; display:inline-block; margin-right:4px;">테스터</span>`);
      if (isSpeciesOwner)                               headerBadges.push(`<span class="badge-role">종족주</span>`);
      if (!admin && !staff && !isTester && !isSpeciesOwner && !isStaffGen1) headerBadges.push(`<span class="badge-user">일반유저</span>`);
      if (headerBadges.length) {
        loginBtn.insertAdjacentHTML('beforebegin', headerBadges.join(''));
      }

      // 로그아웃은 닉네임 뒤에
      loginBtn.insertAdjacentHTML('afterend',
        `<button class="btn-logout" onclick="showLogoutConfirm()">로그아웃</button>`
      );
    }
  }
}

document.addEventListener('DOMContentLoaded', updateHeader);

// 상단바 재화 숫자 즉시 갱신 (페이지 새로고침 없이)
// 사용: updateHeaderCurrencyDisplay({ research_records: N, keys: N })
function updateHeaderCurrencyDisplay({ research_records, keys } = {}) {
  const researchEl = document.getElementById('headerResearchAmount');
  const keysEl     = document.getElementById('headerKeysAmount');
  if (researchEl && research_records != null) {
    researchEl.textContent = Number(research_records).toLocaleString();
  }
  if (keysEl && keys != null) {
    keysEl.textContent = Number(keys).toLocaleString();
  }
}


// ══════════════════════════════════════════════════════════════
// 이메일 인증 완료 회원의 "현재 정책 동의" 보정 팝업 (1회성, 과도기용)
//
// 대상: 서버가 판정한다 — email_verification_rewards.granted = true 이면서
//   서버 현재 정책 버전(current_policy_versions())의 동의 기록이 없는 로그인 회원.
//   (정책 동의 UI 도입 전에 이메일 인증을 끝낸 회원의 누락 동의 보정용.)
//   클라이언트는 이메일 형식/도메인/ID 로 대상을 추측하지 않는다. 인원수·user_id·
//   login_id 어떤 값도 코드에 없다 — 호출 시점의 DB 상태만 본다.
//   아직 @dogam.com 인 회원은 설정 > 이메일 인증에서 동의를 받는 기존 흐름을 쓰므로
//   서버가 대상으로 보지 않는다(reward 없음).
//
// 서버 RPC (supabase/policy_consent_remediation_0919.sql):
//   get_policy_consent_remediation_status() / agree_policy_consent_remediation(...)
//   user_policy_consents 는 클라이언트 직접 접근이 막혀 있어 두 RPC 로만 접근한다.
//   동의 버전은 이 파일에 하드코딩하지 않고, 상태 조회가 돌려준 서버 현재 버전을
//   그대로 되돌려 보낸다(그 사이 버전이 바뀌었다면 서버가 MISMATCH 로 거부).
//
// 호출 위치를 auth.js 로 한 이유: 모든 페이지(89개)가 auth.js 를 로드하고, 이미
//   DOMContentLoaded 공통 초기화(updateHeader)가 여기 있다. sidebar.js 는 이번 기능과
//   무관한 미커밋 변경이 있어 건드리지 않는다.
//
// 표시 조건: 사이드바가 있는 일반 페이지(#sidebar)에서만. 로그인/회원가입/비밀번호
//   찾기·재설정은 사이드바가 없어 자동 제외되고, 동의 내용을 읽어야 하는 약관·방침
//   페이지는 아래 목록으로 명시 제외한다(팝업이 내용을 가리면 안 됨).
//
// 기존 이메일 인증 안내 팝업(sidebar.js, @dogam.com 대상)과의 관계: 대상이 서로 다르지만
//   (reward granted vs @dogam.com), 다른 모달이 이미 열려 있으면(body overflow 잠금)
//   이번 로드에서는 띄우지 않고 다음 페이지 로드에서 다시 판정한다 — 두 모달이 겹치거나
//   overflow 상태가 꼬이지 않는다. 기존 팝업/"오늘 하루 보지 않기"는 수정하지 않았다.
// ══════════════════════════════════════════════════════════════

const POLICY_REMEDIATION_EXCLUDED_PAGES = [
  'login', 'signup', 'forgot-password', 'reset-password', // 인증 과정 자체(사이드바가 없어 이미 제외되지만 명시)
  'terms', 'privacy',                                     // 동의할 내용을 읽어야 하는 페이지
];

// 서버에 보정 대상 여부를 묻는다. 조회 실패는 "대상 아님"으로 처리한다(사이트 이용을
// 막지 않는 fail-open — 팝업이 안 뜰 뿐이고 다음 페이지 로드에서 다시 판정된다).
async function getPolicyConsentRemediationStatus() {
  try {
    const { data, error } = await sb.rpc('get_policy_consent_remediation_status');
    if (error || !data || data.success !== true) return { required: false, failed: true };
    if (data.remediation_required !== true) return { required: false, failed: false };
    if (!data.terms_version || !data.privacy_version) return { required: false, failed: true };
    return {
      required: true,
      failed: false,
      termsVersion: data.terms_version,
      privacyVersion: data.privacy_version,
    };
  } catch (e) {
    return { required: false, failed: true };
  }
}

// signup.html / settings.html 의 정책 동의 UI 와 같은 디자인(클래스는 페이지 인라인 스타일과
// 겹치지 않도록 policy-remedy-* 로 분리). 공용 CSS(style.scss/style.css)는 수정하지 않는다.
function ensurePolicyRemediationStyle() {
  if (document.getElementById('policyRemediationStyle')) return;
  const style = document.createElement('style');
  style.id = 'policyRemediationStyle';
  style.textContent = `
    .policy-remedy { text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; background: var(--sky-pale); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 12px; }
    .policy-remedy-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .policy-remedy-check { display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0; padding: 4px 0; font-size: 13px; line-height: 1.5; color: var(--text); cursor: pointer; }
    .policy-remedy-check input[type="checkbox"] { flex-shrink: 0; width: 18px; height: 18px; margin: 1px 0 0; accent-color: var(--sky-dark); cursor: pointer; }
    .policy-remedy-tag { color: var(--sky-dark); font-weight: 700; }
    .policy-remedy-view { flex-shrink: 0; padding: 4px 2px; font-size: 12px; line-height: 1.5; color: var(--text-mute); text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; }
    .policy-remedy-view:hover { color: var(--sky-dark); }
    .policy-remedy-summary { margin: 2px 0 6px 26px; padding: 10px 12px; background: var(--white); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; line-height: 1.6; color: var(--text-sub); }
    .policy-remedy-summary dl { margin: 0; }
    .policy-remedy-summary dt { font-weight: 700; color: var(--text); }
    .policy-remedy-summary dd { margin: 0 0 6px; }
    .policy-remedy-summary dd:last-of-type { margin-bottom: 0; }
    .policy-remedy input[type="checkbox"]:focus-visible, .policy-remedy-view:focus-visible, .policy-remedy-cta:focus-visible { outline: 2px solid var(--sky-dark); outline-offset: 2px; }
    .policy-remedy-error { min-height: 18px; margin: 0 0 8px; font-size: 13px; color: #EF4444; text-align: left; }
    .policy-remedy-cta { font-family: inherit; }
    .policy-remedy-cta:disabled, .policy-remedy-cta:disabled:hover { opacity: 0.6; cursor: default; transform: none; background: var(--sky-dark); }
    @media (max-width: 640px) { .policy-remedy-summary { margin-left: 0; } }
  `;
  document.head.appendChild(style);
}

// 필수 동의 팝업 표시. 닫기(X)/바깥 클릭/ESC/오늘 하루 보지 않기 없음 — 동의 저장이
// 성공해야만 닫힌다. 내용이 화면보다 길면 카드(.goods-popup-card)가 내부 스크롤한다.
function showPolicyRemediationPopup(status) {
  if (document.getElementById('policyRemediationOverlay')) return;
  ensurePolicyRemediationStyle();

  const overlay = document.createElement('div');
  overlay.className = 'goods-popup-overlay';
  overlay.id = 'policyRemediationOverlay';
  overlay.innerHTML = `
    <div class="goods-popup-card" role="dialog" aria-modal="true" aria-labelledby="policyRemediationTitle" aria-describedby="policyRemediationDesc">
      <p class="goods-popup-title" id="policyRemediationTitle">약관 및 개인정보 처리방침 동의</p>
      <p class="goods-popup-desc" id="policyRemediationDesc">이메일 인증을 완료한 회원을 위한 1회성 안내입니다.
한 번 동의하면 다시 표시되지 않아요.</p>

      <div class="policy-remedy" role="group" aria-label="필수 약관 동의">
        <div class="policy-remedy-row">
          <label class="policy-remedy-check" for="policyRemediationTerms">
            <input type="checkbox" id="policyRemediationTerms">
            <span><span class="policy-remedy-tag">[필수]</span> 이용약관에 동의합니다.</span>
          </label>
          <a class="policy-remedy-view" href="/pages/terms.html" target="_blank" rel="noopener" aria-label="이용약관 전문 보기 (새 탭)">보기</a>
        </div>

        <div class="policy-remedy-row">
          <label class="policy-remedy-check" for="policyRemediationPrivacy">
            <input type="checkbox" id="policyRemediationPrivacy" aria-describedby="policyRemediationSummary">
            <span><span class="policy-remedy-tag">[필수]</span> 개인정보 수집 및 이용에 동의합니다.</span>
          </label>
          <a class="policy-remedy-view" href="/pages/privacy.html" target="_blank" rel="noopener" aria-label="개인정보처리방침 전문 보기 (새 탭)">보기</a>
        </div>

        <div class="policy-remedy-summary" id="policyRemediationSummary">
          <dl>
            <dt>수집 항목</dt>
            <dd>이메일 주소</dd>
            <dt>이용 목적</dt>
            <dd>이메일 인증, 회원 식별 및 계정 관리, 비밀번호 재설정 및 계정 복구</dd>
            <dt>보유 기간</dt>
            <dd>개인정보의 처리 목적이 달성되거나 이용자의 계정이 삭제되는 경우 관련 정보를 삭제하는 것을 원칙으로 합니다. 다만 서비스 운영 및 기록 유지에 필요한 일부 정보는 해당 목적에 필요한 기간 동안 보관될 수 있으며, 관계 법령에 따라 보존할 필요가 있는 경우에는 해당 법령에서 정한 기간 동안 보관할 수 있습니다.</dd>
          </dl>
        </div>
      </div>

      <p class="policy-remedy-error" id="policyRemediationError" role="alert" aria-live="polite"></p>
      <button type="button" class="goods-popup-cta policy-remedy-cta" id="policyRemediationBtn">동의하기</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // 다른 모달(굿즈 팝업 등)의 잠금 관례와 같은 방식. 닫을 때 이전 값으로 되돌려 상태가 꼬이지 않게 한다.
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const terms   = document.getElementById('policyRemediationTerms');
  const privacy = document.getElementById('policyRemediationPrivacy');
  const errorEl = document.getElementById('policyRemediationError');
  const btn     = document.getElementById('policyRemediationBtn');
  const card    = overlay.querySelector('.goods-popup-card');

  // ESC 로 닫히지 않게 막고, Tab 이동을 팝업 안으로 가둔다.
  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key !== 'Tab') return;
    const focusables = [...card.querySelectorAll('input, a[href], button')].filter(el => !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKeydown, true);

  function closePopup() {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    document.body.style.overflow = prevOverflow;
  }

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    errorEl.textContent = '';

    // 두 필수 항목을 모두 체크해야만 서버 요청을 보낸다.
    if (!terms.checked || !privacy.checked) {
      (terms.checked ? privacy : terms).focus();
      errorEl.textContent = '이용약관과 개인정보 수집 및 이용에 동의해주세요.';
      return;
    }

    btn.disabled = true;               // 요청 중 중복 클릭 방지
    btn.textContent = '저장 중...';

    let res;
    try {
      res = await sb.rpc('agree_policy_consent_remediation', {
        p_terms_agreed:    true,
        p_privacy_agreed:  true,
        p_terms_version:   status.termsVersion,    // 서버가 알려준 현재 버전을 그대로 되돌려 보냄
        p_privacy_version: status.privacyVersion,
      });
    } catch (e) {
      res = { data: null, error: e };
    }
    const { data, error } = res;

    if (!error && data && data.success === true) {
      closePopup();                    // 저장 성공 후에만 닫는다
      return;
    }

    const code = !error && data ? data.error : null;
    if (code === 'NOT_ELIGIBLE') {
      closePopup();                    // 서버가 보정 대상이 아니라고 판정 — 더 받을 동의가 없다
      return;
    }

    errorEl.textContent =
      code === 'POLICY_VERSION_MISMATCH'  ? '정책이 갱신됐어요. 새로고침 후 다시 시도해주세요.' :
      code === 'POLICY_CONSENT_REQUIRED'  ? '이용약관과 개인정보 수집 및 이용에 동의해주세요.' :
      code === 'NOT_AUTHENTICATED'        ? '로그인 상태를 확인할 수 없어요. 새로고침 후 다시 시도해주세요.' :
                                            '저장하지 못했어요. 잠시 후 다시 시도해주세요.';
    btn.disabled = false;              // 실패 시 팝업은 유지, 다시 시도 가능
    btn.textContent = '동의하기';
  });

  terms.focus();
}

async function initPolicyConsentRemediation() {
  // 사이드바가 있는 일반 페이지에서만(로그인/회원가입/비밀번호 찾기·재설정/유틸 페이지 제외)
  if (!document.getElementById('sidebar')) return;
  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  if (POLICY_REMEDIATION_EXCLUDED_PAGES.includes(page)) return;
  if (document.getElementById('policyRemediationOverlay')) return;

  const user = await getUser();
  if (!user) return;                   // 비로그인 — 서버 조회도 하지 않는다

  const status = await getPolicyConsentRemediationStatus();
  if (!status.required) return;

  // 이미 다른 모달이 열려 있으면(overflow 잠금) 이번 로드에서는 겹쳐 띄우지 않는다.
  if (document.body.style.overflow === 'hidden') return;
  if (document.getElementById('policyRemediationOverlay')) return;

  showPolicyRemediationPopup(status);
}

function _startPolicyConsentRemediation() {
  initPolicyConsentRemediation().catch((e) => console.error('[정책 동의 보정] 초기화 오류:', e));
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _startPolicyConsentRemediation);
} else {
  _startPolicyConsentRemediation();
}
