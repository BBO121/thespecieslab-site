/* ── 서버 시간 유틸 ────────────────────────── */
let _serverTimerInterval = null;
let _serverResyncInterval = null;

async function initServerClock() {
  if (typeof sb === 'undefined') return;

  async function fetchAndTick() {
    const { data, error } = await sb.rpc('get_server_time');
    if (error || !data) return;

    // UTC → KST (+9)
    let serverMs = new Date(data).getTime() + 9 * 60 * 60 * 1000;

    clearInterval(_serverTimerInterval);
    _serverTimerInterval = setInterval(() => {
      serverMs += 1000;
      const d   = new Date(serverMs);
      const hh  = String(d.getUTCHours()).padStart(2, '0');
      const mm  = String(d.getUTCMinutes()).padStart(2, '0');
      const ss  = String(d.getUTCSeconds()).padStart(2, '0');
      const txt = `KST ${hh}:${mm}:${ss}`;
      document.querySelectorAll('.server-clock').forEach(el => el.textContent = txt);
    }, 1000);
  }

  await fetchAndTick();
  clearInterval(_serverResyncInterval);
  _serverResyncInterval = setInterval(fetchAndTick, 5 * 60 * 1000); // 5분마다 재동기화
}

/* ── 페이지네이션 유틸 ─────────────────────── */
const PER_PAGE = 30;

