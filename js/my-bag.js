let _user              = null;
let _equippedFrameId   = null;
let _equippedStickerId = null;
let _itemsByType       = {};
let _activeTab         = 'decorate'; // 'item' | 'decorate'

const TAB_ITEM_TYPES = {
  item: ['consumable'],
};

// DB의 style_key → CSS 클래스 매핑
// (DB 연동 전 로컬 더미 대비 폴백)
const STYLE_KEY_MAP = {
  'frame-mint':            'frame-mint',
  'frame-orange':          'frame-orange',
  'frame-simple-sky':      'frame-simple-sky',
  'frame-simple-lavender': 'frame-simple-lavender',
  'frame-simple-rose':     'frame-simple-rose',
  'frame-simple-lemon':    'frame-simple-lemon',
  'frame-simple-lime':     'frame-simple-lime',
  'frame-simple-gray':     'frame-simple-gray',
  'frame-simple-blue':     'frame-simple-blue',
  'frame-simple-red':      'frame-simple-red',
};

const TYPE_LABEL = {
  frame:        '프레임',
  sticker:      '스티커',
  title:        '칭호',
  profile_deco: '프로필 꾸미기',
  consumable:   '아이템',
};

// ── 아이템 탭 (실제 DB 기준) ─────────────────────────────
// 데이터 소스: public.my_item_collection 뷰 (보유 수량 + items 마스터, is_hidden=false 만).
//   → quantity > 0 인 아이템만 카드로 표시. 프론트 더미/하드코딩 아이템 없음.
//   → '티켓' 섹션만 기존 시스템(user_items + shop_items, _itemsByType.consumable)을 그대로 사용.
//
// DB item code → 내 가방 큰 분류. 코드 매핑에 없으면 category 로 폴백, 그래도 모르면 '기타'.
// (특정 code 화이트리스트로 "표시 허용"하지 않는다 — 알 수 없는 아이템도 '기타'로라도 항상 보이게.)
const BAG_SECTION_BY_CODE = {
  labber_culture_reagent:    'myo',        // LABBER MYO
  disposable_embryo_kit:     'trait',
  labber_pod_circle:         'trait',
  labber_pod_cylinder:       'trait',
  labber_pod_triangle:       'trait',
  labber_pod_square:         'trait',
  labber_cartridge_protrude: 'trait',
  labber_cartridge_attach:   'trait',
  labber_cartridge_split:    'trait',
  random_subject:            'trait',
  random_fish_subject:       'trait',
  random_reptile_subject:    'trait',
  random_bird_subject:       'trait',
  suspicious_embryo_sample:  'exploration',
  suspicious_scale:          'exploration',
  suspicious_feather:        'exploration',
  suspicious_shed:           'exploration',
};

const BAG_SECTION_ORDER = [
  { key: 'ticket',      label: '티켓' },
  { key: 'myo',         label: 'MYO' },
  { key: 'exploration', label: '탐험물' },
  { key: 'trait',       label: '특성 아이템' },
  { key: 'etc',         label: '기타' },
];

// items 마스터엔 이미지가 비어 있는 실물 아이템의 code → 정적 asset (my_item_collection.image_url 이 우선).
const BAG_ITEM_IMG_FALLBACK = {
  suspicious_embryo_sample: '../images/items/item_embryo_sample.png',
  disposable_embryo_kit:    '../images/items/item_embryo_kit.png',
  suspicious_scale:         '../images/items/item_suspicious_scale.png',
  suspicious_feather:       '../images/items/item_suspicious_feather.png',
  suspicious_shed:          '../images/items/item_suspicious_shed.png',
};

// my_item_collection 뷰 결과 (quantity > 0). [{ code, name, description, image_url, image_path, quantity, category, ... }]
let _bagItems = [];
// code -> { is_sellable, is_transferable, sell_price }  (public.items 직접 조회 — 뷰에는 없는 컬럼)
let _bagItemFlags = {};
// code -> 개당 판매가(연구기록). 표시용 — 실제 판매가/차감은 서버 sell_item RPC 가 다시 계산한다.
//   items.sell_price 있으면 그 값, 없으면 활성 research_records 상점가 × 20% 를 5단위 반올림.
let _bagSellPrice = {};
// code -> 획득처 텍스트. item_dogam_links.source_note (= 아이템 대장 source 값) 그대로. 없으면 미설정.
let _bagAcqByCode = {};
// code -> item_dogam_links.dogam_category (예: trait_pod/trait_cartridge/trait_ink/trait_subject/lab_supplies).
//   섹션 내부 세부 정렬(모듈끼리/카트리지끼리/Ink끼리 등)의 그룹 키로 쓴다.
let _bagDogamCategoryByCode = {};
// code -> [부모 소분류 sort_order(없으면 자기 sort_order), 자기 sort_order]. bagGroupRank() 참고.
let _bagGroupRankByCode = {};

const BAG_SELL_RATE = 0.2;   // 판매가 = 상점가 × 20% (서버 정책과 동일, 표시용)

// 상점가 → 개당 판매가 (서버 sell_item 의 자동 계산식과 동일: 20% 를 5단위 반올림)
function bagCalcSellPrice(basePrice) {
  return Math.round(basePrice * BAG_SELL_RATE / 5) * 5;
}

// 유저 검색 결과 아바타 — 프로필 이미지 없는 유저의 단색 원형 배경색.
// seed(user_id) 로 팔레트 중 하나를 항상 동일하게 선택(새로고침해도 같은 색). 파스텔/중성 톤만.
const BAG_AVATAR_COLORS = [
  '#E7DDF1', '#DCE7F2', '#DBF0E5', '#F1EBDA', '#F2DEDC',
  '#E3E0D8', '#DDE7F3', '#EAF1DB', '#F1E4D6', '#DEEDEE',
];
function bagAvatarColor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return BAG_AVATAR_COLORS[Math.abs(h) % BAG_AVATAR_COLORS.length];
}

function bagSectionOf(row) {
  if (BAG_SECTION_BY_CODE[row.code]) return BAG_SECTION_BY_CODE[row.code];
  if (row.category === 'material')   return 'exploration';
  if (row.category === 'consumable') return 'trait';
  return 'etc';
}

