// ── LABBER 특성 데이터 (공통 모듈) ─────────────────────────────────
// LABBER 관리소(labber-lab.html)의 "특성" 탭 데이터를 단일 소스로 관리한다.
// 사용처:
//   - js/labber-lab.js         관리소 특성 탭 렌더 (renderTraitCard / renderTraits)
//   - pages/character-edit.html  LABBER 개체 수정창 CARTRIDGE 선택 UI
//   - pages/character.html       LABBER 개체 상세 CARTRIDGE 표시 + 관리소 딥링크
// → 여기서 특성을 추가/변경하면 관리소·수정창·상세가 동일하게 반영된다 (이중 관리 금지).
//
// DB·신규 시스템 없음, 정적 데이터.
// acquisition: { label, url, enabled } — label && url && enabled → 실제 <a>, label만 → 비활성 링크, label 없음 → "null"
// artwork: 파일명(확장자 제외). image 있으면 실제 <img>, 없으면 ARTWORK placeholder.
// anchor: 특성 항목의 안정적 DOM id. 관리소 딥링크(labber-lab.html?tab=traits#<anchor>) 목적지.
// code:   저장/식별용 안정 키. characters.custom_field_values 에 이 code 배열로 저장된다.
//         (상점 아이템 코드 labber_cartridge_protrude 등과는 별개 네임스페이스 — 여기는 "특성" 코드)

const LL_TRAIT_DESIGNER = '이상어';   // 포드/카트리지 DESIGN BY (서브젝트는 준비중이라 DESIGN BY 미표시)

// 획득처 — 링크 목적지(url)는 미리 준비하되, LABBER 상점/조합소/탐험 정식 공개 전까지 enabled:false.
const LL_ACQ_SHOP    = { label: 'LABBER 상점', url: 'labber-shop.html',        enabled: false };
const LL_ACQ_CRAFT   = { label: '조합소',      url: 'labber-crafting.html',    enabled: false };
const LL_ACQ_EXPLORE = { label: '탐험',        url: 'labber-exploration.html', enabled: false };

