// ── LABBER 상점 (labber-shop.html) ────────────────────────────────
// 수상한 연구실(js/labber.js)의 하단 등장 패널 + NPC 타이핑 구조를 그대로 재사용.
// 상품 카탈로그(이름/설명/등급/이미지/특성링크)는 아래 LABBER_SHOP_PRODUCTS 정적 배열,
// 가격/판매여부/구매제한은 DB(item_shop_listings → shop_listing_view), 구매는 서버 RPC(purchase_shop_item).
// 재화: research_records(연구기록) / keys(열쇠), 상품에 따라 두 재화를 동시에 사용(주+보조).
// 수량 선택/일괄구매 없음. purchase_limit 이 걸린 상품(래버 배양 시약)은 계정당 그 횟수까지만 구매 가능.

// NPC 대사 — 추후 변경 예정. 이 상수만 고치면 됨.
const LABBER_SHOP_NPC_LINE = '빨리빨리 사고 얼른 일하러 돌아가.';

// 소개 문구(2번째 문장 미확정) — 값이 있으면 이걸로 교체, 없으면 HTML 문구 유지.
const LABBER_SHOP_INTRO = null;

// 가격 null 표시 문구 (연구소 상점에는 null 가격이 없으므로 LABBER 상점 임시 표기)
const LABBER_SHOP_PRICE_TBD = '가격 미정';

// 재화 아이콘/라벨 — 연구소 상점(js/shop.js CURRENCY_ICON/CURRENCY_LABEL)과 동일한 마크업.
// (두 페이지가 JS 파일을 공유하지 않아 값만 복제. 출력 HTML(.shop-currency-icon img + 숫자)은 완전히 동일)
const LABBER_SHOP_CURRENCY_ICON = {
  research_records: '<img src="../images/icons/currency-record.png" class="shop-currency-icon" alt="연구기록">',
  keys:             '<img src="../images/icons/currency-key.png" class="shop-currency-icon" alt="열쇠">',
};
const LABBER_SHOP_CURRENCY_LABEL = { research_records: '연구기록', keys: '열쇠' };

// ── 실제 구매 연동 ──────────────────────────────────────────
// 가격/판매여부는 items 가 아니라 item_shop_listings(→ shop_listing_view) 에서 온다.
// 클라이언트는 구매 시 shop_code + listing_code(= 상품 code) 만 서버 RPC(purchase_shop_item)에 전달한다.
//   ※ RPC 파라미터명은 여전히 p_item_code 다(CREATE OR REPLACE FUNCTION 은 파라미터명을
//     바꿀 수 없어 시그니처를 그대로 유지 — supabase/labber_shop_culture_reagent_second_slot_0912.sql 참고).
//     넘기는 값의 의미만 "아이템 코드"에서 "listing_code(상품 슬롯 식별자)"로 바뀐 것.
const LABBER_SHOP_CODE = 'labber_shop';

const LABBER_SHOP_ERROR_MSG = {
  NOT_AUTHENTICATED:    '로그인이 필요합니다.',
  INVALID_ARGS:         '잘못된 요청입니다.',
  ITEM_NOT_FOUND:       '존재하지 않는 상품입니다.',
  LISTING_NOT_FOUND:    '판매 중인 상품이 아닙니다.',
  NOT_FOR_SALE:         '현재 판매 중이 아닙니다.',
  UNSUPPORTED_CURRENCY: '아직 구매할 수 없는 상품입니다.',
  PRICE_UNSET:          '가격이 정해지지 않은 상품입니다.',
  WALLET_NOT_FOUND:     '지갑 정보를 찾을 수 없습니다.',
  INSUFFICIENT_BALANCE: '재화가 부족합니다.',
  PURCHASE_LIMIT_REACHED: '이미 구매한 상품입니다. 계정당 1회만 구매할 수 있습니다.',
};

// INSUFFICIENT_BALANCE 는 서버가 부족한 재화(currency)를 함께 알려준다 → 재화별 메시지.
const LABBER_SHOP_INSUFFICIENT_MSG = {
  research_records: '연구기록이 부족합니다.',
  keys:             '열쇠가 부족합니다.',
};

// 한글 목적격 조사 (을/를)
function koObjParticle(word) {
  if (!word) return '를';
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xAC00 || c > 0xD7A3) return '를';        // 한글 아님
  return (c - 0xAC00) % 28 === 0 ? '를' : '을';     // 종성 없음 → 를
}

// code(= listing_code) -> { listing_id, price, currency, secondary_currency, secondary_price, purchase_limit, is_active }  (활성 listing만)
let _labberListingByCode = {};
// code -> 보유 수량 (현재 인벤토리). 같은 실제 아이템을 공유하는 상품(예: 래버 배양 시약 500)은 동일 수량을 공유한다.
let _labberOwnedByCode = {};
// code -> 누적 구매 횟수 (item_logs: type='shop_purchase', source='labber_shop', metadata.listing_id 로 이 상품 슬롯만 카운트) — 구매 제한 판정용
let _labberPurchasedByCode = {};
let _labberPurchaseBusy = false;