// 섹션 내부 세부 정렬 키 — item_dogam_categories.sort_order 기반([부모 순서, 자기 순서]).
//   소분류 정보가 없는 아이템(매핑 누락)은 맨 뒤로 보낸다. 값이 같으면 Array.sort 의 안정 정렬 특성상
//   my_item_collection 이 이미 반환한 순서(items.sort_order 오름차순)가 그대로 유지된다.
function bagGroupRank(code) {
  return _bagGroupRankByCode[code] || [Infinity, Infinity];
}

// 이미지: items.image_url → image_path → code 폴백 → placeholder
function resolveBagItemImage(row) {
  if (row.image_url)  return row.image_url;
  if (row.image_path) return row.image_path;   // 스토리지 경로 그대로 (현재 사용처 없음)
  return BAG_ITEM_IMG_FALLBACK[row.code] || null;
}

// 카드(썸네일) 전용: 이름이 길어 박스가 커지는 걸 막기 위해 정해진 위치에서 줄바꿈
// (상점 shop.js의 formatShopNameThumb와 동일 규칙 — 상세 모달에는 적용하지 않음)
function formatBagNameThumb(name) {
  return name
    .replace(/^(분양 끌올 티켓) /, '$1<br>')
    .replace(/^(메어나이트\d?)\(Marenight\)$/, '$1<br>(Marenight)')
    .replace(/^(옥토몬스터)\(Octomonster\)$/, '$1<br>(Octomonster)')
    .replace(/^(쁘띠아라크네)\(Petit Arachne\)$/, '$1<br>(Petit Arachne)');
}