const TRAIT_DATA = {
  pod: [
    { code: 'labber_pod_round',      name: '원형 포드', grade: 'standard', artwork: 'pod-circle', anchor: 'trait-pod-round',
      image: '../images/labber/trait_pod_round.png',
      desc: '둥근 구형의 포드입니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_pod_cylinder',   name: '원통형 포드', grade: 'standard', artwork: 'pod-cylinder', anchor: 'trait-pod-cylinder',
      image: '../images/labber/trait_pod_cylinder.png',
      desc: '원기둥 형태의 포드입니다.<br>물병이나 캡슐처럼 둥근 면을 가진 원통형입니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_pod_triangle',   name: '삼각형 포드', grade: 'special', artwork: 'pod-triangle', anchor: 'trait-pod-triangle',
      image: '../images/labber/trait_pod_triangle.png',
      desc: '각이 있는 형태의 포드입니다.<br>정면을 기준으로 세 변이 드러나야 합니다.',
      acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_pod_square',     name: '사각형 포드', grade: 'special', artwork: 'pod-square', anchor: 'trait-pod-square',
      image: '../images/labber/trait_pod_square.png',
      desc: '각이 있는 형태의 포드입니다.<br>정면을 기준으로 네 변이 드러나야 합니다.',
      acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_pod_semicircle', name: '반원형 포드', grade: 'special', artwork: 'pod-semicircle', anchor: 'trait-pod-semicircle',
      image: '../images/labber/trait_pod_semicircle.png',
      desc: '한쪽 면이 둥글게 이어지는 반원형 포드입니다.<br>정면을 기준으로 반원 형태가 드러나야 합니다.',
      acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
  ],
  // 카트리지 계열 "특성명" — 캐릭터에게 적용되는 특성 이름 (상점 아이템명 '돌출/부착/분할 카트리지' 와 별개).
  cartridge: [
    { code: 'labber_cartridge_liquid_protrusion',    name: '액체 돌출', grade: 'standard', artwork: 'cartridge-protrude', anchor: 'trait-liquid-protrusion',
      image: '../images/labber/trait_cartridge_liquid_protrude.png',
      desc: '포드 내부의 액체가 포드 바깥으로 돌출되어<br>자유로운 형태를 이룰 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_cartridge_liquid_attach',        name: '액체 부착', grade: 'standard', artwork: 'cartridge-attach', anchor: 'trait-liquid-attach',
      image: '../images/labber/trait_cartridge_liquid_attach.png',
      desc: '포드의 액체 일부가 래버의 신체나 의상 등에<br>묻어 있는 형태로 표현될 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_cartridge_pod_open',             name: '포드 개방', grade: 'standard', artwork: 'cartridge-open', anchor: 'trait-pod-open',
      image: '../images/labber/trait_cartridge_pod_open.png',
      desc: '포드의 일부를 외부를 향해 열린 구조로 구성하여<br>개방된 형태로 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_cartridge_pod_split',            name: '포드 분할', grade: 'special', artwork: 'cartridge-split', anchor: 'trait-pod-split',
      image: '../images/labber/trait_cartridge_pod_split.png',
      desc: '포드를 2개의 독립된 공간으로 나눌 수 있습니다.<br>분할된 포드에는 모두 래버의 액체가 담겨 있어야 합니다.',
      acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_cartridge_pod_linear_extension', name: '포드 선형 연장', grade: 'special', artwork: 'cartridge-pod-linear-extension', anchor: 'trait-cartridge-pod-linear-extension',
      image: '../images/labber/trait_cartridge_pod_linear_extension.png',
      desc: '포드의 일부가 가늘고 긴 선형으로 연장되어<br>자유롭게 휘어진 형태를 이룰 수 있습니다.',
      acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
  ],
  // INK 계열 "특성명" — LABBER 포드 내부 액체의 색상 특성. 복수 선택(한 디자인에 여러 색 사용 가능).
  //  · 표시명 표기 고정: 'Ink-<색상>' (I 만 대문자 · nk 소문자 · 색상명 전체 대문자). 다른 표기 금지.
  //  · 등급: RED~PINK = 표준(standard) / NEUTRAL = 특이(special).
  //  · HEX 자동 판정 · 잉크 아이템 소비 로직은 아직 미구현 — 등록/선택/등급 표시까지만.
  //  · 아트워크: trait_ink_*.png 연결 완료(2026-09-08). 9번째 항목의 이미지 파일명만 예외로
  //    trait_ink_natural.png (코드/표시명은 NEUTRAL 유지 — 파일명만 natural).
  //  · DESIGN BY: trait_ink_* 아트워크 디자이너 = LL_TRAIT_DESIGNER(이상어).
  //  · desc: 디자인 규정/설명문 형식(아이템 도감의 관찰 기록체와 다름).
  //  · 획득처: RED~PINK = LABBER 상점 / NEUTRAL = 조합소 (LL_ACQ_* 는 정식 공개 전까지 enabled:false).
  ink: [
    { code: 'labber_ink_red',     name: 'Ink-RED',     grade: 'standard', artwork: 'ink-red',     anchor: 'trait-ink-red',
      image: '../images/labber/trait_ink_red.png',
      desc: '붉은색을 중심으로 구성된 잉크입니다.<br>레드 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_orange',  name: 'Ink-ORANGE',  grade: 'standard', artwork: 'ink-orange',  anchor: 'trait-ink-orange',
      image: '../images/labber/trait_ink_orange.png',
      desc: '주황색을 중심으로 구성된 잉크입니다.<br>오렌지 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_yellow',  name: 'Ink-YELLOW',  grade: 'standard', artwork: 'ink-yellow',  anchor: 'trait-ink-yellow',
      image: '../images/labber/trait_ink_yellow.png',
      desc: '노란색을 중심으로 구성된 잉크입니다.<br>옐로우 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_green',   name: 'Ink-GREEN',   grade: 'standard', artwork: 'ink-green',   anchor: 'trait-ink-green',
      image: '../images/labber/trait_ink_green.png',
      desc: '초록색을 중심으로 구성된 잉크입니다.<br>그린 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_cyan',    name: 'Ink-CYAN',    grade: 'standard', artwork: 'ink-cyan',    anchor: 'trait-ink-cyan',
      image: '../images/labber/trait_ink_cyan.png',
      desc: '청록색을 중심으로 구성된 잉크입니다.<br>시안 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_blue',    name: 'Ink-BLUE',    grade: 'standard', artwork: 'ink-blue',    anchor: 'trait-ink-blue',
      image: '../images/labber/trait_ink_blue.png',
      desc: '푸른색을 중심으로 구성된 잉크입니다.<br>블루 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_purple',  name: 'Ink-PURPLE',  grade: 'standard', artwork: 'ink-purple',  anchor: 'trait-ink-purple',
      image: '../images/labber/trait_ink_purple.png',
      desc: '보라색을 중심으로 구성된 잉크입니다.<br>퍼플 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_pink',    name: 'Ink-PINK',    grade: 'standard', artwork: 'ink-pink',    anchor: 'trait-ink-pink',
      image: '../images/labber/trait_ink_pink.png',
      desc: '분홍색을 중심으로 구성된 잉크입니다.<br>핑크 계열의 색상 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_SHOP, designer: LL_TRAIT_DESIGNER },
    { code: 'labber_ink_neutral', name: 'Ink-NEUTRAL', grade: 'special',  artwork: 'ink-neutral', anchor: 'trait-ink-neutral',
      image: '../images/labber/trait_ink_natural.png',
      desc: '흰색, 회색, 검정 등 무채색으로 구성된 잉크입니다.<br>무채색 범위 내에서 자유롭게 표현할 수 있습니다.',
      acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
  ],
  // 서브젝트는 그룹(어류/조류/파충류/특이)으로 묶어 렌더링. 아트워크 준비된 그룹만
  // group.pending:false 로 개별 공개하고, 나머지는 opts.pending(기본 true, labber-lab.js
  // renderTraits 에서 전달)을 그대로 따른다 — code/anchor 는 미공개 상태에서도 부여해
  // 개체 상세·수정창 딥링크가 동작하도록 한다.
  subject: [
    { group: '어류', pending: false, items: [
      { code: 'labber_subject_clownfish',   name: '흰동가리', grade: 'standard', artwork: 'subject-clownfish', anchor: 'trait-subject-clownfish',
        image: '../images/labber/trait_subject_fish_clownfish.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_sunfish',     name: '개복치', grade: 'standard', artwork: 'subject-sunfish', anchor: 'trait-subject-sunfish',
        image: '../images/labber/trait_subject_fish_sunfish.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_betta',       name: '베타', grade: 'standard', artwork: 'subject-betta', anchor: 'trait-subject-betta',
        image: '../images/labber/trait_subject_fish_betta.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    ] },
    { group: '조류', pending: false, items: [
      { code: 'labber_subject_sparrow',     name: '참새', grade: 'standard', artwork: 'subject-sparrow', anchor: 'trait-subject-sparrow',
        image: '../images/labber/trait_subject_bird_sparrow.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_crow',        name: '까마귀', grade: 'standard', artwork: 'subject-crow', anchor: 'trait-subject-crow',
        image: '../images/labber/trait_subject_bird_crow.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_duck',        name: '오리', grade: 'standard', artwork: 'subject-duck', anchor: 'trait-subject-duck',
        image: '../images/labber/trait_subject_bird_duck.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    ] },
    { group: '파충류', pending: false, items: [
      { code: 'labber_subject_ballpython',  name: '볼파이톤', grade: 'standard', artwork: 'subject-ballpython', anchor: 'trait-subject-ballpython',
        image: '../images/labber/trait_subject_reptile_ball_python.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_crestedgecko', name: '크레스티드 게코', grade: 'standard', artwork: 'subject-crestedgecko', anchor: 'trait-subject-crestedgecko',
        image: '../images/labber/trait_subject_reptile_crested_gecko.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_cooterturtle', name: '쿠터 거북이', grade: 'standard', artwork: 'subject-cooterturtle', anchor: 'trait-subject-cooterturtle',
        image: '../images/labber/trait_subject_reptile_cooter_turtle.png',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    ] },
    { group: '특이', pending: false, items: [
      { code: 'labber_subject_creature',    name: '크리쳐', grade: 'special', artwork: 'subject-creature', anchor: 'trait-subject-creature',
        image: '../images/labber/trait_subject_special_creature.png',
        desc: '직접 디자인한 크리쳐를 서브젝트로 사용할 수 있습니다.<br>오너캐 등의 개인 창작 캐릭터를 사용할 수 있으나,<br>종족에 소속된 개체는 사용할 수 없습니다.',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
      { code: 'labber_subject_species',     name: '종족', grade: 'restricted', artwork: 'subject-species', anchor: 'trait-subject-species',
        image: '../images/labber/trait_subject_special_species.png',
        desc: '종족에 소속된 개체를 서브젝트로 사용할 수 있습니다.<br>해당 종족의 종족주만 사용할 수 있으며,<br>자신이 소유한 종족에 한하여 적용할 수 있습니다.',
        acquisition: LL_ACQ_CRAFT, designer: LL_TRAIT_DESIGNER },
    ] },
  ],
};

const LL_TRAIT_GRADE_LABEL = { standard: '표준', special: '특이', restricted: '제한' };
const LL_TRAIT_GRADE_CLASS = { standard: 'is-standard', special: 'is-special', restricted: 'is-restricted' };

// 관리소 특성 탭 딥링크 base. 뒤에 anchor 를 붙이면 특성 탭 + 해당 하위 탭이 자동 활성화되고 스크롤된다.
const LABBER_TRAIT_DEEPLINK_BASE = 'labber-lab.html?tab=traits#';

// 개체에 붙일 수 있는 특성 타입 (POD/CARTRIDGE/INK/SUBJECT). 소문자 키.
//   multi: 개체가 여러 개 가질 수 있는지.
//     - CARTRIDGE : 복수 (설계상 add-on 특성)
//     - INK       : 복수 (한 디자인에 여러 색상의 액체가 쓰일 수 있음)
//   POD/SUBJECT 는 LABBER 디자인 승인(labber_design_applications: pod_description/subject_description)
//   구조와 동일하게 단일 선택.
const LABBER_TRAIT_TYPES = {
  pod:       { multi: false },
  cartridge: { multi: true  },
  ink:       { multi: true  },
  subject:   { multi: false },
};

function _llTraitView(t, type) {
  return {
    code:       t.code,
    name:       t.name,
    grade:      t.grade,
    type,
    anchor:     t.anchor,
    gradeLabel: LL_TRAIT_GRADE_LABEL[t.grade] || t.grade,
    gradeClass: LL_TRAIT_GRADE_CLASS[t.grade] || '',
  };
}

// 타입의 특성을 그룹 단위로 반환: [{ group: <라벨|null>, items: [view...] }]
//   pod/cartridge → 단일 그룹(group:null), subject → 어류/조류/파충류/특이
function labberTraitGroups(type) {
  const raw = TRAIT_DATA[type] || [];
  const grouped = raw.length && raw[0] && Array.isArray(raw[0].items);
  if (grouped) {
    return raw.map(g => ({
      group: g.group || null,
      items: (g.items || []).filter(t => t.code).map(t => _llTraitView(t, type)),
    }));
  }
  return [{ group: null, items: raw.filter(t => t.code).map(t => _llTraitView(t, type)) }];
}

// 타입의 선택 가능한 특성 목록(flat) — 수정창/파싱용
function labberTraitsByType(type) {
  return labberTraitGroups(type).reduce((acc, g) => acc.concat(g.items), []);
}

// code → 특성 1개 (없으면 null) — pod/cartridge/subject 전부 탐색
function labberTraitByCode(code) {
  if (!code) return null;
  for (const type of Object.keys(LABBER_TRAIT_TYPES)) {
    const hit = labberTraitsByType(type).find(t => t.code === code);
    if (hit) return hit;
  }
  return null;
}

// 관리소 특성 상세 딥링크 (code 또는 anchor 허용)
function labberTraitDeepLink(codeOrAnchor) {
  const t = labberTraitByCode(codeOrAnchor);
  return LABBER_TRAIT_DEEPLINK_BASE + (t ? t.anchor : codeOrAnchor);
}

// 등급 badge HTML — 관리소 특성 UI(.labber-trait-grade)와 동일 마크업 재사용
function labberTraitGradeBadgeHtml(grade) {
  const label = LL_TRAIT_GRADE_LABEL[grade] || grade || '';
  const cls   = LL_TRAIT_GRADE_CLASS[grade] || '';
  return `<span class="labber-trait-grade ${cls}">${label}</span>`;
}

// 값(배열 또는 레거시 문자열) → trait code 배열
//  - 배열이면 알려진 code 만 필터 (중복 제거)
//  - "반원형 포드 (특이) / 액체 돌출 (표준)" 같은 문자열이면 특성명을 찾아 code 로 변환
function labberTraitCodesFromValue(type, value) {
  const items = labberTraitsByType(type);
  const known = new Set(items.map(t => t.code));
  const out = [];
  const push = (code) => { if (code && known.has(code) && !out.includes(code)) out.push(code); };

  if (Array.isArray(value)) {
    value.forEach(push);
    return out;
  }
  if (typeof value !== 'string' || !value.trim()) return out;

  // 구분자(/ , · 、 줄바꿈)로 나눈 뒤, 각 조각에서 (등급)/[등급] 표기를 떼고 특성명 매칭
  value.split(/[\/,、·]|\r?\n/).forEach(rawPart => {
    const part = rawPart.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
    if (!part) return;
    let hit = items.find(t => t.name === part);
    if (!hit) hit = items.find(t => part.includes(t.name) || t.name.includes(part));
    if (hit) push(hit.code);
  });
  return out;
}
