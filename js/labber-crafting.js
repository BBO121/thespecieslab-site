// ── LABBER 조합소 (labber-crafting.html) ─────────────────────────
// 2026-09-14: 조합식 대장(아래 링크) 공개 조합식 19종 구현 완료
//   (서브젝트 4 + 포드 3 + 신규 12). 랜덤 서브젝트 개봉 → 실제 Subject 추첨은 이번 범위 아님.
// 2026-09-25: 최종 밸런스 조정(19종 재료/수량 변경) + 20번째 sticker_snack_random(띠부씰 랜덤,
//   과자 봉지 조각×20 → 001/002/003 균등 랜덤) 신규 구현 — 서버 craft_labber_subject 도 동일 반영
//   (supabase/labber_crafting_recipes_final_0925.sql).
// 2026-09-25(2차): 띠부씰 랜덤 표시명 간소화("001/002/003 중 1개" 문구 제거, 랜덤 로직은 무변경) +
//   데이터칩 조합을 2단계로 분리(datachip_repair 신규 + datachip_restore 재료 교체) → 총 21개
//   (supabase/labber_crafting_datachip_split_0925b.sql). 미구현은 히든 6종만 남음(별도 확률/구조 확정 후
//   구현 예정 — 이 파일에 절대 추가하지 말 것, 조합식 대장에만 문서화돼 있음).
// 2026-09-26: 띠부씰 랜덤/기록물 랜덤을 즉시 추첨 → 개봉형 아이템 지급으로 변경
//   (supabase/labber_random_item_open_0926.sql, 개봉은 js/my-bag.js [열기]).
// 2026-09-26(2차): 카트리지 조합식 2종(cartridge_split/cartridge_linear) 추가 → 서버 23개
//   (supabase/labber_crafting_cartridge_0926.sql). + 조합법 미공개 카드 3종(locked: true — 아래 설명).
//
// 조합 판정(재료·수량·결과)은 전부 서버 RPC `craft_labber_subject(p_recipe_code)` 가 결정한다.
// 아래 CRAFT_RECIPES 는 화면 표시 전용이며, 클라이언트는 recipe_code 문자열만 서버에 넘긴다.
//
// 조합식 전체 목록은 전용 아티팩트에서 관리한다 — 새 조합식을 추가/변경할 땐 거기부터 먼저 반영:
// https://claude.ai/code/artifact/55414281-a5e8-4580-926b-708607fc84df (LABBER 조합식 대장)
//
// 상단 hero + NPC(D) 대화 씬은 _labber.scss 의 .labber-* 재사용.
// 카테고리 탭(.shop-tab-row/.shop-tab-btn)은 관리소·아이템 도감과 동일 클래스 재사용 — 전용 CSS 추가 없음.

// NPC D 대사 — 임시(미확정). 확정 시 이 상수 한 곳만 고침.
const LABBER_CRAFT_NPC_LINE = '조합할 물건은 가져왔습니까?';

// 소개 문구 교체용(선택) — 값이 있으면 이걸로, 없으면 HTML 문구 유지.
const LABBER_CRAFT_INTRO = null;

// ── 카테고리 (표시 전용 — UI 필터링에만 쓰고 서버엔 전달하지 않음) ──────────
//   실제 존재하는 조합식만 정의: 서브젝트 계열(subject) / 포드 모듈 계열(pod).
//   조합식이 하나도 없는 카테고리는 CRAFT_CATEGORIES 에 아예 추가하지 않는다 —
//   renderCraftTabs() 가 이 배열 순서 그대로 탭을 그리므로, 향후 카테고리를 늘릴 땐
//   여기 한 줄 추가 + 해당 recipe 들의 category 값만 맞추면 된다.
const CRAFT_CATEGORIES = [
  { key: 'subject', label: 'SUBJECT' },
  { key: 'pod',     label: '포드' },
  { key: 'cartridge', label: '카트리지' },
  { key: 'ink',     label: '잉크' },
  { key: 'lab',     label: '연구' },   // 기록복원/라벨/시험관/점액/표본라인/기계재조립 통합
  { key: 'misc',    label: '기타' },   // 잡템승급(+ 향후 수집품 계열) 통합
];

