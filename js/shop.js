let _user        = null;
let _wallet      = null;
let _ownedSet    = new Set();
let _qtyByKey    = {};   // item_key → 보유 수량 (stackable 아이템 잔고)
let _pendingItem = null;
let _allItems    = [];
let _activeTab   = 'decorate'; // 'item' | 'decorate'
// 민감한 요소 표시 여부 — user_settings.hide_sensitive_content(DB)의 반대값.
// MY > 설정 페이지와 동일한 DB 값을 공유한다(js/settings.js). loadData()에서 조회해 채운다.
let _showSensitive = false;

const TAB_ITEM_TYPES = {
  item:     ['consumable'],
};

// "분양 끌올 티켓 1장/5장 묶음/10장 묶음" 표시 시 "분양 끌올 티켓" 다음 줄바꿈
function formatShopName(name) {
  return name.replace(/^(분양 끌올 티켓) /, '$1<br>');
}

// 카드(썸네일) 전용: "메어나이트(Marenight)"처럼 한글명(영문명) 형태는 괄호 앞에서
// 줄바꿈해 다른 아이템과 박스 높이를 맞춤. 상세 모달에서는 줄바꿈하지 않음.
function formatShopNameThumb(name) {
  return formatShopName(name)
    .replace(/^(메어나이트\d?)\(Marenight\)$/, '$1<br>(Marenight)')
    .replace(/^(옥토몬스터)\(Octomonster\)$/, '$1<br>(Octomonster)')
    .replace(/^(쁘띠아라크네)\(Petit Arachne\)$/, '$1<br>(Petit Arachne)')
    .replace(/^(몰링)\(Molling\)$/, '$1<br>(Molling)')
    .replace(/^(뾰둥이)\(PPYO\)$/, '$1<br>(PPYO)')
    .replace(/^(드라카우\d?)\(Dracow\)$/, '$1<br>(Dracow)');
}

const TICKET_BUMP_CONDITION_HTML =
  '<strong>※ 사용 조건</strong><br>' +
  '내 분양글보다 최신 분양글이 20개 이상 등록되어 있을 때 사용할 수 있습니다.<br>' +
  '사용 시 해당 분양글이 분양 목록 최상단으로 이동합니다.';

const CURRENCY_LABEL = { research_records: '연구기록', keys: '열쇠' };
const CURRENCY_ICON  = {
  research_records: `<img src="../images/icons/currency-record.png" class="shop-currency-icon" alt="연구기록">`,
  keys:             `<img src="../images/icons/currency-key.png"    class="shop-currency-icon" alt="열쇠">`,
};

const TYPE_LABEL = {
  frame:        '프레임',
  sticker:      '스티커',
  title:        '칭호',
  profile_deco: '프로필 꾸미기',
  consumable:   '아이템',
};

const ERROR_MSG = {
  NOT_AUTHENTICATED:    '로그인이 필요합니다.',
  ITEM_NOT_FOUND:       '존재하지 않는 상품입니다.',
  ITEM_NOT_AVAILABLE:   '현재 판매하지 않는 상품입니다.',
  ITEM_SALE_ENDED:      '판매가 종료된 상품입니다.',
  ALREADY_OWNED:        '이미 보유한 상품입니다.',
  WALLET_NOT_FOUND:     '지갑 정보를 찾을 수 없습니다.',
  INSUFFICIENT_BALANCE: '재화가 부족합니다.',
};

