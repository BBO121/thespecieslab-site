// ── 아이템 도감 탭 (pages/dogam.html 의 [아이템 도감] 탭) ─────────
// public.my_item_collection 뷰를 읽어 카테고리별로 보여준다.
// - 2026-09-22: SUBJECT 탭 신설(js/dogam-subject.js)과 한 페이지(dogam.html)에서 같이
//   로드되므로, 짧은 전역 함수명(render/renderCard 등)이 충돌하지 않도록 전체를
//   window.ItemDogam 모듈로 감쌌다. 파일 로드 시 자동 실행되던 initPage() 호출도 제거 —
//   이제 dogam.html 의 js/dogam.js 가 명시적으로 ItemDogam.init() 을 호출한다.
//   HTML 인라인 onclick 은 openIcDetail/closeIcDetail 대신 ItemDogam.openDetail/closeDetail 을 쓴다.
// - 획득 여부(acquired)는 카드 opacity 만 크게(0.4) 차등 — 이름 자체를 가리지 않는다
//   (수집 여부로 아이템명을 숨기는 기능 없음 — 명시적 요청으로 제거됨).
//   단 상세 모달의 설명(description)만 미획득이면 '???' (2026-10-03, openIcDetail).
// - 카드에는 description 을 표시하지 않는다. 목록 = 수집 현황, 모달 = 상세 정보로 분리.
//   description/rarity 는 카드 클릭 시 뜨는 상세 모달(#icDetailModal)에서만 보여준다.
// - 2026-09-06 대분류/소분류 2단 탭 구조로 개편(item_dogam_hierarchy_migration_0906.sql).
//   대분류 4개(연구자료/연구소 물품/특성 아이템/???) + 전체. 연구자료/연구소 물품만 소분류
//   2차 탭이 있다(MINOR_TABS_BY_MAJOR). link.parent_code 가 있으면 그 아이템의 leaf
//   카테고리(link.category)가 소분류, link.parent_code 자체가 대분류 — parent_code 가
//   없으면(예: ???) link.category 자체가 대분류(소분류 없음).
// - 도감 카테고리는 row.dogam_links(jsonb 배열, item_dogam_links 뷰 조인 결과) 기준.
//   → 같은 아이템이 여러 카테고리에 걸리면 각 카테고리 섹션에 한 번씩 노출된다.
// - 옛 LABBER 아이템(수상한 배아샘플 등)처럼 dogam_links 가 없는 row 는 '전체' 탭에서만 노출.
// - link.subcategory = 소분류 그룹핑 헤더용(조식/맥주냉장고 등, render()의 섹션 소제목 —
//   특성 아이템의 포드/카트리지 등은 leaf 카테고리 자체가 대신해서 그쪽은 NULL).
//   link.source_note = "획득처" 표시 전용 자유 텍스트(구내식당/휴게실/LABBER 상점/조합소 등,
//   그룹핑에는 안 쓰임). 획득처 줄은 source_note + subcategory 를 "A · B"로 조합, 부분만 있으면
//   있는 것만, 둘 다 없으면 "미확인"(icAcquisitionValueHtml).
// - 연구소 물품 > 소모품/수집품(IC_ACQUISITION_COARSE_CATEGORIES)은 예외 — 장소 기반
//   subcategory(조식/과자바구니 등)를 섹션 소제목으로도, 획득처 문구에도 안 쓴다(요청사항).
//   render()의 그룹핑과 icAcquisitionValueHtml 둘 다 이 leaf 카테고리만 subcategory 를
//   무시하도록 분기돼 있다 — DB의 subcategory/stage_code 자체는 그대로 보존(탐험 로직용).
// - 카드/탭/모달 디자인은 신규 제작 없이 기존 LABBER 컴포넌트(labber-trait-item 계열,
//   labberlab-traits-title, labber-trait-group, shop-tab-btn, 연구소 상점 #shopDetailModal
//   구조/.shop-detail-*)를 그대로 재사용한다.
// 증감/사용 기능은 여기 없음.