// ── 확정 조합식 (표시 전용) ──────────────────────────────
//   key       : 서버로 전달하는 recipe_code
//   category  : CRAFT_CATEGORIES 의 key — 탭 필터링 기준
//   materials : [ [item_code, 필요수량], ... ]  ← 서버 매핑과 반드시 일치해야 하지만, 최종 판정은 서버
//   result    : 결과 item_code
//   resultLabel : (선택) 결과 아이템이 도감 뷰에 없을 때(is_hidden 등) 카드에 쓸 이름 폴백
//   locked    : (선택) true = 조합법 미공개. 카드는 노출하되 재료 대신 "조합법 미공개" 표시 + 조합 불가.
//               서버 craft_labber_subject 에도 분기가 없다(INVALID_RECIPE).
//               공개할 땐 ① SQL 에 WHEN 분기 추가 → ② 여기서 locked 제거 + materials 채우기, 두 곳만 고치면 된다.
const CRAFT_RECIPES = [
  // 2026-09-25 최종 조정 — 수상한 배아샘플 1→3, 어류/파충류/조류 부재료 1→3.
  { key: 'random',  category: 'subject',
    materials: [['suspicious_embryo_sample', 3], ['disposable_embryo_kit', 1]],
    result: 'random_subject' },
  { key: 'fish',    category: 'subject',
    materials: [['suspicious_embryo_sample', 3], ['disposable_embryo_kit', 1], ['suspicious_scale', 3]],
    result: 'random_fish_subject' },
  { key: 'reptile', category: 'subject',
    materials: [['suspicious_embryo_sample', 3], ['disposable_embryo_kit', 1], ['suspicious_shed', 3]],
    result: 'random_reptile_subject' },
  { key: 'bird',    category: 'subject',
    materials: [['suspicious_embryo_sample', 3], ['disposable_embryo_kit', 1], ['suspicious_feather', 3]],
    result: 'random_bird_subject' },
  // 2026-09-26 — 조합법 미공개(카드만 노출, 조합 불가).
  { key: 'subject_creature', category: 'subject', locked: true,
    materials: [],
    result: 'labber_subject_item_creature', resultLabel: 'SUBJECT 특이 : 크리쳐' },
  { key: 'subject_species', category: 'subject', locked: true,
    materials: [],
    result: 'labber_subject_item_species', resultLabel: 'SUBJECT 특이 : 종족' },
  // 2026-09-25 최종 조정 — 삼각 모듈: 작은 이빨(dogam_specimen_06) 제거, 누군가 숨겨둔 삼각김밥×3 추가,
  // 얇은 껍질조각 1→2, 미지근한 점액 1→5. 사각/반원: 부재료 3→5, 미지근한 점액 1→5.
  { key: 'pod_triangle', category: 'pod',
    materials: [['labber_empty_module', 1], ['dogam_lounge_snack_07', 3], ['dogam_specimen_08', 2], ['dogam_specimen_04', 5]],
    result: 'labber_pod_triangle' },
  { key: 'pod_square', category: 'pod',
    materials: [['labber_empty_module', 1], ['dogam_records_01', 5], ['dogam_specimen_04', 5]],
    result: 'labber_pod_square' },
  { key: 'pod_semicircle', category: 'pod',
    materials: [['labber_empty_module', 1], ['dogam_lounge_coffee_04', 5], ['dogam_specimen_04', 5]],
    result: 'labber_pod_semicircle' },

  // 2026-09-26 신규 — 카트리지 2종 (빈 카트리지 + 폐기된 회로기판 + 부재료).
  { key: 'cartridge_split', category: 'cartridge',
    materials: [['labber_empty_cartridge', 1], ['dogam_lab_junk_12', 5], ['dogam_lab_junk_11', 3]],
    result: 'labber_cartridge_split', resultLabel: '분할 카트리지' },
  { key: 'cartridge_linear', category: 'cartridge',
    materials: [['labber_empty_cartridge', 1], ['dogam_lab_junk_12', 5], ['dogam_lab_junk_08', 3]],
    result: 'labber_cartridge_linear', resultLabel: '선형 연장 카트리지' },

  // 2026-09-26 — 조합법 미공개(카드만 노출, 조합 불가).
  { key: 'ink_neutral', category: 'ink', locked: true,
    materials: [],
    result: 'labber_ink_neutral', resultLabel: 'Ink-NEUTRAL' },

  // 2026-09-25 최종 조정 — 수량 상향.
  { key: 'coffee_upgrade', category: 'misc',
    materials: [['dogam_lounge_coffee_03', 10]],
    result: 'dogam_lounge_coffee_04' },
  { key: 'tooth_fragment_upgrade', category: 'misc',
    materials: [['dogam_specimen_07', 5]],
    result: 'dogam_specimen_06' },
  { key: 'tooth_evil_upgrade', category: 'misc',
    materials: [['dogam_specimen_06', 5]],
    result: 'dogam_specimen_19' },
  // 띠부씰 랜덤 — 2026-09-26 부터 개봉형 아이템(random_snack_sticker) 지급. 001/002/003 추첨은
  // 가방 [열기] 시 서버 open_random_item 이 한다(supabase/labber_random_item_open_0926.sql).
  { key: 'sticker_snack_random', category: 'misc',
    materials: [['dogam_lounge_snack_03', 20]],
    result: 'random_snack_sticker' },   // 2026-09-26: 개봉형 아이템 지급(추첨은 가방 [열기])

  // 기록물 랜덤 — 2026-09-26 부터 개봉형 아이템(random_record) 지급. 11종 추첨은 가방 [열기] 시 open_random_item.
  { key: 'memo_restore', category: 'lab',
    materials: [['dogam_lab_supplies_01', 10]],
    result: 'random_record' },          // 2026-09-26: 개봉형 아이템 지급(추첨은 가방 [열기])
  // 2026-09-25 2차 수정 — 데이터칩 조합을 2단계로 분리.
  //   1단계(신규) datachip_repair : 손상된 데이터칩×10 → 빈 데이터칩×1
  //   2단계(기존 코드 재사용) datachip_restore : 빈 데이터칩×10 → 복구된 데이터칩×1
  { key: 'datachip_repair', category: 'lab',
    materials: [['dogam_records_02', 10]],
    result: 'dogam_records_01' },
  { key: 'datachip_restore', category: 'lab',
    materials: [['dogam_records_01', 10]],
    result: 'dogam_records_15' },
  { key: 'label_sticker', category: 'lab',
    materials: [['dogam_lab_supplies_13', 5], ['dogam_lab_supplies_12', 5]],
    result: 'dogam_records_07' },
  { key: 'test_tube_break', category: 'lab',
    materials: [['dogam_lab_supplies_03', 5]],
    result: 'dogam_lab_supplies_02' },
  { key: 'slime_lukewarm', category: 'lab',
    materials: [['dogam_specimen_03', 5], ['dogam_specimen_11', 3]],
    result: 'dogam_specimen_04' },
  { key: 'specimen_unclassified', category: 'lab',
    materials: [['dogam_lab_supplies_08', 3], ['dogam_lab_supplies_04', 3], ['dogam_lab_supplies_15', 5]],
    result: 'dogam_specimen_20' },
  { key: 'specimen_sealed', category: 'lab',
    materials: [['dogam_specimen_20', 1], ['dogam_specimen_01', 3], ['dogam_specimen_02', 5]],
    result: 'dogam_specimen_21' },
  { key: 'timer_broken', category: 'lab',
    materials: [['dogam_lab_junk_06', 5], ['dogam_lab_junk_11', 3], ['dogam_lab_junk_10', 2]],
    result: 'dogam_lab_supplies_19' },
  { key: 'sensor_broken', category: 'lab',
    materials: [['dogam_lab_junk_08', 5], ['dogam_lab_junk_12', 3], ['dogam_lab_junk_10', 2]],
    result: 'dogam_lab_junk_13' },
];