// 상품이 실제로 지급받는 아이템의 code. 대부분 p.code 와 동일하지만,
// "같은 아이템을 지급하는 서로 다른 상품 슬롯"(예: 래버 배양 시약 500)은 p.code(=listing_code)가
// 실제 items.code 와 달라진다 — 그런 상품만 itemCode 를 별도로 지정한다.
const labberShopItemCode = p => p.itemCode || p.code;

// p.name 은 카드/모달 제목에서 줄바꿈용 <br> 을 포함할 수 있다(예: 래버 배양 시약).
// alt 속성/구매 완료 alert 등 "일반 텍스트"가 필요한 곳은 <br> 을 공백으로 바꿔서 쓴다.
const labberShopPlainName = p => (p && p.name || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();

// 재화 아이콘 1개
function labberCurrencyIcon(cur) {
  return LABBER_SHOP_CURRENCY_ICON[cur] ?? LABBER_SHOP_CURRENCY_LABEL[cur] ?? cur ?? '';
}

// 가격 HTML — 활성 listing 이 있으면 그 가격(+보조재화), 없으면 상품 카탈로그의 참고가
// (p.currency/p.price)로 대체하고, 그것도 없을 때만 "가격 미정".
//  · listing 미등록 상품은 가격만 표시될 뿐 실제 구매는 여전히 "준비중" (openLabberShopDetail 참고).
//  · 보조 재화(secondary_currency/secondary_price)가 있으면 "주재화 + 보조재화" 로 이어 붙인다.
//    (연구소 상점 buildPriceHtml 의 이중 통화 출력과 동일: 아이콘 + 숫자 [ 아이콘 + 숫자 ])
function labberShopPriceHtml(p) {
  const lst = _labberListingByCode[p.code];
  if (lst && lst.price != null) {
    let html = `${labberCurrencyIcon(lst.currency)} ${lst.price.toLocaleString()}`;
    if (lst.secondary_currency && lst.secondary_price != null) {
      html += ` ${labberCurrencyIcon(lst.secondary_currency)} ${lst.secondary_price.toLocaleString()}`;
    }
    return html;
  }
  if (p && p.price != null && p.currency) {
    let html = `${labberCurrencyIcon(p.currency)} ${p.price.toLocaleString()}`;
    if (p.secondaryCurrency && p.secondaryPrice != null) {
      html += ` ${labberCurrencyIcon(p.secondaryCurrency)} ${p.secondaryPrice.toLocaleString()}`;
    }
    return html;
  }
  return LABBER_SHOP_PRICE_TBD;
}

// 누적 구매 횟수 / 구매 제한 도달 여부
const labberPurchasedCount = code => _labberPurchasedByCode[code] || 0;
function labberLimitReached(code) {
  const lst = _labberListingByCode[code];
  return !!(lst && lst.purchase_limit != null && labberPurchasedCount(code) >= lst.purchase_limit);
}

// LABBER 관리소 > 특성 항목으로 이동하는 딥링크 base.
// labber-lab.js 가 hash(#trait-*)를 보고 특성 탭 + 해당 하위탭을 자동 활성화하고 스크롤한다.
// (?tab=traits 는 명시적 fallback — hash 핸들러가 없어도 최소한 특성 탭은 열림)
const LABBER_TRAIT_LINK_BASE = 'labber-lab.html?tab=traits#';

// 상품 설명 HTML — 적용 특성(targetTrait)이 있으면 그 "특성명"만 bold + LABBER 관리소 특성 링크로,
// 앞뒤(descPrefix / descSuffix)는 일반 텍스트. targetTrait 가 없으면 description 을 평문 그대로.
// prefix/suffix/label/href 는 전부 내부 신뢰 상수지만 방어적으로 escape 처리해 innerHTML 주입 위험 제거.
function labberShopDescHtml(p) {
  if (p.targetTrait) {
    return escapeHtml(p.descPrefix || '')
      + `<a class="labbershop-trait-link" href="${escapeHtml(p.targetTrait.href)}">`
      + `<strong>${escapeHtml(p.targetTrait.label)}</strong></a>`
      + escapeHtml(p.descSuffix || '');
  }
  return escapeHtml(p.description || '');
}

// 상품 전용 구매 주의 문구(p.purchaseNotice) → HTML.
// 세그먼트 배열: { text } 평문 / { text, em:true } 강조(<strong>) / { br:true } 줄바꿈.
// text 는 전부 escapeHtml — 허용 태그는 코드가 만드는 <strong>/<br> 뿐(주입 위험 없음).
function labberShopNoticeHtml(segments) {
  if (!Array.isArray(segments)) return '';
  return segments.map(s => {
    if (s && s.br) return '<br>';
    const t = escapeHtml((s && s.text) || '');
    return (s && s.em) ? `<strong>${t}</strong>` : t;
  }).join('');
}

// 특성 아이템 소분류 — 전부 한글, 화면 표시 순서.
// (category 값 = 화면 소제목. 향후 DB 연동 시 안정적 slug 가 필요하면 categoryKey 필드를 별도로 두면 됨.)
// 잉크: RED~PINK 8종만 상점 노출(표준). NEUTRAL(특이)은 조합소 획득이라 상점 목록에서 제외 —
// 「특이」 등급 포드 모듈/분할 카트리지를 상점에서 뺀 것과 동일한 규칙.
const LABBER_SHOP_SUBCATS = ['MYO', '포드', '카트리지', '잉크', '키트'];

// ── 임시 상품 데이터 ────────────────────────────────────────
// 향후 실제 상점 DB/RPC 연동 시 이 배열만 서버 데이터로 교체. 렌더링 로직은 그대로.
//   { code, name(=상점 아이템명), traitName?(=적용되는 특성명, 미표시 개념 필드), category(=소분류 한글),
//     image, currency, price, grade?, gradeLabel?, designer?, description?, owned? }
//   - price null → "가격 미정"  /  숫자 → 연구소 상점과 동일한 재화 아이콘 + 수량
//   - image null → LABBER 패턴 placeholder (이미지 영역 안에서만)
//   - grade → 'standard'|'special'|'restricted' : LABBER 관리소 특성 페이지와 동일 체계(is-standard/is-special/...)
//   - owned true → 연구소 상점과 동일한 "보유중" badge/status
// code: 프론트 임시 식별자(DB 아님). 기존 코드 규칙(snake_case, 예: disposable_embryo_kit / suspicious_scale)에 맞춰
//       LABBER 특성 상품은 labber_ 프리픽스로 네임스페이스.
// 적용 특성 링크가 있는 상품(포드/카트리지)은 설명을 3조각으로 나눠 둔다:
//   descPrefix + [targetTrait(특성명, bold+링크)] + descSuffix
//   → 카드/모달이 labberShopDescHtml(p) 로 동일하게 렌더. 설명 전체를 HTML 문자열로 박지 않음.
//   targetTrait.href 는 LABBER 관리소 특성 항목 anchor (labber-lab.js LL_TRAIT_ANCHOR/renderTraitCard 참고).
const LABBER_SHOP_PRODUCTS = [
  // ── MYO (LABBER MYO 확정 아이템) ──
  {
    // ★ 래버 배양 시약은 "동일 아이템, 서로 독립된 1회 한정 슬롯" 2개로 판매한다(2026-09-12).
    //   code(=listing_code)는 서로 다르지만 itemCode 는 둘 다 labber_culture_reagent
    //   → 실제 가방엔 같은 아이템으로 쌓이고(최대 2개), 구매 제한(1회)은 슬롯별로 독립 판정된다.
    //   (서버: item_shop_listings.listing_code + purchase_shop_item 의 listing_id 기준 제한 판정,
    //    supabase/labber_shop_culture_reagent_second_slot_0912.sql 참고)
    code: 'labber_culture_reagent',
    // 줄바꿈 없이 한 줄로 두면 .shop-thumb-name(white-space:nowrap) 의 min-content 폭이
    // 카드 전체(그리드 셀) 폭을 밀어 올려 이미지 박스까지 함께 커지는 문제가 있었다 → <br> 로 강제 개행.
    name: '래버 배양 시약<br> (1회 구매 가능)',
    category: 'MYO',
    description: '래버를 배양할 때 사용되는 듯 하다. 어떻게 래버가 배양되는지는 미지수이다.',
    image: '../images/items/item_myo.png',
    // 가격/판매여부/구매제한은 item_shop_listings(→ shop_listing_view) 기준: 연구기록 50, 계정당 1회.
    // 아래 currency/price 는 표시에 안 쓰이지만 다른 상품과 형식을 맞춰 참고용으로 채워 둔다.
    currency: 'research_records', price: 50,
    // 이 상품 전용 구매 주의 문구 — 상세(구매) 모달에만 노출. { em:true } 구간은 <strong> 로 강조.
    //   · 계정당 1회 제한은 서버(purchase_shop_item + item_shop_listings.purchase_limit=1)에서 실제 차단됨.
    //   · 전송 불가는 items.is_transferable=false 로 관리 — 향후 전송 기능이 이 DB 값을 기준으로 판정.
    purchaseNotice: [
      { text: '이 상품은 ' },
      { text: '계정당 한 번만 구매 가능', em: true },
      { text: '합니다.' },
      { br: true },
      { text: '구매 후 다른 사용자에게 ' },
      { text: '전송 불가', em: true },
      { text: '한 아이템입니다.' },
    ],
  },
  {
    // 위 상품과 지급되는 실제 아이템(labber_culture_reagent)은 동일 — itemCode 로 명시.
    // code(=listing_code)만 다른 별개 상품이라 구매 제한도 위 상품과 완전히 독립적으로 판정된다.
    code: 'labber_culture_reagent_500',
    itemCode: 'labber_culture_reagent',
    name: '래버 배양 시약<br> (1회 구매 가능)',
    category: 'MYO',
    description: '래버를 배양할 때 사용되는 듯 하다. 어떻게 래버가 배양되는지는 미지수이다.',
    image: '../images/items/item_myo.png',
    currency: 'research_records', price: 500,
    purchaseNotice: [
      { text: '이 상품은 ' },
      { text: '계정당 한 번만 구매 가능', em: true },
      { text: '합니다.' },
      { br: true },
      { text: '구매 후 다른 사용자에게 ' },
      { text: '전송 불가', em: true },
      { text: '한 아이템입니다.' },
    ],
  },

  // ── 포드 (상점 아이템명 = "모듈". 캐릭터에 적용되는 "특성명"은 targetTrait.label = LABBER 관리소 표기) ──
  // traitName 은 개념 구분용 데이터 필드 (미표시). 관리소 TRAIT_DATA 와는 완전히 별개 배열.
  { code: 'labber_pod_circle',   name: '원형 모듈', traitName: '원형 포드',   category: '포드', grade: 'standard', gradeLabel: '표준',
    descPrefix: '둥근 구형의 모듈. LABBER의 포드를 ',
    targetTrait: { label: '원형 포드', href: LABBER_TRAIT_LINK_BASE + 'trait-pod-round' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_module_circle.png', currency: 'research_records', price: 300, secondaryCurrency: 'keys', secondaryPrice: 1, designer: '뽀' },
  { code: 'labber_pod_cylinder', name: '원통형 모듈', traitName: '원통형 포드', category: '포드', grade: 'standard', gradeLabel: '표준',
    descPrefix: '원기둥 형태의 모듈. LABBER의 포드를 ',
    targetTrait: { label: '원통형 포드', href: LABBER_TRAIT_LINK_BASE + 'trait-pod-cylinder' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_module_cylinder.png', currency: 'research_records', price: 300, secondaryCurrency: 'keys', secondaryPrice: 1, designer: '뽀' },
  // ※ 「특이(special)」 등급 포드 모듈(삼각/사각/반원)은 상점 판매 목록에서 제외됨(2026-09-06).
  //    아이템 마스터(public.items)와 특성 정의(labber-lab.js)는 그대로 유지 — 재판매 시 여기에 되살리면 됨.

  // ── 잉크 (상점 아이템명 = 특성명 'Ink-<색상>' 그대로. RED~PINK 8종만, 전부 표준) ──
  //   NEUTRAL(특이)은 조합소 획득이라 여기 없음.
  //   설명: 포드/카트리지와 동일하게 3조각(descPrefix + [targetTrait: '<색> 계열' bold+링크] + descSuffix).
  //   targetTrait.href = LABBER 관리소 특성 > 잉크 항목 anchor(trait-ink-*).
  //   가격/판매여부는 item_shop_listings(→ shop_listing_view) 기준 — listing 미등록 시 "가격 미정" + 상세 "준비중".
  { code: 'labber_ink_red',    name: 'Ink-RED',    traitName: 'Ink-RED',    category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '붉은색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '레드 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-red' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_red.png',    currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_orange', name: 'Ink-ORANGE', traitName: 'Ink-ORANGE', category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '주황색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '오렌지 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-orange' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_orange.png', currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_yellow', name: 'Ink-YELLOW', traitName: 'Ink-YELLOW', category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '노란색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '옐로우 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-yellow' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_yellow.png', currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_green',  name: 'Ink-GREEN',  traitName: 'Ink-GREEN',  category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '초록색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '그린 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-green' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_green.png',  currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_cyan',   name: 'Ink-CYAN',   traitName: 'Ink-CYAN',   category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '청록색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '시안 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-cyan' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_cyan.png',   currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_blue',   name: 'Ink-BLUE',   traitName: 'Ink-BLUE',   category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '푸른색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '블루 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-blue' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_blue.png',   currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_purple', name: 'Ink-PURPLE', traitName: 'Ink-PURPLE', category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '보라색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '퍼플 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-purple' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_purple.png', currency: 'research_records', price: 150, designer: '뽀' },
  { code: 'labber_ink_pink',   name: 'Ink-PINK',   traitName: 'Ink-PINK',   category: '잉크', grade: 'standard', gradeLabel: '표준',
    descPrefix: '분홍색 액체가 담긴 잉크인 것 같다. LABBER의 액상 본체를 ',
    targetTrait: { label: '핑크 계열', href: LABBER_TRAIT_LINK_BASE + 'trait-ink-pink' },
    descSuffix: '로 변경할 수 있다.',
    image: '../images/items/item_ink_pink.png',   currency: 'research_records', price: 150, designer: '뽀' },

  // ── 카트리지 (상점 아이템명 유지. 적용되는 특성명은 targetTrait.label = '액체 돌출' 등) ──
  { code: 'labber_cartridge_protrude', name: '돌출 카트리지', traitName: '액체 돌출', category: '카트리지', grade: 'standard', gradeLabel: '표준',
    descPrefix: '포드 내부의 액체를 외부로 돌출시키는 카트리지. LABBER에게 ',
    targetTrait: { label: '액체 돌출', href: LABBER_TRAIT_LINK_BASE + 'trait-liquid-protrusion' },
    descSuffix: ' 특성을 적용할 수 있다.',
    image: '../images/items/item_cartridge_liquid_protrude.png', currency: 'research_records', price: 200, designer: '뽀' },
  { code: 'labber_cartridge_attach', name: '부착 카트리지', traitName: '액체 부착', category: '카트리지', grade: 'standard', gradeLabel: '표준',
    descPrefix: '포드의 액체 일부를 신체나 의상에 부착시키는 카트리지. LABBER에게 ',
    targetTrait: { label: '액체 부착', href: LABBER_TRAIT_LINK_BASE + 'trait-liquid-attach' },
    descSuffix: ' 특성을 적용할 수 있다.',
    image: '../images/items/item_cartridge_liquid_attach.png', currency: 'research_records', price: 200, designer: '뽀' },
  { code: 'labber_cartridge_open', name: '개방 카트리지', traitName: '포드 개방', category: '카트리지', grade: 'standard', gradeLabel: '표준',
    descPrefix: '포드의 일부를 외부를 향해 열린 구조로 변경하는 카트리지. LABBER에게 ',
    targetTrait: { label: '포드 개방', href: LABBER_TRAIT_LINK_BASE + 'trait-pod-open' },
    descSuffix: ' 특성을 적용할 수 있다.',
    image: '../images/items/item_cartridge_pod_open.png', currency: 'research_records', price: 200, designer: '뽀' },
  // ※ 「특이(special)」 등급 분할 카트리지(labber_cartridge_split)는 상점 판매 목록에서 제외됨(2026-09-06).
  //    아이템 마스터(public.items)와 특성 정의(labber-lab.js)는 그대로 유지 — 재판매 시 여기에 되살리면 됨.

  // ── 키트 (Subject 완성품은 판매하지 않음 — 배아샘플+배아키트 등 조합으로 획득) ──
  {
    code: 'disposable_embryo_kit',
    name: '일회용 배아키트',
    category: '키트',
    image: '../images/items/item_embryo_kit.png',
    currency: 'research_records',
    price: 50,
    designer: '이상어',
    description: '배아 샘플을 넣어 무언가를 키울 수 있는 배양 키트. 한 번만 사용할 수 있는 것 같다.',
  },
  {
    // 조합소에서 반원/삼각/사각 모듈 제작 재료로 쓰인다(적용 특성 없음 → 딥링크 없이 평문 설명).
    code: 'labber_empty_module',
    name: '빈 모듈',
    category: '키트',
    grade: 'standard', gradeLabel: '표준',
    image: '../images/items/item_module_empty.png',
    currency: 'research_records',
    price: 50,
    designer: '뽀',
    description: '빈 모듈. 무언가 만들 수 있을 것 같다.',
  },
  {
    // 조합소에서 카트리지 계열 제작 재료로 쓰일 예정(적용 특성 없음 → 딥링크 없이 평문 설명). 이미지 미정.
    code: 'labber_empty_cartridge',
    name: '빈 카트리지',
    category: '키트',
    grade: 'standard', gradeLabel: '표준',
    image: '../images/items/item_cartridge_empty.png',
    currency: 'research_records',
    price: 50,
    designer: '뽀',
    description: '빈 카트리지. 무언가 만들 수 있을 것 같다.',
  },
];

let _labberShopUser = null;

async function initPage() {
  try {
    _labberShopUser = await getUser();
    if (!_labberShopUser) { window.location.href = 'login.html'; return; }

    applyLabberShopIntro();
    // listing_id 를 구매 이력(listing 별 매칭)에 써야 하므로 listing → inventory 순서로 로드한다(병렬 불가).
    await loadLabberShopListings();
    await loadLabberShopInventory();
    renderLabberShopProducts();
    runLabberShopTyping();

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[labber-shop] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

// 활성 listing (가격/통화/보조통화/구매제한) — shop_listing_view (RLS: 활성 listing만 노출)
// key = listing_code(= 상품 code). 같은 item_code(실제 지급 아이템)를 여러 listing_code 가
// 공유할 수 있다(예: 래버 배양 시약 50 / 500 슬롯) — 그래서 item_code 가 아니라 listing_code 로 매핑한다.
async function loadLabberShopListings() {
  _labberListingByCode = {};
  try {
    const { data, error } = await sb
      .from('shop_listing_view')
      .select('listing_id,listing_code,item_code,price,currency,secondary_currency,secondary_price,purchase_limit,is_active')
      .eq('shop_code', LABBER_SHOP_CODE);
    if (error) throw error;
    (data || []).forEach(row => {
      if (row.is_active) {
        _labberListingByCode[row.listing_code] = {
          listing_id: row.listing_id, item_code: row.item_code, price: row.price, currency: row.currency,
          secondary_currency: row.secondary_currency, secondary_price: row.secondary_price,
          purchase_limit: row.purchase_limit, is_active: true,
        };
      }
    });
  } catch (e) {
    console.warn('[labber-shop] listing 조회 실패:', e.message || e);
  }
}

// 보유 수량 + 누적 구매 횟수 — my_item_collection / item_logs (둘 다 본인 기준 RLS)
// ※ loadLabberShopListings() 이후에 호출해야 한다(listing_id → 상품 코드 매칭에 필요).
async function loadLabberShopInventory() {
  _labberOwnedByCode = {};
  _labberPurchasedByCode = {};
  // 실제 지급 아이템 기준으로 조회(같은 아이템을 공유하는 상품은 중복 없이 1회만 조회).
  const itemCodes = [...new Set(LABBER_SHOP_PRODUCTS.map(labberShopItemCode))];
  try {
    const { data, error } = await sb
      .from('my_item_collection')
      .select('code,item_id,quantity')
      .in('code', itemCodes);
    if (error) throw error;

    const qtyByItemCode = {};
    const idToItemCode = {};
    (data || []).forEach(row => {
      qtyByItemCode[row.code] = row.quantity || 0;
      if (row.item_id) idToItemCode[row.item_id] = row.code;
    });
    // 상품 code(=listing_code) 기준으로 재매핑 — 아이템을 공유하는 상품들은 같은 수량을 본다.
    LABBER_SHOP_PRODUCTS.forEach(p => {
      _labberOwnedByCode[p.code] = qtyByItemCode[labberShopItemCode(p)] || 0;
    });

    // 구매 제한 판정: 소비되어 수량이 0 이 되어도 "구매한 적 있음" 은 item_logs 로만 확정된다.
    // (type='shop_purchase', source='labber_shop' 로그를 item_id 로 가져온 뒤,
    //  metadata.listing_id 로 "어느 상품 슬롯"의 구매인지 구분한다 — 같은 아이템을 지급하는
    //  다른 상품(예: 래버 배양 시약 500)의 구매 이력이 이 상품 카운트에 섞이지 않도록.)
    // ※ user_id 를 반드시 명시 필터링한다 — item_logs RLS(item_logs_select_own)는
    //   admin/staff 계정에 한해 "본인 것 OR 전체" 를 허용하므로, 이 필터가 없으면
    //   admin/staff 로 로그인한 계정은 다른 유저의 구매 이력까지 섞여서 카운트된다
    //   (본인은 0회 구매인데도 "구매 완료"로 잘못 표시되는 원인이었음).
    const ids = Object.keys(idToItemCode);
    if (ids.length) {
      const { data: logs, error: logErr } = await sb
        .from('item_logs')
        .select('item_id,metadata')
        .eq('user_id', _labberShopUser.id)
        .eq('type', 'shop_purchase')
        .eq('source', LABBER_SHOP_CODE)
        .in('item_id', ids);
      if (logErr) throw logErr;

      const countByListingId = {};
      (logs || []).forEach(r => {
        const listingId = r.metadata && r.metadata.listing_id;
        if (!listingId) return;
        countByListingId[listingId] = (countByListingId[listingId] || 0) + 1;
      });
      LABBER_SHOP_PRODUCTS.forEach(p => {
        const lst = _labberListingByCode[p.code];
        if (lst && lst.listing_id) {
          _labberPurchasedByCode[p.code] = countByListingId[lst.listing_id] || 0;
        }
      });
    }
  } catch (e) {
    console.warn('[labber-shop] 보유/구매이력 조회 실패:', e.message || e);
  }
}

const labberOwnedQty  = code => _labberOwnedByCode[code] || 0;
const labberListingOf = code => _labberListingByCode[code] || null;

function applyLabberShopIntro() {
  if (LABBER_SHOP_INTRO) {
    const el = document.getElementById('labberShopIntro');
    if (el) el.textContent = LABBER_SHOP_INTRO;
  }
}

// ── 상품 영역 렌더 — 연구소 상점(js/shop.js renderCategories)과 동일 구조 ────
// 대분류(특성 아이템) → 소분류(MYO/Pod/…)가 세로로 이어지는 방식. 탭 전환 없음.
function renderLabberShopProducts() {
  const wrap = document.getElementById('labberShopCategories');
  if (!wrap) return;

  const bySub = {};
  LABBER_SHOP_PRODUCTS.forEach(p => {
    (bySub[p.category] = bySub[p.category] || []).push(p);
  });
  const subs = LABBER_SHOP_SUBCATS.filter(s => (bySub[s] || []).length);   // 상품 있는 소분류만

  if (!subs.length) {
    wrap.innerHTML = '<p class="empty-state" style="padding:60px 0;text-align:center;">판매중인 상품이 없어요.</p>';
    return;
  }

  wrap.innerHTML = `
    <div class="shop-cat-box">
      <h2 class="shop-cat-title">특성 아이템</h2>
      <div class="shop-cat-inner">
        ${subs.map((sub, i) => `
          <div class="shop-subcat${i > 0 ? ' shop-subcat--gap' : ''}">
            <h3 class="shop-subcat-title">${sub}</h3>
            <div class="shop-cat-grid">
              ${bySub[sub].map(renderLabberShopThumb).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}

// 상품 썸네일 — 연구소 상점 js/shop.js renderThumb 과 동일한 마크업/클래스.
// (할인/준비중/민감요소/관리자 분기는 LABBER 상점 상품에 해당 없어 생략)
function renderLabberShopThumb(p) {
  // 대부분 소모 아이템이라 재구매 가능(보유 수량만 배지로 노출).
  // 단, purchase_limit 이 걸린 상품은 제한 도달 시 연구소 상점의 "보유중" 잠금 패턴을 재사용한다.
  const qty       = labberOwnedQty(p.code);
  const soldOut   = labberLimitReached(p.code);

  const preview = p.image
    ? `<img src="${p.image}" alt="${labberShopPlainName(p)}">`
    : `<span class="labbershop-thumb-ph" aria-hidden="true"></span>`;

  const cornerBadge = soldOut
    ? `<span class="shop-thumb-badge shop-badge--owned shop-badge--right">구매 완료</span>`
    : qty > 0
      ? `<span class="shop-thumb-badge shop-badge--owned shop-badge--right">보유 ${qty}</span>`
      : '';

  // 등급 badge — LABBER 관리소 특성 페이지의 .labber-trait-grade(is-standard/is-special/...) 색상 그대로.
  // 상점 썸네일 왼쪽 상단 overlay (크기만 축소, 카드 구조/크기 변화 없음).
  const gradeBadge = p.grade
    ? `<span class="labber-trait-grade is-${p.grade}">${p.gradeLabel || p.grade}</span>`
    : '';

  const statusHtml = soldOut
    ? `<span class="shop-thumb-status shop-status--owned">구매 완료</span>`
    : `<span class="shop-thumb-status shop-status--available">${labberShopPriceHtml(p)}</span>`;

  // 클릭 → 상세 모달. data-item-code 는 구매 RPC 훅.
  return `
    <div class="shop-thumb shop-thumb--${soldOut ? 'owned' : 'available'}" data-item-code="${p.code}"
         onclick="openLabberShopDetail('${p.code}')">
      <div class="shop-thumb-img">
        ${gradeBadge}
        ${cornerBadge}
        ${preview}
      </div>
      <p class="shop-thumb-name">${p.name}</p>
      ${statusHtml}
    </div>`;
}

// ── 상품 상세 모달 — 연구소 상점(js/shop.js openDetailModal)과 동일한 구조/주입 방식 ──
// 별도 모달 노드(#labberShopDetailModal)에 .shop-detail-* 클래스를 그대로 재사용.
// LABBER 고유 항목(등급)만 조건부로 추가. 구매 로직 없음(준비중).
function openLabberShopDetail(code) {
  const p = LABBER_SHOP_PRODUCTS.find(x => x.code === code);
  if (!p) return;

  // 이미지: 있으면 <img>(cover), 없으면 LABBER 패턴 placeholder — 카드와 동일
  document.getElementById('labberShopDetailPreview').innerHTML = p.image
    ? `<img src="${p.image}" alt="${labberShopPlainName(p)}" style="width:100%;height:100%;object-fit:cover;">`
    : '<span class="labbershop-thumb-ph" aria-hidden="true"></span>';

  // p.name 은 내부 신뢰 상수(<br> 줄바꿈만 포함할 수 있음)라 innerHTML 사용 — 카드와 동일하게 렌더.
  document.getElementById('labberShopDetailName').innerHTML = p.name;

  // Design by (조건부)
  const creditEl = document.getElementById('labberShopDetailCredit');
  creditEl.textContent  = p.designer ? `Design by ${p.designer}` : '';
  creditEl.style.display = p.designer ? '' : 'none';

  // 등급 (조건부) — LABBER 관리소 특성 badge(.labber-trait-grade) 색상 체계 그대로. 없으면 영역 숨김.
  const gradeEl = document.getElementById('labberShopDetailGrade');
  if (p.grade) {
    gradeEl.innerHTML = `<span class="labber-trait-grade is-${p.grade}">${p.gradeLabel || p.grade}</span>`;
    gradeEl.hidden = false;
  } else {
    gradeEl.innerHTML = '';
    gradeEl.hidden = true;
  }

  // 설명 — 적용 특성이 있으면 특성명만 bold + 관리소 특성 링크(labberShopDescHtml). 없으면 평문.
  document.getElementById('labberShopDetailDesc').innerHTML = labberShopDescHtml(p);

  // 가격 — 연구소 상점과 동일한 재화 아이콘 UI (보조 재화 있으면 함께 표시)
  document.getElementById('labberShopDetailPrice').innerHTML = labberShopPriceHtml(p);

  const lst = labberListingOf(p.code);

  // 구매 제한 / 주의 안내.
  //   - 이 상품 전용 purchaseNotice(계정 1회 + 전송 불가 강조)가 있으면 그걸 노출하고,
  //     자동 생성되는 일반 제한 문구(#labberShopDetailLimitNote)는 감춘다(같은 내용 중복 방지).
  //   - purchaseNotice 가 없으면 기존 동작 그대로: purchase_limit 이 있을 때만 "계정당 N회…" 보조 문구.
  const limitNoteEl = document.getElementById('labberShopDetailLimitNote');
  const noticeEl    = document.getElementById('labberShopDetailNotice');
  const hasNotice   = Array.isArray(p.purchaseNotice) && p.purchaseNotice.length > 0;

  if (noticeEl) {
    noticeEl.innerHTML = hasNotice ? labberShopNoticeHtml(p.purchaseNotice) : '';
    noticeEl.hidden    = !hasNotice;
  }
  if (limitNoteEl) {
    if (!hasNotice && lst && lst.purchase_limit != null) {
      limitNoteEl.textContent = `계정당 ${lst.purchase_limit}회만 구매할 수 있습니다.`;
      limitNoteEl.hidden = false;
    } else {
      limitNoteEl.textContent = '';
      limitNoteEl.hidden = true;
    }
  }

  // 구매 영역
  //   - 구매 제한 도달 → 연구소 상점 "보유중" 잠금 패턴 재사용("구매 완료"). 서버가 최종 검증하므로 프론트는 표시만.
  //     labberLimitReached 는 item_logs(구매 이력) 기반이라 인벤토리를 비워도 유지되고 새로고침·다른 세션에서도 동일.
  //   - 활성 listing + 가격 있음 → 구매하기 버튼(연구소 상점 상세모달과 동일한 .shop-buy-btn-lg)
  //   - 없음(가격 미정) → "준비중" 유지
  const actionEl = document.getElementById('labberShopDetailAction');
  const qty = labberOwnedQty(p.code);
  const ownedHtml = qty > 0 ? `<span class="labbershop-owned-count">보유 ${qty}개</span>` : '';
  if (labberLimitReached(p.code)) {
    actionEl.innerHTML = '<span class="shop-detail-status shop-status--owned">구매 완료</span>' + ownedHtml;
  } else if (lst && lst.price != null) {
    actionEl.innerHTML =
      `<button type="button" class="shop-buy-btn-lg" onclick="doLabberShopPurchase('${p.code}', this)">구매하기</button>`
      + ownedHtml;
  } else {
    actionEl.innerHTML = '<span class="shop-detail-status shop-status--coming">준비중</span>' + ownedHtml;
  }

  document.getElementById('labberShopDetailModal').style.display = 'flex';
}

function closeLabberShopDetail() {
  document.getElementById('labberShopDetailModal').style.display = 'none';
}

// ── 구매 처리 ───────────────────────────────────────────────
// 클라이언트는 shop_code + listing_code(= 상품 code) 만 전달. 가격/차감/지급/로그는 전부 서버(purchase_shop_item).
// ※ RPC 파라미터명은 p_item_code 그대로(서버 함수 시그니처 유지) — 값만 listing_code 를 넣는다.
async function doLabberShopPurchase(code, btn) {
  if (_labberPurchaseBusy) return;
  const p = LABBER_SHOP_PRODUCTS.find(x => x.code === code);
  if (!p) return;

  _labberPurchaseBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = '구매 중...'; }

  try {
    const { data, error } = await sb.rpc('purchase_shop_item', {
      p_shop_code: LABBER_SHOP_CODE,
      p_item_code: code,   // 값 = listing_code (서버 함수 파라미터명은 p_item_code 로 고정)
    });

    if (error || !data || data.success !== true) {
      const key = (data && data.error) || 'UNKNOWN';
      // INSUFFICIENT_BALANCE 는 서버가 부족한 재화를 알려준다(연구기록/열쇠).
      const msg = (key === 'INSUFFICIENT_BALANCE' && data && LABBER_SHOP_INSUFFICIENT_MSG[data.currency])
        || LABBER_SHOP_ERROR_MSG[key]
        || `구매 중 오류가 발생했습니다.\n[${key}${error ? ' / ' + error.message : ''}]`;
      alert(msg);
      // 구매 제한 도달을 뒤늦게 감지한 경우 — 상태 새로고침 후 모달 재렌더(구매완료 표시)
      if (key === 'PURCHASE_LIMIT_REACHED') {
        _labberPurchasedByCode[code] = Math.max(labberPurchasedCount(code), 1);
        renderLabberShopProducts();
        openLabberShopDetail(code);
      } else if (btn) {
        btn.disabled = false; btn.textContent = '구매하기';
      }
      return;
    }

    // 성공 — 보유 수량 + 누적 구매 횟수 갱신 → 카드/모달 재렌더 → 사이드바 지갑 갱신
    //   같은 아이템을 공유하는 다른 상품(예: 래버 배양 시약 500)에도 갱신된 수량을 함께 반영한다
    //   (실제로는 같은 인벤토리 row 라 수량이 공유되지만, 구매 제한(_labberPurchasedByCode)은
    //    이 상품(code)에만 반영한다 — 서로 독립적인 판정이라 다른 상품엔 영향 없음).
    const newQty = (typeof data.quantity === 'number') ? data.quantity : (labberOwnedQty(code) + 1);
    const itemCode = labberShopItemCode(p);
    LABBER_SHOP_PRODUCTS.forEach(pp => {
      if (labberShopItemCode(pp) === itemCode) _labberOwnedByCode[pp.code] = newQty;
    });
    _labberPurchasedByCode[code] = labberPurchasedCount(code) + 1;

    renderLabberShopProducts();
    openLabberShopDetail(code);   // 모달 그대로 유지, 버튼/보유수량만 갱신
    if (typeof updateSidebarLogin === 'function') updateSidebarLogin();

    alert(`${labberShopPlainName(p)}${koObjParticle(labberShopPlainName(p))} 구매했습니다.`);
  } catch (e) {
    console.error('[labber-shop] 구매 오류:', e);
    alert('구매 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = '구매하기'; }
  } finally {
    _labberPurchaseBusy = false;
  }
}

// ── NPC 대사 타이핑 + 패널 등장 (js/labber.js runLabberTyping 과 동일 구조) ──
function runLabberShopTyping() {
  const el    = document.getElementById('labberShopNpcLine');
  const panel = document.getElementById('labberShopPanel');
  if (!el || !panel) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    el.textContent = LABBER_SHOP_NPC_LINE;
    panel.classList.add('show');
    return;
  }

  const speed = 55;
  let i = 0;
  el.textContent = '';
  el.classList.add('labber-typing');

  (function tick() {
    if (i < LABBER_SHOP_NPC_LINE.length) {
      el.textContent += LABBER_SHOP_NPC_LINE[i];
      i++;
      setTimeout(tick, speed);
    } else {
      el.classList.remove('labber-typing');
      panel.classList.add('show');
    }
  })();
}

initPage();