// ── 초기화 ──────────────────────────────────────────────
async function initPage() {
  try {
    _user = await getUser();
    if (!_user) { window.location.href = 'login.html'; return; }

    await loadData();
    renderCategories();

    document.getElementById('shopTabRow').addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      document.querySelectorAll('#shopTabRow .shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab = btn.dataset.tab;
      renderCategories();
    });

    const sensitiveToggle = document.getElementById('shopSensitiveToggle');
    sensitiveToggle.checked = _showSensitive;
    sensitiveToggle.addEventListener('change', async () => {
      const next = sensitiveToggle.checked;
      sensitiveToggle.disabled = true;
      // 토글 라벨은 "민감한 요소 보이기"(show) — DB는 hide_sensitive_content(hide)로 저장하므로 반전해서 저장
      const { error } = await updateUserSettings(_user.id, { hide_sensitive_content: !next });
      sensitiveToggle.disabled = false;
      if (error) {
        sensitiveToggle.checked = !next;
        alert('설정 저장에 실패했어요. 다시 시도해주세요.');
        return;
      }
      _showSensitive = next;
      renderCategories();
    });

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[shop] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

async function loadData() {
  const [itemsRes, walletRes, ownedRes, settings] = await Promise.all([
    sb.from('shop_items')
      .select('*')
      // status='hidden' 필터링은 하지 않음 — RLS가 일반 사용자에게는 이미 걸러주고,
      // admin/staff 계정은 RLS 예외로 hidden 상품도 미리보기용으로 받아옴 (renderThumb에서 배지 표시)
      .or(`sale_end_at.is.null,sale_end_at.gt.${new Date().toISOString()}`)
      .order('sort_order', { ascending: true })
      .order('created_at',  { ascending: true }),
    getMyWallet(_user.id),
    sb.from('user_items')
      .select('item_id, item_key, quantity')
      .eq('user_id', _user.id),
    getUserSettings(_user.id),
  ]);

  _allItems = itemsRes.data  || [];
  _wallet   = walletRes.data;
  _ownedSet = new Set((ownedRes.data || []).map(r => r.item_id));
  _showSensitive = !settings.hide_sensitive_content;

  _qtyByKey = {};
  (ownedRes.data || []).forEach(r => {
    if (r.item_key) _qtyByKey[r.item_key] = r.quantity ?? 0;
  });
}

// ── 카테고리 렌더 ────────────────────────────────────────
function renderCategories() {
  const wrap = document.getElementById('shopCategories');

  // 탭(아이템/꾸미기) 기준으로 먼저 걸러낸 뒤 item_type 기준으로 그룹핑
  const itemTabTypes = TAB_ITEM_TYPES.item;
  const tabItems = _allItems.filter(item => {
    const isItemTab = itemTabTypes.includes(item.item_type || 'etc');
    return _activeTab === 'item' ? isItemTab : !isItemTab;
  });

  const grouped = {};
  tabItems.forEach(item => {
    const t = item.item_type || 'etc';
    if (!grouped[t]) grouped[t] = {};

    // sub_category 컬럼 있으면 사용, 없으면 '기본'
    const sub = item.sub_category || '기본';
    if (!grouped[t][sub]) grouped[t][sub] = [];
    grouped[t][sub].push(item);
  });

  const types = Object.keys(grouped);
  if (!types.length) {
    wrap.innerHTML = '<p class="empty-state" style="padding:60px 0;text-align:center;">판매중인 상품이 없어요.</p>';
    return;
  }

  wrap.innerHTML = types.map(type => {
    const label = TYPE_LABEL[type] || type;
    const subs  = grouped[type];
    return `
      <div class="shop-cat-box">
        <h2 class="shop-cat-title">${label}</h2>
        <div class="shop-cat-inner">
          ${Object.entries(subs).map(([subLabel, items], i) => `
            <div class="shop-subcat${i > 0 ? ' shop-subcat--gap' : ''}">
              <h3 class="shop-subcat-title">${subLabel}</h3>
              <div class="shop-cat-grid">
                ${items.map(renderThumb).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');
}

// ── 민감한 요소 가림 썸네일 ──────────────────────────────
const SENSITIVE_PLACEHOLDER_HTML =
  '<div class="shop-sensitive-placeholder">' +
  '<span class="shop-sensitive-placeholder-icon">⚠</span>' +
  '<span class="shop-sensitive-placeholder-label">민감한 요소</span>' +
  '</div>';

// 상세 모달용 — 안내 문구 포함 (카드 썸네일은 공간이 좁아 문구 없이 유지)
const SENSITIVE_PLACEHOLDER_LARGE_HTML =
  '<div class="shop-sensitive-placeholder">' +
  '<span class="shop-sensitive-placeholder-icon">⚠</span>' +
  '<span class="shop-sensitive-placeholder-label">민감한 요소</span>' +
  '<span class="shop-sensitive-placeholder-hint">상단의 ‘민감한 요소 보이기’ 설정에서 표시할 수 있습니다.</span>' +
  '</div>';

// 토글 OFF && is_sensitive 상품만 이미지 자리에 가림 화면을 대신 렌더링
function buildPreviewHtml(item, { large = false } = {}) {
  if (item.is_sensitive && !_showSensitive) {
    return large ? SENSITIVE_PLACEHOLDER_LARGE_HTML : SENSITIVE_PLACEHOLDER_HTML;
  }
  if (item.style_key && item.item_type !== 'sticker') {
    return `<div class="frame-preview ${large ? 'frame-preview--lg ' : ''}${item.style_key}"></div>`;
  }
  if (!item.image_url) return '';
  if (large) {
    // 스티커 확대 미리보기는 .frame-preview--lg(60%)와 동일한 비율로 맞춰
    // 프레임 대비 스티커만 커 보이지 않게 함. 소모품(티켓 등)은 기존 100% 유지.
    const isSticker = item.item_type === 'sticker';
    return `<img src="${item.image_url}" alt="${item.name}" style="width:${isSticker ? '60%' : '100%'};height:${isSticker ? '60%' : '100%'};object-fit:${isSticker ? 'contain' : 'cover'};">`;
  }
  return `<img src="${item.image_url}" alt="${item.name}"${item.item_type === 'sticker' ? ' class="shop-sticker-img"' : ''}>`;
}

// ── 가격 HTML 생성 (이중 통화 지원) ────────────────────────
function buildPriceHtml(item, discountHtml = '') {
  const curIcon = CURRENCY_ICON[item.currency] ?? CURRENCY_LABEL[item.currency] ?? item.currency;
  let html = `${curIcon} ${discountHtml}${item.price.toLocaleString()}`;
  if (item.secondary_currency && item.secondary_price) {
    const secIcon = CURRENCY_ICON[item.secondary_currency] ?? CURRENCY_LABEL[item.secondary_currency] ?? item.secondary_currency;
    html += ` ${secIcon} ${item.secondary_price.toLocaleString()}`;
  }
  return html;
}

// ── 썸네일 렌더 ──────────────────────────────────────────
function getItemState(item) {
  if (item.purchase_type !== 'stackable' && _ownedSet.has(item.id)) return 'owned';
  if (item.status === 'coming_soon') return 'coming';
  const balance = item.currency === 'research_records'
    ? (_wallet?.research_records ?? 0) : (_wallet?.keys ?? 0);
  if (item.price > 0 && balance < item.price) return 'insufficient';
  if (item.secondary_currency && item.secondary_price) {
    const secBalance = item.secondary_currency === 'research_records'
      ? (_wallet?.research_records ?? 0) : (_wallet?.keys ?? 0);
    if (secBalance < item.secondary_price) return 'insufficient';
  }
  return 'available';
}

function renderThumb(item) {
  const state    = getItemState(item);
  const isFree   = item.price === 0;
  const curIcon  = CURRENCY_ICON[item.currency] ?? CURRENCY_LABEL[item.currency] ?? item.currency;

  const imgOverlay = state === 'owned'
    ? `<span class="shop-thumb-badge shop-badge--owned shop-badge--right">보유중</span>`
    : state === 'coming'
      ? `<span class="shop-thumb-badge shop-badge--coming">준비중</span>`
      : item.purchase_type === 'stackable' && item.item_key
        ? `<span class="shop-thumb-badge shop-badge--owned shop-badge--right">보유 ${_qtyByKey[item.item_key] ?? 0}장</span>`
        : '';

  // 이미지 아래(상품명 위) 배지 — hidden 상품은 RLS 예외로 admin/staff에게만
  // 조회되는 미리보기 상태이므로, 실사용자에게는 안 보인다는 걸 명확히 알림.
  // 할인 배지는 취소선 정가 + 할인가로 이미 충분히 전달되므로 별도 표시하지 않음.
  const adminOnlyBadge = item.status === 'hidden'
    ? `<span class="shop-thumb-badge shop-badge--coming shop-thumb-badge--static">관리자 전용(비공개)</span>`
    : '';

  const previewHtml = buildPreviewHtml(item);

  const hasDiscount = item.original_price && item.original_price > item.price;
  const discountHtml = hasDiscount
    ? `<s class="shop-price-original">${item.original_price.toLocaleString()}</s> `
    : '';
  const priceHtml = buildPriceHtml(item, discountHtml);
  const statusHtml = {
    owned:        `<span class="shop-thumb-status shop-status--owned">보유중</span>`,
    coming:       `<span class="shop-thumb-status shop-status--coming">준비중</span>`,
    available:    `<span class="shop-thumb-status shop-status--available">${priceHtml}</span>`,
    insufficient: `<span class="shop-thumb-status shop-status--insufficient">${priceHtml}</span>`,
  }[state];

  // item 전달 시 실제 DB UUID 사용
  const itemJson = JSON.stringify(item).replace(/'/g, "\\'");

  return `
    <div class="shop-thumb shop-thumb--${state}"
         onclick='openDetailModal(${itemJson})'>
      <div class="shop-thumb-img">
        ${imgOverlay}
        ${previewHtml}
      </div>
      ${adminOnlyBadge ? `<div class="shop-thumb-badge-row">${adminOnlyBadge}</div>` : ''}
      <p class="shop-thumb-name">${formatShopNameThumb(item.name)}</p>
      ${statusHtml}
    </div>`;
}

// ── 상세 모달 ────────────────────────────────────────────
function openDetailModal(item) {
  const state    = getItemState(item);
  const isFree   = item.price === 0;
  const curIcon  = CURRENCY_ICON[item.currency] ?? CURRENCY_LABEL[item.currency] ?? item.currency;

  const previewEl = document.getElementById('detailPreview');
  previewEl.innerHTML = buildPreviewHtml(item, { large: true });

  document.getElementById('detailName').innerHTML    = formatShopName(item.name);
  document.getElementById('detailDesc').textContent  = item.description || '';

  const speciesLinkEl = document.getElementById('detailSpeciesLink');
  if (item.species_link_id) {
    const speciesName = item.name.replace(/\d+(?=\()|\d+$/, '');
    speciesLinkEl.innerHTML = `<a class="shop-detail-species-link" href="species.html?id=${item.species_link_id}">${speciesName} ㅣ 종족주 : ${item.credit || ''}</a>`;
  } else {
    speciesLinkEl.innerHTML = '';
  }

  const conditionEl = document.getElementById('detailCondition');
  if (item.item_key === 'ticket-bump') {
    conditionEl.innerHTML     = TICKET_BUMP_CONDITION_HTML;
    conditionEl.style.display = '';
  } else {
    conditionEl.style.display = 'none';
  }

  const saleEndEl = document.getElementById('detailSaleEnd');
  if (saleEndEl) {
    if (item.sale_end_at) {
      const endDate = new Date(new Date(item.sale_end_at).getTime() - 1);
      const formatted = `${endDate.getFullYear()}년 ${endDate.getMonth() + 1}월 ${endDate.getDate()}일까지`;
      saleEndEl.textContent = '판매기간 ' + formatted;
      saleEndEl.style.display = '';
    } else {
      saleEndEl.style.display = 'none';
    }
  }

  const creditEl = document.getElementById('detailCredit');
  if (creditEl) {
    creditEl.textContent    = item.credit ? `Design by ${item.credit}` : '';
    creditEl.style.display  = item.credit ? '' : 'none';
  }
  const detailDiscount = item.original_price && item.original_price > item.price
    ? `<s class="shop-price-original">${item.original_price.toLocaleString()}</s> `
    : '';
  // 목록에서는 뺀 할인 배지를 상세 모달에서는 가격 옆에 표시 (원가/할인가로 이미 전달되는 정보를 보강)
  const detailDiscountBadge = item.discount_note
    ? `<span class="shop-thumb-badge shop-badge--discount shop-thumb-badge--static shop-detail-price-badge">${item.discount_note}</span>`
    : '';
  const detailPriceHtml = buildPriceHtml(item, detailDiscount) + detailDiscountBadge;
  document.getElementById('detailPrice').innerHTML =
    state === 'insufficient'
      ? `<span style="color:#ef4444;">${detailPriceHtml}</span>`
      : detailPriceHtml;

  const actionEl = document.getElementById('detailAction');
  if (state === 'owned') {
    actionEl.innerHTML = `<span class="shop-detail-status shop-status--owned">보유중</span>`;
  } else if (state === 'coming') {
    actionEl.innerHTML = `<span class="shop-detail-status shop-status--coming">준비중</span>`;
  } else if (state === 'available') {
    const encoded = JSON.stringify(item).replace(/"/g, '&quot;');
    actionEl.innerHTML = `<button class="shop-buy-btn-lg"
      onclick='closeDetailModal(); openShopModal(JSON.parse(this.dataset.item))'
      data-item="${encoded}">구매하기</button>`;
  } else {
    actionEl.innerHTML = `<span class="shop-detail-status shop-status--insufficient">재화 부족</span>`;
  }

  document.getElementById('shopDetailModal').style.display = 'flex';
}

function closeDetailModal() {
  document.getElementById('shopDetailModal').style.display = 'none';
}

// ── 구매 확인 모달 ────────────────────────────────────────
function openShopModal(item) {
  _pendingItem = typeof item === 'string' ? JSON.parse(item) : item;
  const confirmPriceHtml = buildPriceHtml(_pendingItem);

  document.getElementById('shopModalDesc').innerHTML = `
    <div class="wallet-confirm-row">
      <span class="wallet-confirm-label">상품</span>
      <span class="wallet-confirm-value">${_pendingItem.name}</span>
    </div>
    <div class="wallet-confirm-row">
      <span class="wallet-confirm-label">가격</span>
      <span class="wallet-confirm-value wallet-confirm-amount">${confirmPriceHtml}</span>
    </div>`;

  const btn = document.getElementById('shopModalBtn');
  btn.disabled = false; btn.textContent = '구매';
  document.getElementById('shopModal').style.display = 'flex';
}

function closeShopModal() {
  document.getElementById('shopModal').style.display = 'none';
  _pendingItem = null;
}

// ── 구매 처리 ────────────────────────────────────────────
async function doPurchase() {
  if (!_pendingItem) return;
  const btn = document.getElementById('shopModalBtn');
  btn.disabled = true; btn.textContent = '처리 중...';

  // item.id = 실제 DB UUID
  const { data, error } = await sb.rpc('purchase_item', { p_item_id: _pendingItem.id });

  console.log('[shop] purchase result:', data);
  console.log('[shop] purchase error:', error);

  if (error || !data?.success) {
    btn.disabled = false; btn.textContent = '구매';
    alert(ERROR_MSG[data?.error] ?? `구매 중 오류가 발생했습니다.\n[${data?.error ?? error?.message ?? 'unknown'}]`);
    return;
  }

  _ownedSet.add(_pendingItem.id);
  if (_pendingItem.purchase_type === 'stackable' && _pendingItem.item_key) {
    _qtyByKey[_pendingItem.item_key] = data.quantity ?? ((_qtyByKey[_pendingItem.item_key] ?? 0) + _pendingItem.grant_qty);
  }
  if (_wallet) {
    if (data.currency === 'research_records') _wallet.research_records = data.new_balance;
    else _wallet.keys = data.new_balance;
    if (data.sec_new_balance !== undefined && _pendingItem.secondary_currency) {
      if (_pendingItem.secondary_currency === 'research_records') _wallet.research_records = data.sec_new_balance;
      else _wallet.keys = data.sec_new_balance;
    }
  }
  if (typeof updateHeaderCurrencyDisplay === 'function') {
    updateHeaderCurrencyDisplay({ research_records: _wallet?.research_records, keys: _wallet?.keys });
  }

  closeShopModal();
  renderCategories();
}

initPage();