// 기존 재료 4종은 items DB 에 이미지가 비어 있어 프론트가 code→경로로 매핑(js/my-bag.js 와 동일 규칙).
// suspicious_shed 는 DB image_url 이 채워져 있으면 그 값이 우선된다(아래 loadCraftItems).
// 2026-09-13 추가분(포드 모듈 재료/결과 7종)도 동일 규칙 — images/items/ 에 실제 파일 존재 확인함.
const CRAFT_ITEM_IMG_FALLBACK = {
  suspicious_embryo_sample: '../images/items/item_embryo_sample.png',
  disposable_embryo_kit:    '../images/items/item_embryo_kit.png',
  suspicious_scale:         '../images/items/item_suspicious_scale.png',
  suspicious_feather:       '../images/items/item_suspicious_feather.png',
  suspicious_shed:          '../images/items/item_suspicious_shed.png',
  labber_empty_module:      '../images/items/item_module_empty.png',
  dogam_specimen_04:        '../images/items/item_lab_lukewarm_slime.png',
  dogam_specimen_06:        '../images/items/item_lab_small_tooth.png',
  dogam_specimen_08:        '../images/items/item_lab_thin_shell_fragment.png',
  dogam_records_01:         '../images/items/item_lab_empty_data_chip.png',
  dogam_lounge_coffee_04:   '../images/items/item_lab_coffee_capsule.png',
  labber_pod_triangle:      '../images/items/item_module_triangle.png',
  labber_pod_square:        '../images/items/item_module_square.png',
  labber_pod_semicircle:    '../images/items/item_module_semicircle.png',
  // 2026-09-14 추가분 — images/items/ 에 실제 파일 존재 확인함.
  // (미분류 표본/봉인된 표본/복구된 데이터칩은 아직 아트웍이 없어 일부러 여기 추가하지 않음 —
  //  기존 placeholder 로직이 그대로 "이미지 미등록" 상태를 보여준다.)
  dogam_lounge_coffee_03:   '../images/items/item_lab_defective_coffee_capsule.png',
  dogam_specimen_07:        '../images/items/item_lab_tooth_like_fragment.png',
  dogam_lab_supplies_01:    '../images/items/item_lab_crumpled_note.png',
  dogam_records_02:         '../images/items/item_lab_damaged_data_chip.png',
  dogam_records_07:         '../images/items/item_inspection_complete_sticker.png',
  dogam_lab_supplies_03:    '../images/items/item_lab_cracked_tube.png',
  dogam_lab_supplies_02:    '../images/items/item_lab_broken_tube.png',
  dogam_specimen_03:        '../images/items/item_lab_dried_slime.png',
  dogam_lab_supplies_04:    '../images/items/item_empty_sample_bottle.png',
  dogam_specimen_01:        '../images/items/item_lab_broken_specimen_case.png',
  dogam_specimen_02:        '../images/items/item_lab_empty_capsule.png',
  dogam_specimen_19:        '../images/items/item_lab_wicked_tooth.png',
  random_snack_sticker:     '../images/items/item_snack_sticker_random.png',
  random_record:            '../images/items/item_record_random.png',
  // 2026-09-26 카트리지 조합 + 미공개 카드 — images/items/ 에 실제 파일 존재 확인함.
  labber_empty_cartridge:       '../images/items/item_cartridge_empty.png',
  dogam_lab_junk_08:            '../images/items/item_broken_wire.png',
  dogam_lab_junk_11:            '../images/items/item_small_gear.png',
  dogam_lab_junk_12:            '../images/items/item_discarded_circuit_board.png',
  labber_cartridge_split:       '../images/items/item_cartridge_pod_split.png',
  labber_cartridge_linear:      '../images/items/item_cartridge_pod_linear_extension.png',
  labber_ink_neutral:           '../images/items/item_ink_natural.png',
  labber_subject_item_creature: '../images/items/item_subject_special_creature.png',
  labber_subject_item_species:  '../images/items/item_subject_special_species.png',
};

