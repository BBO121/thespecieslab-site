// ── 소속 개체 목록 공통 모듈 ─────────────────────────────────────────
// species.html 의 "소속 개체" 영역(#charactersSection)에서 쓰던 목록/정렬/분류필터/
// 관리(선택삭제) 로직을 그대로 추출한 것. species.html 과 LABBER 개체기록실
// (labber-records.html) 이 같은 코드를 공유한다.
//
// 요구 DOM (두 페이지 모두 동일 id 사용):
//   #charactersSection  섹션 래퍼 (초기 display:none → mount 시 노출)
//   #charCount          섹션 제목 옆 개수 뱃지
//   #charSort           정렬 select (recent | name | charNumber)
//   #charSortDirBtn     정렬 방향 토글 버튼 (data-dir=asc|desc, 기준별로 방향을 기억)
//   #manageBtn          관리 토글 버튼 (canManage 일 때만 노출)
//   #manageBar          관리 모드 액션 바
//   #selectedCount #deleteSelectedBtn
//   #categoryFilterSection #categorySearchInput #categoryFilterBar
//   #categoryFilterBarWrap #categoryFilterMoreBtn #categoryFilterMoreLabel #categoryFilterChevron
//   #characterGrid      개체 카드 그리드
//
// 개체 수정 / 소유권 이전 은 카드 클릭 → character.html?id=X 이동 후
// 해당 페이지에서 처리되므로(별도 로직 없음) 카드 링크만 동일하게 유지하면 된다.
//
// 의존: utils.js (resolveCharacterImage / characterHasVisibleRealImage), 전역 sb (Supabase)
(function () {
  'use strict';

  // species.html 과 동일 — 이 계정만 종족 소유권과 무관하게 관리 기능 접근 가능.
  const SUPER_ADMIN_USER_ID = '78ad7670-847e-4347-b50c-8d8cb2131861';

  const SORT_KEY     = 'speciesCharSort';
  const SORT_DIR_KEY = 'speciesCharSortDir';
  // 정렬 기준별 기본 방향 — 방향 토글 도입 전부터의 기존 동작(최근순=내림차순, 이름순/개체번호순=오름차순)을 그대로 유지.
  const DEFAULT_SORT_DIR = { recent: 'desc', name: 'asc', charNumber: 'asc' };

  let cfg = null;            // { speciesName, canManage, idToNick, onCount }
  let allChars       = [];
  let manageMode     = false;
  let activeCategory = null;
  let sortWired      = false;
  let sortDirections = Object.assign({}, DEFAULT_SORT_DIR); // 기준(sortBy)별 현재 방향

  const $ = (id) => document.getElementById(id);

  // ── 진입점 ─────────────────────────────────────────────
  async function mount(opts) {
    cfg = Object.assign({ canManage: false, idToNick: {}, onCount: null }, opts);
    if (!cfg.speciesName) throw new Error('[SpeciesCharList] speciesName 이 필요합니다.');

    manageMode = false;
    activeCategory = null;

    // 소속 개체 (1000행 제한을 넘는 종족도 전부 가져오도록 페이지네이션)
    const chars = [];
    {
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: page } = await sb
          .from('characters')
          .select('id, name, species_name, owner_nickname, owner_user_id, image_url, thumbnail_url, default_image_index, created_at, is_sensitive, sensitive_note, char_categories, char_number')
          .eq('species_name', cfg.speciesName)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (!page || !page.length) break;
        chars.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
    }

    allChars = chars || [];
    renderCategoryFilter();

    const saved = localStorage.getItem(SORT_KEY);
    if (['recent', 'name', 'charNumber'].includes(saved) && $('charSort')) {
      $('charSort').value = saved;
    }

    try {
      const savedDir = JSON.parse(localStorage.getItem(SORT_DIR_KEY) || '{}');
      sortDirections = Object.assign({}, DEFAULT_SORT_DIR, savedDir);
    } catch (e) {
      sortDirections = Object.assign({}, DEFAULT_SORT_DIR);
    }

    if (!sortWired && $('charSort')) {
      $('charSort').addEventListener('change', () => {
        localStorage.setItem(SORT_KEY, $('charSort').value);
        updateSortDirButton();
        renderChars();
      });
      sortWired = true;
    }

    updateSortDirButton();
    renderChars();
    if (typeof cfg.onCount === 'function') cfg.onCount(allChars.length);

    if ($('charactersSection')) $('charactersSection').style.display = '';
    updateCategoryClamp(); // 섹션이 보이기 전엔 줄바꿈 높이를 정확히 잴 수 없어 여기서 다시 계산
    if (cfg.canManage && $('manageBtn')) $('manageBtn').style.display = '';

    return allChars;
  }

  // ── 분류 필터 ──────────────────────────────────────────
  function renderCategoryFilter() {
    const seen = new Set();
    const cats = [];
    allChars.forEach(c => (c.char_categories || []).forEach(cat => {
      if (!cat.label || seen.has(cat.label)) return;
      seen.add(cat.label);
      cats.push(cat);
    }));

    const section = $('categoryFilterSection');
    const bar = $('categoryFilterBar');
    if (!section || !bar) return;
    if (!cats.length) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    bar.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.id = 'filterBtn_all';
    allBtn.textContent = '전체';
    allBtn.style.cssText = `padding:5px 14px; border-radius:20px; border:2px solid var(--border); background:var(--text); color:var(--white); font-size:13px; font-weight:600; cursor:pointer;`;
    allBtn.onclick = () => { activeCategory = null; updateFilterButtons(); renderChars(); };
    bar.appendChild(allBtn);

    cats.forEach(cat => {
      const r = parseInt(cat.color.slice(1, 3), 16), g = parseInt(cat.color.slice(3, 5), 16), b = parseInt(cat.color.slice(5, 7), 16);
      const tc = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000' : '#fff';
      const btn = document.createElement('button');
      btn.dataset.catLabel = cat.label;
      btn.textContent = cat.label;
      btn.style.cssText = `padding:5px 14px; border-radius:20px; border:2px solid ${cat.color}; background:var(--white); color:var(--text); font-size:13px; font-weight:600; cursor:pointer;`;
      btn.dataset.color = cat.color;
      btn.dataset.tc = tc;
      btn.onclick = () => { activeCategory = cat.label; updateFilterButtons(); renderChars(); };
      bar.appendChild(btn);
    });

    const searchEl = $('categorySearchInput');
    const searchVal = searchEl ? searchEl.value : '';
    if (searchVal) filterCategoryButtons(searchVal);
    else updateCategoryClamp();
  }

  // 분류 버튼이 여러 줄이면 첫 줄만 남기고 "더보기"로 접어둔다
  function updateCategoryClamp() {
    const wrap = $('categoryFilterBarWrap');
    const bar  = $('categoryFilterBar');
    const moreBtn = $('categoryFilterMoreBtn');
    if (!wrap || !bar || !moreBtn) return;
    const isExpanded = wrap.dataset.expanded === '1';

    wrap.style.maxHeight = 'none';
    wrap.style.overflow  = 'visible';

    const btns = [...bar.children].filter(b => b.style.display !== 'none');
    if (!btns.length) { moreBtn.style.display = 'none'; return; }

    const firstTop = btns[0].offsetTop;
    const rowHeight = btns[0].offsetHeight;
    const hasMoreRows = btns.some(b => b.offsetTop > firstTop);

    if (!hasMoreRows) {
      moreBtn.style.display = 'none';
      return;
    }

    moreBtn.style.display = 'flex';
    if (!isExpanded) {
      wrap.style.maxHeight = rowHeight + 'px';
      wrap.style.overflow  = 'hidden';
    }
    $('categoryFilterMoreLabel').textContent = isExpanded ? '접기' : '더보기';
    $('categoryFilterChevron').style.transform = isExpanded ? 'rotate(180deg)' : '';
  }

  function toggleCategoryFilter() {
    const wrap = $('categoryFilterBarWrap');
    if (!wrap) return;
    wrap.dataset.expanded = wrap.dataset.expanded === '1' ? '0' : '1';
    updateCategoryClamp();
  }

  function filterCategoryButtons(query) {
    const q = query.trim().toLowerCase();
    document.querySelectorAll('#categoryFilterBar [data-cat-label]').forEach(btn => {
      btn.style.display = (!q || btn.dataset.catLabel.toLowerCase().includes(q)) ? '' : 'none';
    });
    updateCategoryClamp();
  }

  let _catResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_catResizeTimer);
    _catResizeTimer = setTimeout(updateCategoryClamp, 150);
  });

  function updateFilterButtons() {
    const allBtn = $('filterBtn_all');
    if (allBtn) {
      allBtn.style.background = activeCategory === null ? 'var(--text)' : 'var(--white)';
      allBtn.style.color      = activeCategory === null ? 'var(--white)' : 'var(--text)';
    }
    document.querySelectorAll('#categoryFilterBar [data-cat-label]').forEach(btn => {
      const isActive = btn.dataset.catLabel === activeCategory;
      btn.style.background = isActive ? btn.dataset.color : 'var(--white)';
      btn.style.color      = isActive ? btn.dataset.tc : 'var(--text)';
    });
  }

  // ── 정렬 방향 토글 ─────────────────────────────────────
  function currentSortBy() {
    const el = $('charSort');
    return el ? el.value : 'recent';
  }

  function currentSortDir() {
    return sortDirections[currentSortBy()] || 'asc';
  }

  function updateSortDirButton() {
    const btn = $('charSortDirBtn');
    if (!btn) return;
    const dir = currentSortDir();
    const label = dir === 'desc' ? '내림차순' : '오름차순';
    const nextLabel = dir === 'desc' ? '오름차순' : '내림차순';
    btn.dataset.dir = dir;
    btn.title = `정렬 방향: ${label}`;
    btn.setAttribute('aria-label', `정렬 방향: ${label} (누르면 ${nextLabel}으로 전환)`);
  }

  function toggleSortDir() {
    const sortBy = currentSortBy();
    sortDirections[sortBy] = (sortDirections[sortBy] || 'asc') === 'asc' ? 'desc' : 'asc';
    localStorage.setItem(SORT_DIR_KEY, JSON.stringify(sortDirections));
    updateSortDirButton();
    renderChars();
  }

  // ── 정렬 로직(카드 목록 / character.html 이전·다음 이동이 공유) ─────
  function sortCharacters(list, sortBy, dirStr) {
    const dir = dirStr === 'desc' ? -1 : 1;
    const out = [...list];

    if (sortBy === 'recent') {
      out.sort((a, b) => dir * (new Date(a.created_at) - new Date(b.created_at)));
    } else if (sortBy === 'name') {
      out.sort((a, b) => dir * a.name.localeCompare(b.name, 'ko'));
    } else if (sortBy === 'charNumber') {
      const getGroup = str => {
        if (!str) return 4;
        if (/\d/.test(str)) return 0;
        if (/^[a-zA-Z]/.test(str)) return 1;
        if (/^[가-힣ᄀ-ᇿ㄰-㆏]/.test(str)) return 2;
        return 3;
      };
      const firstNum = str => { const m = str.match(/\d+/); return parseInt(m[0], 10); };
      out.sort((a, b) => {
        const aStr = a.char_number || '';
        const bStr = b.char_number || '';
        const aG = getGroup(aStr);
        const bG = getGroup(bStr);
        // 그룹 우선순위(숫자>영문>한글>기타>빈값)는 방향과 무관하게 항상 유지 — 빈값이 내림차순에서 위로 튀어오르지 않도록.
        if (aG !== bG) return aG - bG;
        if (aG === 0) {
          const diff = firstNum(aStr) - firstNum(bStr);
          return dir * (diff !== 0 ? diff : aStr.localeCompare(bStr, 'ko'));
        }
        if (aG === 4) return 0;
        return dir * aStr.localeCompare(bStr, 'ko');
      });
    }

    return out;
  }

  // 현재 저장된(localStorage) 정렬 기준/방향 — select 미탑재 페이지(character.html)에서도
  // 카드 목록과 동일한 기준을 읽어올 수 있도록 DOM 의존 없이 별도로 제공.
  function getSavedSort() {
    let sortBy = 'recent';
    const saved = localStorage.getItem(SORT_KEY);
    if (['recent', 'name', 'charNumber'].includes(saved)) sortBy = saved;

    let dirs = Object.assign({}, DEFAULT_SORT_DIR);
    try {
      const savedDir = JSON.parse(localStorage.getItem(SORT_DIR_KEY) || '{}');
      dirs = Object.assign({}, DEFAULT_SORT_DIR, savedDir);
    } catch (e) { /* ignore */ }

    return { sortBy, dir: dirs[sortBy] || 'asc' };
  }

  // 같은 종족(species_name) 개체를 카드 목록과 동일한 조회(페이지네이션) + 정렬로 가져온다.
  // character.html 이전/다음 이동 전용 — 카드 렌더에 불필요한 컬럼은 가져오지 않는다.
  async function getOrderedList(speciesName) {
    const rows = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: page, error } = await sb
        .from('characters')
        .select('id, name, created_at, char_number')
        .eq('species_name', speciesName)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error || !page || !page.length) break;
      rows.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }
    const { sortBy, dir } = getSavedSort();
    return sortCharacters(rows, sortBy, dir);
  }

  // ── 카드 목록 렌더 ─────────────────────────────────────
  function renderChars() {
    const sort = currentSortBy();
    const dir = currentSortDir();
    const idToNick = (cfg && cfg.idToNick) || {};
    let list = [...allChars];

    if (activeCategory !== null) {
      list = list.filter(c => (c.char_categories || []).some(cat => cat.label === activeCategory));
    }

    list = sortCharacters(list, sort, dir);

    if ($('charCount')) $('charCount').textContent = list.length;

    const grid = $('characterGrid');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<p class="page-loading">등록된 개체가 없어요.</p>';
      return;
    }

    grid.innerHTML = list.map(c => `
      <div style="position:relative;" id="card_${c.id}">
        ${manageMode ? `
        <label style="position:absolute; top:8px; left:8px; z-index:2; cursor:pointer;">
          <input type="checkbox" class="char-checkbox" data-id="${c.id}" onchange="onCheckChange()"
            style="width:18px; height:18px; cursor:pointer; accent-color:var(--sky);">
        </label>` : ''}
        <a href="${manageMode ? 'javascript:void(0)' : `character.html?id=${c.id}`}" class="character-card"
          style="${manageMode ? 'cursor:default;' : ''}"
          onclick="${manageMode ? `toggleCheck('${c.id}'); return false;` : ''}">
          ${c.is_sensitive && characterHasVisibleRealImage(c) ? `
          <div style="position:relative; overflow:hidden; border-radius:var(--radius);">
            <div class="character-img blurred" style="background-image:url('${c.thumbnail_url || c.image_url}'); background-size:cover; background-position:center;"></div>
            <div class="sensitive-overlay" onclick="revealSensitive(this,event)"><div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><svg width="28" height="26" viewBox="0 0 28 26" fill="none"><path d="M14 2L26 24H2L14 2Z" stroke="#b91c1c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line x1="14" y1="9" x2="14" y2="16" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="20" r="1.2" fill="#b91c1c"/></svg><span style="color:#b91c1c;font-size:16px;font-weight:700;">민감한 요소</span>${c.sensitive_note ? '<span class="sensitive-overlay-note">' + c.sensitive_note + '</span>' : ''}<span class="sensitive-overlay-hint">누르면 이미지가 보여요</span></div></div>
          </div>` : `
          <div class="character-img" style="background-image:url('${resolveCharacterImage(c)}'); background-size:cover; background-position:center;"></div>`}
          <div class="character-info">
            <p class="character-name">${c.name}</p>
            <p class="character-species">${c.species_name || ''}</p>
            <p class="character-owner">소유주: ${(c.owner_user_id && idToNick[c.owner_user_id]) || c.owner_nickname || '—'}</p>
          </div>
        </a>
      </div>
    `).join('');
  }

  // ── 관리(선택 삭제) 모드 ───────────────────────────────
  function toggleManage() {
    manageMode = !manageMode;
    const manageBar = $('manageBar');
    const manageBtn = $('manageBtn');
    if (manageBar) manageBar.style.display = manageMode ? 'flex' : 'none';
    if (manageBtn) {
      manageBtn.textContent = manageMode ? '완료' : '관리';
      manageBtn.style.color = manageMode ? 'var(--sky-deep)' : 'var(--text-sub)';
    }
    renderChars();
  }

  function toggleCheck(id) {
    const cb = document.querySelector(`.char-checkbox[data-id="${id}"]`);
    if (cb) { cb.checked = !cb.checked; onCheckChange(); }
  }

  function onCheckChange() {
    const checked = document.querySelectorAll('.char-checkbox:checked').length;
    if ($('selectedCount')) $('selectedCount').textContent = `${checked}개 선택됨`;
    const btn = $('deleteSelectedBtn');
    if (btn) {
      btn.disabled = checked === 0;
      btn.style.opacity = checked === 0 ? '0.4' : '1';
    }
  }

  function selectAll() {
    document.querySelectorAll('.char-checkbox').forEach(cb => cb.checked = true);
    onCheckChange();
  }

  function deselectAll() {
    document.querySelectorAll('.char-checkbox').forEach(cb => cb.checked = false);
    onCheckChange();
  }

  async function deleteSelected() {
    const checked = [...document.querySelectorAll('.char-checkbox:checked')];
    if (!checked.length) return;
    if (!confirm(`선택한 ${checked.length}개의 개체를 정말 삭제할까요?`)) return;

    const ids = checked.map(cb => cb.dataset.id);
    const { error } = await sb.from('characters').delete().in('id', ids);
    if (error) { alert('삭제에 실패했어요.'); return; }

    allChars = allChars.filter(c => !ids.includes(String(c.id)));
    manageMode = false;
    if ($('manageBar')) $('manageBar').style.display = 'none';
    if ($('manageBtn')) {
      $('manageBtn').textContent = '관리';
      $('manageBtn').style.color = 'var(--text-sub)';
    }
    renderChars();
    if (cfg && typeof cfg.onCount === 'function') cfg.onCount(allChars.length);
  }

  function revealSensitive(overlayEl, e) {
    e.stopPropagation();
    e.preventDefault();
    const wrap = overlayEl.parentElement;
    wrap.querySelectorAll('.blurred').forEach(el => el.classList.remove('blurred'));
    overlayEl.remove();
  }

  // ── 전역 노출 ──────────────────────────────────────────
  // 정적 HTML / 카드 템플릿의 인라인 onclick 이 참조하는 이름들 (species.html 과 동일).
  window.renderChars          = renderChars;
  window.toggleSortDir        = toggleSortDir;
  window.toggleManage         = toggleManage;
  window.toggleCheck          = toggleCheck;
  window.onCheckChange        = onCheckChange;
  window.selectAll            = selectAll;
  window.deselectAll          = deselectAll;
  window.deleteSelected       = deleteSelected;
  window.revealSensitive      = window.revealSensitive || revealSensitive;
  window.filterCategoryButtons = filterCategoryButtons;
  window.toggleCategoryFilter  = toggleCategoryFilter;

  window.SpeciesCharList = {
    mount,
    getChars: () => allChars,
    getOrderedList,
    SUPER_ADMIN_USER_ID,
  };
})();
