// pages/bookmarks.html 전용 — 전체 북마크 목록 (전체/종족/개체 필터, created_at DESC)
// 카드 마크업은 species-list.html/character-list.html과 동일한 .species-card/.character-card를
// 그대로 재사용한다 (새 디자인 시스템을 만들지 않음). 이름/이미지는 species/characters 테이블에서
// 조회 시점에 새로 읽어오며(js/bookmark.js의 bmFetchTargetRows), bookmarks 테이블에는 저장하지 않는다.

let _bmRows      = [];   // [{ id, target_type, target_id, created_at }]
let _bmDataMap    = null; // bmFetchTargetRows 결과
let _bmFilter     = 'all';
let _bmUserId     = null;

document.addEventListener('DOMContentLoaded', () => {
  initPage();
  document.getElementById('bmFilterRow').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    _bmFilter = btn.dataset.filter;
    document.querySelectorAll('#bmFilterRow .shop-tab-btn').forEach(el => el.classList.toggle('active', el === btn));
    renderBmGrid();
  });
});

async function initPage() {
  const user = await getUser();
  if (!user) { window.location.href = 'login.html'; return; }
  _bmUserId = user.id;

  const { data, error } = await sb
    .from('bookmarks')
    .select('id, target_type, target_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    document.getElementById('pageLoading').textContent = '북마크를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
    return;
  }

  _bmRows = data || [];
  _bmDataMap = await bmFetchTargetRows(_bmRows.map(r => ({ type: r.target_type, id: r.target_id })));

  document.getElementById('pageLoading').style.display = 'none';
  document.getElementById('pageContent').style.display = '';
  renderBmGrid();
}

function bmFilteredRows() {
  if (_bmFilter === 'all') return _bmRows;
  return _bmRows.filter(r => r.target_type === _bmFilter);
}