// memo_restore 처럼 결과가 서버 랜덤이라 result 코드가 없는(null) 레시피가 있어 filter(Boolean) 필요.
const CRAFT_ALL_CODES = [...new Set(
  CRAFT_RECIPES.flatMap(r => [...r.materials.map(m => m[0]), r.result]).filter(Boolean)
)];

let _labberCraftUser = null;
let _craftItemMap = {};   // code -> { name, image, quantity }
let _craftBusy = false;
let _craftActiveCat = 'all';   // 'all' | CRAFT_CATEGORIES[].key

async function initPage() {
  try {
    _labberCraftUser = await getUser();
    if (!_labberCraftUser) { window.location.href = 'login.html'; return; }

    applyLabberCraftIntro();
    await loadCraftItems();
    renderCraftTabs();
    renderCraftRecipes();
    runLabberCraftTyping();

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[labber-crafting] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

function applyLabberCraftIntro() {
  if (LABBER_CRAFT_INTRO) {
    const el = document.getElementById('labberCraftIntro');
    if (el) el.textContent = LABBER_CRAFT_INTRO;
  }
}

// ── 아이템 이름/이미지/보유수량 로드 (도감 뷰 = 본인 기준 RLS) ──
async function loadCraftItems() {
  _craftItemMap = {};
  try {
    const { data, error } = await sb
      .from('my_item_collection')
      .select('code,name,image_url,image_path,quantity')
      .in('code', CRAFT_ALL_CODES);
    if (error) throw error;
    (data || []).forEach(row => {
      _craftItemMap[row.code] = {
        name: row.name || row.code,
        image: row.image_url || CRAFT_ITEM_IMG_FALLBACK[row.code] || null,
        quantity: row.quantity || 0,
      };
    });
  } catch (e) {
    console.warn('[labber-crafting] 아이템 조회 실패:', e.message || e);
  }
  // 뷰에 아직 없는 코드(시드 전 등) 보완 — 이름은 code, 보유 0
  CRAFT_ALL_CODES.forEach(code => {
    if (!_craftItemMap[code]) {
      _craftItemMap[code] = { name: code, image: CRAFT_ITEM_IMG_FALLBACK[code] || null, quantity: 0 };
    }
  });
}

// 랜덤 결과 조합(memo_restore 등)은 서버가 CRAFT_RECIPES 에 없는 코드를 결과로 돌려줄 수 있다 —
// _craftItemMap 은 CRAFT_ALL_CODES(정적 레시피에 적힌 재료/결과 코드)만 미리 채워두므로,
// 그 목록에 없는 코드가 오면 itemImg/itemName 이 못 찾아서 결과 모달이 placeholder 로 빠졌었다.
// 특정 recipe_code 를 하드코딩하지 않고, "응답으로 받은 코드가 캐시에 없으면 그 코드만 한 번 더
// 조회해서 채워 넣는" 범용 방식으로 고친다 — 향후 다른 랜덤 결과 조합(예: 띠부씰 랜덤)에도 그대로 적용된다.
async function ensureItemCached(code) {
  if (!code || _craftItemMap[code]) return; // 이미 있으면(고정 결과 등) 추가 조회 불필요
  try {
    const { data, error } = await sb
      .from('my_item_collection')
      .select('code,name,image_url,image_path,quantity')
      .eq('code', code)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      _craftItemMap[data.code] = {
        name: data.name || data.code,
        image: data.image_url || CRAFT_ITEM_IMG_FALLBACK[data.code] || null,
        quantity: data.quantity || 0,
      };
    }
  } catch (e) {
    console.warn('[labber-crafting] 결과 아이템 조회 실패:', e.message || e);
    // 실패해도 openCraftResult 는 그냥 placeholder 로 표시될 뿐 — 조합 성공 흐름 자체는 막지 않는다.
  }
}

const itemName = code => _craftItemMap[code]?.name || code;
const itemImg  = code => _craftItemMap[code]?.image || null;
const itemQty  = code => _craftItemMap[code]?.quantity || 0;

// ── 카테고리 탭 ─────────────────────────────────────────
// 실제 조합식이 1개 이상 있는 카테고리만 노출한다(미래용 빈 카테고리 미리 보여주지 않음).
// 마크업/클래스는 LABBER 관리소·아이템 도감과 동일한 .shop-tab-row/.shop-tab-btn 재사용.
function renderCraftTabs() {
  const host = document.getElementById('labberCraftTabs');
  if (!host) return;

  const usedCats = CRAFT_CATEGORIES.filter(c => CRAFT_RECIPES.some(r => r.category === c.key));
  if (usedCats.length < 2) { host.hidden = true; host.innerHTML = ''; return; } // 탭 나눌 필요 없으면 숨김

  const chips = [`<button type="button" class="shop-tab-btn${_craftActiveCat === 'all' ? ' active' : ''}" data-cat="all">전체</button>`]
    .concat(usedCats.map(c => `<button type="button" class="shop-tab-btn${_craftActiveCat === c.key ? ' active' : ''}" data-cat="${escapeHtml(c.key)}">${escapeHtml(c.label)}</button>`));
  host.innerHTML = chips.join('');
  host.hidden = false;

  host.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      _craftActiveCat = btn.dataset.cat;
      renderCraftTabs();
      renderCraftRecipes();
    });
  });
}

