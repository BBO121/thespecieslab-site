// ── 개인연구실 (pages/labber-personal-lab.html) ─────────────────────────
// 작성일: 2026-09-24
// 개체기록실(labber-records.html, 종족 전체 로스터)과는 별개의 신규 페이지 —
// "내가 소유한 LABBER/SUBJECT를 육성·관리하는 개인 공간"으로 앞으로 확장될 자리다.
// 상위 오케스트레이터 — 로그인 확인, [LABBER]/[SUBJECT] 탭 전환만 담당한다.
//   - LABBER 탭 = 이 파일 안의 loadLabberTab()(1차 구현, 기본 목록만)
//   - SUBJECT 탭 = window.PersonalLabSubject (js/labber-personal-lab-subject.js)
//
// 탭 전환은 pages/dogam.html의 switchDogamTab과 동일한 패턴(history 조작 없이 단순
// hidden/표시 전환 + 활성 칩 토글). SUBJECT 탭 데이터는 처음 열릴 때 1회만 지연 로드한다.

let _personalLabSubjectLoaded = false;

async function initPersonalLab() {
  const loadingEl = document.getElementById('pageLoading');
  const contentEl = document.getElementById('pageContent');
  const errEl     = document.getElementById('personalLabError');

  try {
    const user = await getUser();
    if (!user) { window.location.href = 'login.html'; return; }

    await loadLabberTab(user.id);

    document.getElementById('personalLabTabRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) switchPersonalLabTab(btn.dataset.tab);
    });

    // 딥링크 ?tab=subject — 예) 관리소 > 디자인 승인 > 내 신청의 [SUBJECT 보관소 바로가기].
    // 없으면 기본 탭(LABBER) 그대로 유지.
    if (new URLSearchParams(location.search).get('tab') === 'subject') {
      switchPersonalLabTab('subject');
    }

    loadingEl.style.display = 'none';
    contentEl.style.display = '';
  } catch (e) {
    console.error('[labber-personal-lab] init 오류:', e);
    loadingEl.style.display = 'none';
    contentEl.style.display = '';
    if (errEl) {
      errEl.textContent = '개인연구실을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
      errEl.style.display = '';
    }
  }
}

// [LABBER] 탭 — 내가 소유한 LABBER 개체 기본 목록(1차 구현). 정렬/필터/관리 기능은
// 이후 확장 예정 — 지금은 최근 등록순으로 카드만 나열한다.
async function loadLabberTab(userId) {
  const grid = document.getElementById('personalLabLabberGrid');

  const { data: species, error: spErr } = await sb
    .from('species')
    .select('name')
    .eq('id', LABBER_SPECIES_ID)
    .single();
  if (spErr || !species) throw spErr || new Error('SPECIES_NOT_FOUND');

  const { data: chars, error: charErr } = await sb
    .from('characters')
    .select('id, name, owner_custom_name, char_number, image_url, thumbnail_url, species_name')
    .eq('owner_user_id', userId)
    .eq('species_name', species.name)
    .order('created_at', { ascending: false });
  if (charErr) throw charErr;

  const list = chars || [];
  document.getElementById('personalLabLabberCount').textContent = String(list.length);

  grid.innerHTML = list.length
    ? list.map(renderLabberCard).join('')
    : `<p class="personal-lab-empty">아직 소유한 LABBER 개체가 없어요.</p>`;
}

// LABBER 표시명 우선순위(2026-09-24 전역 정책): owner_custom_name(소유주가 정한 이름)이
// 있으면 그걸, 없으면 character.name(등록명)을 쓴다. DB 값은 바꾸지 않고 화면 표시에서만 적용.
function labberDisplayName(c) {
  if (!c) return '';
  const custom = typeof c.owner_custom_name === 'string' ? c.owner_custom_name.trim() : '';
  return custom || c.name || '';
}

function renderLabberCard(c) {
  return `
    <a href="character.html?id=${encodeURIComponent(c.id)}" class="character-card">
      <div class="character-img" style="background-image:url('${resolveCharacterImage(c)}'); background-size:cover; background-position:center;"></div>
      <div class="character-info">
        <p class="character-name">${escapeHtml(labberDisplayName(c))}</p>
        ${c.char_number ? `<p class="character-species">#${escapeHtml(String(c.char_number))}</p>` : ''}
      </div>
    </a>`;
}

function switchPersonalLabTab(tab) {
  document.querySelectorAll('#personalLabTabRow .shop-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.getElementById('personalLabLabberSection').style.display  = (tab === 'labber')  ? '' : 'none';
  document.getElementById('personalLabSubjectSection').style.display = (tab === 'subject') ? '' : 'none';

  if (tab === 'subject' && !_personalLabSubjectLoaded) {
    _personalLabSubjectLoaded = true;
    window.PersonalLabSubject.init();
  }
}

initPersonalLab();
