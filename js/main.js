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
          <span class="dd-meta">${[escapeHtml(c.species_name || ''), escapeHtml(c.owner_nickname || '')].filter(Boolean).join(' · ')}</span>
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

  searchDropdown.innerHTML = charGroup + speciesGroup + userGroup;
  searchDropdown.querySelectorAll('.dd-more').forEach(li => {
    li.addEventListener('click', () => { window.location.href = li.dataset.href; });
  });
  searchDropdown.classList.add('active');
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
