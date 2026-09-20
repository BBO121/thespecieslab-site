async function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;


  const path = window.location.pathname.split('/').pop();
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  sidebar.innerHTML = `
    <div class="sidebar-user-block" id="sidebarUserBlock"></div>

    <!-- ── 홈 아코디언 ─────────────────────────────── -->
    <div class="sidebar-accordion" id="accHome">
      <button class="sidebar-accordion-btn" onclick="toggleAccordion('accHome')">
        홈<svg class="sidebar-accordion-arrow" id="arrHome" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sidebar-accordion-body" id="bodyHome">
        <a href="notice.html"      class="sidebar-subitem ${path === 'notice.html'           || path === 'notice-detail.html'        ? 'active' : ''}">공지사항</a>
        <a href="events.html"      class="sidebar-subitem ${path === 'events.html'           || path === 'event-detail.html'         ? 'active' : ''}">이벤트</a>
        <a href="guide.html"       class="sidebar-subitem ${path === 'guide.html'            || path === 'guide-detail.html'         ? 'active' : ''}">가이드</a>
        <div class="sidebar-divider" style="margin:8px 0;"></div>
        <a href="update-note.html" class="sidebar-subitem ${path === 'update-note.html'      || path === 'update-note-detail.html'   || path === 'update-note-write.html' ? 'active' : ''}">업데이트</a>
        <a href="dev-log.html"     class="sidebar-subitem ${path === 'dev-log.html'          || path === 'dev-log-detail.html'       || path === 'dev-log-write.html'     ? 'active' : ''}">개발일지</a>
        <!-- TODO: 출석 — 개발일지 아래 위치 예정 -->
      </div>
    </div>

    <!-- ── 출석 단일 메뉴 ───────────────────────────── -->
    <a href="attendance.html" class="sidebar-top-link ${path === 'attendance.html' ? 'active' : ''}">출석</a>

    <!-- ── 리스트 아코디언 ──────────────────────────── -->
    <div class="sidebar-accordion" id="accList">
      <button class="sidebar-accordion-btn" onclick="toggleAccordion('accList')">
        리스트<svg class="sidebar-accordion-arrow" id="arrList" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sidebar-accordion-body" id="bodyList">
        <button class="sidebar-subitem" id="btnSpecies" onclick="onSpeciesClick(this)" style="background:none;border:none;width:100%;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
          종족<span style="font-size:14px;opacity:0.5;">▶</span>
        </button>
        <div id="bodySpecies" style="display:none;"></div>
        <a href="character-list.html" class="sidebar-subitem ${path === 'character-list.html' || path === 'character.html'                                                    ? 'active' : ''}">개체</a>
        <a href="adoption.html"       class="sidebar-subitem ${path === 'adoption.html'       || path === 'adoption-detail.html'   || path === 'adoption-write.html'          ? 'active' : ''}">분양</a>
        <a href="users.html"          class="sidebar-subitem ${path === 'users.html'          || (path === 'profile.html' && new URLSearchParams(window.location.search).get('user')) ? 'active' : ''}">유저</a>
      </div>
    </div>

    <!-- ── MY 아코디언 (로그인 전용) ────────────────── -->
    <div class="sidebar-accordion sidebar-login" id="accMy">
      <button class="sidebar-accordion-btn" onclick="toggleAccordion('accMy')">
        MY<svg class="sidebar-accordion-arrow" id="arrMy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sidebar-accordion-body" id="bodyMy">
        <a href="my-species.html"       class="sidebar-subitem ${path === 'my-species.html'       ? 'active' : ''}">내 종족</a>
        <a href="my-characters.html"    class="sidebar-subitem ${path === 'my-characters.html'    ? 'active' : ''}">내 캐릭터</a>
        <a href="my-designs.html"       class="sidebar-subitem ${path === 'my-designs.html'       ? 'active' : ''}">내 디자인</a>
        <a href="my-slots.html"         class="sidebar-subitem ${path === 'my-slots.html'         ? 'active' : ''}">내 디자인권</a>
        <a href="my-adoptions.html"     class="sidebar-subitem ${path === 'my-adoptions.html'     ? 'active' : ''}">내 분양</a>
        <div class="sidebar-divider" style="margin:8px 0;"></div>
        <a href="profile.html"          class="sidebar-subitem ${path === 'profile.html' && !new URLSearchParams(window.location.search).get('user') ? 'active' : ''}">프로필</a>
        <a href="achievements.html"     class="sidebar-subitem ${path === 'achievements.html' ? 'active' : ''}">업적</a>
        <a href="my-wallet.html"        class="sidebar-subitem ${path === 'my-wallet.html' ? 'active' : ''}">지갑</a>
        <a href="my-bag.html"           class="sidebar-subitem ${path === 'my-bag.html'    ? 'active' : ''}">가방</a>
        <a href="item-transfer-history.html" class="sidebar-subitem ${path === 'item-transfer-history.html' ? 'active' : ''}">아이템 전송 내역</a>
        <div class="sidebar-divider" style="margin:8px 0;"></div>
        <a href="settings.html"         class="sidebar-subitem ${path === 'settings.html' ? 'active' : ''}">설정</a>
        <a href="notifications.html"    class="sidebar-subitem ${path === 'notifications.html'    ? 'active' : ''}" style="display:flex;justify-content:space-between;align-items:center;">알림함<span class="sidebar-notif-badge" id="sidebarNotifBadge" style="display:none">0</span></a>
        <a href="transfer-history.html" class="sidebar-subitem ${path === 'transfer-history.html' ? 'active' : ''}">캐릭터 이전 내역</a>
      </div>
    </div>

    <!-- ── LABBER 아코디언 (MY 바로 아래) ──────────── -->
    <div class="sidebar-accordion" id="accLabber">
      <button class="sidebar-accordion-btn" onclick="toggleAccordion('accLabber')">
        <img src="../images/labber/labber_logo.png" alt="LABBER" class="labber-menu-logo">
        <svg class="sidebar-accordion-arrow" id="arrLabber" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sidebar-accordion-body" id="bodyLabber">
        <a href="labber-lab.html" class="sidebar-subitem ${path === 'labber-lab.html' ? 'active' : ''}">관리소</a>
        <a href="labber-records.html"     class="sidebar-subitem ${path === 'labber-records.html'     ? 'active' : ''}">개체기록실</a>
        <a href="labber-amplification.html" class="sidebar-subitem ${path === 'labber-amplification.html' ? 'active' : ''}">기록 증폭 실험</a>
      </div>
    </div>

    <!-- ── 상점 아코디언 ─────────────────────────── -->
    <div class="sidebar-accordion" id="accShop">
      <button class="sidebar-accordion-btn" onclick="toggleAccordion('accShop')">
        상점<svg class="sidebar-accordion-arrow" id="arrShop" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sidebar-accordion-body" id="bodyShop">
        <a href="shop.html"        class="sidebar-subitem ${path === 'shop.html'        ? 'active' : ''}">연구소 상점</a>
        <a href="labber-shop.html" class="sidebar-subitem labber-menu-link ${path === 'labber-shop.html' ? 'active' : ''}">
          <span>LABBER 상점</span>
          <img src="../images/labber/labber_logo.png" alt="LABBER" class="labber-menu-logo">
        </a>
        <a href="labber.html"      class="sidebar-subitem labber-menu-link ${path === 'labber.html'      ? 'active' : ''}">
          <span>수상한 연구실</span>
          <img src="../images/labber/labber_logo.png" alt="LABBER" class="labber-menu-logo">
        </a>
      </div>
    </div>

    <!-- ── 지원 아코디언 ─────────────────────────────── -->
    <div class="sidebar-accordion" id="accSupport">
      <button class="sidebar-accordion-btn" onclick="toggleAccordion('accSupport')">
        지원<svg class="sidebar-accordion-arrow" id="arrSupport" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sidebar-accordion-body" id="bodySupport">
        <a href="inquiry.html"    class="sidebar-subitem ${path === 'inquiry.html'    || path === 'inquiry-write.html'    || path === 'inquiry-detail.html'    ? 'active' : ''}" style="display:flex;justify-content:space-between;align-items:center;">문의<span class="sidebar-notif-badge" id="sidebarInquiryBadge" style="display:none">0</span></a>
        <a href="bug-report.html" class="sidebar-subitem ${path === 'bug-report.html' || path === 'bug-report-write.html' || path === 'bug-report-detail.html' ? 'active' : ''}" style="display:flex;justify-content:space-between;align-items:center;">버그리포트<span class="sidebar-notif-badge" id="sidebarBugBadge" style="display:none">0</span></a>
      </div>
    </div>

    <!-- ── 종족주 신청 단일 메뉴 ─────────────────────── -->
    <a href="species-apply.html" class="sidebar-top-link ${path === 'species-apply.html' || path === 'species-apply-write.html' || path === 'species-apply-detail.html' ? 'active' : ''}">✨종족주 신청✨<span class="sidebar-notif-badge" id="sidebarApplyBadge" style="display:none">0</span></a>

    <!-- ── 서버 시간 ────────────────────────────────── -->
    <div class="sidebar-server-clock-wrap">
      <span class="server-clock server-clock--sidebar">서버시간 --:--:--</span>
    </div>

    <!-- ── 서버비 후원 카드 ─────────────────────────── -->
    <a href="https://ctee.kr/place/thespecieslab/donation" target="_blank" rel="noopener noreferrer" class="sidebar-donate-card">
      <img src="../images/donate.png" alt="" class="sidebar-donate-card-img">
      <span class="sidebar-donate-card-text">
        <span class="sidebar-donate-card-title">서버비 후원이 열렸어요!</span>
        <span class="sidebar-donate-card-sub">연구소 운영에 큰 힘이 됩니다</span>
      </span>
      <span class="sidebar-donate-card-arrow">›</span>
    </a>
  `;

  // 현재 페이지에 해당하는 아코디언 자동 열기
  const homePages    = ['notice.html','notice-detail.html','events.html','event-detail.html','guide.html','guide-detail.html',
                        'update-note.html','update-note-detail.html','update-note-write.html',
                        'dev-log.html','dev-log-detail.html','dev-log-write.html'];
  const listPages    = ['species.html','species-list.html','character-list.html','character.html',
                        'adoption.html','adoption-detail.html','adoption-write.html','users.html'];
  const myPages      = ['my-species.html','my-characters.html','my-designs.html','my-slots.html',
                        'my-adoptions.html','notifications.html','transfer-history.html','my-wallet.html','my-bag.html',
                        'item-transfer-history.html','settings.html'];
  const supportPages = ['inquiry.html','inquiry-write.html','inquiry-detail.html',
                        'bug-report.html','bug-report-write.html','bug-report-detail.html',
                        'species-apply.html','species-apply-write.html','species-apply-detail.html'];
  const shopPages     = ['shop.html','labber-shop.html','labber.html'];
  const labberPages   = ['labber-lab.html','labber-records.html','labber-amplification.html'];

  const isUserProfile = path === 'profile.html' && new URLSearchParams(window.location.search).get('user');
  const isMyProfile   = path === 'profile.html' && !new URLSearchParams(window.location.search).get('user');

  function openAccordion(suffix) {
    const body  = document.getElementById('body'  + suffix);
    const arrow = document.getElementById('arr'   + suffix);
    if (body)  body.classList.add('open');
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }

  if (homePages.includes(path))              openAccordion('Home');
  if (listPages.includes(path) || isUserProfile) openAccordion('List');
  if (myPages.includes(path)   || isMyProfile)   openAccordion('My');
  if (supportPages.includes(path))           openAccordion('Support');
  if (shopPages.includes(path))              openAccordion('Shop');
  if (labberPages.includes(path))            openAccordion('Labber');

  // 종족 관련 페이지: 종족 버튼 active 표시
  if (path === 'species.html' || path === 'species-list.html') {
    document.getElementById('btnSpecies')?.classList.add('active');
  }

  // 플라이아웃 패널 주입 (PC 전용)
  if (!document.getElementById('flyoutSpecies')) {
    const el = document.createElement('div');
    el.id = 'flyoutSpecies';
    el.className = 'species-flyout';
    document.body.appendChild(el);
  }

  // 바텀시트 주입 (모바일 전용)
  if (!document.getElementById('speciesSheetOverlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'speciesSheetOverlay';
    overlay.className = 'species-sheet-overlay';
    overlay.addEventListener('click', dismissSpeciesSheet);
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'speciesSheetPanel';
    panel.className = 'species-sheet-panel';
    document.body.appendChild(panel);
  }

  loadSpeciesSidebar();
  updateSidebarLogin();
  loadAdminBadges();
  initEmailVerifyPopup();
  initHamburger();
}