// ── 조합식 카드 렌더 ────────────────────────────────────
function renderCraftRecipes() {
  const host = document.getElementById('labberCraftBoard');
  if (!host) return;
  const list = _craftActiveCat === 'all'
    ? CRAFT_RECIPES
    : CRAFT_RECIPES.filter(r => r.category === _craftActiveCat);
  host.innerHTML = list.map(renderRecipeCard).join('');
  host.querySelectorAll('[data-craft]').forEach(btn => {
    btn.addEventListener('click', () => doCraft(btn.dataset.craft, btn));
  });
}

function thumbHtml(code, isResult) {
  const img = itemImg(code);
  const cls = isResult ? 'labcraft-thumb labcraft-thumb--result' : 'labcraft-thumb';
  return `<div class="${cls}">${
    img ? `<img src="${escapeHtml(img)}" alt="">` : '<span class="labcraft-thumb-ph" aria-hidden="true"></span>'
  }</div>`;
}

function renderRecipeCard(r) {
  // result 가 null 인 레시피(예: memo_restore)는 결과를 서버가 랜덤으로 정하므로
  // 미리보기는 resultLabel 텍스트 + placeholder 썸네일로만 표시하고, 실제 결과는 조합 성공 후
  // 서버 응답(openCraftResult)으로 보여준다.
  // resultLabel: 도감 뷰에 결과 아이템이 없으면(is_hidden 등) 이름이 code 로 떨어지므로 라벨로 대체.
  const cached = r.result ? _craftItemMap[r.result] : null;
  const result = cached && cached.name !== r.result
    ? cached
    : { name: r.resultLabel || r.result || '랜덤' };
  const canCraft = !r.locked && r.materials.every(([code, need]) => itemQty(code) >= need);

  // 조합법 미공개 — 재료 대신 "조합법 미공개" 셀 하나, 버튼은 비활성.
  const matsHtml = r.locked ? `
      <div class="labcraft-mat labcraft-mat--locked">
        <div class="labcraft-thumb"><span class="labcraft-thumb-lock" aria-hidden="true">?</span></div>
        <p class="labcraft-mat-name">조합법 미공개</p>
      </div>` : r.materials.map(([code, need], i) => {
    const have  = itemQty(code);
    const short = have < need;
    return `
      ${i > 0 ? '<span class="labcraft-plus" aria-hidden="true">+</span>' : ''}
      <div class="labcraft-mat${short ? ' is-short' : ''}">
        ${thumbHtml(code, false)}
        <p class="labcraft-mat-name">${escapeHtml(itemName(code))}</p>
        <p class="labcraft-mat-qty">필요 ${need} / 보유 <span class="${short ? 'labcraft-qty-short' : ''}">${have}</span></p>
      </div>`;
  }).join('');

  return `
    <article class="labcraft-recipe" data-recipe="${r.key}">
      <h3 class="labcraft-recipe-title">${escapeHtml(result.name)}</h3>
      <div class="labcraft-flow">
        <div class="labcraft-mats">${matsHtml}</div>
        <span class="labcraft-arrow" aria-hidden="true">&rarr;</span>
        <div class="labcraft-result">
          ${thumbHtml(r.result, true)}
          <p class="labcraft-mat-name">${escapeHtml(result.name)}</p>
          <p class="labcraft-mat-qty">&times;1</p>
        </div>
      </div>
      <button type="button" class="labcraft-btn" data-craft="${r.key}"${canCraft ? '' : ' disabled'}>${r.locked ? '조합법 미공개' : '조합하기'}</button>
      <p class="labcraft-msg" id="craftMsg-${r.key}" role="status"></p>
    </article>`;
}