// ── 초기화 ──────────────────────────────────────────────
async function initPage() {
  try {
    _user = await getUser();
    if (!_user) { window.location.href = 'login.html'; return; }

    await Promise.all([loadData(), loadBagItems()]);
    renderBag();

    document.getElementById('bagTabRow').addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      document.querySelectorAll('#bagTabRow .shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab = btn.dataset.tab;
      renderBag();
    });

    // 아이템 전송 — 유저 검색 입력(자동 검색) + 바깥 클릭 시 드롭다운 닫기
    const transferInput = document.getElementById('bagTransferUserInput');
    if (transferInput) {
      transferInput.addEventListener('input', () => _bagUserSearchDebounced());
      transferInput.addEventListener('focus', () => {
        if ((transferInput.value || '').trim().length >= 1) _bagUserSearchDebounced();
      });
    }
    document.addEventListener('click', (e) => {
      const wrap = document.querySelector('.bag-usersearch');
      const dd   = document.getElementById('bagTransferUserDropdown');
      if (dd && !dd.hidden && wrap && !wrap.contains(e.target)) { dd.hidden = true; }
    });


    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[my-bag] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

async function loadData() {
  console.log('[my-bag] loadData 시작, user.id =', _user.id);

  const [userItemsRes, equipRes] = await Promise.all([
    sb.from('user_items')
      .select('item_id, purchased_at, item_key, quantity')
      .eq('user_id', _user.id),
    sb.from('user_equipment')
      .select('equipped_frame_id, equipped_sticker_id')
      .eq('user_id', _user.id)
      .maybeSingle(),
  ]);

  console.log('[my-bag] user_items 조회 결과:', userItemsRes.data, '에러:', userItemsRes.error);

  _equippedFrameId   = equipRes.data?.equipped_frame_id   ?? null;
  _equippedStickerId = equipRes.data?.equipped_sticker_id ?? null;

  const userItems = userItemsRes.data || [];
  _itemsByType = {};
  if (!userItems.length) {
    console.log('[my-bag] 보유 아이템 없음 → 종료');
    return;
  }

  const itemIds = userItems.map(r => r.item_id);
  console.log('[my-bag] item_id 목록:', itemIds);

  const { data: shopItemsData, error: shopErr } = await sb.from('shop_items')
    .select('id, name, description, item_type, style_key, image_url, sub_category, sort_order, credit, species_link_id')
    .in('id', itemIds)
    .order('sort_order', { ascending: true })
    .order('created_at',  { ascending: true });

  console.log('[my-bag] shop_items 조회 결과:', shopItemsData, '에러:', shopErr);

  const userItemMap = {};
  userItems.forEach(row => { userItemMap[row.item_id] = row; });

  // _itemsByType = { type: { sub_category: [items] } }
  // shopItemsData가 sort_order 순으로 정렬되어 있으므로 이 순서를 그대로 따라가면
  // 상점 페이지와 동일한 카테고리/아이템 순서가 됨 (구매 순서에 의존하지 않음)
  (shopItemsData || []).forEach(item => {
    const row = userItemMap[item.id];
    if (!row) return;
    const type = item.item_type || 'etc';
    const sub  = item.sub_category || '기본';
    if (!_itemsByType[type])      _itemsByType[type] = {};
    if (!_itemsByType[type][sub]) _itemsByType[type][sub] = [];
    _itemsByType[type][sub].push({ ...item, quantity: row.quantity, item_key: row.item_key });
  });
}

// ── 아이템 탭용: 실제 보유 아이템 (my_item_collection, quantity > 0) ──
async function loadBagItems() {
  _bagItems = [];
  _bagItemFlags = {};
  _bagSellPrice = {};
  _bagAcqByCode = {};
  _bagDogamCategoryByCode = {};
  _bagGroupRankByCode = {};
  try {
    const { data, error } = await sb
      .from('my_item_collection')
      .select('item_id, code, name, description, category, rarity, image_url, image_path, quantity')
      .gt('quantity', 0)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    // 뷰가 이미 is_hidden=false 만 반환하지만, 테스트 아이템(code prefix test_)은 방어적으로 한 번 더 제외
    _bagItems = (data || []).filter(r => !/^test_/.test(r.code || ''));
  } catch (e) {
    console.warn('[my-bag] my_item_collection 조회 실패:', e.message || e);
  }

  const codes = _bagItems.map(r => r.code).filter(Boolean);
  if (!codes.length) return;

  // 판매/전송 가능 여부 + 수동 판매가 — my_item_collection 뷰에 없는 컬럼이라 items 를 직접 조회 (RLS: is_hidden=false 공개)
  try {
    const { data, error } = await sb
      .from('items')
      .select('code, is_sellable, is_transferable, sell_price')
      .in('code', codes);
    if (error) throw error;
    (data || []).forEach(r => {
      _bagItemFlags[r.code] = { is_sellable: r.is_sellable, is_transferable: r.is_transferable, sell_price: r.sell_price };
      if (r.sell_price != null) _bagSellPrice[r.code] = r.sell_price;   // 수동가 우선
    });
  } catch (e) {
    console.warn('[my-bag] items 플래그 조회 실패:', e.message || e);
  }

  // 표시용 판매가(수동가 없는 아이템) — 활성 research_records 상점가 중 최저가 → 20% 5단위 반올림
  try {
    const { data, error } = await sb
      .from('shop_listing_view')
      .select('item_code, currency, price, is_active')
      .eq('currency', 'research_records')
      .eq('is_active', true)
      .in('item_code', codes);
    if (error) throw error;
    const baseByCode = {};
    (data || []).forEach(r => {
      if (r.price == null) return;
      baseByCode[r.item_code] = (baseByCode[r.item_code] == null) ? r.price : Math.min(baseByCode[r.item_code], r.price);
    });
    Object.keys(baseByCode).forEach(code => {
      if (_bagSellPrice[code] == null) _bagSellPrice[code] = bagCalcSellPrice(baseByCode[code]);
    });
  } catch (e) {
    console.warn('[my-bag] 상점가 조회 실패:', e.message || e);
  }

  // 획득처 — item_dogam_links.source_note (= 아이템 대장 source 값) 를 그대로 사용.
  //   아이템 도감(js/item-collection.js)이 읽는 것과 동일한 링크 데이터. RLS 공개 테이블이라
  //   my_item_collection 뷰 버전(=마이그레이션 적용 여부)과 무관하게 직접 조회한다.
  //   조합/가공하지 않고 source_note 텍스트만 표시(획득처 미확정이면 미설정 → "-").
  //   dogam_category 도 같은 조회에서 함께 받아 섹션 내부 세부 정렬(bagGroupRank)에 사용한다.
  try {
    const ids = _bagItems.map(r => r.item_id).filter(Boolean);
    if (ids.length) {
      const { data, error } = await sb
        .from('item_dogam_links')
        .select('item_id, source_note, dogam_category, sort_order')
        .in('item_id', ids)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const byId = {};
      const catById = {};
      (data || []).forEach(r => {
        if (r.source_note && byId[r.item_id] == null) byId[r.item_id] = r.source_note;
        if (r.dogam_category && catById[r.item_id] == null) catById[r.item_id] = r.dogam_category;
      });
      _bagItems.forEach(r => {
        if (byId[r.item_id]) _bagAcqByCode[r.code] = byId[r.item_id];
        if (catById[r.item_id]) _bagDogamCategoryByCode[r.code] = catById[r.item_id];
      });
    }
  } catch (e) {
    console.warn('[my-bag] 획득처(item_dogam_links) 조회 실패:', e.message || e);
  }

  // 세부 종류(도감 소분류) 그룹 순서 — item_dogam_categories.sort_order 를 그대로 재사용.
  //   부모 카테고리가 있으면 "부모 순서 → 자기 순서"로 (아이템 도감 뷰의 정렬 규칙과 동일).
  //   신규 소분류가 늘어나도 이 테이블에만 값이 생기면 자동으로 반영된다(가방 코드 수정 불필요).
  try {
    const cats = Object.values(_bagDogamCategoryByCode);
    if (cats.length) {
      const { data, error } = await sb
        .from('item_dogam_categories')
        .select('code, sort_order, parent_code');
      if (error) throw error;
      const byCode = {};
      (data || []).forEach(c => { byCode[c.code] = c; });
      Object.keys(_bagDogamCategoryByCode).forEach(code => {
        const c = byCode[_bagDogamCategoryByCode[code]];
        if (!c) return;
        const parent = c.parent_code ? byCode[c.parent_code] : null;
        _bagGroupRankByCode[code] = [parent ? parent.sort_order : c.sort_order, c.sort_order];
      });
    }
  } catch (e) {
    console.warn('[my-bag] 도감 소분류(item_dogam_categories) 조회 실패:', e.message || e);
  }
}

// 아이템이 판매 가능한 상태인지 — 서버 정책(fail-closed)과 동일: is_sellable === true + 계산된 판매가(>0) 존재
function bagCanSell(code) {
  const f = _bagItemFlags[code];
  return !!(f && f.is_sellable === true && _bagSellPrice[code] > 0);
}
// 전송 가능 여부 — 서버와 동일: is_transferable === true (NULL/false 모두 불가)
function bagCanTransfer(code) {
  const f = _bagItemFlags[code];
  return !!(f && f.is_transferable === true);
}

// ── 착용 프레임 미리보기 렌더 ────────────────────────────
function renderEquippedPreview() {
  const el = document.getElementById('equippedPreview');
  if (!el) return;

  // 아이템 탭에서는 프레임/스티커 미리보기 대신 안내 문구만 표시
  // (탭 전환 시 화면 출렁임을 막기 위해 .bag-ep-section 틀 자체는 그대로 유지)
  if (_activeTab === 'item') {
    el.innerHTML = `
      <div class="bag-ep-section">
        <h2 class="bag-section-title">미리보기</h2>
        <p class="bag-ep-item-notice">아이템은 미리보기에 적용되지 않습니다.</p>
      </div>`;
    return;
  }

  const frames        = Object.values(_itemsByType['frame']   || {}).flat();
  const stickers      = Object.values(_itemsByType['sticker'] || {}).flat();
  const equippedFrame   = _equippedFrameId   ? frames.find(f => f.id === _equippedFrameId)   : null;
  const equippedSticker = _equippedStickerId ? stickers.find(s => s.id === _equippedStickerId) : null;

  if (!equippedFrame && !equippedSticker) {
    el.innerHTML = `
      <div class="bag-ep-section">
        <h2 class="bag-section-title">미리보기</h2>
        <p class="bag-ep-none">착용 중인 아이템이 없습니다</p>
      </div>`;
    return;
  }

  const avatarUrl   = _user?.user_metadata?.avatar_url || '';
  const avatarStyle = avatarUrl
    ? `background-image:url('${avatarUrl}');background-size:cover;background-position:center;`
    : '';
  const frameCss = equippedFrame ? (equippedFrame.style_key || '') : '';

  const stickerOverlay = equippedSticker
    ? `<img id="bagEpStickerImg" src="${equippedSticker.image_url}" alt="${equippedSticker.name}"
           style="grid-area:1/1; width:0; height:0; object-fit:contain; z-index:3; pointer-events:none;">`
    : '';

  const leftHtml = equippedFrame
    ? `<div class="bag-ep-side bag-ep-side--left">
        <span class="bag-ep-item-label">프레임</span>
        <p class="bag-ep-name">${equippedFrame.name}</p>
        <button class="bag-unequip-btn" onclick="unequipFrame()">해제하기</button>
      </div>`
    : `<div class="bag-ep-side bag-ep-side--left"></div>`;

  const rightHtml = equippedSticker
    ? `<div class="bag-ep-side bag-ep-side--right">
        <span class="bag-ep-item-label">스티커</span>
        <p class="bag-ep-name">${equippedSticker.name}</p>
        <button class="bag-unequip-btn" onclick="unequipSticker()">해제하기</button>
      </div>`
    : `<div class="bag-ep-side bag-ep-side--right"></div>`;

  el.innerHTML = `
    <div class="bag-ep-section">
      <h2 class="bag-section-title">미리보기</h2>
      <div class="bag-ep-tricolumn">
        ${leftHtml}
        <div class="bag-ep-preview-center" style="display:grid; place-items:center; flex-shrink:0; line-height:0;">
          <div class="bag-ep-preview-wrap ${frameCss}" style="grid-area:1/1;">
            <div class="bag-ep-avatar" style="${avatarStyle}"></div>
          </div>
          ${stickerOverlay}
        </div>
        ${rightHtml}
      </div>
    </div>`;

  // 렌더 후 실제 아바타 크기 측정 → 프로필과 동일한 비율(116/96) 적용
  if (equippedSticker) {
    requestAnimationFrame(() => {
      const wrap = el.querySelector('.bag-ep-preview-wrap');
      const img  = document.getElementById('bagEpStickerImg');
      if (!wrap || !img) return;
      const avatarPx  = wrap.clientWidth;
      const stickerPx = Math.round(avatarPx * 116 / 96);
      img.style.width  = stickerPx + 'px';
      img.style.height = stickerPx + 'px';
    });
  }
}

// ── 가방 렌더 ────────────────────────────────────────────
function renderBag() {
  renderEquippedPreview();

  // "전송 로그" 버튼은 아이템 탭에서만 노출
  const toolbar = document.getElementById('bagItemToolbar');
  if (toolbar) toolbar.hidden = (_activeTab !== 'item');

  // 아이템 탭 = 세로형 섹션 (티켓 / MYO / 탐험물 / 특성 아이템)
  if (_activeTab === 'item') {
    renderItemSections();
    return;
  }

  // 꾸미기 탭 = 기존 로직 그대로 (consumable 제외한 모든 타입)
  const wrap = document.getElementById('bagSections');
  const itemTabTypes = TAB_ITEM_TYPES.item;
  const types = Object.keys(_itemsByType).filter(t => !itemTabTypes.includes(t));

  if (!types.length) {
    wrap.innerHTML = `<p class="empty-state" style="padding:60px 0; text-align:center;">보유한 꾸미기 아이템이 없어요.<br><a href="shop.html" style="color:var(--sky-dark); font-weight:700;">상점 바로가기</a></p>`;
    return;
  }

  wrap.innerHTML = types.map(type => {
    const subs      = _itemsByType[type];
    const label     = TYPE_LABEL[type] || type;
    const subEntries = Object.entries(subs);
    // sub_category가 기본값('기본')뿐이면 굳이 소제목을 안 띄우고, 의미 있는 이름(예: '티켓')이면 하나뿐이어도 표시
    const multiSub  = subEntries.length > 1 || subEntries[0]?.[0] !== '기본';

    return `
      <div class="bag-section">
        <h2 class="bag-section-title">${label}</h2>
        ${subEntries.map(([subLabel, items], i) => `
          <div class="${i > 0 ? 'bag-subsection-gap' : ''}">
            ${multiSub ? `<h3 class="bag-subsection-title">${subLabel}</h3>` : ''}
            <div class="bag-grid">
              ${items.map(item => renderBagItem(item, type)).join('')}
            </div>
          </div>
        `).join('')}
      </div>`;
  }).join('');
}

// ── 아이템 탭: 세로형 섹션 렌더 ──────────────────────────
// 티켓(기존 시스템) → MYO → 탐험물 → 특성 아이템 → 기타 순.
// MYO 이후는 전부 my_item_collection (quantity > 0) 실데이터. 아이템 없는 섹션은 렌더 안 함.
function renderItemSections() {
  const wrap = document.getElementById('bagSections');
  const sections = [];

  // 1) 티켓 — 기존 실제 데이터/렌더/기능 그대로 (renderBagItem 재사용 → 상세 모달·사용 링크 유지)
  const tickets = Object.values(_itemsByType['consumable'] || {}).flat();
  if (tickets.length) {
    sections.push(`
      <div class="bag-section">
        <h2 class="bag-section-title">티켓</h2>
        <div class="bag-grid">${tickets.map(it => renderBagItem(it, 'consumable')).join('')}</div>
      </div>`);
  }

  // 2) MYO / 특성 아이템 / 탐험물 / 기타 — my_item_collection 실데이터
  const bySection = {};
  _bagItems.forEach(row => {
    const sec = bagSectionOf(row);
    (bySection[sec] = bySection[sec] || []).push(row);
  });
  BAG_SECTION_ORDER.forEach(({ key, label }) => {
    if (key === 'ticket') return;
    const rows = bySection[key];
    if (!rows || !rows.length) return;
    rows.sort((a, b) => {
      const ra = bagGroupRank(a.code), rb = bagGroupRank(b.code);
      return ra[0] - rb[0] || ra[1] - rb[1];
    });
    sections.push(`
      <div class="bag-section">
        <h2 class="bag-section-title">${label}</h2>
        <div class="bag-grid">${rows.map(renderDbItemCard).join('')}</div>
      </div>`);
  });

  wrap.innerHTML = sections.length
    ? sections.join('')
    : `<p class="empty-state" style="padding:60px 0; text-align:center;">보유한 아이템이 없어요.<br><a href="shop.html" style="color:var(--sky-dark); font-weight:700;">상점 바로가기</a></p>`;
}

// 아이템 탭 카드 (my_item_collection row). 이미지 없으면 placeholder — .bag-item-preview(정사각)로 크기 통일.
// 클릭 시 공통 상세 모달(openBagItemInfo).
function renderDbItemCard(row) {
  const img = resolveBagItemImage(row);
  const preview = img
    ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(row.name)}" class="bag-item-img" loading="lazy">`
    : `<span class="bag-item-ph" aria-hidden="true">📦</span>`;
  return `
    <div class="bag-item-card" onclick="openBagItemInfo('${escapeHtml(row.code)}')">
      <div class="bag-item-preview">${preview}</div>
      <p class="bag-item-name">${escapeHtml(row.name)}</p>
      <div class="bag-item-action"><span class="shop-thumb-status shop-status--owned">×${row.quantity}</span></div>
    </div>`;
}