window.ItemDogam = (function () {

  // 구내식당/휴게실 세부 구역 표시 순서 (DB 에 별도 순서 컬럼이 없어 고정 매핑)
  const IC_SUBCATEGORY_ORDER = {
    '조식': 1, '점심': 2, '석식': 3, '야식': 4,
    '과자바구니': 1, '커피머신': 2, '맥주냉장고': 3,
  };

  // 잉크(trait_ink) 소분류 전용 표시 순서 — 이름(Ink-<색상>) 기준. LABBER 상점 LABBER_SHOP_PRODUCTS /
  // 관리소 특성(js/labber-traits.js TRAIT_DATA.ink) 순서와 동일하게 고정한다(가나다순 예외).
  const IC_INK_ORDER = [
    'Ink-RED', 'Ink-ORANGE', 'Ink-YELLOW', 'Ink-GREEN', 'Ink-CYAN', 'Ink-BLUE', 'Ink-PURPLE', 'Ink-PINK', 'Ink-NEUTRAL',
  ];

  // 표본(specimen) 소분류 전용 표시 순서 — 이름 기준, 아이템 계열별(침전물/점액 → 표본 → 이빨 → 수상한 ~)로 묶어
  // 고정한다(가나다순 예외). 보유 여부와 무관하게 동일. 목록에 없는 표본은 맨 뒤에 가나다순.
  const IC_SPECIMEN_ORDER = [
    '검은 침전물', '굳은 액체 덩어리', '말라붙은 점액', '미지근한 점액',
    '깨진 표본 케이스', '미분류 표본', '봉인된 표본',
    '이빨 같은 조각', '작은 이빨', '사악한 이빨',
    '수상한 깃털', '수상한 비늘', '수상한 허물', '수상한 배아샘플',
  ];

  // 소분류(link.category) → 고정 이름 순서. 여기 없는 소분류는 가나다순.
  const IC_FIXED_ORDER_BY_CATEGORY = {
    trait_ink: IC_INK_ORDER,
    specimen:  IC_SPECIMEN_ORDER,
  };

  // 기록물 랜덤(random_record) 개봉 풀 — supabase/labber_random_item_open_0926.sql 의
  // items.metadata.random_pool 과 동일한 11종(뷰에 metadata 가 없어 여기 복제). 풀이 바뀌면 같이 수정.
  const IC_RECORD_RANDOM_POOL = [
    'dogam_records_01', 'dogam_records_02', 'dogam_records_03', 'dogam_records_04', 'dogam_records_06',
    'dogam_records_07', 'dogam_records_10', 'dogam_records_11', 'dogam_records_12', 'dogam_records_13',
    'dogam_records_14',
  ];

  // 소분류(link.category) → code 기준 배치 규칙(가나다순 위에 얹는 예외). 보유 여부와 무관.
  //   head     : 맨 앞 고정. 항목이 code 면 1칸, code 배열이면 한 블록(블록 안은 가나다순).
  //   tail     : 맨 끝 고정(적힌 순서대로). head 보다 우선 — head 블록에 들어 있어도 끝으로 간다.
  //   firstSourceNote : 나머지 중 link.source_note 가 이 값인 것을 먼저, 그 외를 뒤에(각각 가나다순).
  //   together : [a, b, ...] — 모두 있으면 b 이후를 a 바로 뒤로 붙인다.
  //   나머지는 head 와 tail 사이에 가나다순.
  const IC_CODE_ORDER_RULES = {
    records: {
      head: ['random_record', IC_RECORD_RANDOM_POOL],
      tail: ['dogam_records_02', 'dogam_records_01', 'dogam_records_15'], // 손상된 → 빈 → 복구된 데이터칩
      together: [['dogam_records_07', 'dogam_records_06']], // 검수 완료 스티커 · 폐기 스티커
    },
    trait_cartridge: {
      firstSourceNote: 'LABBER 상점', // 상점 판매 카트리지 먼저, 조합소 등은 뒤
    },
    collectible_goods: {
      head: ['random_snack_sticker', 'dogam_lounge_snack_01', 'dogam_lounge_snack_05', 'dogam_lounge_snack_06'], // 띠부씰 랜덤 → 001/002/003
    },
    consumable_goods: {
      together: [['dogam_lounge_coffee_03', 'dogam_lounge_coffee_04']], // 불량 커피 캡슐 · 커피 캡슐
    },
    trait_subject: {
      tail: ['labber_subject_item_species', 'labber_subject_item_creature'], // SUBJECT 특이 : 종족 / 크리쳐
    },
  };

  // 연구소 물품 > 소모품/수집품 은 장소 기반 subcategory(조식/맥주냉장고 등)를 화면에서 안 쓴다 —
  // render()의 섹션 소제목 그룹핑과 icAcquisitionValueHtml 획득처 문구 둘 다 여기서 참조한다.
  const IC_ACQUISITION_COARSE_CATEGORIES = ['consumable_goods', 'collectible_goods'];

  // 대분류별 소분류(2차 탭) — 여기 없는 대분류(특성 아이템/???)는 2차 탭 자체를 안 그린다.
  // (1차 탭 자체는 dogam.html 에 고정 버튼 5개로 이미 있음 — code 는 item_dogam_categories 와 일치)
  const IC_MINOR_TABS_BY_MAJOR = {
    research_material: [
      { code: 'lab_supplies', label: '연구용품' },
      { code: 'records',      label: '기록물' },
      { code: 'specimen',     label: '표본' },
    ],
    lab_goods: [
      { code: 'lab_junk',           label: '잡동사니' },
      { code: 'consumable_goods',  label: '소모품' },
      { code: 'collectible_goods', label: '수집품' },
    ],
  };

  let _icRows   = [];
  let _icCards  = [];   // expandCards(_icRows) 결과 — idx 가 고정되어 탭 필터와 무관하게 모달 조회에 쓰인다.
  let _icMajor  = 'all'; // 1차 탭
  let _icMinor  = 'all'; // 2차 탭 — _icMajor 바뀌면 항상 'all'로 리셋

  async function initPage() {
    const { data, error } = await sb
      .from('my_item_collection')
      .select('*')
      .order('category_sort', { ascending: true })
      .order('rarity_sort',   { ascending: true })
      .order('sort_order',    { ascending: true });

    if (error) throw error;
    _icRows  = data || [];
    _icCards = expandCards(_icRows);

    document.getElementById('icTabRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-major]');
      if (!btn) return;
      document.querySelectorAll('#icTabRow .shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _icMajor = btn.dataset.major;
      _icMinor = 'all'; // 1차 탭이 바뀌면 2차 탭은 항상 "전체"로 리셋
      renderSubTabs();
      render();
    });

    document.getElementById('icSubTabRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-minor]');
      if (!btn) return;
      document.querySelectorAll('#icSubTabRow .shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _icMinor = btn.dataset.minor;
      render();
    });

    renderSubTabs();
    render();
  }

  // row 1개 → "카드 노출 단위" 1개 이상으로 펼친다 (dogam_links 각 항목마다 카드 1장).
  // dogam_links 가 비어 있으면(옛 아이템) 링크 없는 카드 1장으로 취급 — '전체' 탭에서만 보임.
  // idx 는 생성 시점에 한 번만 고정 — 탭 필터로 배열이 줄어들어도 모달 조회(openIcDetail(idx))가 항상 유효하다.
  function expandCards(rows) {
    const out = [];
    rows.forEach(row => {
      const links = Array.isArray(row.dogam_links) ? row.dogam_links : [];
      if (!links.length) {
        out.push({ row, link: null });
      } else {
        links.forEach(link => out.push({ row, link }));
      }
    });
    out.forEach((c, i) => { c.idx = i; });
    return out;
  }

  // 2차 탭(소분류) — _icMajor 에 소분류가 있을 때만 그린다. 개수는 실제 카드 배열을 그대로
  // 세서 표시 — render()의 필터 조건과 동일한 기준(parent_code/category)이라 숫자가 안 어긋난다.
  function renderSubTabs() {
    const wrap = document.getElementById('icSubTabRow');
    const minors = IC_MINOR_TABS_BY_MAJOR[_icMajor];
    if (!minors) { wrap.hidden = true; wrap.innerHTML = ''; return; }

    const chips = [`<button class="shop-tab-btn${_icMinor==='all' ? ' active' : ''}" data-minor="all">전체</button>`]
      .concat(minors.map(m => `<button class="shop-tab-btn${_icMinor===m.code ? ' active' : ''}" data-minor="${escapeHtml(m.code)}">${escapeHtml(m.label)}</button>`));
    wrap.innerHTML = chips.join('');
    wrap.hidden = false;
  }

  function render() {
    const acquiredCount = _icRows.filter(r => r.acquired).length;
    document.getElementById('icSummary').textContent =
      `획득 ${acquiredCount} / 전체 ${_icRows.length}`;

    let cards = _icCards;
    if (_icMajor !== 'all') {
      // parent_code 가 있으면 그게 대분류(leaf category 가 소분류) — 없으면(예: ???) category 자체가 대분류.
      cards = cards.filter(c => c.link && (c.link.parent_code === _icMajor || (!c.link.parent_code && c.link.category === _icMajor)));
      if (IC_MINOR_TABS_BY_MAJOR[_icMajor] && _icMinor !== 'all') {
        cards = cards.filter(c => c.link.category === _icMinor);
      }
    }

    const wrap = document.getElementById('icSections');
    if (!cards.length) {
      wrap.innerHTML = `<p class="empty-state" style="padding:48px 0; text-align:center;">표시할 아이템이 없어요.</p>`;
      return;
    }

    // 2단 그룹: 카테고리(구내식당) → 서브카테고리(조식/점심/...). 서브카테고리 없으면 카테고리 1단만.
    // 연구소 물품 > 소모품/수집품(IC_ACQUISITION_COARSE_CATEGORIES)은 장소 기반 subcategory
    // (조식/과자바구니 등)를 섹션 소제목으로 안 쓴다 — 요청사항. DB 값 자체는 안 건드림,
    // 여기서 그냥 null 취급해서 한 목록으로만 묶는다(획득처 문구는 icAcquisitionValueHtml 담당).
    const cats = new Map(); // catLabel -> { sort, subs: Map(subKey -> {sub, subSort, items:[]}) }
    cards.forEach(c => {
      const catLabel = c.link ? c.link.category_label : (c.row.category_label || '기타');
      const catSort  = c.link ? (c.link.category_sort ?? 999) : 999;
      const coarse   = c.link && IC_ACQUISITION_COARSE_CATEGORIES.includes(c.link.category);
      const sub      = (c.link && !coarse) ? c.link.subcategory : null;

      if (!cats.has(catLabel)) cats.set(catLabel, { sort: catSort, subs: new Map() });
      const cat = cats.get(catLabel);
      const subKey = sub || '';
      if (!cat.subs.has(subKey)) {
        cat.subs.set(subKey, { sub, subSort: sub ? (IC_SUBCATEGORY_ORDER[sub] || 99) : 0, items: [] });
      }
      cat.subs.get(subKey).items.push(c);
    });

    const sortedCats = Array.from(cats.entries()).sort((a, b) => a[1].sort - b[1].sort);

    // 카테고리(소분류 그룹) 안에서는 아이템을 이름 가나다순으로 정렬한다.
    // (기존 등급/sort_order 순서 대신 — 요청사항. 한글·숫자·영문 혼용은 localeCompare('ko')에 맡긴다.)
    const byNameKo = (a, b) => (a.row.name || '').localeCompare(b.row.name || '', 'ko', { numeric: true });

    // 예외(IC_FIXED_ORDER_BY_CATEGORY): 잉크(trait_ink)는 LABBER 상점/관리소 특성 페이지와 동일한 색상 순서,
    // 표본(specimen)은 계열별 고정 순서. 그룹 전체가 같은 소분류일 때만 적용 — 그 외 카테고리는 위 가나다순 그대로.
    const sortGroupItems = (items) => {
      const cat = items.length && items[0].link ? items[0].link.category : null;
      const sameCat = cat && items.every(c => c.link && c.link.category === cat);
      if (sameCat && IC_CODE_ORDER_RULES[cat]) return applyCodeOrderRules(items, IC_CODE_ORDER_RULES[cat]);
      const order = cat && IC_FIXED_ORDER_BY_CATEGORY[cat];
      if (!order || !sameCat) return items.slice().sort(byNameKo);
      const rank = (c) => {
        const i = order.indexOf(c.row.name);
        return i < 0 ? order.length : i;
      };
      return items.slice().sort((a, b) => rank(a) - rank(b) || byNameKo(a, b));
    };

    // IC_CODE_ORDER_RULES 적용 — head 순위 → (나머지: firstSourceNote 일치 → 불일치) → tail 순위,
    // 같은 순위 안은 가나다순. 누락 없이 재배치만 한다.
    function applyCodeOrderRules(items, rule) {
      const head = rule.head || [];
      const tail = rule.tail || [];
      const rank = (c) => {
        const code = c.row.code;
        const t = tail.indexOf(code);
        if (t >= 0) return head.length + 2 + t;
        const h = head.findIndex(e => Array.isArray(e) ? e.includes(code) : e === code);
        if (h >= 0) return h;
        return head.length + (rule.firstSourceNote && c.link.source_note !== rule.firstSourceNote ? 1 : 0);
      };
      let out = items.slice().sort((a, b) => rank(a) - rank(b) || byNameKo(a, b));
      (rule.together || []).forEach(codes => {
        const members = codes.map(code => out.find(c => c.row.code === code));
        if (members.some(m => !m)) return;
        const rest = members.slice(1);
        out = out.filter(c => !rest.includes(c));
        out.splice(out.indexOf(members[0]) + 1, 0, ...rest);
      });
      return out;
    }

    wrap.innerHTML = sortedCats.map(([catLabel, cat]) => {
      const sortedSubs = Array.from(cat.subs.values()).sort((a, b) => a.subSort - b.subSort);
      return `
        <p class="labberlab-traits-title ic-section-title">${escapeHtml(catLabel)}</p>
        ${sortedSubs.map(sg => `
          ${sg.sub ? `<div class="labber-trait-group">${escapeHtml(sg.sub)}</div>` : ''}
          <div class="ic-grid">
            ${sortGroupItems(sg.items).map(renderCard).join('')}
          </div>
        `).join('')}
      `;
    }).join('');
  }

  // 획득처 표시 — link.source_note(구내식당/휴게실/LABBER 상점/조합소 등)와
  // link.subcategory(조식/맥주냉장고 등)를 "A · B"로 조합. 한쪽만 있으면 그것만, 둘 다 없으면 "미확인".
  // 단 소모품/수집품(IC_ACQUISITION_COARSE_CATEGORIES)은 subcategory 를 무시하고 source_note만.
  // 카드/모달이 완전히 동일한 마크업을 쓰도록 공용 함수로 분리 (labber-trait-acquisition-* 클래스 재사용).
  function icAcquisitionValueHtml(link) {
    const coarse = link && IC_ACQUISITION_COARSE_CATEGORIES.includes(link.category);
    const parts = link ? [link.source_note, coarse ? null : link.subcategory].filter(Boolean) : [];
    return parts.length
      ? `<span class="labber-trait-acquisition-plain">${escapeHtml(parts.join(' · '))}</span>`
      : `<span class="labber-trait-acquisition-null">미확인</span>`;
  }

  // ── '???' 비밀 도감 잠금 ────────────────────────────────────────
  // item_dogam_categories.code = 'rare' (label '???') 카테고리는 "정체불명" 비밀 아이템 모음이다.
  // 이 카테고리에 걸린 카드는, 해당 아이템을 한 번도 획득하지 않았으면 이름/이미지/획득처/상세를
  // 전부 '???' 로 가린다 — 실제 name/image_url/source_note/description 을 DOM 에 넣지 않는다.
  // (그 외 카테고리의 미획득 표시는 기존 그대로: opacity 만 낮추고 정보는 공개.)
  // 판별: 그 카드의 도감 링크(leaf category)가 'rare' 이고 && row.acquired 가 false.
  // 예외(IC_SECRET_ITEM_CODES): 다른 카테고리(수집품 등)에 있어도 code 단위로 같은 잠금을 건다 —
  //   과자 봉지 속 띠부씰 001/002/003. 카테고리/위치는 그대로, 미획득일 때 표시만 '???'.
  // row.acquired = user_inventory.first_acquired_at IS NOT NULL (my_item_collection 뷰) —
  //   "한 번이라도 획득" 기준이라 판매/소모/납품으로 수량이 0이 돼도 공개가 유지된다.
  const IC_SECRET_CATEGORY = 'rare';
  const IC_SECRET_ITEM_CODES = ['dogam_lounge_snack_01', 'dogam_lounge_snack_05', 'dogam_lounge_snack_06'];
  function icIsSecretLocked(c) {
    if (!c || !c.row || c.row.acquired) return false;
    return (!!c.link && c.link.category === IC_SECRET_CATEGORY) || IC_SECRET_ITEM_CODES.includes(c.row.code);
  }

  // 카드(.ic-thumb)와 상세 모달(.shop-detail-preview) 둘 다에서 쓰이므로 인라인 style로 크기를 직접 고정한다
  // (연구소 상점 상세모달의 buildPreviewHtml({large:true})와 동일하게 width/height:100% — object-fit만 contain).
  function icThumbHtml(r, name) {
    const style = 'width:100%;height:100%;object-fit:contain;';
    if (r.image_url)  return `<img src="${escapeHtml(r.image_url)}" alt="${escapeHtml(name)}" style="${style}">`;
    if (r.image_path) return `<img src="../${escapeHtml(r.image_path)}" alt="${escapeHtml(name)}" style="${style}">`;
    return `<span class="labber-trait-artwork-ph">ARTWORK</span>`; // 이미지 없으면 관리소와 동일한 옅은 placeholder
  }

  // 도감 카드 — 목록에서는 이미지/이름/획득처/디자인 크레딧만 (설명은 상세 모달에서).
  // 기본은 획득 여부와 무관하게 실제 이름을 표시하고 클릭하면 상세 모달이 열린다.
  // 단 '???' 카테고리 + 미획득(icIsSecretLocked)이면 이름/이미지/획득처를 전부 '???' 로 가린다.
  function renderCard(c) {
    const { row: r, link, idx } = c;
    const locked = !r.acquired;
    const secret = icIsSecretLocked(c);
    const name = secret ? '???' : (r.name || '');

    const qty = (!locked && r.quantity > 0) ? `<p class="ic-qty">보유 ${r.quantity}</p>` : '';

    // 잠금 시 실제 획득처(source_note/subcategory) 대신 '???' — icAcquisitionValueHtml 호출 자체를 건너뛴다.
    const acqHtml = secret
      ? `<span class="labber-trait-acquisition-null">???</span>`
      : icAcquisitionValueHtml(link);
    const source =
      `<p class="labber-trait-acquisition"><span class="labber-trait-acquisition-label">획득처</span> : ${acqHtml}</p>`;

    // 잠금 시 이미지 영역은 실제 <img>(src/alt) 대신 '???' placeholder — 관리소와 동일한 옅은 박스 재사용.
    const thumb = secret
      ? `<span class="labber-trait-artwork-ph">???</span>`
      : icThumbHtml(r, name);

    return `
      <div class="ic-card${locked ? ' ic-card--locked' : ''}${secret ? ' ic-card--secret' : ''}" onclick="ItemDogam.openDetail(${idx})">
        <div class="ic-thumb">${thumb}</div>
        <p class="ic-name">${escapeHtml(name)}</p>
        ${source}
        ${qty}
      </div>`;
  }

  // ── 상세 모달 — 연구소 상점 #shopDetailModal(js/shop.js openDetailModal/closeDetailModal)과
  //    동일한 구조/토글 방식(.shop-detail-*, style.display='flex'/'none')을 별도 노드(#icDetailModal)에
  //    재사용. 획득 여부와 무관하게 열리며, 미획득 아이템도 이름/획득처는 그대로 공개한다
  //    (설명만 '???' — 2026-10-03). ──
  function openIcDetail(idx) {
    const c = _icCards[idx];
    if (!c) return;
    const { row: r, link } = c;
    const secret = icIsSecretLocked(c);   // '???' 카테고리 + 미획득 → 실제 정보 전부 잠금
    const name = secret ? '???' : (r.name || '');

    document.getElementById('icDetailPreview').innerHTML = secret
      ? `<span class="labber-trait-artwork-ph">???</span>`
      : icThumbHtml(r, name);
    document.getElementById('icDetailName').textContent = name;

    // 미획득 아이템 — 이미지만 크게 dim 처리(일반 카테고리는 이름/획득처 그대로 공개, 설명만 '???').
    document.getElementById('icDetailModal').classList.toggle('is-locked', !r.acquired);

    // Design by — 연구소 상점 상세모달과 동일한 표기. designer 없거나 비밀 잠금이면 숨김.
    const creditEl = document.getElementById('icDetailCredit');
    const showCredit = !secret && !!r.designer;
    creditEl.textContent  = showCredit ? `Design by ${r.designer}` : '';
    creditEl.style.display = showCredit ? '' : 'none';

    // 설명(description)은 미획득이면 일반 카테고리여도 '???' — 이름/이미지/획득처/등급은 그대로 공개.
    // 판정은 r.acquired(first_acquired_at 기준)라 판매/소비로 보유량이 0이 돼도 설명은 계속 공개된다.
    document.getElementById('icDetailDesc').textContent = (secret || !r.acquired) ? '???' : (r.description || '');

    document.getElementById('icDetailAcquisition').innerHTML = secret
      ? `<span class="labber-trait-acquisition-label">획득처</span> : <span class="labber-trait-acquisition-null">???</span>`
      : `<span class="labber-trait-acquisition-label">획득처</span> : ${icAcquisitionValueHtml(link)}`;

    // 등급(rarity) — r.rarity_label 은 item_rarities.label 을 그대로 조인해온 값이라
    // JS 는 손댈 게 없다. LABBER 아이템은 rarity 컬럼 자체가 전용 code(labber_standard/
    // labber_special)를 가리키므로 여기 표시되는 건 항상 "표준"/"특이"(대장 등급) —
    // 다른 아이템(일반/고급 등)의 rarity 체계와는 완전히 분리돼 있다. 선택 정보라 값 없거나 비밀 잠금이면 줄 숨김.
    const rarityEl = document.getElementById('icDetailRarity');
    if (!secret && r.rarity_label) {
      rarityEl.textContent  = `등급 : ${r.rarity_label}`;
      rarityEl.style.display = '';
    } else {
      rarityEl.style.display = 'none';
    }

    document.getElementById('icDetailModal').style.display = 'flex';
  }

  function closeIcDetail() {
    document.getElementById('icDetailModal').style.display = 'none';
  }

  return {
    init: initPage,
    openDetail: openIcDetail,
    closeDetail: closeIcDetail,
  };

})();
