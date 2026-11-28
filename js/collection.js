// ═══════════════════════════════════════
//   콜렉션 (MY > 콜렉션) — 프레임·스티커 열람 전용 도감
// ═══════════════════════════════════════
// - 목록: 상점(shop_items)에 공개된 적 있는 프레임·스티커. 판매 종료된 한정품도 포함한다.
//     상점(js/shop.js)은 sale_end_at 이 지난 상품을 목록 조회에서 빼지만, 콜렉션 조회에서는 빼지 않는다.
//     공개 범위는 상점과 같은 shop_items RLS 를 그대로 따른다
//       (로그인 필요 / status='hidden' 은 admin·staff 에게만 반환 → 상점처럼 '관리자 전용(비공개)' 배지).
//     status 'coming_soon'(미출시)은 상점과 같이 '준비중'으로 표시. 그 밖의 알 수 없는 status 는 표시하지 않는다.
// - 보유 판정: 내 가방과 같은 공용 함수 getMyShopItemRows (js/utils.js, user_items · 내 user_id 로만 조회).
// - 민감한 요소: 상점과 같은 user_settings.hide_sensitive_content 값 + 같은 가림 화면.
// - 열람 전용: 가격·구매 버튼 없음, DB 쓰기는 민감한 요소 토글(설정 저장)뿐.

let _colUser          = null;
let _colItems         = [];          // 표시 대상 shop_items (frame/sticker)
let _colOwnedSet      = new Set();   // 내가 보유한 shop_items.id
let _colActiveTab     = 'frame';     // 'frame' | 'sticker'
let _colShowSensitive = false;
let _colReturnFocus   = null;

const COLLECTION_TYPES    = ['frame', 'sticker'];
const COLLECTION_STATUSES = ['active', 'coming_soon', 'hidden'];
const COLLECTION_TYPE_LABEL = { frame: '프레임', sticker: '스티커' };
const COLLECTION_ITEM_COLUMNS =
  'id, item_type, name, description, image_url, status, sort_order, created_at, style_key, ' +
  'sub_category, credit, sale_end_at, species_link_id, is_sensitive';

function colEsc(s) {
  return typeof escapeHtml === 'function'
    ? escapeHtml(s == null ? '' : String(s))
    : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 상점(js/shop.js formatShopNameThumb)과 같은 카드 이름 줄바꿈 — "한글명(영문명)" 은 괄호 앞에서 줄바꿈
function colNameThumbHtml(name) {
  return colEsc(name)
    .replace(/^(메어나이트\d?)\(Marenight\)$/, '$1<br>(Marenight)')
    .replace(/^(옥토몬스터)\(Octomonster\)$/, '$1<br>(Octomonster)')
    .replace(/^(쁘띠아라크네)\(Petit Arachne\)$/, '$1<br>(Petit Arachne)')
    .replace(/^(몰링)\(Molling\)$/, '$1<br>(Molling)')
    .replace(/^(뾰둥이)\(PPYO\)$/, '$1<br>(PPYO)')
    .replace(/^(드라카우\d?)\(Dracow\)$/, '$1<br>(Dracow)');
}

// 판매 종료 — 상점 목록 조건(sale_end_at 이 없거나 지금보다 뒤)의 반대. purchase_item RPC 도 같은 시각 기준으로 막는다.
function colIsSaleEnded(item) {
  return !!item.sale_end_at && new Date(item.sale_end_at).getTime() <= Date.now();
}

// 상세 모달 표시용 마지막 판매일 — 상점과 같이 (sale_end_at - 1ms) 기준
function colSaleEndDateText(item) {
  const d = new Date(new Date(item.sale_end_at).getTime() - 1);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ── 초기화 ──────────────────────────────────────────────
async function initCollectionPage() {
  try {
    _colUser = await getUser();
    if (!_colUser) { window.location.href = 'login.html'; return; }

    await loadCollectionData();
    renderCollection();

    document.getElementById('collectionTabRow').addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      document.querySelectorAll('#collectionTabRow .shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _colActiveTab = btn.dataset.tab;
      renderCollection();
    });

    const grid = document.getElementById('collectionCategories');
    grid.addEventListener('click', e => {
      const card = e.target.closest('[data-col-id]');
      if (card) openCollectionDetail(card.dataset.colId);
    });
    grid.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-col-id]');
      if (!card) return;
      e.preventDefault();
      openCollectionDetail(card.dataset.colId);
    });

    const toggle = document.getElementById('collectionSensitiveToggle');
    toggle.checked = _colShowSensitive;
    toggle.addEventListener('change', async () => {
      const next = toggle.checked;
      toggle.disabled = true;
      // 라벨은 "보이기"(show), DB 는 hide_sensitive_content(hide) — 상점·설정 페이지와 같은 값을 반전 저장
      const { error } = await updateUserSettings(_colUser.id, { hide_sensitive_content: !next });
      toggle.disabled = false;
      if (error) {
        toggle.checked = !next;
        alert('설정 저장에 실패했어요. 다시 시도해주세요.');
        return;
      }
      _colShowSensitive = next;
      renderCollection();
    });

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[collection] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