// ── 일반 아이템 공통 상세 모달 (아이템 탭) ──
//   상단: 이름/설명 → 판매 가격/획득처 → 보유 수량 + [판매하기]
//   하단 별도 영역: 아이템 전송 (유저 검색 + 수량 + 전송하기)  /  전송 불가 아이템이면 "전송 불가 아이템"만
//   실제 수량/재화 변경은 전부 서버 RPC(sell_item / transfer_item). 프론트는 표시·확인만.
let _bagInfoCode      = null;   // 현재 모달에 열린 아이템 code
let _bagTransferQty   = 1;
let _bagTransferUser  = null;   // { id, nickname } — 선택된 전송 대상 (id = user_id uuid)
let _bagActionBusy    = false;
let _bagUserSearchSeq = 0;
let _bagUserResults   = [];     // 현재 드롭다운에 표시 중인 유저 검색 결과 (인덱스로 선택)

function openBagItemInfo(code) {
  const row = _bagItems.find(x => x.code === code);
  if (!row) return;
  _bagInfoCode     = code;
  _bagTransferQty  = 1;
  _bagTransferUser = null;

  const img = resolveBagItemImage(row);
  document.getElementById('bagItemInfoPreview').innerHTML = img
    ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(row.name)}" style="width:100%;height:100%;object-fit:contain;">`
    : '';
  document.getElementById('bagItemInfoName').textContent = row.name;

  // items 마스터에 크레딧 컬럼 없음 → Design by 라인 숨김
  const creditEl = document.getElementById('bagItemInfoCredit');
  creditEl.textContent  = '';
  creditEl.style.display = 'none';

  document.getElementById('bagItemInfoDesc').textContent = row.description || '';

  // 판매 가격 — 표시용(서버가 최종 계산). 판매 불가면 "판매 불가".
  const priceEl = document.getElementById('bagItemInfoPrice');
  priceEl.textContent = bagCanSell(code)
    ? `${_bagSellPrice[code].toLocaleString()} 연구기록`
    : '판매 불가';

  // 획득처 — 아이템 대장(item_dogam_links.source_note) 값 그대로. 없으면 "-".
  document.getElementById('bagItemInfoAcq').textContent = _bagAcqByCode[code] || '-';

  // 보유 수량 + 판매하기
  document.getElementById('bagItemInfoQty').textContent = `보유 ${row.quantity}개`;
  const sellActionEl = document.getElementById('bagItemInfoAction');
  if (bagCanSell(code)) {
    sellActionEl.innerHTML =
      `<button type="button" class="shop-buy-btn-lg" id="bagItemSellBtn" onclick="onBagItemSell()">판매하기</button>`;
  } else {
    sellActionEl.innerHTML = `<span class="shop-detail-status shop-status--coming">판매 불가</span>`;
  }

  // ── 전송 영역 ──
  const blockedEl = document.getElementById('bagTransferBlocked');
  const formEl    = document.getElementById('bagTransferForm');
  if (bagCanTransfer(code)) {
    blockedEl.hidden = true;
    formEl.hidden    = false;
    // 폼 초기화
    const input = document.getElementById('bagTransferUserInput');
    input.value = '';
    document.getElementById('bagTransferUserDropdown').hidden = true;
    document.getElementById('bagTransferUserDropdown').innerHTML = '';
    document.getElementById('bagTransferPicked').hidden = true;
    bagRenderTransferQty();
    bagSyncTransferBtn();
  } else {
    blockedEl.hidden = false;
    formEl.hidden    = true;
  }

  document.getElementById('bagItemInfoModal').style.display = 'flex';
}