// ── 조합 실행 ───────────────────────────────────────────
async function doCraft(recipeKey, btn) {
  if (_craftBusy) return;
  // 조합법 미공개 레시피는 서버 호출 자체를 하지 않는다(버튼 disabled 우회 방어).
  if (CRAFT_RECIPES.find(r => r.key === recipeKey)?.locked) return;
  _craftBusy = true;

  const msgEl = document.getElementById('craftMsg-' + recipeKey);
  if (msgEl) { msgEl.textContent = ''; msgEl.classList.remove('is-error'); }
  btn.disabled = true;
  btn.textContent = '조합 중...';

  let ok = false;
  try {
    const { data, error } = await sb.rpc('craft_labber_subject', { p_recipe_code: recipeKey });
    if (error) throw new Error(error.message);

    if (data && data.success === true) {
      ok = true;
      await loadCraftItems();               // 재료/결과 보유 수량 갱신
      await ensureItemCached(data.result && data.result.code); // 랜덤 결과 등 캐시에 없는 코드 보강(아래 설명)
      renderCraftRecipes();                 // 버튼 disabled 상태 재계산
      openCraftResult(data.result);
    } else {
      showCraftError(msgEl, data && data.error, data);
    }
  } catch (e) {
    console.error('[labber-crafting] 조합 오류:', e);
    if (msgEl) { msgEl.textContent = '조합 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.'; msgEl.classList.add('is-error'); }
  } finally {
    _craftBusy = false;
    // 성공 시엔 renderCraftRecipes 로 버튼이 새로 그려지므로 복구 불필요.
    // 실패/오류로 카드가 그대로면 버튼 상태를 되돌린다.
    if (!ok && document.body.contains(btn)) { btn.disabled = false; btn.textContent = '조합하기'; }
  }
}