function initHamburger() {
  // 햄버거 버튼 주입
  const headerInner = document.querySelector('.header-inner');
  if (headerInner && !document.getElementById('hamburgerBtn')) {
    const btn = document.createElement('button');
    btn.id = 'hamburgerBtn';
    btn.className = 'hamburger-btn';
    btn.setAttribute('aria-label', '메뉴 열기');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.addEventListener('click', toggleSidebar);
    headerInner.prepend(btn);
  }

  // 오버레이 주입
  if (!document.getElementById('sidebarOverlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'sidebar-overlay';
    overlay.addEventListener('click', closeSidebar);
    document.body.appendChild(overlay);
  }

  // 사이드바 링크 클릭 시 닫기 (모바일, 아코디언 버튼 제외)
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.querySelectorAll('a, button').forEach(el => {
      el.addEventListener('click', () => {
        if (window.innerWidth <= 767 && !el.classList.contains('sidebar-accordion-btn')) {
          closeSidebar();
        }
      });
    });
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('hamburgerBtn');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;

  const isOpen = sidebar.classList.toggle('sidebar--open');
  if (btn)     btn.classList.toggle('is-open', isOpen);
  if (overlay) overlay.classList.toggle('show', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('hamburgerBtn');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('sidebar--open');
  if (btn)     btn.classList.remove('is-open');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
}

// 초성/문자 그룹 반환
function getSpeciesGroup(name) {
  const ch   = name?.[0] || '';
  const code = ch.charCodeAt(0);
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return 'A-Z';
  if (code >= 0xAC00 && code <= 0xD7A3) {
    const cho = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
    return cho[Math.floor((code - 0xAC00) / (21 * 28))];
  }
  return '#';
}

const FLYOUT_GROUP_ORDER = ['A-Z','ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ','#'];

async function loadSpeciesSidebar() {
  const body       = document.getElementById('bodySpecies');
  const flyout     = document.getElementById('flyoutSpecies');
  const sheetPanel = document.getElementById('speciesSheetPanel');
  if (!body) return;

  // LABBER 종족은 일반 종족 목록/플라이아웃에 노출하지 않는다 (개체기록실 전용 — utils.js LABBER_SPECIES_ID).
  let speciesQuery = sb.from('species').select('id, name').order('name');
  if (typeof LABBER_SPECIES_ID !== 'undefined') speciesQuery = speciesQuery.neq('id', LABBER_SPECIES_ID);
  const { data, error } = await speciesQuery;

  const q    = new URLSearchParams(window.location.search);
  const curr = q.get('id');

  const allLink       = `<a href="species-list.html" class="sidebar-subitem sidebar-subitem--all">전체보기</a>`;
  const allLinkFlyout = `<a href="species-list.html" class="flyout-all-link">전체보기</a>`;

  // ── 모바일 아코디언 body (숨겨져 있으나 혹시 모를 대비) ──
  if (error || !data || data.length === 0) {
    body.innerHTML = allLink;
  } else {
    body.innerHTML = allLink + data.map(s =>
      `<a href="species.html?id=${s.id}" class="sidebar-subitem ${curr === String(s.id) ? 'active' : ''}">${s.name}</a>`
    ).join('');
  }

  // ── 플라이아웃·바텀시트 공용 그룹화 HTML ──────────────────
  let groupedHtml = allLinkFlyout;
  if (error || !data || data.length === 0) {
    const dummy = ['드래곤','엘프','요정','늑대인간','슬라임','골렘'];
    groupedHtml += dummy.map(n =>
      `<a href="species-list.html" class="sidebar-subitem" style="opacity:0.45;">${n}</a>`
    ).join('');
  } else {
    const groups = {};
    data.forEach(s => {
      const g = getSpeciesGroup(s.name);
      (groups[g] = groups[g] || []).push(s);
    });
    FLYOUT_GROUP_ORDER.forEach(g => {
      if (!groups[g]) return;
      groupedHtml += `<div class="flyout-group-label">${g}</div>`;
      groupedHtml += groups[g].map(s =>
        `<a href="species.html?id=${s.id}" class="sidebar-subitem ${curr === String(s.id) ? 'active' : ''}">${s.name}</a>`
      ).join('');
    });
  }

  const searchHtml = `<div class="flyout-search-wrap"><input type="text" class="flyout-search-input" placeholder="종족 검색..."></div>`;
  const scrollWrapOpen  = '<div class="flyout-scroll-body">';
  const scrollWrapClose = '</div>';

  // 플라이아웃 (PC)
  if (flyout) {
    flyout.innerHTML = searchHtml + scrollWrapOpen + groupedHtml + scrollWrapClose;
    const input = flyout.querySelector('.flyout-search-input');
    const scrollBody = flyout.querySelector('.flyout-scroll-body');
    input.addEventListener('input', () => filterFlyout(scrollBody, input.value));
    flyout.querySelectorAll('a').forEach(el => {
      el.addEventListener('click', () => { if (window.innerWidth >= 768) closeFlyout(); });
    });
  }

  // 바텀시트 (모바일)
  if (sheetPanel) {
    sheetPanel.innerHTML = '<div class="species-sheet-handle"></div>' + searchHtml + scrollWrapOpen + groupedHtml + scrollWrapClose;
    const input = sheetPanel.querySelector('.flyout-search-input');
    const scrollBody = sheetPanel.querySelector('.flyout-scroll-body');
    input.addEventListener('input', () => filterFlyout(scrollBody, input.value));
    sheetPanel.querySelectorAll('a').forEach(el => {
      el.addEventListener('click', closeSpeciesSheet);
    });
  }
}

async function updateSidebarLogin() {
  const user = await getUser();
  const block = document.getElementById('sidebarUserBlock');

  if (user) {
    document.querySelectorAll('.sidebar-login').forEach(el => el.classList.remove('sidebar-login'));

    if (block) {
      const nickname = user.user_metadata?.display_name || user.user_metadata?.nickname || '유저';
      const admin = user.user_metadata?.role === 'admin';
      const staff = user.user_metadata?.role === 'staff';
      const TESTERS = ['Moulow', 'moulow', 'Sawol'];
      const STAFF_GEN1 = ['아요', '사월', '사월巳月'];
      const isTester = TESTERS.includes(nickname);
      const isStaffGen1 = STAFF_GEN1.includes(nickname);
      const roleIsSpeciesOwner = user.user_metadata?.role === 'species_owner';
      const isSpeciesOwner = await window._cachedIsSpeciesOwner?.(user.id, roleIsSpeciesOwner) ?? roleIsSpeciesOwner;

      const badges = [];
      if (admin)                                        badges.push(`<a href="admin.html" class="badge-admin">관리자</a>`);
      if (staff)                                        badges.push(`<a href="admin.html" class="badge-staff">스태프</a>`);
      if (isStaffGen1)                                  badges.push(`<span class="badge-staff-gen1">스태프(1기)</span>`);
      if (isTester && !staff)                           badges.push(`<span style="font-size:10px;padding:3px 8px;background:#dcfce7;color:#166534;border-radius:4px;font-weight:700;">테스터</span>`);
      if (isSpeciesOwner)                               badges.push(`<span class="badge-role">종족주</span>`);
      if (!admin && !staff && !isTester && !isSpeciesOwner && !isStaffGen1) badges.push(`<span class="badge-user">일반유저</span>`);

      const [{ data: wallet }, { data: repProfile }] = await Promise.all([
        getMyWallet(user.id).catch(() => ({ data: null })),
        sb.from('user_profiles').select('representative_character_id').eq('user_id', user.id).maybeSingle(),
      ]);
      const researchAmt = (wallet?.research_records ?? 0).toLocaleString();
      const keysAmt     = (wallet?.keys ?? 0).toLocaleString();

      let repChar = null;
      if (repProfile?.representative_character_id) {
        const { data: c } = await sb.from('characters_public')
          .select('id, name, owner_custom_name, species_name, image_url, thumbnail_url, default_image_index')
          .eq('id', repProfile.representative_character_id)
          .maybeSingle();
        repChar = c || null;
      }

      // 대표 캐릭터는 미설정이어도 항상 존재하는 슬롯 — placeholder로 자리를 유지해 레이아웃이 움직이지 않게 함
      const repCharHtml = repChar ? `
        <a href="character.html?id=${repChar.id}" class="sidebar-rep-char">
          <div class="sidebar-rep-char-img" style="background-image:url('${resolveCharacterImage(repChar)}')"></div>
        </a>` : `
        <a href="profile.html" class="sidebar-rep-char">
          <div class="sidebar-rep-char-img sidebar-rep-char-img--empty">＋</div>
        </a>`;
      const repCharCaption = repChar
        ? `<p class="sidebar-rep-char-caption">${representativeCharacterName(repChar)} · ${repChar.species_name || ''}</p>`
        : `<p class="sidebar-rep-char-caption">대표 캐릭터 미설정</p>`;

      block.innerHTML = `
        ${repCharHtml}
        ${repCharCaption}
        <div class="sidebar-user-row">
          <a href="profile.html" class="btn-username">${nickname}</a>
          ${badges.length ? `<div class="sidebar-user-badges">${badges.join('')}</div>` : ''}
        </div>
        <a href="my-wallet.html" class="sidebar-currencies">
          <span class="header-currency currency-record">
            <img src="../images/icons/currency-record.png" class="currency-icon" alt="연구기록">
            <span class="currency-amount">${researchAmt}</span>
            <span class="sidebar-currency-label">연구기록</span>
          </span>
          <span class="header-currency currency-key">
            <img src="../images/icons/currency-key.png" class="currency-icon" alt="열쇠">
            <span class="currency-amount">${keysAmt}</span>
            <span class="sidebar-currency-label">열쇠</span>
          </span>
        </a>
        <button class="btn-logout" onclick="showLogoutConfirm()">로그아웃</button>
      `;
    }
  } else {
    if (block) {
      block.innerHTML = `<a href="login.html" class="btn-login">로그인</a>`;
    }
  }
}

// ── 종족 플라이아웃 (PC 전용) ─────────────────────────
function onSpeciesClick(btn) {
  if (window.innerWidth < 768) {
    closeSidebar();
    openSpeciesSheet();
  } else {
    const flyout = document.getElementById('flyoutSpecies');
    if (flyout && flyout.classList.contains('open')) {
      closeFlyout();
    } else {
      openFlyout(btn);
    }
  }
}

function resetFlyoutSearch(container) {
  const input = container?.querySelector('.flyout-search-input');
  if (input && input.value) {
    input.value = '';
    const scrollBody = container.querySelector('.flyout-scroll-body');
    if (scrollBody) filterFlyout(scrollBody, '');
  }
}

function openFlyout(btn) {
  const flyout = document.getElementById('flyoutSpecies');
  if (!flyout) return;

  resetFlyoutSearch(flyout);
  const rect = btn.getBoundingClientRect();
  flyout.style.top  = rect.top + 'px';
  flyout.style.left = (rect.right + 6) + 'px';
  flyout.classList.add('open');

  // 뷰포트 하단 벗어나면 위로 조정
  const fr = flyout.getBoundingClientRect();
  if (fr.bottom > window.innerHeight - 12) {
    flyout.style.top = Math.max(12, window.innerHeight - fr.height - 12) + 'px';
  }

  btn.classList.add('flyout-open');
  setTimeout(() => document.addEventListener('click', onFlyoutOutsideClick), 0);
}

function closeFlyout() {
  const flyout = document.getElementById('flyoutSpecies');
  const btn    = document.getElementById('btnSpecies');
  if (flyout) flyout.classList.remove('open');
  if (btn)    btn.classList.remove('flyout-open');
  document.removeEventListener('click', onFlyoutOutsideClick);
}

function openSpeciesSheet() {
  const overlay = document.getElementById('speciesSheetOverlay');
  const panel   = document.getElementById('speciesSheetPanel');
  if (overlay) overlay.classList.add('show');
  if (panel) {
    resetFlyoutSearch(panel);
    panel.classList.add('open');
    const scrollBody = panel.querySelector('.flyout-scroll-body');
    if (scrollBody) scrollBody.scrollTop = 0;
  }
  document.body.style.overflow = 'hidden';
}

function closeSpeciesSheet() {
  const overlay = document.getElementById('speciesSheetOverlay');
  const panel   = document.getElementById('speciesSheetPanel');
  if (overlay) overlay.classList.remove('show');
  if (panel)   panel.classList.remove('open');
  document.body.style.overflow = '';
}

function dismissSpeciesSheet() {
  closeSpeciesSheet();
  toggleSidebar();
}

function filterFlyout(scrollBody, query) {
  const q = query.trim().toLowerCase();
  const items  = scrollBody.querySelectorAll('.sidebar-subitem');
  const labels = scrollBody.querySelectorAll('.flyout-group-label');

  if (!q) {
    items.forEach(el => el.style.display = '');
    labels.forEach(el => el.style.display = '');
    const empty = scrollBody.querySelector('.flyout-empty');
    if (empty) empty.remove();
    return;
  }

  items.forEach(el => {
    if (el.classList.contains('sidebar-subitem--all') || el.classList.contains('flyout-all-link')) {
      el.style.display = '';
    } else {
      el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
    }
  });

  labels.forEach(label => {
    let next = label.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('flyout-group-label')) {
      if (next.tagName === 'A' && next.style.display !== 'none') { hasVisible = true; break; }
      next = next.nextElementSibling;
    }
    label.style.display = hasVisible ? '' : 'none';
  });

  const allHidden = [...items].filter(el =>
    !el.classList.contains('sidebar-subitem--all') && !el.classList.contains('flyout-all-link')
  ).every(el => el.style.display === 'none');

  let empty = scrollBody.querySelector('.flyout-empty');
  if (allHidden) {
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'flyout-empty';
      empty.textContent = '검색 결과가 없어요.';
      scrollBody.appendChild(empty);
    }
  } else {
    if (empty) empty.remove();
  }
}

