// MY > 설정 페이지
// user_settings 조회/저장은 js/utils.js의 getUserSettings()/updateUserSettings() 공용 헬퍼를 사용한다.
// (상점 js/shop.js도 동일한 헬퍼로 같은 DB 값을 공유한다 — 토글 동기화)

let _settingsUserId = null;
let _settingsUser   = null; // executeDelete() 등 profile.html에서 이전한 로직이 참조

async function initPage() {
  try {
    const user = await getUser();
    if (!user) { window.location.href = 'login.html'; return; }
    _settingsUserId = user.id;
    _settingsUser   = user;

    const settings = await getUserSettings(user.id);

    const toggle = document.getElementById('hideSensitiveToggle');
    toggle.checked = settings.hide_sensitive_content;
    toggle.addEventListener('change', async () => {
      const next = toggle.checked;
      toggle.disabled = true;
      const { error } = await updateUserSettings(_settingsUserId, { hide_sensitive_content: next });
      toggle.disabled = false;
      if (error) {
        toggle.checked = !next; // 실패 시 되돌리기
        alert('설정 저장에 실패했어요. 다시 시도해주세요.');
      }
    });

    // 이메일 인증 섹션은 다른 설정 로딩을 막지 않도록 별도로(await 없이) 초기화
    initEmailVerification(user);

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = 'block';

    // 이메일 인증 완료 redirect(emailRedirectTo=.../settings.html#email-verification)로
    // 도착했을 때 해당 섹션으로 스크롤 — 해시가 Supabase의 토큰 프래그먼트와 섞여
    // 예상과 다른 형태로 와도(예: "email-verification#access_token=...") 부분 일치로
    // 감지해 최대한 스크롤해준다. 실패해도(해시가 아예 없어도) 페이지 자체는
    // 정상 동작하므로 순수 UX 보조 기능이다.
    if (location.hash && location.hash.includes('email-verification')) {
      document.getElementById('email-verification')?.scrollIntoView({ block: 'start' });
    }
  } catch (e) {
    console.error('[settings] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

// 이메일 인증 요청 시 필수 정책 동의(이용약관 + 개인정보 수집·이용) UI 상태.
// true(기본) = 동의 UI를 보여주고 두 체크를 요구한다. 현재 버전 동의 기록이 이미
// 있다고 서버가 알려준 경우에만 false 로 바뀐다(조회 실패는 "동의 없음"으로 취급).
// 최종 판단은 언제나 서버 RPC 가 한다 — 이 값은 UI 표시용이다.
let _emailPolicyConsentRequired = true;

function _setEmailPolicyConsentVisible(visible) {
  _emailPolicyConsentRequired = visible;
  const box = document.getElementById('emailPolicyConsent');
  if (box) box.style.display = visible ? '' : 'none';
}

// 실제 이메일 인증 (Stage 4 — profile.html에서 이전, 로직 변경 없음.
// 미인증 회원의 정책 동의 UI 표시/숨김만 추가)
async function initEmailVerification(user) {
  const pendingEl     = document.getElementById('emailVerifyPending');
  const doneEl        = document.getElementById('emailVerifyDone');
  const addressEl      = document.getElementById('emailVerifyAddress');
  const rewardNoteEl  = document.getElementById('emailVerifyRewardNote');

  const isVerified = !!user.email && !user.email.toLowerCase().endsWith('@dogam.com');

  if (!isVerified) {
    pendingEl.style.display = '';
    doneEl.style.display    = 'none';

    // 동의 UI는 기본으로 보이는 상태에서 시작한다. 현재 버전 동의가 이미 있는
    // 회원에게만 숨긴다(재동의 요구 없음). 조회 실패 시에는 그대로 보인다.
    const consent = await getCurrentPolicyConsentStatus();
    if (consent.agreed) _setEmailPolicyConsentVisible(false);
    return;
  }

  pendingEl.style.display = 'none';
  doneEl.style.display    = '';
  if (addressEl) addressEl.textContent = user.email;

  // 미지급 자격이 있으면 안전하게 정산 시도(멱등 — 자격 없으면 아무 일도 안 함)
  try {
    await sb.rpc('settle_email_verification_reward');
  } catch (e) {
    console.warn('[initEmailVerification] 보상 정산 시도 실패:', e);
  }

  try {
    const { data: reward } = await sb
      .from('email_verification_rewards')
      .select('granted')
      .eq('user_id', user.id)
      .maybeSingle();
    rewardNoteEl.textContent = reward?.granted ? ' (연구기록 200 지급 완료)' : '';
  } catch (e) {
    rewardNoteEl.textContent = '';
  }
}

async function submitEmailVerification() {
  const input      = document.getElementById('emailVerifyInput');
  const errorEl    = document.getElementById('emailVerifyError');
  const successEl  = document.getElementById('emailVerifySuccess');
  const btn        = document.getElementById('emailVerifyBtn');

  const email = input.value.trim();
  errorEl.textContent   = '';
  successEl.textContent = '';

  if (!email) return;

  // 필수 정책 동의 — 버튼 상태에 의존하지 않고 요청 직전에 다시 검증한다.
  // (auth.js/서버 RPC 도 각각 동의 없는 요청을 다시 거부한다)
  const agreeTerms   = document.getElementById('emailAgreeTerms');
  const agreePrivacy = document.getElementById('emailAgreePrivacy');
  const policiesAgreed = !!(agreeTerms?.checked && agreePrivacy?.checked);
  if (_emailPolicyConsentRequired && !policiesAgreed) {
    (agreeTerms?.checked ? agreePrivacy : agreeTerms)?.focus();
    errorEl.textContent = '이용약관과 개인정보 수집 및 이용에 동의해주세요.';
    return;
  }

  btn.textContent = '전송 중...';
  btn.disabled = true;

  // 동의 UI 를 보여준 경우에만 이번에 체크한 동의를 함께 보낸다. 숨긴 경우(이미
  // 현재 버전 동의 있음)에는 버전을 보내지 않고, 서버가 기존 동의 기록으로 판단한다.
  const { error, code } = await requestEmailVerification(email, _emailPolicyConsentRequired && policiesAgreed);

  if (code === 'POLICY_VERSION_MISMATCH') {
    // 오래된 화면(구버전 정책 문구)으로 요청한 경우 — 인증 요청을 진행하지 않는다.
    errorEl.textContent = '정책이 갱신됐어요. 새로고침 후 다시 시도해주세요.';
  } else if (code === 'POLICY_CONSENT_REQUIRED') {
    // 화면은 "이미 동의함"으로 알고 있었지만 서버에 현재 버전 동의가 없는 경우 —
    // 동의 UI 를 다시 보여주고 체크를 요구한다.
    _setEmailPolicyConsentVisible(true);
    errorEl.textContent = '이용약관과 개인정보 수집 및 이용에 동의해주세요.';
  } else if (error) {
    // Supabase 원본 오류 메시지를 그대로 노출하지 않는다(이메일 중복 등 계정
    // 존재 여부와 관련된 정보를 노출하지 않기 위함 — 실패 원인을 구분하지 않음).
    errorEl.textContent = '이 이메일로 변경할 수 없어요. 다른 이메일을 사용해주세요.';
  } else {
    successEl.innerHTML = '인증 메일을 보냈어요!' +
      '<br><span style="font-size:12px; color:var(--text-mute); font-weight:400;">메일이 보이지 않는다면 스팸함도 확인해주세요.</span>';
    input.value = '';
  }

  btn.textContent = '인증 메일 보내기';
  btn.disabled = false;
}

// 비밀번호 변경 (profile.html에서 이전, 로직 변경 없음)
async function changePassword() {
  const newPw      = document.getElementById('newPassword').value;
  const confirmPw  = document.getElementById('newPasswordConfirm').value;
  const btn        = document.getElementById('changePwBtn');
  const errorEl    = document.getElementById('pwError');
  const successEl  = document.getElementById('pwSuccess');

  errorEl.textContent = '';
  successEl.textContent = '';

  if (newPw.length < 6) {
    errorEl.textContent = '비밀번호는 6자 이상이어야 해요.';
    return;
  }
  if (newPw !== confirmPw) {
    errorEl.textContent = '비밀번호가 일치하지 않아요.';
    return;
  }

  btn.textContent = '변경 중...';
  btn.disabled = true;

  const { error } = await updatePassword(newPw);

  if (error) {
    errorEl.textContent = '변경에 실패했어요. 다시 시도해주세요.';
  } else {
    successEl.textContent = '비밀번호가 변경됐어요!';
    document.getElementById('newPassword').value = '';
    document.getElementById('newPasswordConfirm').value = '';
    setTimeout(() => successEl.textContent = '', 3000);
  }

  btn.textContent = '변경';
  btn.disabled = false;
}

// 탈퇴 모달 (profile.html에서 이전, 로직 변경 없음 — currentUser → _settingsUser)
function confirmDelete() {
  document.getElementById('deleteModal').style.display = 'flex';
}
function closeDeleteModal() {
  document.getElementById('deleteModal').style.display = 'none';
}
async function executeDelete() {
  const btn = document.getElementById('confirmDeleteBtn');
  btn.textContent = '처리 중...';
  btn.disabled = true;

  const nickname = _settingsUser?.user_metadata?.nickname;
  if (nickname) {
    await Promise.all([
      sb.from('characters').update({ owner_nickname: '(알수없음)', owner_user_id: null }).eq('owner_user_id', _settingsUser.id),
      // 디자이너 삭제 처리: UUID 제거 + display string 갱신 (비동기)
      (async () => {
        const [{ data: uuidDesigns }, { data: allUsersData }] = await Promise.all([
          sb.from('characters_public').select('id, designer_user_ids, designer_external')
            .filter('designer_user_ids', 'cs', `{${_settingsUser.id}}`),
          sb.rpc('get_all_users'),
        ]);
        const idToNick = Object.fromEntries((allUsersData || []).map(u => [u.id, u.nickname]));
        await Promise.all((uuidDesigns || []).map(c => {
          const updatedIds  = (c.designer_user_ids || []).filter(id => id !== _settingsUser.id);
          const siteNicks   = updatedIds.map(id => idToNick[id] || '(알수없음)');
          const extNames    = (c.designer_external || []).filter(e => e && e.name).map(e => e.name);
          const updatedNick = [...siteNicks, ...extNames].join(' / ') || '(알수없음)';
          return sb.from('characters').update({ designer_nickname: updatedNick, designer_user_ids: updatedIds }).eq('id', c.id);
        }));
        await sb.from('characters').update({ designer_nickname: '(알수없음)' }).eq('designer_nickname', nickname);
      })(),
      sb.from('species').update({ owner_nickname: '(알수없음)', owner_user_id: null }).eq('owner_user_id', _settingsUser.id),
      sb.from('character_transfers').update({ from_nickname: '(알수없음)' }).eq('from_nickname', nickname),
      sb.from('character_transfers').update({ to_nickname: '(알수없음)' }).eq('to_nickname', nickname),
    ]);
  }

  await deleteAccount();
}

initPage();