// [전체] 탭에서는 종족/개체 썸네일 비율·카드 높이가 달라 한 grid에 섞지 않고
// 기존 .species-grid/.character-grid를 각각의 섹션으로 분리해서 보여준다.
// [종족]/[개체] 탭은 기존처럼 단일 grid만 보여준다.
function renderBmGrid() {
  const content = document.getElementById('bookmarkContent');
  const empty   = document.getElementById('bookmarkEmpty');

  if (_bmFilter === 'all') {
    const speciesRows   = _bmRows.filter(r => r.target_type === 'species');
    const characterRows = _bmRows.filter(r => r.target_type === 'character');

    if (!speciesRows.length && !characterRows.length) {
      content.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    content.innerHTML = `
      ${speciesRows.length   ? bmRenderSection('종족', speciesRows, 'species-grid')     : ''}
      ${characterRows.length ? bmRenderSection('개체', characterRows, 'character-grid') : ''}
    `;
    return;
  }

  const rows = bmFilteredRows();
  if (!rows.length) {
    content.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  const gridClass = _bmFilter === 'species' ? 'species-grid' : 'character-grid';
  content.innerHTML = `<div class="${gridClass}">${rows.map(bmRenderCard).join('')}</div>`;
}

function bmRenderSection(title, rows, gridClass) {
  return `
    <div class="section">
      <div class="section-header"><h2>${title}</h2></div>
      <div class="${gridClass}">${rows.map(bmRenderCard).join('')}</div>
    </div>
  `;
}

function bmRenderCard(row) {
  const key  = `${row.target_type}:${row.target_id}`;
  const data = _bmDataMap ? _bmDataMap.get(key) : undefined;

  if (!data) {
    const missingClass = row.target_type === 'character' ? 'bm-missing-card bm-missing-card--character' : 'bm-missing-card';
    return `
      <div class="bm-card-wrap" id="bmCard_${row.id}">
        <button type="button" class="bm-remove-btn" onclick="bmRemoveBookmark(event, ${row.id})" aria-label="북마크 해제" title="북마크 해제">★</button>
        <div class="${missingClass}">삭제되었거나<br>확인할 수 없는 항목입니다.</div>
      </div>
    `;
  }

  if (row.target_type === 'character') {
    const href = `character.html?id=${row.target_id}`;
    return `
      <div class="bm-card-wrap" id="bmCard_${row.id}">
        <button type="button" class="bm-remove-btn" onclick="bmRemoveBookmark(event, ${row.id})" aria-label="북마크 해제" title="북마크 해제">★</button>
        <a href="${href}" class="character-card">
          ${data.is_sensitive && characterHasVisibleRealImage(data) ? `
          <div style="position:relative; overflow:hidden; border-radius:var(--radius);">
            <div class="character-img blurred" style="background-image:url('${data.thumbnail_url || data.image_url}'); background-size:cover; background-position:center;"></div>
            <div class="sensitive-overlay" onclick="revealSensitive(this,event)"><div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><svg width="28" height="26" viewBox="0 0 28 26" fill="none"><path d="M14 2L26 24H2L14 2Z" stroke="#b91c1c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line x1="14" y1="9" x2="14" y2="16" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="20" r="1.2" fill="#b91c1c"/></svg><span style="color:#b91c1c;font-size:16px;font-weight:700;">민감한 요소</span>${data.sensitive_note ? '<span class="sensitive-overlay-note">' + data.sensitive_note + '</span>' : ''}<span class="sensitive-overlay-hint">누르면 이미지가 보여요</span></div></div>
          </div>` : `
          <div class="character-img" style="background-image:url('${resolveCharacterImage(data)}'); background-size:cover; background-position:center;"></div>`}
          <div class="character-info">
            <p class="character-name">${data.name}</p>
            <p class="character-species">${data.species_name || ''}</p>
            <p class="character-owner">소유주: ${data.owner_nickname || '—'}</p>
          </div>
        </a>
      </div>
    `;
  }

  const href = `species.html?id=${row.target_id}`;
  return `
    <div class="bm-card-wrap" id="bmCard_${row.id}">
      <button type="button" class="bm-remove-btn" onclick="bmRemoveBookmark(event, ${row.id})" aria-label="북마크 해제" title="북마크 해제">★</button>
      <a href="${href}" class="species-card">
        ${data.is_sensitive && speciesHasVisibleRealImage(data) ? `
        <div style="position:relative; overflow:hidden;">
          <div class="species-img blurred" style="background-image:url('${data.thumbnail_url || data.image_url}'); background-size:cover; background-position:center;"></div>
          <div class="sensitive-overlay" onclick="revealSensitive(this,event)"><div style="display:flex;flex-direction:column;align-items:center;gap:5px;"><svg width="28" height="26" viewBox="0 0 28 26" fill="none"><path d="M14 2L26 24H2L14 2Z" stroke="#b91c1c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line x1="14" y1="9" x2="14" y2="16" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="20" r="1.2" fill="#b91c1c"/></svg><span style="color:#b91c1c;font-size:16px;font-weight:700;">민감한 요소</span>${data.sensitive_note ? '<span class="sensitive-overlay-note">' + data.sensitive_note + '</span>' : ''}<span class="sensitive-overlay-hint">누르면 이미지가 보여요</span></div></div>
        </div>` : `
        <div class="species-img" style="background-image:url('${resolveSpeciesImage(data)}'); background-size:cover; background-position:center;"></div>`}
        <div class="species-info">
          <p class="species-name">${data.name}</p>
        </div>
      </a>
    </div>
  `;
}

async function bmRemoveBookmark(e, bookmarkRowId) {
  e.preventDefault();
  e.stopPropagation();
  const btn = e.currentTarget;
  btn.disabled = true;

  const row = _bmRows.find(r => r.id === bookmarkRowId);
  if (!row) return;

  const { error } = await sb
    .from('bookmarks')
    .delete()
    .eq('user_id', _bmUserId)
    .eq('id', bookmarkRowId);

  if (error) {
    console.error('[북마크] 해제 실패:', error);
    btn.disabled = false;
    return;
  }

  _bmRows = _bmRows.filter(r => r.id !== bookmarkRowId);
  // 카드만 지우지 않고 다시 렌더 — [전체] 탭에서 한 섹션의 마지막 카드가 사라지면
  // 그 섹션(제목+구분선 포함) 자체도 함께 사라져야 하기 때문.
  renderBmGrid();
}

function revealSensitive(overlayEl, e) {
  e.stopPropagation();
  e.preventDefault();
  const wrap = overlayEl.parentElement;
  wrap.querySelectorAll('.blurred').forEach(el => el.classList.remove('blurred'));
  overlayEl.remove();
}