function closeBagItemInfo() {
  document.getElementById('bagItemInfoModal').style.display = 'none';
  _bagInfoCode = null;
  _bagTransferUser = null;
}

// ── 판매 ───────────────────────────────────────────────
function onBagItemSell() {
  if (_bagActionBusy) return;
  const code = _bagInfoCode;
  const row = _bagItems.find(x => x.code === code);
  if (!row || !bagCanSell(code)) return;

  const unit = _bagSellPrice[code];
  bagOpenConfirm({
    title: '아이템 판매',
    desc: `${row.name}을(를) 판매하시겠습니까?\n판매 시 ${unit.toLocaleString()} 연구기록을 획득합니다.`,
    okLabel: '판매하기',
    onProceed: async () => {
      const { data, error } = await sb.rpc('sell_item', { p_item_code: code, p_quantity: 1 });
      if (error || !data || data.success !== true) {
        alert(bagRpcErrorMsg(data && data.error, '판매'));
        return false;
      }
      await refreshAfterBagAction();
      alert(`${row.name}을(를) 판매하고 ${Number(data.total).toLocaleString()} 연구기록을 받았습니다.`);
      return true;
    },
  });
}

// ── 전송: 유저 검색 ────────────────────────────────────
const _bagUserSearchDebounced = (typeof debounce === 'function')
  ? debounce(bagRunUserSearch, 300)
  : bagRunUserSearch;

