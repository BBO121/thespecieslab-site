// ── SUBJECT 도감 탭 (pages/dogam.html 의 [SUBJECT] 탭) ─────────────
// 작성일: 2026-09-22
// 2026-09-24: 개체(instance) 보관/관리 UI(구 [보관소] 필터)는 개인연구실
// (pages/labber-records.html, js/labber-records-subject.js)로 이관했다. 이 파일은
// 이제 순수 "종류(type) 발견 여부 도감"만 담당한다 — 개체 정보(이미지/이름/EXP/레벨/
// 배정 상태)는 여기서 전혀 다루지 않는다.
//
// public.my_subject_collection (supabase/my_subject_collection_view_artwork_fix_0924.sql)을
// 읽어 "종류를 한 번이라도 발견했는가"를 보여준다.
//
// 발견 기준: labber_subject_discoveries(SUBJECT 아이템을 처음 획득한 순간 생성 —
// _apply_item_delta가 기록, 등록/개체화와 무관). 인벤토리 수량은 이 화면과 무관 —
// "보유 N" 표시 없음.
//
// 뷰 컬럼: subject_code / group_name / sort_order / discovered / display_name /
// first_discovered_at. 대표 아트웍은 더 이상 DB(items.image_url)에서 가져오지 않는다
// (2026-09-24 정책 정정) — LABBER 관리소 "특성 > SUBJECT"에 이미 등록된 종류별 아트웍
// (js/labber-traits.js, TRAIT_DATA.subject[].items[].image, 이 페이지에 script로 추가
// 로드)을 subject_code로 그대로 찾아 쓴다. 새 이미지 저장 구조를 만들지 않았다.
// 이 아트웍은 발견 여부와 무관하게 항상 보여주고(숨기지 않음), 미발견이면 opacity만
// 낮춘다(.subj-card--locked, 아이템 도감과 동일한 0.4). display_name도 2026-09-24부터
// 발견 여부와 무관하게 항상 공개한다('???' 마스킹 제거) — discovered는 "미발견" 배지
// 표시에만 쓴다.
//
// js/item-collection.js(ItemDogam)와 같은 페이지(dogam.html)에서 함께 로드되므로 전역
// 함수명 충돌을 피하려고 이 파일도 IIFE(window.SubjectDogam)로 감쌌다. dogam.html 의
// js/dogam.js 가 SUBJECT 탭이 처음 열릴 때 SubjectDogam.init() 을 호출한다(지연 로드).
//
// 필터 탭(group_name) — 하드코딩하지 않고, 조회 결과에서 실제로 나온 그룹을 sort_order
// 순서 그대로 뽑아 동적으로 그린다(현재 DB 값 기준: 어류/조류/파충류/특이).

window.SubjectDogam = (function () {

  let _subjRows  = [];
  let _subjGroup = 'all';

  async function init() {
    document.getElementById('subjSummary').textContent = '불러오는 중...';

    const { data, error } = await sb
      .from('my_subject_collection')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[dogam-subject] init 오류:', error);
      document.getElementById('subjSummary').textContent = '불러오기 실패. 새로고침 해주세요.';
      return;
    }

    _subjRows = data || [];

    renderGroupTabs();
    document.getElementById('subjTabRow').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-group]');
      if (!btn) return;
      document.querySelectorAll('#subjTabRow .shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _subjGroup = btn.dataset.group;
      render();
    });

    render();
  }

  // 필터 칩 — "전체" 다음에 실제 데이터에 나온 그룹(어류/조류/...) 순서대로.
  function renderGroupTabs() {
    const seen = new Set();
    const groups = [];
    _subjRows.forEach(r => {
      if (r.group_name && !seen.has(r.group_name)) { seen.add(r.group_name); groups.push(r.group_name); }
    });

    const chips = [
      `<button type="button" class="shop-tab-btn active" data-group="all">전체</button>`,
    ].concat(groups.map(g => `<button type="button" class="shop-tab-btn" data-group="${escapeHtml(g)}">${escapeHtml(g)}</button>`));
    document.getElementById('subjTabRow').innerHTML = chips.join('');
  }

  function render() {
    const discoveredCount = _subjRows.filter(r => r.discovered).length;
    document.getElementById('subjSummary').textContent =
      `발견 ${discoveredCount} / 전체 ${_subjRows.length}`;

    const rows = _subjGroup === 'all'
      ? _subjRows
      : _subjRows.filter(r => r.group_name === _subjGroup);

    document.getElementById('subjGrid').innerHTML = rows.length
      ? rows.map(renderSubjectCard).join('')
      : `<p class="empty-state" style="padding:48px 0; text-align:center;">표시할 SUBJECT가 없어요.</p>`;
  }

  // 관리소 특성 SUBJECT 데이터(js/labber-traits.js, TRAIT_DATA)에서 종류별 아트웍 경로를
  // 그대로 찾아 쓴다 — labberTraitsByType()/labberTraitByCode()는 image 필드를 view 단계에서
  // 제거하므로 쓸 수 없고, TRAIT_DATA.subject(그룹 배열)를 직접 순회해야 한다.
  function subjectArtworkPath(code) {
    const groups = (typeof TRAIT_DATA !== 'undefined' && TRAIT_DATA.subject) || [];
    for (const g of groups) {
      const hit = (g.items || []).find(t => t.code === code);
      if (hit && hit.image) return hit.image;
    }
    return null;
  }

  function subjThumbHtml(r) {
    const artPath = subjectArtworkPath(r.subject_code);
    if (artPath) {
      const style = 'width:100%;height:100%;object-fit:contain;';
      return `<img src="${escapeHtml(artPath)}" alt="${escapeHtml(r.display_name || '')}" style="${style}">`;
    }
    // 관리소에 아직 아트웍이 없는 종류(정상적으로는 없어야 함)를 대비한 방어용 placeholder.
    return `<span class="labber-trait-artwork-ph">ARTWORK</span>`;
  }

  // 2026-09-24: 미발견 SUBJECT도 종류명을 그대로 공개한다('???' 마스킹 제거) — discovered는
  // "미발견" 배지 표시에만 쓴다.
  function renderSubjectCard(r) {
    const locked = !r.discovered;
    const name = r.display_name || '';
    const metaHtml = locked ? `<p class="subj-card-status">미발견</p>` : '';

    return `
      <div class="subj-card${locked ? ' subj-card--locked' : ''}">
        <div class="subj-card-thumb">${subjThumbHtml(r)}</div>
        <div class="subj-card-body">
          <div class="subj-card-head">
            <p class="subj-card-name">${escapeHtml(name)}</p>
          </div>
          <p class="subj-card-group">${escapeHtml(r.group_name || '')}</p>
          <div class="subj-card-meta">${metaHtml}</div>
        </div>
      </div>`;
  }

  return {
    init,
  };

})();