function createPager(renderFn, wrapId = 'paginationWrap', pageParam = 'page', perPage = PER_PAGE) {
  let page = 1;
  let data = [];

  const pager = {
    load(arr) {
      data = arr; page = 1;
      const url = new URL(location.href);
      url.searchParams.delete(pageParam);
      history.replaceState(null, '', url);
      pager._draw();
    },
    // 초기 로드 시 URL의 ?page= 값으로 복원
    init(arr) {
      data = arr;
      const p     = parseInt(new URLSearchParams(location.search).get(pageParam));
      const total = Math.ceil(arr.length / perPage);
      page = (p >= 1 && p <= (total || 1)) ? p : 1;
      pager._draw();
    },
    go(p) {
      const total = Math.ceil(data.length / perPage);
      page = Math.max(1, Math.min(p, total || 1));
      const url = new URL(location.href);
      if (page === 1) url.searchParams.delete(pageParam);
      else            url.searchParams.set(pageParam, page);
      history.replaceState(null, '', url);
      pager._draw();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    _draw() {
      const slice = data.slice((page - 1) * perPage, page * perPage);
      renderFn(slice);

      const wrap = document.getElementById(wrapId);
      if (!wrap) return;

      const total = Math.ceil(data.length / perPage);
      if (total <= 1) { wrap.innerHTML = ''; return; }

      // 표시할 페이지 번호 목록 (현재 ±2, 항상 1·끝 포함)
      const set = new Set([1, total]);
      for (let i = Math.max(1, page - 2); i <= Math.min(total, page + 2); i++) set.add(i);
      const nums = [...set].sort((a, b) => a - b);

      let html = '<nav class="pagination">';
      html += `<button class="pg-btn" data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>`;
      let prev = 0;
      for (const n of nums) {
        if (n - prev > 1) html += '<span class="pg-gap">…</span>';
        html += `<button class="pg-btn${n === page ? ' active' : ''}" data-p="${n}">${n}</button>`;
        prev = n;
      }
      html += `<button class="pg-btn" data-p="${page + 1}" ${page === total ? 'disabled' : ''}>›</button>`;
      html += '</nav>';

      wrap.innerHTML = html;
      wrap.querySelectorAll('.pg-btn:not([disabled])').forEach(btn =>
        btn.addEventListener('click', () => pager.go(+btn.dataset.p))
      );
    }
  };
  return pager;
}
/* ─────────────────────────────────────────── */

/* ── 목록 보기 설정(열 수) 메뉴 ───────────────
   내 캐릭터(my-characters.html)의 '보기' 메뉴와 같은 동작을 다른 목록 페이지에서 쓰기 위한 공통 유틸.
   (현재 사용: species-list.html. my-characters.html은 기존 자체 구현 유지)
   - 'default'(반응형 기본 배치) 또는 2~8열. 이 기기·브라우저 localStorage에만 저장(storageKey는 페이지마다 따로).
   - 선택한 열 수는 grid 요소의 data-cols 속성으로 적용('기본'이면 속성 제거) — 실제 배치는 페이지 CSS가 담당.
   - 전역 이름은 이 함수 하나뿐(페이지 인라인 스크립트의 viewCols 등과 충돌하지 않게 전부 내부 변수).
   마크업(id 기본값):
     <div class="view-cols" id="viewCols">
       <button type="button" class="view-cols-btn" id="viewColsBtn" aria-haspopup="listbox" aria-expanded="false" aria-controls="viewColsPanel">
         <span id="viewColsBtnPrev"></span>보기<span class="view-cols-caret" aria-hidden="true">▼</span></button>
       <div class="view-cols-panel" id="viewColsPanel" role="listbox" aria-label="목록 보기 설정" hidden></div>
     </div>
   스타일: style.css .view-cols* / .vc-prev*
   opts.onChange(val)         — 사용자가 다른 배열을 고른 직후
   opts.onDefaultColsChange(n) — 화면 크기 변경으로 '기본' 배치의 열 수가 바뀐 직후 */
function createViewColsMenu(opts) {
  const o = Object.assign({
    rootId: 'viewCols', btnId: 'viewColsBtn', btnPrevId: 'viewColsBtnPrev', panelId: 'viewColsPanel',
    gridId: null, storageKey: null,
    options: ['default', 2, 3, 4, 5, 6, 7, 8],
    tabletQuery: '(max-width:1023px)', mobileQuery: '(max-width:767px)',
    cols: { desktop: 4, tablet: 3, mobile: 2 },
    onChange: null, onDefaultColsChange: null,
  }, opts || {});

  const mqTablet = window.matchMedia(o.tabletQuery);
  const mqMobile = window.matchMedia(o.mobileQuery);
  const root  = document.getElementById(o.rootId);
  const btn   = document.getElementById(o.btnId);
  const prev  = document.getElementById(o.btnPrevId);
  const panel = document.getElementById(o.panelId);
  const grid  = document.getElementById(o.gridId);
  let value = 'default';

  function parse(raw) {
    if (raw === 'default') return 'default';
    if (typeof raw === 'string' && /^\d+$/.test(raw) && o.options.includes(Number(raw))) return Number(raw);
    return null;
  }
  function load() {
    try { return parse(localStorage.getItem(o.storageKey)) || 'default'; }
    catch (e) { return 'default'; }
  }
  function save(val) {
    try { localStorage.setItem(o.storageKey, String(val)); } catch (e) { /* 저장 불가 — 이번 방문에만 적용 */ }
  }
  // 현재 화면 크기의 기본 열 수 — 페이지 grid의 반응형 규칙과 같아야 한다
  function defaultCols() {
    return mqMobile.matches ? o.cols.mobile : mqTablet.matches ? o.cols.tablet : o.cols.desktop;
  }
  function currentCols() { return value === 'default' ? defaultCols() : value; }
  function label(val) { return val === 'default' ? '기본 배치' : `${val}열로 보기`; }
  function previewHtml(n, extraClass = '') {
    return `<span class="vc-prev ${extraClass}" style="--n:${n}" aria-hidden="true">${'<i></i>'.repeat(n * 2)}</span>`;
  }

  function renderPanel() {
    // 열려 있는 동안 다시 그려도(화면 크기 변경) 포커스 위치를 유지
    const focusedVal = panel.contains(document.activeElement) ? document.activeElement.dataset.val : null;
    panel.innerHTML = o.options.map(val => {
      const selected  = val === value;
      const isDefault = val === 'default';
      return `<button type="button" role="option" class="view-cols-opt${isDefault ? ' view-cols-opt--default' : ''}"
          data-val="${val}" aria-selected="${selected}" tabindex="-1"
          title="${label(val)}" aria-label="${label(val)}${isDefault ? ` (현재 화면 ${defaultCols()}열)` : ''}">
          ${isDefault ? '<span>기본</span>' : ''}${previewHtml(isDefault ? defaultCols() : val)}
          <span class="view-cols-check" aria-hidden="true">✓</span>
        </button>`;
    }).join('');
    if (focusedVal) panel.querySelector(`[data-val="${focusedVal}"]`)?.focus();
  }

  function apply() {
    if (grid) {
      if (value === 'default') grid.removeAttribute('data-cols');
      else grid.setAttribute('data-cols', String(value));
    }
    const text = label(value);
    prev.innerHTML = previewHtml(currentCols(), 'vc-prev--btn');
    btn.title = `보기 설정: ${text}`;
    btn.setAttribute('aria-label', `보기 설정: ${text}`);
    renderPanel();
  }

  function optionEls() { return [...panel.querySelectorAll('.view-cols-opt')]; }
  function open() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const els = optionEls();
    (els.find(el => el.getAttribute('aria-selected') === 'true') || els[0]).focus();
  }
  function close(returnFocus = true) {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  }
  function select(val) {
    const changed = val !== value;
    value = val;
    save(val);
    apply();
    close(true);
    if (changed && o.onChange) o.onChange(val);
  }

  value = load();
  apply();

  btn.addEventListener('click', () => panel.hidden ? open() : close(true));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  });
  panel.addEventListener('click', e => {
    const el = e.target.closest('.view-cols-opt');
    if (el) select(parse(el.dataset.val));
  });
  panel.addEventListener('keydown', e => {
    const els = optionEls();
    const i = els.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = els[Math.min(i + 1, els.length - 1)];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = els[Math.max(i - 1, 0)];
    else if (e.key === 'Home') next = els[0];
    else if (e.key === 'End')  next = els[els.length - 1];
    else if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    else if (e.key === 'Tab') { close(false); return; }
    if (next) { e.preventDefault(); next.focus(); }
    // Enter/Space는 button 기본 동작(click)으로 선택
  });
  document.addEventListener('click', e => {
    if (!root.contains(e.target)) close(false);
  });
  // 화면 크기 변경으로 기본 열 수가 바뀌면 미리보기 갱신 후 페이지에 알림
  let lastDefault = defaultCols();
  window.addEventListener('resize', () => {
    const n = defaultCols();
    if (n === lastDefault) return;
    lastDefault = n;
    apply();
    if (o.onDefaultColsChange) o.onDefaultColsChange(n);
  });

  return {
    get value() { return value; },
    currentCols,
    defaultCols,
  };
}
/* ─────────────────────────────────────────── */