async function bagRunUserSearch() {
  const input = document.getElementById('bagTransferUserInput');
  const dd    = document.getElementById('bagTransferUserDropdown');
  const q     = (input.value || '').trim();
  const seq   = ++_bagUserSearchSeq;

  if (q.length < 1) { dd.hidden = true; dd.innerHTML = ''; return; }
  if (typeof searchUsers !== 'function') { dd.hidden = true; return; }

  const { data } = await searchUsers(q, { limit: 8 });
  if (seq !== _bagUserSearchSeq) return;   // 오래된 응답 무시

  _bagUserResults = (data || []).filter(u => u.id && u.id !== (_user && _user.id));
  if (!_bagUserResults.length) {
    dd.innerHTML = `<p class="bag-usersearch-empty">검색 결과가 없어요.</p>`;
    dd.hidden = false;
    return;
  }

  dd.innerHTML = _bagUserResults.map((u, i) => {
    const nick = u.nickname || u.login_id || '이름 없음';
    // 프로필 이미지 없으면 이모지/문자 없이 단색 원형만 (user_id 기반 고정 파스텔색)
    const av = u.avatar_url
      ? `<img src="${escapeHtml(u.avatar_url)}" alt="" class="bag-usersearch-avatar">`
      : `<span class="bag-usersearch-avatar bag-usersearch-avatar--ph" style="background:${bagAvatarColor(u.id)}" aria-hidden="true"></span>`;
    const sub = u.login_id && u.login_id !== nick ? `<span class="bag-usersearch-sub">@${escapeHtml(u.login_id)}</span>` : '';
    return `<button type="button" class="bag-usersearch-row" onclick="bagPickTransferUser(${i})">
              ${av}<span class="bag-usersearch-nick">${escapeHtml(nick)}</span>${sub}
            </button>`;
  }).join('');
  dd.hidden = false;
}

function bagPickTransferUser(idx) {
  const u = _bagUserResults[idx];
  if (!u || !u.id) return;
  const nickname = u.nickname || u.login_id || '이름 없음';
  _bagTransferUser = { id: u.id, nickname };
  document.getElementById('bagTransferUserInput').value = '';
  const dd = document.getElementById('bagTransferUserDropdown');
  dd.hidden = true; dd.innerHTML = '';
  const picked = document.getElementById('bagTransferPicked');
  document.getElementById('bagTransferPickedName').textContent = `받는 사람: ${nickname}`;
  picked.hidden = false;
  bagSyncTransferBtn();
}

function bagTransferClearUser() {
  _bagTransferUser = null;
  document.getElementById('bagTransferPicked').hidden = true;
  bagSyncTransferBtn();
}

// ── 전송: 수량 ─────────────────────────────────────────
function bagTransferMax() {
  const row = _bagItems.find(x => x.code === _bagInfoCode);
  return row ? (row.quantity || 0) : 0;
}

function bagRenderTransferQty() {
  const max = bagTransferMax();
  _bagTransferQty = Math.min(Math.max(1, _bagTransferQty), Math.max(1, max));
  const row = document.getElementById('bagTransferQtyRow');
  // 보유 1개면 수량 UI 숨김(항상 1개 전송)
  row.hidden = max <= 1;
  document.getElementById('bagTransferQtyValue').textContent = String(_bagTransferQty);
}

function bagTransferQtyStep(delta) {
  const max = bagTransferMax();
  _bagTransferQty = Math.min(Math.max(1, _bagTransferQty + delta), Math.max(1, max));
  document.getElementById('bagTransferQtyValue').textContent = String(_bagTransferQty);
}

function bagSyncTransferBtn() {
  const btn = document.getElementById('bagTransferBtn');
  if (!btn) return;
  btn.disabled = !_bagTransferUser || _bagActionBusy || bagTransferMax() < 1;
}

// ── 전송 실행 ──────────────────────────────────────────
function onBagItemTransfer() {
  if (_bagActionBusy) return;
  const code = _bagInfoCode;
  const row = _bagItems.find(x => x.code === code);
  if (!row || !bagCanTransfer(code) || !_bagTransferUser) return;

  const max = bagTransferMax();
  const qty = max <= 1 ? 1 : _bagTransferQty;
  if (qty < 1 || qty > max) return;

  bagOpenConfirm({
    title: '아이템 전송',
    desc: `${_bagTransferUser.nickname}님에게\n${row.name} ${qty}개를 전송하시겠습니까?\n전송한 아이템은 되돌릴 수 없습니다.`,
    okLabel: '전송하기',
    onProceed: async () => {
      const { data, error } = await sb.rpc('transfer_item', {
        p_item_code: code,
        p_receiver_user_id: _bagTransferUser.id,
        p_quantity: qty,
      });
      if (error || !data || data.success !== true) {
        alert(bagRpcErrorMsg(data && data.error, '전송'));
        return false;
      }
      const toNick = data.receiver_nickname || _bagTransferUser.nickname;
      await refreshAfterBagAction();
      alert(`${toNick}님에게 ${row.name} ${qty}개를 전송했습니다.`);
      return true;
    },
  });
}

// ── 판매/전송 후 상태 새로고침 ─────────────────────────
async function refreshAfterBagAction() {
  await loadBagItems();
  renderBag();
  if (typeof updateSidebarLogin === 'function') updateSidebarLogin();   // 지갑 잔액 갱신
  // 모달이 열려 있으면: 아이템이 남아 있으면 다시 그리고, 없으면 닫는다
  const stillOpen = document.getElementById('bagItemInfoModal').style.display === 'flex';
  if (stillOpen) {
    if (_bagInfoCode && _bagItems.some(x => x.code === _bagInfoCode)) openBagItemInfo(_bagInfoCode);
    else closeBagItemInfo();
  }
}

// ── 공용 확인 모달 ─────────────────────────────────────
let _bagConfirmFn = null;

