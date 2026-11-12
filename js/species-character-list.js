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
// 선택 DOM (있으면 사용, 없으면 기존 동작 — labber-records.html 은 아직 미탑재):
//   #categorySearchClear #categoryEmptyMsg    분류 검색 지우기 버튼 / '검색된 분류가 없어요.'
//   #charNameSearchInput #charNameSearchClear 개체명 검색창 / 지우기 버튼
//   #charResultCount     표시 결과 수 (+ 선택 분류 표시 / '전체' 복귀 버튼)
//
// 검색 역할 분리(2026-10-22): 분류명 검색은 분류 버튼 목록만, 개체명 검색은 카드 목록만 거른다.
// 개체명 검색 대상은 mount 때 페이지네이션으로 전부 받아온 allChars(현재 선택 분류 안에서).
//
// 개체 수정 / 소유권 이전 은 카드 클릭 → character.html?id=X 이동 후
// 해당 페이지에서 처리되므로(별도 로직 없음) 카드 링크만 동일하게 유지하면 된다.
//
// 의존: utils.js (resolveCharacterImage / characterHasVisibleRealImage), 전역 sb (Supabase)
//
// mount 선택 옵션(1112, 기본값이면 기존 동작 그대로 — species.html 은 넘기지 않는다):
//   client       목록 조회에 쓸 Supabase 클라이언트(기본: 전역 sb). 삭제는 항상 전역 sb 로만 한다.
//   strictErrors true 면 조회 오류·중간 페이지 실패를 "0개"로 보이지 않고 예외로 던진다(기본 false).
//   timeoutMs    페이지 조회 1회 시간 제한(기본 0 = 제한 없음).
//   canDelete    삭제 직전 호출하는 권한 재확인 함수(async 가능, false 면 삭제하지 않음).
// 카드에 넣는 이름·민감 안내·소유주 등은 일반 텍스트로 이스케이프한다.
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
  let nameSearchWired = false;
  let nameQuery      = '';   // 정규화된 개체명 검색어 (trim + 소문자)
  let sortDirections = Object.assign({}, DEFAULT_SORT_DIR); // 기준(sortBy)별 현재 방향
  let mountGen       = 0;    // mount 요청 번호 — 늦게 끝난 이전 요청이 최신 목록을 덮어쓰지 않게 한다

  const $ = (id) => document.getElementById(id);

  // 저장소를 쓸 수 없는 환경에서도 목록은 기본 정렬로 표시한다.
  function storageGet(key) {
    try { return localStorage.getItem(key); }
    catch (e) { console.warn('[SpeciesCharList] localStorage 읽기 실패, 기본값 사용:', key, e); return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) { console.warn('[SpeciesCharList] localStorage 저장 실패:', key, e); }
  }

  // LABBER 표시명 우선순위(2026-09-24, cfg.labberDisplay=true일 때만 적용): owner_custom_name
  // (소유주가 정한 이름)이 있으면 그걸, 없으면 등록명(character.name)을 쓴다. DB 값은
  // 바꾸지 않고 화면 표시에서만 적용 — 다른 종족(labberDisplay=false)은 항상 등록명 그대로.
  function charDisplayName(c) {
    if (!c) return '';
    const custom = typeof c.owner_custom_name === 'string' ? c.owner_custom_name.trim() : '';
    return custom || c.name || '';
  }

  // 카드 템플릿(innerHTML)에 넣는 값은 일반 텍스트로만 취급한다. main.js 없이도 동작하도록 모듈 안에 둔다.
  function escText(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  // style 속성의 url('...') 안에 넣는 이미지 주소 — 따옴표·괄호·역슬래시·공백만 퍼센트 인코딩(일반 Storage 주소는 그대로).
  function cssUrl(u) {
    return escText(String(u == null ? '' : u).replace(/["'()\\\s<>]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')));
  }

  function withTimeout(promise, ms, label) {
    if (!ms) return Promise.resolve(promise);
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 시간 초과(${ms}ms)`)), ms); }),
    ]);
  }

  // 전역 sb — auth.js 가 없거나 초기화 도중 실패하면 null (초기화 전 상태에서는 typeof 도 예외를 던진다).
  function readGlobalSb() {
    try { return (typeof sb !== 'undefined' && sb && typeof sb.from === 'function') ? sb : null; }
    catch (e) { return null; }
  }

  // ── 진입점 ─────────────────────────────────────────────
  async function mount(opts) {
    // labberDisplay: true → LABBER 표시명 정책(owner_custom_name 우선) + 카드에 종족명 대신
    // 개체번호 표시(2026-09-24, 개체기록실 전용 opt-in). 기본 false — 다른 종족은 무변경.
    const myCfg = Object.assign({ canManage: false, idToNick: {}, onCount: null, labberDisplay: false, client: null, strictErrors: false, timeoutMs: 0, canDelete: null }, opts);
    if (!myCfg.speciesName) throw new Error('[SpeciesCharList] speciesName 이 필요합니다.');
    const gen = ++mountGen;
    cfg = myCfg;

    manageMode = false;
    activeCategory = null;

    // 소속 개체 (1000행 제한을 넘는 종족도 전부 가져오도록 페이지네이션)
    // strictErrors: 한 페이지라도 실패·시간 초과면 받은 앞부분도 버리고 예외 — 잘린 목록을 전체처럼 보이지 않는다.
    const db = myCfg.client || sb;
    const chars = [];
    {
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const query = db
          .from('characters')
          .select('id, name, owner_custom_name, species_name, owner_nickname, owner_user_id, image_url, thumbnail_url, default_image_index, created_at, is_sensitive, sensitive_note, char_categories, char_number')
          .eq('species_name', myCfg.speciesName)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        const { data: page, error } = await withTimeout(query, myCfg.timeoutMs, `소속 개체 조회(${from}~)`);
        if (gen !== mountGen) return null;   // 더 새 mount 가 시작됨 — 이 결과는 버린다
        if (myCfg.strictErrors && (error || !Array.isArray(page))) {
          throw new Error(`[SpeciesCharList] 소속 개체 조회 실패(${from}~): ${(error && (error.message || error.code)) || '응답 없음'}`);
        }
        if (!page || !page.length) break;
        chars.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
    }
    if (gen !== mountGen) return null;

    allChars = chars || [];
    renderCategoryFilter();
    wireNameSearch();

    const saved = storageGet(SORT_KEY);
    if (['recent', 'name', 'charNumber'].includes(saved) && $('charSort')) {
      $('charSort').value = saved;
    }

    try {
      const savedDir = JSON.parse(storageGet(SORT_DIR_KEY) || '{}');
      sortDirections = Object.assign({}, DEFAULT_SORT_DIR, savedDir);
    } catch (e) {
      sortDirections = Object.assign({}, DEFAULT_SORT_DIR);
    }

    if (!sortWired && $('charSort')) {
      $('charSort').addEventListener('change', () => {
        storageSet(SORT_KEY, $('charSort').value);
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
  // 관리(선택삭제) 버튼 열기/닫기 — mount 뒤 로그인 확인이 끝났을 때 호출(개체기록실). 닫으면 관리 모드도 끝낸다.
  function setManageAllowed(allowed) {
    if (!cfg) return;
    cfg.canManage = !!allowed;
    const btn = $('manageBtn');
    if (btn) btn.style.display = cfg.canManage ? '' : 'none';
    if (!cfg.canManage && manageMode) toggleManage();
  }

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
    allBtn.type = 'button';
    allBtn.onclick = () => selectCategory(null);
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
      btn.type = 'button';
      btn.onclick = () => selectCategory(cat.label);
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

  // 분류 버튼 목록만 거른다 — 개체 카드/선택된 분류(activeCategory)는 건드리지 않음.
  // '전체' 버튼은 data-cat-label 이 없어 항상 표시된다.
  function filterCategoryButtons(query) {
    const q = normalizeQuery(query);
    let visible = 0;
    document.querySelectorAll('#categoryFilterBar [data-cat-label]').forEach(btn => {
      const show = !q || btn.dataset.catLabel.normalize('NFC').toLowerCase().includes(q);
      btn.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    const emptyMsg = $('categoryEmptyMsg');
    if (emptyMsg) emptyMsg.hidden = !(q && visible === 0);
    const clearBtn = $('categorySearchClear');
    if (clearBtn) clearBtn.hidden = !String(query || '').length;
    updateCategoryClamp();
  }

  function clearCategorySearch() {
    const el = $('categorySearchInput');
    if (!el) return;
    el.value = '';
    filterCategoryButtons('');
    el.focus();
  }

  function selectCategory(label) {
    activeCategory = label;
    updateFilterButtons();
    renderChars();
  }

  // ── 개체명 검색 ────────────────────────────────────────
  function normalizeQuery(v) {
    return String(v || '').normalize('NFC').trim().toLowerCase();
  }

  function wireNameSearch() {
    const el = $('charNameSearchInput');
    if (!el) return;
    nameQuery = normalizeQuery(el.value);
    updateNameClearBtn();
    if (nameSearchWired) return;
    let timer = null;
    el.addEventListener('input', () => {
      updateNameClearBtn();
      clearTimeout(timer);
      timer = setTimeout(() => { nameQuery = normalizeQuery(el.value); renderChars(); }, 120);
    });
    nameSearchWired = true;
  }

  function updateNameClearBtn() {
    const el = $('charNameSearchInput');
    const btn = $('charNameSearchClear');
    if (el && btn) btn.hidden = !el.value.length;
  }

  function clearNameSearch() {
    const el = $('charNameSearchInput');
    if (!el) return;
    el.value = '';
    nameQuery = '';
    updateNameClearBtn();
    renderChars();
    el.focus();
  }

  // 표시 결과 수 + 선택 분류. 분류 버튼이 검색/접기로 가려져도 여기서 확인하고 '전체'로 돌아갈 수 있다.
  // 사용자 입력/분류명은 textContent 로만 넣는다.
  function renderResultCount(count) {
    const box = $('charResultCount');
    if (!box) return;
    box.textContent = '';
    const parts = [];
    if (activeCategory !== null) parts.push(`분류 ‘${activeCategory}’`);
    if (nameQuery) parts.push(`‘${$('charNameSearchInput').value.trim()}’ 검색`);
    const text = document.createElement('span');
    text.textContent = parts.length ? `${parts.join(' · ')} — ${count}개` : `전체 ${count}개`;
    box.appendChild(text);
    if (activeCategory !== null) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'char-result-reset';
      reset.textContent = '전체 분류 보기';
      reset.onclick = () => selectCategory(null);
      box.appendChild(reset);
    }
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
    storageSet(SORT_DIR_KEY, JSON.stringify(sortDirections));
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
    const saved = storageGet(SORT_KEY);
    if (['recent', 'name', 'charNumber'].includes(saved)) sortBy = saved;

    let dirs = Object.assign({}, DEFAULT_SORT_DIR);
    try {
      const savedDir = JSON.parse(storageGet(SORT_DIR_KEY) || '{}');
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

    if (nameQuery) {
      list = list.filter(c => {
        const n = cfg && cfg.labberDisplay ? charDisplayName(c) : (c.name || '');
        return n.normalize('NFC').toLowerCase().includes(nameQuery);
      });
    }

    list = sortCharacters(list, sort, dir);

    // 결과 수 줄이 있으면 뱃지는 종족 전체 개체 수, 없으면(개체기록실) 기존대로 표시 개수.
    const hasResultLine = !!$('charResultCount');
    if ($('charCount')) $('charCount').textContent = hasResultLine ? allChars.length : list.length;
    renderResultCount(list.length);

    const grid = $('characterGrid');
    if (!grid) return;
    if (!list.length) {
      const msg = (nameQuery && allChars.length) ? '검색된 개체가 없어요.' : '등록된 개체가 없어요.';
      grid.innerHTML = `<p class="page-loading">${msg}</p>`;
      return;
    }

    grid.innerHTML = list.map(c => `
      <div style="position:relative;" id="card_${c.id}">
        ${manageMode ? `
        <label style="position:absolute; top:8px; left:8px; z-index:2; cursor:pointer;">
          <input type="checkbox" class="char-checkbox" data-id="${escText(c.id)}" onchange="onCheckChange()"
            style="width:18px; height:18px; cursor:pointer; accent-color:var(--sky);">
        </label>` : ''}
        <a href="${manageMode ? 'javascript:void(0)' : `character.html?id=${encodeURIComponent(c.id)}`}" class="character-card"
          style="${manageMode ? 'cursor:default;' : ''}"
          onclick="${manageMode ? `toggleCheck('${escText(c.id)}'); return false;` : ''}">
          ${c.is_sensitive && characterHasVisibleRealImage(c) ? `
          <div class="vc-sensitive-wrap" style="position:relative; overflow:hidden; border-radius:var(--radius);">
            <div class="character-img blurred" style="background-image:url('${cssUrl(c.thumbnail_url || c.image_url)}'); background-size:cover; background-position:center;"></div>
            <div class="sensitive-overlay" onclick="revealSensitive(this,event)"><div class="sensitive-overlay-inner"><svg width="28" height="26" viewBox="0 0 28 26" fill="none"><path d="M14 2L26 24H2L14 2Z" stroke="#b91c1c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line x1="14" y1="9" x2="14" y2="16" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="20" r="1.2" fill="#b91c1c"/></svg><span class="sensitive-overlay-title">민감한 요소</span>${c.sensitive_note ? '<span class="sensitive-overlay-note">' + escText(c.sensitive_note) + '</span>' : ''}<span class="sensitive-overlay-hint">누르면 이미지가 보여요</span></div></div>
          </div>` : `
          <div class="character-img" style="background-image:url('${cssUrl(resolveCharacterImage(c))}'); background-size:cover; background-position:center;"></div>`}
          <div class="character-info">
            <p class="character-name">${escText(cfg.labberDisplay ? charDisplayName(c) : c.name)}</p>
            <p class="character-species">${escText(cfg.labberDisplay ? (c.char_number ? `#${c.char_number}` : '') : (c.species_name || ''))}</p>
            <p class="character-owner">소유주: ${escText((c.owner_user_id && idToNick[c.owner_user_id]) || c.owner_nickname || '—')}</p>
          </div>
        </a>
      </div>
    `).join('');
  }

  // ── 관리(선택 삭제) 모드 ───────────────────────────────
  function toggleManage() {
    if (!manageMode && !(cfg && cfg.canManage)) return;   // 관리 권한이 닫혀 있으면 관리 모드를 열지 않는다
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
    if (!cfg || !cfg.canManage) return;
    const checked = [...document.querySelectorAll('.char-checkbox:checked')];
    if (!checked.length) return;

    // 삭제는 로그인 세션이 있는 전역 sb 로만 한다. 조회용 client(세션 없는 공개 조회 등)로는 삭제하지 않는다.
    const authSb = readGlobalSb();
    if (!authSb || (cfg.client && cfg.client !== authSb)) {
      alert('로그인 상태를 확인할 수 없어 삭제할 수 없어요. 새로고침 후 다시 시도해주세요.');
      return;
    }
    if (typeof cfg.canDelete === 'function') {
      let ok = false;
      try { ok = !!(await cfg.canDelete()); }
      catch (e) { console.warn('[SpeciesCharList] 삭제 권한 확인 실패:', e); ok = false; }
      if (!ok || !cfg.canManage) {
        alert('삭제 권한을 확인할 수 없어요. 새로고침 후 다시 시도해주세요.');
        return;
      }
    }
    if (!confirm(`선택한 ${checked.length}개의 개체를 정말 삭제할까요?`)) return;
    if (!cfg.canManage) return;

    const ids = checked.map(cb => cb.dataset.id);
    const { error } = await authSb.from('characters').delete().in('id', ids);
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
  window.clearCategorySearch   = clearCategorySearch;
  window.clearNameSearch       = clearNameSearch;

  window.SpeciesCharList = {
    mount,
    getChars: () => allChars,
    getOrderedList,
    setManageAllowed,
    SUPER_ADMIN_USER_ID,
  };
})();