// 개체 목록 페이지: URL 쿼리로 필터링
const grid = document.getElementById('characterGrid');
const noResult = document.getElementById('noResult');

if (grid) {
  const q = new URLSearchParams(window.location.search).get('q');
  if (q) {
    const cards = grid.querySelectorAll('.character-card');
    let visible = 0;
    cards.forEach(card => {
      if (card.dataset.name.toLowerCase().includes(q.toLowerCase())) {
        card.style.display = 'block';
        visible++;
      } else {
        card.style.display = 'none';
      }
    });
    if (noResult) noResult.style.display = visible === 0 ? 'block' : 'none';

    const titleEl = document.querySelector('.list-page-title');
    const countEl = document.querySelector('.list-page-count');
    if (titleEl) titleEl.textContent = `"${q}" 검색 결과`;
    if (countEl) countEl.textContent = `${visible}개의 개체`;
  }
}

// 헤더 통합 검색: js/search.js의 searchAll()을 사용한다.
// (개체/종족/유저 전체 데이터를 미리 캐싱해두던 방식은 폐기 —
//  입력 시마다 서버에 직접 검색 요청을 보낸다.)
const searchInput    = document.getElementById('searchInput');
const searchDropdown = document.getElementById('searchDropdown');
let headerSearchController = null;

if (searchInput && searchDropdown) {
  const runHeaderSearch = debounce(async () => {
    const q = normalizeSearchQuery(searchInput.value);
    if (!q) { closeDropdown(); return; }

    if (headerSearchController) headerSearchController.abort();
    headerSearchController = new AbortController();
    const { signal } = headerSearchController;

    const result = await searchAll(q, { signal, charLimit: 6, speciesLimit: 4, userLimit: 5 });
    if (signal.aborted || result.aborted) return; // 이전 요청보다 늦게 온 응답은 무시
    renderDropdown(q, result);
  }, 300);

  searchInput.addEventListener('input', runHeaderSearch);

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = normalizeSearchQuery(searchInput.value);
      if (q) goToSearch(q);
    }
    if (e.key === 'Escape') closeDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) closeDropdown();
  });
}