function bagOpenConfirm({ title, desc, okLabel, onProceed }) {
  _bagConfirmFn = onProceed;
  document.getElementById('bagConfirmTitle').textContent = title;
  document.getElementById('bagConfirmDesc').textContent  = desc;
  const okBtn = document.getElementById('bagConfirmOkBtn');
  okBtn.textContent = okLabel || '확인';
  okBtn.disabled = false;
  document.getElementById('bagConfirmModal').style.display = 'flex';
}

function bagCloseConfirm() {
  document.getElementById('bagConfirmModal').style.display = 'none';
  _bagConfirmFn = null;
  _bagActionBusy = false;
  bagSyncTransferBtn();
}

async function bagConfirmProceed() {
  if (_bagActionBusy || typeof _bagConfirmFn !== 'function') return;
  _bagActionBusy = true;
  const okBtn = document.getElementById('bagConfirmOkBtn');
  const okLabel = okBtn.textContent;
  okBtn.disabled = true;
  okBtn.textContent = '처리 중...';
  bagSyncTransferBtn();

  let done = false;
  try {
    done = await _bagConfirmFn();
  } catch (e) {
    console.error('[my-bag] 확인 처리 오류:', e);
    alert('처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  } finally {
    _bagActionBusy = false;
    if (done) {
      bagCloseConfirm();
    } else {
      okBtn.disabled = false;
      okBtn.textContent = okLabel;
      bagSyncTransferBtn();
    }
  }
}

// RPC 에러코드 → 사용자 문구
function bagRpcErrorMsg(code, action) {
  const M = {
    NOT_AUTHENTICATED:    '로그인이 필요합니다.',
    INVALID_QUANTITY:     '수량이 올바르지 않습니다.',
    INVALID_ARGS:         '잘못된 요청입니다.',
    ITEM_NOT_FOUND:       '존재하지 않는 아이템입니다.',
    NOT_SELLABLE:         '판매할 수 없는 아이템입니다.',
    NOT_TRANSFERABLE:     '전송할 수 없는 아이템입니다.',
    INSUFFICIENT_QUANTITY:'보유 수량이 부족합니다.',
    SELF_TRANSFER:        '본인에게는 전송할 수 없습니다.',
    RECEIVER_NOT_FOUND:   '받는 유저를 찾을 수 없습니다.',
    WALLET_NOT_FOUND:     '지갑 정보를 찾을 수 없습니다.',
  };
  return M[code] || `${action} 중 오류가 발생했습니다.${code ? `\n[${code}]` : ''}`;
}
// 전송 내역은 별도 페이지(pages/item-transfer-history.html + js/item-transfer-history.js)로 이동함.
// 조회 RPC(get_my_item_transfer_logs)는 그대로 두고, 여기 있던 모달 렌더 로직만 제거.

// 가방은 구매 상품(SKU)이 아니라 실제 보유 수량 기준으로 표시 — 묶음 이름/이미지로
// 오해(예: "5장 묶음 / 보유 3장" → 15장으로 착각)하지 않도록 통일된 이름/이미지로 덮어씀
function getTicketBumpDisplay(quantity) {
  const qty = quantity ?? 0;
  const image_url = qty >= 10
    ? '../images/shop/ticket_bump_3.png'
    : qty >= 5
      ? '../images/shop/ticket_bump_2.png'
      : '../images/shop/ticket_bump_1.png';
  return { name: '분양 끌올 티켓', image_url };
}

// ── 아이템 카드 렌더 (상점과 동일한 크기/구조) ──────────────
function renderBagItem(item, type) {
  if (type === 'consumable' && item.item_key === 'ticket-bump') {
    item = { ...item, ...getTicketBumpDisplay(item.quantity) };
  }

  const styleKey   = item.style_key || '';
  const cssClass   = styleKey;
  const isEquipped = type === 'frame'
    ? item.id === _equippedFrameId
    : type === 'sticker'
      ? item.id === _equippedStickerId
      : false;

  const previewHtml = cssClass && type !== 'sticker'
    ? `<div class="frame-preview ${cssClass}"></div>`
    : item.image_url
      ? `<img src="${item.image_url}" alt="${item.name}"${type === 'sticker' ? ' class="shop-sticker-img"' : ''}>`
      : '';

  const badgeHtml = isEquipped
    ? `<span class="shop-thumb-badge shop-badge--owned shop-badge--right">착용중</span>`
    : '';

  let actionHtml;
  if (type === 'frame') {
    actionHtml = isEquipped
      ? `<span class="shop-thumb-status shop-status--owned">착용중</span>`
      : `<button class="bag-equip-btn-sm" data-item-id="${item.id}" onclick="event.stopPropagation(); equipFrame('${item.id}')">착용하기</button>`;
  } else if (type === 'sticker') {
    actionHtml = isEquipped
      ? `<span class="shop-thumb-status shop-status--owned">착용중</span>`
      : `<button class="bag-equip-btn-sm" data-item-id="${item.id}" onclick="event.stopPropagation(); equipSticker('${item.id}')">착용하기</button>`;
  } else if (type === 'consumable') {
    actionHtml = `<span class="shop-thumb-status shop-status--owned">보유 ${item.quantity ?? 0}장</span>`;
  } else {
    actionHtml = `<span class="shop-thumb-status shop-status--owned">보유중</span>`;
  }

  // 카드 클릭 시 상세 모달 오픈 (착용 버튼 클릭은 stopPropagation으로 분리)
  const itemJson = JSON.stringify(item).replace(/'/g, "\\'");
  const clickAttr = ` onclick='openItemDetailModal(${itemJson})'`;

  return `
    <div class="bag-item-card${isEquipped ? ' bag-item-card--equipped' : ''}"${clickAttr}>
      <div class="bag-item-preview">
        ${badgeHtml}
        ${previewHtml}
      </div>
      <p class="bag-item-name">${formatBagNameThumb(item.name)}</p>
      <div class="bag-item-action">${actionHtml}</div>
    </div>`;
}

const TICKET_BUMP_CONDITION_HTML =
  '<strong>※ 사용 조건</strong><br>' +
  '내 분양글보다 최신 분양글이 20개 이상 등록되어 있을 때 사용할 수 있습니다.<br>' +
  '사용 시 해당 분양글이 분양 목록 최상단으로 이동합니다.';

// ── 아이템 상세 모달 (프레임/스티커/소모품 공통) ──
function openItemDetailModal(item) {
  const type = item.item_type;
  const isEquipped = type === 'frame'
    ? item.id === _equippedFrameId
    : type === 'sticker'
      ? item.id === _equippedStickerId
      : false;

  document.getElementById('bagDetailName').textContent = item.name;
  document.getElementById('bagDetailDesc').textContent = item.description || '';
  document.getElementById('bagDetailPreview').innerHTML = item.image_url
    ? `<img src="${item.image_url}" alt="${item.name}" style="width:100%;height:100%;object-fit:${type === 'sticker' ? 'contain' : 'cover'};">`
    : '';

  const creditEl = document.getElementById('bagDetailCredit');
  creditEl.textContent   = item.credit ? `Design by ${item.credit}` : '';
  creditEl.style.display = item.credit ? '' : 'none';

  const speciesLinkEl = document.getElementById('bagDetailSpeciesLink');
  if (item.species_link_id) {
    const speciesName = item.name.replace(/\d+(?=\()|\d+$/, '');
    speciesLinkEl.innerHTML = `<a class="shop-detail-species-link" href="species.html?id=${item.species_link_id}">${speciesName} ㅣ 종족주 : ${item.credit || ''}</a>`;
  } else {
    speciesLinkEl.innerHTML = '';
  }

  const conditionEl = document.getElementById('bagDetailCondition');
  if (item.item_key === 'ticket-bump') {
    conditionEl.innerHTML     = TICKET_BUMP_CONDITION_HTML;
    conditionEl.style.display = '';
  } else {
    conditionEl.style.display = 'none';
  }

  const qtyEl    = document.getElementById('bagDetailQty');
  const actionEl = document.getElementById('bagDetailAction');

  if (type === 'consumable') {
    qtyEl.style.display = '';
    qtyEl.textContent    = `보유 ${item.quantity ?? 0}장`;
    actionEl.innerHTML   = `<a href="my-adoptions.html" class="shop-buy-btn-lg">내 분양에서 사용하기</a>`;
  } else if (type === 'frame' || type === 'sticker') {
    qtyEl.style.display = 'none';
    qtyEl.textContent    = '';
    actionEl.innerHTML  = isEquipped
      ? `<span class="shop-detail-status shop-status--owned">착용중</span>`
      : `<button class="shop-buy-btn-lg" onclick="${type === 'frame' ? 'equipFrameFromModal' : 'equipStickerFromModal'}('${item.id}')">착용하기</button>`;
  } else {
    qtyEl.style.display = 'none';
    qtyEl.textContent    = '';
    actionEl.innerHTML   = `<span class="shop-detail-status shop-status--owned">보유중</span>`;
  }

  document.getElementById('bagDetailModal').style.display = 'flex';
}

function closeItemDetailModal() {
  document.getElementById('bagDetailModal').style.display = 'none';
}

// ── 프레임 해제 ──────────────────────────────────────────
async function unequipFrame() {
  document.querySelectorAll('.bag-unequip-btn').forEach(btn => {
    btn.disabled = true; btn.textContent = '처리 중...';
  });

  const { data, error } = await sb.rpc('unequip_frame');

  if (error || !data?.success) {
    if (btn) { btn.disabled = false; btn.textContent = '해제하기'; }
    alert('해제 중 오류가 발생했습니다.');
    return;
  }

  _equippedFrameId = null;
  renderBag();
}

// ── 프레임 장착 ──────────────────────────────────────────
async function equipFrame(itemId) {
  const btn = document.querySelector(`.bag-equip-btn-sm[data-item-id="${itemId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

  const { data, error } = await sb.rpc('equip_frame', { p_item_id: itemId });

  if (error || !data?.success) {
    if (btn) { btn.disabled = false; btn.textContent = '착용하기'; }
    console.error('[my-bag] equip_frame 오류:', error || data?.error);
    alert('장착 중 오류가 발생했습니다.');
    return;
  }

  _equippedFrameId = data.equipped_frame_id;
  renderBag();
}

// ── 프레임 장착 (상세 모달 전용) ──────────────────────────
async function equipFrameFromModal(itemId) {
  const { data, error } = await sb.rpc('equip_frame', { p_item_id: itemId });
  if (error || !data?.success) {
    alert('장착 중 오류가 발생했습니다.');
    return;
  }
  _equippedFrameId = data.equipped_frame_id;
  closeItemDetailModal();
  renderBag();
}

// ── 스티커 해제 ──────────────────────────────────────────
async function unequipSticker() {
  document.querySelectorAll('.bag-unequip-btn').forEach(btn => {
    btn.disabled = true; btn.textContent = '처리 중...';
  });

  const { data, error } = await sb.rpc('unequip_sticker');

  if (error || !data?.success) {
    document.querySelectorAll('.bag-unequip-btn').forEach(btn => {
      btn.disabled = false; btn.textContent = '해제하기';
    });
    alert('해제 중 오류가 발생했습니다.');
    return;
  }

  _equippedStickerId = null;
  renderBag();
}

// ── 스티커 장착 ──────────────────────────────────────────
async function equipSticker(itemId) {
  const btn = document.querySelector(`.bag-equip-btn-sm[data-item-id="${itemId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

  const { data, error } = await sb.rpc('equip_sticker', { p_item_id: itemId });

  if (error || !data?.success) {
    if (btn) { btn.disabled = false; btn.textContent = '착용하기'; }
    console.error('[my-bag] equip_sticker 오류:', error || data?.error);
    alert('장착 중 오류가 발생했습니다.');
    return;
  }

  _equippedStickerId = data.equipped_sticker_id;
  renderBag();
}

// ── 스티커 장착 (상세 모달 전용) ─────────────────────────
async function equipStickerFromModal(itemId) {
  const { data, error } = await sb.rpc('equip_sticker', { p_item_id: itemId });
  if (error || !data?.success) {
    alert('장착 중 오류가 발생했습니다.');
    return;
  }
  _equippedStickerId = data.equipped_sticker_id;
  closeItemDetailModal();
  renderBag();
}

initPage();