// 조합 실패는 재료가 전혀 차감되지 않은 상태(RPC 가 원자적). 메시지만 표시.
function showCraftError(msgEl, code, data) {
  if (!msgEl) return;
  let t;
  switch (code) {
    case 'INSUFFICIENT_MATERIALS': {
      const nm = itemName(data && data.missing_code) || '재료';
      const need = (data && data.need != null) ? data.need : '?';
      const have = (data && data.have != null) ? data.have : 0;
      t = `재료가 부족해요. (${nm} · 필요 ${need} / 보유 ${have})`;
      break;
    }
    case 'NOT_AUTHENTICATED':       t = '로그인이 필요해요.'; break;
    case 'INVALID_RECIPE':          t = '알 수 없는 조합식이에요.'; break;
    case 'RESULT_ITEM_MISSING':
    case 'INGREDIENT_ITEM_MISSING': t = '아이템 데이터가 아직 준비되지 않았어요. 운영진에게 문의해주세요.'; break;
    default:                        t = '조합에 실패했어요. 잠시 후 다시 시도해주세요.';
  }
  msgEl.textContent = t;
  msgEl.classList.add('is-error');
}

// ── 결과 모달 ───────────────────────────────────────────
// 이 단계에서는 획득한 "랜덤 서브젝트 아이템"만 보여준다.
// 실제 Subject(흰동가리/참새/볼파이톤 등) 추첨·공개는 하지 않는다.
function openCraftResult(result) {
  if (!result) return;
  const modal = document.getElementById('labberCraftResultModal');
  if (!modal) return;

  const img = itemImg(result.code);
  document.getElementById('craftResultPreview').innerHTML = img
    ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(result.name || '')}">`
    : '<span class="labcraft-thumb-ph" aria-hidden="true"></span>';
  document.getElementById('craftResultName').textContent = result.name || '';
  document.getElementById('craftResultQty').textContent = `×${result.gained || 1} 획득했습니다.`;

  modal.style.display = 'flex';
}

function closeCraftResult() {
  const modal = document.getElementById('labberCraftResultModal');
  if (modal) modal.style.display = 'none';
}

// ── NPC 대사 타이핑 + 콘텐츠 패널 등장 (js/labber-shop.js runLabberShopTyping 과 동일 구조) ──
function runLabberCraftTyping() {
  const el    = document.getElementById('labberCraftNpcLine');
  const panel = document.getElementById('labberCraftPanel');
  if (!el || !panel) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    el.textContent = LABBER_CRAFT_NPC_LINE;
    panel.classList.add('show');
    return;
  }

  const speed = 55;
  let i = 0;
  el.textContent = '';
  el.classList.add('labber-typing');

  (function tick() {
    if (i < LABBER_CRAFT_NPC_LINE.length) {
      el.textContent += LABBER_CRAFT_NPC_LINE[i];
      i++;
      setTimeout(tick, speed);
    } else {
      el.classList.remove('labber-typing');
      panel.classList.add('show');
    }
  })();
}

initPage();