function userPriority(u) {
  if (u.role === 'admin') return 1;
  if (u.role === 'staff') return 2;
  if (u.isSpeciesOwner)   return 3;
  return 4;
}

function getUserBadgesHtml(u) {
  const badges = [];
  if (u.role === 'admin') badges.push('<span class="dd-badge dd-badge--admin">관리자</span>');
  if (u.role === 'staff') badges.push('<span class="dd-badge dd-badge--staff">스태프</span>');
  if (u.isSpeciesOwner)   badges.push('<span class="dd-badge dd-badge--species-owner">종족주</span>');
  if (!badges.length)     badges.push('<span class="dd-badge dd-badge--user">일반유저</span>');
  return badges.join('');
}

// url은 개체/종족 썸네일, 유저 avatar_url까지 여러 출처에서 오는데, 셋 다 결국
// user_profiles/characters/species 테이블 값을 그대로 읽어온 것이라 정상 업로드
// 플로우를 거치지 않고 임의 문자열이 들어가 있을 수 있음 — http/https 절대 URL인지
// 검증 후, 정규화된 href(위험 문자가 퍼센트 인코딩됨)를 escapeHtml로 한 번 더 감싼다.
function ddSafeThumbUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;   // 상대경로/깨진 문자열 등 절대 URL로 파싱 안 되면 무조건 fallback
  }
}

function ddThumb(url) {
  const safeUrl = ddSafeThumbUrl(url);
  return safeUrl
    ? `<span class="dd-thumb" style="background-image:url('${escapeHtml(safeUrl)}')"></span>`
    : `<span class="dd-thumb dd-thumb--empty"></span>`;
}

// 검색 실패 시 드롭다운 UI 자체가 깨지지 않도록 항상 안전하게 렌더링한다.
function renderDropdown(q, result) {
  const characters   = result?.characters || [];
  const species      = result?.species    || [];
  const users        = result?.users      || [];
  const charCount     = result?.charCount    ?? characters.length;
  const speciesCount  = result?.speciesCount ?? species.length;
  const userCount     = result?.userCount    ?? users.length;
  const total = characters.length + species.length + users.length;

  if (result?.error && !total) {
    searchDropdown.innerHTML = '<li class="dd-error">검색 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.</li>';
    searchDropdown.classList.add('active');
    return;
  }
  if (!total) { closeDropdown(); return; }

  const sortedUsers = users
    .map(u => ({
      id:             u.id,
      nickname:       u.nickname || '(닉네임 미설정)',
      role:           u.role || '',
      avatar_url:     u.avatar_url || '',
      isSpeciesOwner: !!u.is_species_owner,
    }))
    .sort((a, b) => userPriority(a) - userPriority(b));

  const charGroup = characters.length ? `
    <li class="dd-group-title">개체</li>
    ${characters.map(c => `
      <li><a href="character.html?id=${c.id}">
        ${ddThumb(new URL(resolveCharacterImage(c), location.href).href)}
        <span class="dd-text">
          <span class="dd-label">${highlight(c.name, q)}</span>
          <span class="dd-meta">${[ownerCustomNameMeta(c, q), escapeHtml(c.species_name || ''), escapeHtml(c.owner_nickname || '')].filter(Boolean).join(' · ')}</span>
        </span>
      </a></li>
    `).join('')}
    ${charCount > characters.length ? `<li class="dd-more" data-href="character-list.html?q=${encodeURIComponent(q)}">개체 검색 결과 ${charCount}개 전체 보기 →</li>` : ''}
  ` : '';

  const speciesGroup = species.length ? `
    <li class="dd-group-title">종족</li>
    ${species.map(s => `
      <li><a href="species.html?id=${s.id}">
        ${ddThumb(new URL(resolveSpeciesImage(s), location.href).href)}
        <span class="dd-text">
          <span class="dd-label">${highlight(s.name, q)}</span>
          <span class="dd-meta">${escapeHtml(s.owner_nickname || '')}</span>
        </span>
      </a></li>
    `).join('')}
    ${speciesCount > species.length ? `<li class="dd-more" data-href="species-list.html?q=${encodeURIComponent(q)}">종족 검색 결과 ${speciesCount}개 전체 보기 →</li>` : ''}
  ` : '';

  const userGroup = sortedUsers.length ? `
    <li class="dd-group-title">유저</li>
    ${sortedUsers.map(u => `
      <li><a href="profile.html?user=${u.id}">
        ${ddThumb(u.avatar_url)}
        <span class="dd-text">
          <span class="dd-label">${getUserBadgesHtml(u)} ${highlight(u.nickname, q)}</span>
        </span>
      </a></li>
    `).join('')}
    ${userCount > sortedUsers.length ? `<li class="dd-more" data-href="users.html?q=${encodeURIComponent(q)}">유저 검색 결과 ${userCount}개 전체 보기 →</li>` : ''}
  ` : '';

  // 표시 순서: 종족 → 개체 → 유저 (종족 자체를 찾는 검색이 많아 종족을 맨 위로)
  searchDropdown.innerHTML = speciesGroup + charGroup + userGroup;
  searchDropdown.querySelectorAll('.dd-more').forEach(li => {
    li.addEventListener('click', () => { window.location.href = li.dataset.href; });
  });
  searchDropdown.classList.add('active');
}