function onFlyoutOutsideClick(e) {
  const flyout = document.getElementById('flyoutSpecies');
  const btn    = document.getElementById('btnSpecies');
  if (flyout && btn && !flyout.contains(e.target) && !btn.contains(e.target)) {
    closeFlyout();
  }
}

function toggleAccordion(id) {
  const suffix  = id.replace('acc', '');
  const body    = document.getElementById('body' + suffix);
  const arrow   = document.getElementById('arr'  + suffix);
  if (!body) return;

  const isOpen = body.classList.toggle('open');
  if (arrow) arrow.style.transform = isOpen ? 'rotate(180deg)' : '';
}

async function loadAdminBadges() {
  const user = await getUser();
  if (!isAdminOrStaff(user?.user_metadata?.role)) return;

  const [{ count: inquiryCount }, { count: bugCount }, { data: applyRows }] = await Promise.all([
    sb.from('inquiries').select('*', { count: 'exact', head: true }).eq('status', '접수됨'),
    sb.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', '접수됨'),
    // 종족주 신청 뱃지는 "검토중 상태가 존재하는지"가 아니라
    // "관리자가 아직 확인하지 않은 신청자 측 변화가 있는지"로 판단한다.
    // (admin_checked_at이 없거나, 신청자가 admin_checked_at 이후에 다시 수정한 경우)
    sb.from('species_applications')
      .select('status, admin_checked_at, applicant_updated_at')
      .in('status', ['접수됨', '검토중']),
  ]);
  const applyCount = (applyRows || []).filter(row =>
    !row.admin_checked_at ||
    (row.applicant_updated_at && row.applicant_updated_at > row.admin_checked_at)
  ).length;

  const iBadge = document.getElementById('sidebarInquiryBadge');
  const bBadge = document.getElementById('sidebarBugBadge');
  const aBadge = document.getElementById('sidebarApplyBadge');

  if (iBadge && inquiryCount > 0) {
    iBadge.textContent  = inquiryCount > 99 ? '99+' : inquiryCount;
    iBadge.style.display = 'inline-flex';
  }
  if (bBadge && bugCount > 0) {
    bBadge.textContent  = bugCount > 99 ? '99+' : bugCount;
    bBadge.style.display = 'inline-flex';
  }
  if (aBadge && applyCount > 0) {
    aBadge.textContent  = applyCount > 99 ? '99+' : applyCount;
    aBadge.style.display = 'inline-flex';
  }
}

