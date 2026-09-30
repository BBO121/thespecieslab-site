// ── 도감 (pages/dogam.html) ─────────────────────────────────────
// 작성일: 2026-09-22
// 상위 페이지 오케스트레이터 — 로그인 확인, [아이템 도감]/[SUBJECT] 탭 전환, URL(?tab=)
// 유지만 담당한다. 실제 데이터 로직은 각 탭 모듈에 있다:
//   - 아이템 도감 탭 = window.ItemDogam (js/item-collection.js)
//   - SUBJECT 탭     = window.SubjectDogam (js/dogam-subject.js)
//
// 탭 전환은 history.replaceState 로 현재 URL의 ?tab= 값만 갱신한다(pushState 아님) —
// 이 프로젝트의 기존 탭 전환 패턴(js/labber-lab.js switchTab, ABOUT/특성/디자인승인)과
// 동일한 방식. 탭 클릭이 브라우저 히스토리에 새 엔트리를 쌓지 않으므로 뒤로가기/앞으로가기는
// 평소처럼(이 페이지 진입 전 화면으로) 동작 — 탭 전환 때문에 깨지는 동작은 없다.
// 새로고침/직접 링크(dogam.html?tab=subject)는 initPage() 가 최초 로드 시 ?tab= 을 읽어
// 그대로 복원한다.
//
// SUBJECT 탭 데이터는 처음 열릴 때 1회만 지연 로드한다(_dogamSubjectLoaded).

let _dogamSubjectLoaded = false;

async function initPage() {
  try {
    const user = await getUser();
    if (!user) { window.location.href = 'login.html'; return; }

    document.getElementById('dogamTabRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) switchDogamTab(btn.dataset.tab);
    });

    await ItemDogam.init(); // 기본 진입 탭

    const params = new URLSearchParams(location.search);
    const initialTab = params.get('tab') === 'subject' ? 'subject' : 'items';
    if (initialTab === 'subject') await loadSubjectTab(); // 직접 진입/새로고침 시 빈 화면 깜빡임 방지

    switchDogamTab(initialTab);

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';

    // LABBER 도감 등록 업적 재확인(서버 판정) — 화면 표시를 막지 않도록 await 하지 않는다.
    window.syncLabberAchievements?.();
  } catch (e) {
    console.error('[dogam] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

async function loadSubjectTab() {
  if (_dogamSubjectLoaded) return;
  _dogamSubjectLoaded = true;
  await SubjectDogam.init();
}

function switchDogamTab(tab) {
  document.querySelectorAll('#dogamTabRow .shop-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('dogam-tab-items').hidden   = (tab !== 'items');
  document.getElementById('dogam-tab-subject').hidden = (tab !== 'subject');

  const url = new URL(location.href);
  url.searchParams.set('tab', tab);
  history.replaceState(null, '', url);

  if (tab === 'subject') loadSubjectTab(); // 탭 클릭으로 처음 열리는 경우(지연 로드, idempotent)
}

initPage();