async function loadCollectionData() {
  const [itemsRes, ownedRes, settings] = await Promise.all([
    // sale_end_at 필터 없음 — 판매 종료 상품도 콜렉션에는 남긴다. 공개 범위는 shop_items RLS 그대로.
    sb.from('shop_items')
      .select(COLLECTION_ITEM_COLUMNS)
      .in('item_type', COLLECTION_TYPES)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    getMyShopItemRows(_colUser.id, 'item_id'),
    getUserSettings(_colUser.id),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (ownedRes.error) throw ownedRes.error;

  _colItems = (itemsRes.data || []).filter(it => COLLECTION_STATUSES.includes(it.status));
  _colOwnedSet = new Set((ownedRes.data || []).map(r => r.item_id));
  _colShowSensitive = !settings.hide_sensitive_content;
}

// ── 썸네일 ───────────────────────────────────────────────
const COL_SENSITIVE_HTML =
  '<div class="shop-sensitive-placeholder">' +
  '<span class="shop-sensitive-placeholder-icon">⚠</span>' +
  '<span class="shop-sensitive-placeholder-label">민감한 요소</span>' +
  '</div>';
const COL_SENSITIVE_LARGE_HTML =
  '<div class="shop-sensitive-placeholder">' +
  '<span class="shop-sensitive-placeholder-icon">⚠</span>' +
  '<span class="shop-sensitive-placeholder-label">민감한 요소</span>' +
  '<span class="shop-sensitive-placeholder-hint">상단의 ‘민감한 요소 보이기’ 설정에서 표시할 수 있습니다.</span>' +
  '</div>';
const COL_MISSING_HTML = '<div class="collection-thumb-missing">이미지 없음</div>';

// 상점 buildPreviewHtml 과 같은 규칙: 프레임 = style_key CSS, 스티커/이미지 상품 = image_url
function colPreviewHtml(item, { large = false } = {}) {
  if (item.is_sensitive && !_colShowSensitive) return large ? COL_SENSITIVE_LARGE_HTML : COL_SENSITIVE_HTML;
  if (item.style_key && item.item_type !== 'sticker') {
    return `<div class="frame-preview ${large ? 'frame-preview--lg ' : ''}${colEsc(item.style_key)}"></div>`;
  }
  if (!item.image_url) return COL_MISSING_HTML;
  const isSticker = item.item_type === 'sticker';
  const onErr = 'onerror="colImgFallback(this)"';
  if (large) {
    return `<img src="${colEsc(item.image_url)}" alt="${colEsc(item.name)}" ${onErr}
      style="width:${isSticker ? '60%' : '100%'};height:${isSticker ? '60%' : '100%'};object-fit:${isSticker ? 'contain' : 'cover'};">`;
  }
  return `<img src="${colEsc(item.image_url)}" alt="${colEsc(item.name)}" loading="lazy" ${onErr}${isSticker ? ' class="shop-sticker-img"' : ''}>`;
}

// 이미지 주소가 깨진 경우(파일 누락 등) — 빈 칸 대신 '이미지 없음' 표시
//   카드는 '그림 없음' 상태로 바꿔 안내 문구가 흐려지지 않고, 미보유 배지와도 겹치지 않게 한다.
function colImgFallback(img) {
  img.onerror = null;
  img.closest('.collection-thumb')?.classList.add('collection-thumb--noart');
  img.outerHTML = COL_MISSING_HTML;
}

function renderCollectionThumb(item) {
  const owned  = _colOwnedSet.has(item.id);
  const ended  = colIsSaleEnded(item);
  const coming = item.status === 'coming_soon';
  // 민감한 요소 가림 / 그림 정보 없음 — 안내 화면이라 회색·투명도를 적용하지 않고, 미보유 배지는 아래쪽으로 비킨다
  const noArt  = (item.is_sensitive && !_colShowSensitive)
              || (!(item.style_key && item.item_type !== 'sticker') && !item.image_url);

  // 이미지 위 배지 — 회색·투명도 적용 대상(.collection-thumb-art) 밖에 둬서 선명하게.
  //   카드에는 '미보유'(가운데, 그림 없음이면 아래 가운데)만 표시. '판매 종료'·'보유중'은 카드에서 빼고 상세 모달에서만 보여준다(1128 뽀 결정).
  //   준비중(왼쪽 위)·관리자 전용(비공개)은 상점과 같은 공개 정책 표시라 유지.
  const overlay = coming
    ? '<span class="shop-thumb-badge shop-badge--coming">준비중</span>'
    : '';
  const adminOnly = item.status === 'hidden'
    ? '<div class="shop-thumb-badge-row"><span class="shop-thumb-badge shop-badge--coming shop-thumb-badge--static">관리자 전용(비공개)</span></div>'
    : '';
  const unownedBadge = owned ? '' : '<span class="collection-badge--unowned">미보유</span>';

  return `
    <div class="shop-thumb collection-thumb ${owned ? 'collection-thumb--owned' : 'collection-thumb--unowned'}${ended ? ' collection-thumb--ended' : ''}${noArt ? ' collection-thumb--noart' : ''}"
         role="button" tabindex="0" data-col-id="${colEsc(item.id)}"
         aria-label="${colEsc(item.name)} — ${owned ? '보유중' : '미보유'}${ended ? ', 판매 종료' : ''}">
      <div class="shop-thumb-img">
        ${overlay}
        ${unownedBadge}
        <div class="collection-thumb-art">${colPreviewHtml(item)}</div>
      </div>
      ${adminOnly}
      <p class="shop-thumb-name">${colNameThumbHtml(item.name)}</p>
    </div>`;
}

// ── 목록 렌더 (상점 꾸미기와 같은 분류: item_type > sub_category, sort_order 순) ──
function renderCollection() {
  const wrap  = document.getElementById('collectionCategories');
  const items = _colItems.filter(it => it.item_type === _colActiveTab);

  renderCollectionSummary();

  if (!items.length) {
    wrap.innerHTML = `<p class="empty-state" style="padding:60px 0;text-align:center;">표시할 ${COLLECTION_TYPE_LABEL[_colActiveTab]}이 없어요.</p>`;
    return;
  }

  const subs = {};
  items.forEach(it => {
    const sub = it.sub_category || '기본';
    (subs[sub] = subs[sub] || []).push(it);
  });

  const ownedCount = items.filter(it => _colOwnedSet.has(it.id)).length;
  wrap.innerHTML = `
    <div class="shop-cat-box">
      <h2 class="shop-cat-title">${COLLECTION_TYPE_LABEL[_colActiveTab]}
        <span class="collection-cat-count">${ownedCount} / ${items.length}</span></h2>
      <div class="shop-cat-inner">
        ${Object.entries(subs).map(([label, list], i) => `
          <div class="shop-subcat${i > 0 ? ' shop-subcat--gap' : ''}">
            <h3 class="shop-subcat-title">${colEsc(label)}</h3>
            <div class="shop-cat-grid">${list.map(renderCollectionThumb).join('')}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderCollectionSummary() {
  const el = document.getElementById('collectionSummary');
  if (!el) return;
  el.textContent = COLLECTION_TYPES.map(t => {
    const list = _colItems.filter(it => it.item_type === t);
    return `${COLLECTION_TYPE_LABEL[t]} ${list.filter(it => _colOwnedSet.has(it.id)).length} / ${list.length}`;
  }).join(' · ');
}

// ── 상세 모달 (열람 전용) ─────────────────────────────────
function openCollectionDetail(itemId) {
  const item = _colItems.find(it => String(it.id) === String(itemId));
  if (!item) return;
  const owned = _colOwnedSet.has(item.id);
  const ended = colIsSaleEnded(item);

  document.getElementById('colDetailPreview').innerHTML = colPreviewHtml(item, { large: true });
  document.getElementById('colDetailName').textContent = item.name || '';
  document.getElementById('colDetailDesc').textContent = item.description || '';

  const creditEl = document.getElementById('colDetailCredit');
  creditEl.textContent   = item.credit ? `Design by ${item.credit}` : '';
  creditEl.style.display = item.credit ? '' : 'none';

  const speciesEl = document.getElementById('colDetailSpeciesLink');
  if (item.species_link_id) {
    const speciesName = (item.name || '').replace(/\d+(?=\()|\d+$/, '');
    speciesEl.innerHTML = `<a class="shop-detail-species-link" href="species.html?id=${encodeURIComponent(item.species_link_id)}">${colEsc(speciesName)} ㅣ 종족주 : ${colEsc(item.credit || '')}</a>`;
  } else {
    speciesEl.innerHTML = '';
  }

  const saleEl = document.getElementById('colDetailSaleEnd');
  if (item.sale_end_at) {
    saleEl.textContent = ended
      ? `판매 종료 · ${colSaleEndDateText(item)}까지 판매`
      : `판매기간 ${colSaleEndDateText(item)}까지`;
    saleEl.style.display = '';
  } else {
    saleEl.style.display = 'none';
  }

  const pills = [
    owned
      ? '<span class="shop-detail-status shop-status--owned">보유중</span>'
      : '<span class="shop-detail-status collection-status-pill--unowned">미보유</span>',
  ];
  if (ended) pills.push('<span class="shop-detail-status collection-status-pill--ended">판매 종료</span>');
  else if (item.status === 'coming_soon') pills.push('<span class="shop-detail-status shop-status--coming">준비중</span>');
  if (item.status === 'hidden') pills.push('<span class="shop-detail-status shop-status--coming">관리자 전용(비공개)</span>');
  document.getElementById('colDetailStatus').innerHTML = pills.join('');

  _colReturnFocus = document.activeElement;
  document.getElementById('collectionDetailModal').style.display = 'flex';
  document.getElementById('colDetailClose').focus();
}

function closeCollectionDetail() {
  const modal = document.getElementById('collectionDetailModal');
  if (modal.style.display === 'none') return;
  modal.style.display = 'none';
  document.getElementById('colDetailPreview').innerHTML = '';
  if (_colReturnFocus && document.contains(_colReturnFocus)) _colReturnFocus.focus();
  _colReturnFocus = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCollectionDetail();
});

initCollectionPage();