// ── 이메일 인증 안내 팝업 (기존 회원 대상) ──────────────────────
// pages/index.html의 굿즈 홍보 팝업(.goods-popup-*) 구조/CSS를 그대로 재사용한다
// (신규 CSS/팝업 시스템을 새로 만들지 않음). "오늘 하루 보지 않기"의 자정 판정도
// index.html의 getNextKstMidnightMs()와 동일한 KST 기준 로직을 쓰되, 함수명은
// index.html이 자체적으로 정의한 전역 함수와 겹치지 않도록 접두사를 붙였다.
const EMAIL_VERIFY_POPUP_HIDE_UNTIL_KEY = 'emailVerificationPopupHiddenUntil';

function _emailVerifyPopupNextKstMidnightMs() {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const shifted = new Date(Date.now() + KST_OFFSET_MS);
  const nextMidnightShifted = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1, 0, 0, 0
  );
  return nextMidnightShifted - KST_OFFSET_MS;
}

// 로그아웃 확인 모달(js/auth.js의 ensureLogoutModal())과 동일한 방식 —
// 페이지 정적 HTML에 마크업을 추가하지 않고 JS에서 동적으로 생성해
// 모든 페이지에서 공통으로 동작하게 한다.
function ensureEmailVerifyPopup() {
  if (document.getElementById('emailVerifyPopupOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'goods-popup-overlay';
  overlay.id = 'emailVerifyPopupOverlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="goods-popup-card" role="dialog" aria-modal="true" aria-labelledby="emailVerifyPopupTitle">
      <p class="goods-popup-title" id="emailVerifyPopupTitle">이메일을 인증해주세요!</p>
      <p class="goods-popup-desc">비밀번호를 잊어버렸을 때 이메일로 찾을 수 있어요.
인증을 완료하면 연구기록 200개를 드립니다!</p>
      <a href="settings.html#email-verification" class="goods-popup-cta">이메일 인증하기</a>
      <div class="goods-popup-footer">
        <button type="button" class="goods-popup-minor" id="emailVerifyPopupHideToday">오늘 하루 보지 않기</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function initEmailVerifyPopup() {
  const user = await getUser();
  if (!user) return; // 로그아웃 상태 — 노출 안 함

  // 대상 판정은 오직 현재 로그인 유저의 실제 email 값(@dogam.com 여부)만 기준으로 한다.
  // 새로운 보상/인증 상태를 DB에 만들지 않는다 — admin/staff도 예외 없이 동일 기준.
  const isUnverified = !!user.email && user.email.toLowerCase().endsWith('@dogam.com');
  if (!isUnverified) return;

  // 팝업의 "이메일 인증하기" 링크가 바로 이 위치(settings.html#email-verification)로
  // 이동시키므로, 이동 직후 같은 페이지에서 팝업이 자기 자신을 다시 가리지 않도록
  // 이 진입 상태에서는 표시하지 않는다. "오늘 하루 보지 않기"를 누른 것으로 취급하지
  // 않으므로 localStorage는 건드리지 않는다 — 다른 페이지로 가면 다시 정상 노출된다.
  if (location.pathname.endsWith('settings.html') && location.hash.includes('email-verification')) {
    return;
  }

  try {
    const until = Number(localStorage.getItem(EMAIL_VERIFY_POPUP_HIDE_UNTIL_KEY));
    if (Number.isFinite(until) && until > 0 && Date.now() < until) return; // 오늘 하루 숨김 처리됨
  } catch {}

  // 이미 다른 모달(굿즈 팝업 등, body 스크롤 잠금 관례를 따르는)이 열려 있으면
  // 이번 페이지 로드에서는 겹쳐 띄우지 않고 건너뛴다(다음 방문에서 다시 판정됨).
  if (document.body.style.overflow === 'hidden') return;

  ensureEmailVerifyPopup();
  const overlay = document.getElementById('emailVerifyPopupOverlay');
  if (!overlay) return;

  function closePopup() {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKeydown);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') closePopup();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePopup();
  });
  document.getElementById('emailVerifyPopupHideToday').addEventListener('click', () => {
    try {
      localStorage.setItem(EMAIL_VERIFY_POPUP_HIDE_UNTIL_KEY, String(_emailVerifyPopupNextKstMidnightMs()));
    } catch {}
    closePopup();
  });

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKeydown);
}

document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initServerClock();
});

// ── 가이드맵 동적 로드 (미구현, 추후 연결 예정) ────────────────────────────────
// function _loadGuideTour() {
//   if (typeof openCategoryModal !== 'undefined') return;
//   const s = document.createElement('script');
//   s.src = '../js/guide-tour.js';
//   document.head.appendChild(s);
// }
// document.addEventListener('DOMContentLoaded', _loadGuideTour);

function openGuideTour() {
  // guide-tour.js 미구현 — 추후 연결 예정
  // if (typeof openCategoryModal === 'function') {
  //   openCategoryModal();
  //   return;
  // }
  // const s = document.createElement('script');
  // s.src = '../js/guide-tour.js';
  // s.onload = () => openCategoryModal();
  // document.head.appendChild(s);
}