// 소유주가 붙인 개체명(owner_custom_name)으로 걸린 경우 등록명만 보면 왜 나왔는지 모르므로
// 검색어가 포함된 경우에만 메타 줄 앞에 하이라이트해서 보여준다(등록명과 같으면 생략).
function ownerCustomNameMeta(c, q) {
  const ocn = (c.owner_custom_name || '').trim();
  if (!ocn || ocn === c.name) return '';
  if (!ocn.toLowerCase().includes(q.toLowerCase())) return '';
  return `소유주명 ${highlight(ocn, q)}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlight(name, q) {
  const safeName = escapeHtml(name);
  const escaped  = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeName.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark style="background:var(--sky-light);color:var(--sky-deep);border-radius:2px;">$1</mark>'
  );
}

function closeDropdown() {
  searchDropdown.classList.remove('active');
  searchDropdown.innerHTML = '';
}

/* ── 디자이너 레거시 데이터 유틸 ───────────────
   designer_external(jsonb 배열) 도입 이전에 저장된 구(舊) 레코드는
   designer_user_ids(uuid 배열)만 있고 외부 디자이너 이름은
   designer_nickname 캐시 문자열 안에 " / "로 합쳐진 채로만 남아있을 수 있다.
   이 문자열을 다시 split(' / ')하면 닉네임 자체에 "/"가 포함된 경우
   한 명을 여러 명으로 잘못 나누게 되므로, 이미 알고 있는 연구소 회원
   닉네임을 앞/뒤에서만 정확히 제거하고 남은 부분은 통째로 외부 디자이너
   1개 항목으로 보존한다. (임의로 여러 명으로 분리하지 않음) */
function extractLegacyDesignerLeftover(fullText, knownSiteNicknames) {
  if (!fullText) return '';
  const nicks = (knownSiteNicknames || []).filter(Boolean);
  let remaining = fullText.trim();

  for (const nick of nicks) {
    const stripped = remaining.replace(/^\s*\/\s*/, '');
    if (stripped.startsWith(nick)) {
      remaining = stripped.slice(nick.length).trim();
    } else {
      break;
    }
  }
  for (let i = nicks.length - 1; i >= 0; i--) {
    const stripped = remaining.replace(/\s*\/\s*$/, '');
    if (stripped.endsWith(nicks[i])) {
      remaining = stripped.slice(0, stripped.length - nicks[i].length).trim();
    } else {
      break;
    }
  }
  return remaining.replace(/^\s*\/\s*/, '').replace(/\s*\/\s*$/, '').trim();
}

function goToSearch(q) {
  window.location.href = `character-list.html?q=${encodeURIComponent(q)}`;
}
