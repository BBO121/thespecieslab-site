// 북마크 — 1단계: 헤더 아이콘(PC/모바일) + 모바일 퀵패널 + 상세페이지 토글 버튼 공통 로직
// 이 파일은 notifications.js/chat.js처럼 거의 모든 페이지에 공통 삽입되므로,
// 전역 함수/변수명은 다른 페이지 인라인 스크립트와 겹치지 않도록 전부 bm 접두사를 붙인다.
//
// 오른쪽 패널(.personal-panel*)은 북마크 전용으로 고정하지 않고, 앞으로 다른 개인 기능이
// 추가될 수 있도록 이름만 범용으로 둔다. 내용(BOOKMARK 헤더/목록)은 현재 북마크 전용으로 채운다.

const BM_QUICK_LIMIT = 8;
const BM_LINKS  = { species: 'species.html?id=', character: 'character.html?id=' };

// ────────────────────────────────
// 헤더 아이콘 삽입 (PC: .header-nav / 모바일: .header-inner)
// ────────────────────────────────
function insertBookmarkIcon() {
  const nav = document.querySelector('.header-nav');
  if (nav && !document.getElementById('bookmarkIconWrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'bookmark-icon-wrap';
    wrap.id = 'bookmarkIconWrap';
    wrap.innerHTML = `
      <a href="bookmarks.html" class="bookmark-icon-btn" aria-label="북마크" title="북마크">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
        </svg>
      </a>
    `;
    // 알림벨(notif-bell-wrap) 바로 다음에 위치 — DM/알림 아이콘이 먼저 삽입된 뒤에 이 스크립트가
    // 실행되도록 페이지마다 <script src="js/chat.js">, <script src="js/notifications.js"> 다음에
    // <script src="js/bookmark.js">를 둔다. 혹시 순서가 어긋나면 nav 맨 앞에 붙인다.
    const notifWrap = document.getElementById('notifBellWrap');
    if (notifWrap && notifWrap.nextSibling) nav.insertBefore(wrap, notifWrap.nextSibling);
    else if (notifWrap) nav.appendChild(wrap);
    else nav.prepend(wrap);
  }

  // 모바일 헤더: 기존 mobileNotifBell 바로 뒤(오른쪽 끝)에 삽입
  const headerInner = document.querySelector('.header-inner');
  if (headerInner && !document.getElementById('mobileBookmarkIcon')) {
    const mobileBell = document.getElementById('mobileNotifBell');

    const mobileBtn = document.createElement('button');
    mobileBtn.id = 'mobileBookmarkIcon';
    mobileBtn.type = 'button';
    mobileBtn.className = 'mobile-bookmark-icon';
    mobileBtn.setAttribute('aria-label', '북마크');
    mobileBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
      </svg>
    `;
    mobileBtn.addEventListener('click', (e) => { e.preventDefault(); toggleBmPanel(); });

    if (mobileBell) mobileBell.insertAdjacentElement('afterend', mobileBtn);
    else headerInner.appendChild(mobileBtn);
  }
}

document.addEventListener('DOMContentLoaded', insertBookmarkIcon);


// ────────────────────────────────
// 오른쪽 퀵패널 (모바일 전용 — 왼쪽 사이드바 드로어와 반대 방향, 같은 메커니즘)
// ────────────────────────────────
function ensureBmPanel() {
  if (document.getElementById('personalPanelOverlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'personal-panel-overlay';
  overlay.id = 'personalPanelOverlay';
  overlay.style.display = 'none';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeBmPanel(); });

  overlay.innerHTML = `
    <aside class="personal-panel" id="personalPanel">
      <div class="personal-panel-header">
        <span class="personal-panel-title">BOOKMARK</span>
        <button class="personal-panel-close-btn" onclick="closeBmPanel()" aria-label="닫기">✕</button>
      </div>
      <div class="personal-panel-body" id="personalPanelBody"></div>
    </aside>
  `;
  overlay.querySelector('.personal-panel').addEventListener('click', (e) => e.stopPropagation());

  document.body.appendChild(overlay);
}

async function toggleBmPanel() {
  ensureBmPanel();
  const overlay = document.getElementById('personalPanelOverlay');
  const isOpen = overlay.style.display === 'flex';

  if (isOpen) { closeBmPanel(); return; }

  const user = await getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  // 왼쪽 햄버거 메뉴가 열려 있으면 먼저 닫아 두 패널이 겹치지 않게 한다.
  if (typeof closeSidebar === 'function') closeSidebar();

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  bmLoadQuickPanel();
}

function closeBmPanel() {
  const overlay = document.getElementById('personalPanelOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('personalPanelOverlay');
  if (overlay && overlay.style.display === 'flex') closeBmPanel();
});

// 왼쪽 메뉴를 열 때 오른쪽 패널이 열려 있으면 닫는다 (sidebar.js의 toggleSidebar를 감싸서 처리).
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('hamburgerBtn');
  // hamburgerBtn은 sidebar.js가 삽입하므로 아직 없을 수 있다 — 약간 뒤에 한 번 더 확인.
  setTimeout(() => {
    const hb = document.getElementById('hamburgerBtn');
    if (hb && !hb.dataset.bmBound) {
      hb.dataset.bmBound = '1';
      hb.addEventListener('click', () => {
        const overlay = document.getElementById('personalPanelOverlay');
        if (overlay && overlay.style.display === 'flex') closeBmPanel();
      });
    }
  }, 0);
});

function bmEscapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function bmLoadQuickPanel() {
  const body = document.getElementById('personalPanelBody');
  if (!body) return;
  body.innerHTML = '<p class="personal-panel-placeholder">불러오는 중...</p>';

  const user = await getUser();
  if (!user) { body.innerHTML = '<p class="personal-panel-placeholder">로그인이 필요합니다.</p>'; return; }

  // 종족/개체를 한 쿼리로 합쳐서 limit을 걸면, 한쪽 타입을 몰아서 북마크했을 때 그 타입이
  // limit을 전부 채워버려 다른 타입 섹션이 통째로 빈 채로 보이는 문제가 있었다(버그 리포트로 확인됨).
  // → 타입별로 각각 조회 + limit(bookmarks_user_type_created_idx가 이 쿼리 패턴을 위해 이미 있음)해서
  //   한쪽이 아무리 많아도 다른 쪽 최근 북마크가 항상 보이도록 한다.
  const [spRes, charRes] = await Promise.all([
    sb.from('bookmarks').select('id, target_type, target_id, created_at')
      .eq('user_id', user.id).eq('target_type', 'species')
      .order('created_at', { ascending: false }).limit(BM_QUICK_LIMIT),
    sb.from('bookmarks').select('id, target_type, target_id, created_at')
      .eq('user_id', user.id).eq('target_type', 'character')
      .order('created_at', { ascending: false }).limit(BM_QUICK_LIMIT),
  ]);

  if (spRes.error || charRes.error) { body.innerHTML = '<p class="personal-panel-placeholder">불러오지 못했어요.</p>'; return; }

  const speciesRows   = spRes.data || [];
  const characterRows = charRes.data || [];

  if (!speciesRows.length && !characterRows.length) {
    body.innerHTML = `
      <div class="empty-state-wrap">
        <span class="empty-state-icon">🔖</span>
        <p class="empty-state-title">아직 북마크한 기록이 없습니다.</p>
      </div>
    `;
    return;
  }

  const dataMap = await bmFetchTargetRows(
    [...speciesRows, ...characterRows].map(r => ({ type: r.target_type, id: r.target_id }))
  );

  body.innerHTML = `
    <div class="bm-quick-list">
      ${speciesRows.length   ? bmRenderQuickSection('종족', speciesRows, dataMap)   : ''}
      ${characterRows.length ? bmRenderQuickSection('개체', characterRows, dataMap) : ''}
    </div>
    <a href="bookmarks.html" class="bm-quick-more">더보기 →</a>
  `;
}

function bmRenderQuickSection(title, rows, dataMap) {
  return `
    <div class="bm-quick-section">
      <div class="bm-quick-section-header"><span class="bm-quick-section-title">${title}</span></div>
      <div class="bm-quick-thumb-grid">
        ${rows.map(r => bmRenderQuickThumb(r, dataMap)).join('')}
      </div>
    </div>
  `;
}

function bmRenderQuickThumb(row, dataMap) {
  const key  = `${row.target_type}:${row.target_id}`;
  const data = dataMap.get(key);
  const href = `${BM_LINKS[row.target_type]}${row.target_id}`;

  if (!data) {
    return `
      <a class="bm-quick-thumb-card bm-quick-thumb-card--missing" href="${href}">
        <div class="bm-quick-thumb-img bm-quick-thumb-img--empty"></div>
        <span class="bm-quick-thumb-name">삭제됨</span>
      </a>
    `;
  }

  const img   = row.target_type === 'character' ? resolveCharacterImage(data) : resolveSpeciesImage(data);
  const title = data.name || '(이름 없음)';

  return `
    <a class="bm-quick-thumb-card" href="${href}">
      ${img ? `<img src="${bmEscapeHtml(img)}" class="bm-quick-thumb-img" alt="">` : `<div class="bm-quick-thumb-img bm-quick-thumb-img--empty"></div>`}
      <span class="bm-quick-thumb-name">${bmEscapeHtml(title)}</span>
    </a>
  `;
}


// ────────────────────────────────
// 대상 데이터 batch 조회 — 이름/이미지 등은 절대 bookmarks에 복제 저장하지 않고
// 매번 species/characters 테이블에서 현재 값을 읽는다 (N+1 방지를 위해 타입별로 in() 한 번씩만 조회).
// ────────────────────────────────
async function bmFetchTargetRows(pairs) {
  const map = new Map();
  if (!pairs.length) return map;

  const speciesIds   = [...new Set(pairs.filter(p => p.type === 'species').map(p => p.id))];
  const characterIds = [...new Set(pairs.filter(p => p.type === 'character').map(p => p.id))];

  const [spRes, charRes] = await Promise.all([
    speciesIds.length
      ? sb.from('species').select('id, name, owner_nickname, owner_user_id, image_url, thumbnail_url, default_image_index, is_sensitive, sensitive_note').in('id', speciesIds)
      : Promise.resolve({ data: [] }),
    characterIds.length
      ? sb.from('characters').select('id, name, species_name, owner_nickname, owner_user_id, image_url, thumbnail_url, default_image_index, is_sensitive, sensitive_note, char_number').in('id', characterIds)
      : Promise.resolve({ data: [] }),
  ]);

  speciesIds.forEach(id => map.set(`species:${id}`, null));
  characterIds.forEach(id => map.set(`character:${id}`, null));
  (spRes.data   || []).forEach(r => map.set(`species:${r.id}`, r));
  (charRes.data || []).forEach(r => map.set(`character:${r.id}`, r));

  return map;
}


// ────────────────────────────────
// 상세페이지(종족/개체) 북마크 토글 버튼 — species.html / character.html에서 호출
// ────────────────────────────────
async function initBookmarkButton(btnId, targetType, targetId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const user = await getUser();
  if (!user) {
    btn.textContent = '☆ 북마크';
    btn.onclick = () => { window.location.href = 'login.html'; };
    return;
  }

  let bookmarked = false;
  try {
    const { data } = await sb
      .from('bookmarks')
      .select('id')
      .eq('user_id', user.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
      .maybeSingle();
    bookmarked = !!data;
  } catch (e) {
    console.warn('[북마크] 상태 조회 실패:', e);
  }

  bmRenderToggleBtn(btn, bookmarked);

  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;

    if (bookmarked) {
      const { error } = await sb
        .from('bookmarks')
        .delete()
        .eq('user_id', user.id)
        .eq('target_type', targetType)
        .eq('target_id', targetId);
      if (!error) { bookmarked = false; bmRenderToggleBtn(btn, bookmarked); }
      else console.error('[북마크] 해제 실패:', error);
    } else {
      const { error } = await sb
        .from('bookmarks')
        .insert({ user_id: user.id, target_type: targetType, target_id: targetId });
      // 23505 = unique_violation — 이미 등록돼 있던 경우(중복 클릭 등)도 등록 상태로 취급
      if (!error || error.code === '23505') { bookmarked = true; bmRenderToggleBtn(btn, bookmarked); }
      else console.error('[북마크] 등록 실패:', error);
    }

    btn.disabled = false;
  };
}

function bmRenderToggleBtn(btn, on) {
  btn.textContent = on ? '★ 북마크' : '☆ 북마크';
  btn.classList.toggle('is-active', on);
}
