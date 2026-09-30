// ── LABBER 관리소 (labber-lab.html) ─────────────────────────────
// 탭: ABOUT LABBER(세계관/설정 기록) / 특성 / 디자인 승인
//
// 디자인 승인 탭 = DESIGN APPROVAL v2 (supabase/labber_design_approval_v2_0920.sql)
//   유저     : 신청서 작성(개체 이미지 + 크롭 썸네일 + 인벤토리 아이템 선택) → 임시저장 → 제출
//              → "내 디자인 승인 신청"(MY APPLICATIONS) 에서 상태/거절 사유 확인 → 거절이면 수정 후 재제출
//   admin·staff: "승인 관리" 서브탭에서 제출된 신청서(이미지·아이템·하고 싶은 말)를 확인 → 승인/거절
//
// 원칙
//   - 모든 쓰기는 RPC (save_labber_design_draft / submit_labber_design / delete_labber_design_draft /
//     approve_labber_design / reject_labber_design). 테이블 직접 INSERT/UPDATE 없음(DB 가 권한 차단).
//   - 아이템 보유/예약/소비 판정은 전부 서버. 여기의 수량 표시는 화면 안내용일 뿐이다.
//   - 이미지는 비공개 버킷 'labber-designs' 에 저장하고 표시할 때마다 signed URL 을 발급한다 (public URL 아님).
//   - 관리자 권한의 실제 판정은 RPC 내부(app_metadata.role). isAdminOrStaff(user_metadata.role)는 UI 게이트로만 쓴다.
//   - 크롭(3:4, 600×800 JPEG)은 개체 등록(character-register.html)과 같은 Cropper.js + js/utils.js 헬퍼를 재사용.

const LL_BUCKET = 'labber-designs';
const LL_SIGNED_TTL = 3600;
const LL_NOTE_MAX = 500;

// 화면 표시 라벨만 바꾼다 (DB status 값 submitted/rejected/approved/registered 는 그대로).
//   흐름: 승인 대기(submitted) → 등록 대기(approved: 디자인 심사 통과) → 승인(registered: 개체 등록 완료), 또는 반려(rejected)
//   최종 "승인" 은 실제 개체 등록이 끝난 registered 에서만 쓴다.
const LL_STATUS_KO = {
  draft: '작성중',
  submitted: '승인 대기',
  rejected: '반려',
  approved: '등록 대기',
  registered: '승인',
};
const LL_STATUS_CLASS = {
  draft: 'is-draft',
  submitted: 'is-pending',
  rejected: 'is-rejected',
  approved: 'is-approved',
  registered: 'is-registered',
};

// 신청서 아이템 슬롯 — 순서가 화면 순서. (분류 기준은 DB items.metadata.kind → _labber_design_slot_of)
const LL_SLOTS = [
  { key: 'myo',       label: 'MYO',       required: true,  emptyMsg: '보유 중인 MYO(래버 배양 시약)가 없어요.' },
  { key: 'pod',       label: 'POD',       required: true,  emptyMsg: '보유 중인 POD 모듈이 없어요.' },
  { key: 'ink',       label: 'INK',       required: true,  emptyMsg: '보유 중인 INK가 없어요.' },
  { key: 'cartridge', label: 'CARTRIDGE', required: false, emptyMsg: '보유 중인 카트리지가 없어요.' },
];

const LL_ITEM_STATE_KO = { reserved: '예약', consumed: '소비됨', released: '해제' };

// 심사 기록(이력) 표기 — 위 상태 라벨과 뜻이 겹치지 않게: approved 이벤트 = 디자인 심사 통과(등록 대기), registered 이벤트 = 개체 등록 완료(최종 승인)
const LL_EVENT_KO = { submitted: '제출', approved: '심사 통과 (등록 대기)', rejected: '반려', registered: '개체 등록 (승인)' };

const LL_MANAGER_LINE = '지금 몇시야... ... 어, 왔어? LABBER 디자인 검토해줄까?';

// 관리자 상태 탭 (draft 는 관리자에게 보이지 않는다)
const LL_ADMIN_TABS = [
  { key: 'submitted',  label: '승인 대기', statuses: ['submitted'] },
  { key: 'approved',   label: '등록 대기', statuses: ['approved'] },
  { key: 'rejected',   label: '반려',      statuses: ['rejected'] },
  { key: 'registered', label: '승인',      statuses: ['registered'] },
  { key: 'all',        label: '전체',      statuses: null },
];

// SUBJECT 승인 상태 탭 — 가방 SUBJECT 등록 신청(labber_subject_bag_registrations)은
// submitted/approved/rejected 3가지 상태뿐이라 LL_ADMIN_TABS보다 단순하다.
const LL_SUBJECT_APPROVAL_TABS = [
  { key: 'submitted', label: '승인 대기', statuses: ['submitted'] },
  { key: 'approved',  label: '승인',      statuses: ['approved'] },
  { key: 'rejected',  label: '반려',      statuses: ['rejected'] },
  { key: 'all',       label: '전체',      statuses: null },
];

// ── 디자인 승인 기능 노출 플래그 ─────────────────────────────
// DESIGN_APPROVAL_ENABLED=false 면 '디자인 승인' 탭은 준비중 화면만 표시하고 모든 진입점이 막힌다.
// true 로 켜려면 supabase/labber_design_approval_v2_0920.sql 이 먼저 실행되어 있어야 한다(없으면 목록/제출이 오류).
// ※ 이 값을 true 로 둔 채 커밋/배포하면 PUBLIC 사이트에 신청 폼이 열린다 — 배포 시점에 의도적으로 결정할 것.
const DESIGN_APPROVAL_ENABLED = true;

let _llUser = null;
let _llIsAdmin = false;

// ── 유저 폼 상태 ──
let _llMyRows = [];
let _llApp = null;                 // 편집 중 신청서 { id, status, items } — null = 아직 서버에 없는 새 신청
let _llInv = [];                   // get_my_labber_design_inventory 결과
let _llSel = {};                   // 단일 슬롯(MYO/POD/INK): slot -> item_id. subject 키는 선택된 subject_instance_id(문자열)를 담는다.
let _llCart = new Set();           // CARTRIDGE(복수 종류 선택, 종류당 1개): 선택된 item_id 집합 — 수량 개념 없음
let _llSubjectInstances = [];      // 내 SUBJECT 보관소의 미배정 instance 목록(my_subject_instances, is_assigned=false) — 신청서에서 선택 가능한 후보
let _llPaths = { character: null, thumbnail: null };   // 서버에 저장된 경로
let _llUrls = {};                  // path -> signed URL (미리보기)
const _llPending = { character: null, thumbnail: null }; // 아직 업로드 안 한 새 이미지 { blob, url, ext }
let _llDesigner = null;            // CreatorPicker — 개체 디자이너(필수)
let _llArtist = null;              // CreatorPicker — 개체 아티스트(선택)
let _llSpeciesNames = {};          // species_id → 종족명 (카드 표시용 — 레거시 디자인 신청서 + 가방 SUBJECT 등록 신청의 subject_species_id)
const LL_SPECIES_SUBJECT_CODE = 'labber_subject_species';   // 종족형 SUBJECT "특이: 종족" (labber_subject_types.code)
let _llCropper = null;
let _llCropSource = null;          // 크롭 대상 Blob
let _llCropSrcUrl = null;
let _llCropIsNew = false;          // 새로 고른 이미지의 첫 크롭인지 (취소 시 그 선택을 폐기)
let _llBusy = false;

// ── 관리자 상태 ──
let _llAdminTab = 'submitted';
let _llAdminRows = [];
let _llAdminBusy = false;

// ── SUBJECT 승인 상태 ──
let _llSubjectAdminTab = 'submitted';
let _llSubjectAdminRows = [];   // labber_subject_bag_registrations 행 + 표시용 캐시(_nick/_itemName/_subjectName)
let _llSubjectAdminBusy = false;

// ── 초기화 ────────────────────────────────────────────────────
async function initPage() {
  try {
    _llUser = await getUser();
    _llIsAdmin = !!_llUser && isAdminOrStaff(_llUser.user_metadata?.role);

    setupTabs();
    renderTraits();
    setupTraitSubtabs();
    runManagerTyping();

    // DESIGN APPROVAL
    if (DESIGN_APPROVAL_ENABLED) {
      setupApprovalUi();
    } else {
      showApprovalPending();   // 런칭 임시 비공개 — 준비중 화면
    }

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';

    // 딥링크: ?tab=about|traits|guide|usage|approval , ?app=<id>
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'my') switchTab('approval');
    else if (['about', 'traits', 'guide', 'usage', 'approval'].includes(tab)) switchTab(tab);

    // 특성 딥링크(#trait-*) — ?tab= 처리 뒤에 실행해 특성 탭/하위 탭을 확정하고 스크롤
    handleTraitHashDeepLink();
    window.addEventListener('hashchange', handleTraitHashDeepLink);
    // 같은 #trait-* 링크를 다시 누르면 hashchange 가 안 생기므로 직접 처리 (가이드 → 특성 → 가이드 → 재클릭)
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#trait-"]');
      if (a && location.hash === a.getAttribute('href')) {
        e.preventDefault();
        handleTraitHashDeepLink();
      }
    });

    // 데이터 로드 (디자인 승인 공개 시에만)
    if (DESIGN_APPROVAL_ENABLED) {
      if (!_llUser) {
        showLoginPrompt();
      } else {
        await loadMyList();
        if (_llIsAdmin) {
          await loadAdminList();
          await loadSubjectApprovalList();
        }
        const focusId = params.get('app');
        if (focusId) {
          if (_llIsAdmin) setApprovalMode('mine');   // 알림 링크는 "내 신청" 카드로 연결된다
          focusApplication(focusId);
        }
      }
    }
  } catch (e) {
    console.error('[labber-lab] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

// ── 탭 ───────────────────────────────────────────────────────
function setupTabs() {
  document.getElementById('tabRow').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });
}

// ── 특성 데이터 (POD / CARTRIDGE / SUBJECT) ─────────────────────
// TRAIT_DATA / LL_TRAIT_GRADE_LABEL / LL_TRAIT_GRADE_CLASS / LL_TRAIT_DESIGNER / LL_ACQ_* 는
// js/labber-traits.js (공통 모듈) 로 이전 — labber-lab.html 에서 이 파일보다 먼저 로드된다.
// 관리소·개체 수정창·개체 상세가 같은 데이터를 참조하도록 하기 위함(이중 관리 금지).

// 준비중 아트워크 placeholder 박스 (서브젝트 섹션 전체 / 개별 항목 아트워크 미준비 공용).
// CSS: .labber-trait-ph-pending (_labber-lab.scss)
function traitPendingArtworkHtml(subLabel) {
  return `
        <div class="labber-trait-ph-pending" role="img" aria-label="준비중 — ${escapeHtml(subLabel)}">
          <span class="labber-trait-ph-pending-main">준비중</span>
          <span class="labber-trait-ph-pending-sub">${escapeHtml(subLabel)}</span>
        </div>`;
}

// 특성 카드 1개 HTML
// opts.pending = true (서브젝트 준비중): 아트워크는 "준비중" placeholder 고정,
//   상세 설명/획득처/DESIGN BY 줄은 렌더링하지 않는다. (탭/카드 구조·이름·등급 badge 는 그대로)
function renderTraitCard(t, opts = {}) {
  const pending    = !!opts.pending;
  const gradeLabel = LL_TRAIT_GRADE_LABEL[t.grade] || t.grade;
  const gradeClass = LL_TRAIT_GRADE_CLASS[t.grade] || '';

  const descHtml = (!pending && t.desc) ? `<p class="labber-trait-desc">${t.desc}</p>` : '';

  let acquisitionHtml = '';
  if (!pending) {
    const acq = t.acquisition || {};
    let acqValueHtml;
    if (acq.label && acq.url && acq.enabled) {
      // 공개됨 — 실제 이동 링크
      acqValueHtml = `<a class="labber-trait-acquisition-link" href="${escapeHtml(acq.url)}">${escapeHtml(acq.label)}</a>`;
    } else if (acq.label) {
      // 목적지는 data-href 로 준비, 현재 비활성 — href 없음(이동/# 튐 없음), aria-disabled.
      // 공개 시 acq.enabled 를 true 로 바꾸면 위 분기로 실제 링크가 된다.
      const dataHref = acq.url ? ` data-href="${escapeHtml(acq.url)}"` : '';
      acqValueHtml = `<a class="labber-trait-acquisition-link is-disabled" role="link" aria-disabled="true"${dataHref}>${escapeHtml(acq.label)}</a>`;
    } else {
      acqValueHtml = `<span class="labber-trait-acquisition-null">null</span>`;
    }
    acquisitionHtml =
      `<p class="labber-trait-acquisition"><span class="labber-trait-acquisition-label">획득처</span> : ${acqValueHtml}</p>`;
  }

  // 준비중이면 DESIGN BY 줄 자체를 렌더링하지 않는다(빈 줄도 남기지 않음).
  const creditHtml = (!pending && t.designer)
    ? `<p class="labber-trait-credit">DESIGN BY <span class="labber-trait-credit-name">${escapeHtml(t.designer)}</span></p>`
    : '';

  // 아트워크 영역:
  //  - 준비중(서브젝트 섹션): 준비중 placeholder 박스 — 실제 이미지/artwork 미노출.
  //  - 개별 항목 아트워크 미준비(t.imagePending): 같은 placeholder 박스 재사용 (깨진 이미지 아이콘 방지).
  //    → 파일 준비 후 해당 항목의 imagePending 플래그만 지우면 t.image 로 실제 <img> 표시.
  //  - 평상시: t.image 있으면 실제 <img> (CSS :has(img) 로 ARTWORK placeholder 자동 숨김).
  let artworkInner;
  if (pending) {
    artworkInner = traitPendingArtworkHtml('SUBJECT DATA PENDING');
  } else if (t.imagePending) {
    artworkInner = traitPendingArtworkHtml('ARTWORK PENDING');
  } else {
    const artworkHtml = t.image
      ? `<img src="${escapeHtml(t.image)}" alt="${escapeHtml(t.name)}">`
      : (t.artwork ? `<!-- artwork 예정: ${escapeHtml(t.artwork)} -->` : '');
    artworkInner = `
        <span class="labber-trait-artwork-ph">ARTWORK</span>
        ${artworkHtml}`;
  }

  const idAttr = t.anchor ? ` id="${escapeHtml(t.anchor)}"` : '';

  return `
    <article class="labber-trait-item"${idAttr}>
      <div class="labber-trait-artwork">${artworkInner}
      </div>
      <div class="labber-trait-body">
        <div class="labber-trait-head">
          <h4 class="labber-trait-name">${escapeHtml(t.name)}</h4>
          <span class="labber-trait-grade ${gradeClass}">${gradeLabel}</span>
        </div>
        ${descHtml}
        ${acquisitionHtml}
        ${creditHtml}
      </div>
    </article>`;
}

// 특성 목록 1개 섹션(POD/CARTRIDGE 처럼 groups 없이 flat, 또는 SUBJECT처럼 그룹 포함) 렌더링
function renderTraitSection(containerId, catLabel, groups, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let html = `<p class="labber-trait-cat">${catLabel}</p>`;
  groups.forEach((g) => {
    if (g.group) html += `<p class="labber-trait-group">${escapeHtml(g.group)}</p>`;
    const groupOpts = g.pending !== undefined ? { ...opts, pending: g.pending } : opts;
    html += g.items.map(it => renderTraitCard(it, groupOpts)).join('');
  });
  el.innerHTML = html;
}

function renderTraits() {
  renderTraitSection('trait-pod', 'POD', [{ group: null, items: TRAIT_DATA.pod }]);
  renderTraitSection('trait-cartridge', 'CARTRIDGE', [{ group: null, items: TRAIT_DATA.cartridge }]);
  renderTraitSection('trait-ink', 'INK', [{ group: null, items: TRAIT_DATA.ink }]);
  // 서브젝트: 기본은 준비중(그룹별 pending:false 로 개별 공개 — js/labber-traits.js 참고)
  renderTraitSection('trait-subject', 'SUBJECT', TRAIT_DATA.subject, { pending: true });
}

// 특성 탭 내부 하위 탭 (포드 / 카트리지 / 서브젝트). 상위 탭과 독립, 정적 콘텐츠만 토글.
const LL_TRAIT_SUBTAB_KEYS = ['pod', 'cartridge', 'ink', 'subject'];

function activateTraitSubtab(key) {
  if (!LL_TRAIT_SUBTAB_KEYS.includes(key)) return;
  const row = document.getElementById('traitSubtabs');
  if (row) {
    row.querySelectorAll('.labber-trait-subtab').forEach(b =>
      b.classList.toggle('active', b.dataset.trait === key));
  }
  LL_TRAIT_SUBTAB_KEYS.forEach(k => {
    const el = document.getElementById('trait-' + k);
    if (el) el.hidden = (k !== key);
  });
}

function setupTraitSubtabs() {
  const row = document.getElementById('traitSubtabs');
  if (!row) return;
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-trait]');
    if (btn) activateTraitSubtab(btn.dataset.trait);
  });
}

// ── 특성 딥링크 (labber-lab.html#trait-*) ────────────────────
// LABBER 상점 상품 설명의 "적용 특성" 링크 등에서 진입. hash 는 이 페이지에서 다른 용도로
// 쓰지 않으므로(탭 전환은 ?tab= 쿼리) 충돌 없음. anchor → 하위 탭은 TRAIT_DATA 에서 역산.
function traitSubtabOfAnchor(anchor) {
  // 하위 탭 영역 자체(#trait-pod / #trait-subject 등) — 디자인 가이드의 「특성 > SUBJECT」 링크
  const listKey = LL_TRAIT_SUBTAB_KEYS.find(k => anchor === 'trait-' + k);
  if (listKey) return listKey;
  if (TRAIT_DATA.pod.some(t => t.anchor === anchor)) return 'pod';
  if (TRAIT_DATA.cartridge.some(t => t.anchor === anchor)) return 'cartridge';
  if ((TRAIT_DATA.ink || []).some(t => t.anchor === anchor)) return 'ink';
  const inSubject = (TRAIT_DATA.subject || []).some(g => (g.items || []).some(t => t.anchor === anchor));
  return inSubject ? 'subject' : null;
}

function handleTraitHashDeepLink() {
  const anchor = (location.hash || '').replace(/^#/, '');
  if (!anchor) return;
  const sub = traitSubtabOfAnchor(anchor);
  if (!sub) return;                 // 알 수 없는 hash → 무시 (기존 동작 유지)
  switchTab('traits');             // ?tab=traits 로 replaceState (hash 는 보존됨)
  activateTraitSubtab(sub);
  // 하위 탭 영역 링크면 하위 탭 버튼 줄(서브젝트 활성 표시)이 보이도록 그 위치로 스크롤
  const el = anchor === 'trait-' + sub
    ? (document.getElementById('traitSubtabs') || document.getElementById(anchor))
    : document.getElementById(anchor);
  if (el) {
    // 탭이 표시(hidden 해제)된 뒤 레이아웃이 잡히도록 다음 프레임에 스크롤
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function switchTab(tab) {
  document.querySelectorAll('#tabRow .shop-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['about', 'traits', 'guide', 'usage', 'approval'].forEach(t => {
    document.getElementById('tab-' + t).hidden = (t !== tab);
  });
  const url = new URL(location.href);
  url.searchParams.set('tab', tab);
  url.searchParams.delete('app');
  history.replaceState(null, '', url);

  if (DESIGN_APPROVAL_ENABLED && tab === 'approval' && !_llUser) showLoginPrompt();
}

// 디자인 승인 준비중 (DESIGN_APPROVAL_ENABLED=false) — 기존 하위 뷰(신청 폼/관리자/내 신청)를
// 모두 숨기고 준비중 empty-state 를 표시. 플래그를 true 로 되돌리면 이 함수는 호출되지 않고
// 기존 UI 가 그대로 복구된다. (DOM 요소는 삭제하지 않음 — hidden 처리)
function showApprovalPending() {
  ['approvalUserView', 'approvalAdminView', 'mySection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  const tab = document.getElementById('tab-approval');
  if (!tab || document.getElementById('approvalPending')) return;
  const box = document.createElement('div');
  box.id = 'approvalPending';
  box.className = 'labberlab-approval-pending';
  box.innerHTML = `
    <span class="labberlab-approval-pending-eyebrow">DESIGN APPROVAL</span>
    <p class="labberlab-approval-pending-title">준비중</p>
    <p class="labberlab-approval-pending-desc">LABBER 디자인 승인 시스템을 준비하고 있습니다.</p>`;
  tab.prepend(box);
}

// 비로그인 사용자가 '디자인 승인' 탭을 열었을 때 로그인 안내 (신청/목록/관리 뷰는 모두 숨김)
function showLoginPrompt() {
  const guest = document.getElementById('approvalGuest');
  if (guest) { guest.hidden = false; guest.style.display = ''; }
  ['mySection', 'designForm', 'approvalModeRow', 'approvalAdminView'].forEach(id => llShow(id, false));
}

// ── INDIVIDUAL B 타이핑 ──────────────────────────────────────
function runManagerTyping() {
  const el = document.getElementById('managerLine');
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.textContent = LL_MANAGER_LINE; return; }
  let i = 0;
  el.textContent = '';
  el.classList.add('labberlab-typing');
  (function tick() {
    if (i < LL_MANAGER_LINE.length) {
      el.textContent += LL_MANAGER_LINE[i++];
      setTimeout(tick, 32);
    } else {
      el.classList.remove('labberlab-typing');
    }
  })();
}

// ── signed URL ──────────────────────────────────────────────
async function signedUrlFor(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from(LL_BUCKET).createSignedUrl(path, LL_SIGNED_TTL);
  if (error) { console.warn('[labber-lab] signed URL 실패:', error.message); return null; }
  return data?.signedUrl || null;
}

async function signedUrlMap(paths) {
  const uniq = [...new Set(paths.filter(Boolean))];
  const map = {};
  if (!uniq.length) return map;
  const { data, error } = await sb.storage.from(LL_BUCKET).createSignedUrls(uniq, LL_SIGNED_TTL);
  if (error) { console.warn('[labber-lab] signed URLs 실패:', error.message); return map; }
  (data || []).forEach(row => { if (row && !row.error && row.signedUrl) map[row.path] = row.signedUrl; });
  return map;
}

// ── 신청 카드 렌더 공용 ─────────────────────────────────────
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '.').replace(/\.$/, '');
}
function shortId(id) { return String(id).slice(0, 8).toUpperCase(); }


// ══════════════════════════════════════════════════════════════
// DESIGN APPROVAL v2 — 공용 헬퍼
// ══════════════════════════════════════════════════════════════
const LL_APP_SELECT =
  '*, items:labber_design_application_items(slot,state,item_id,item:items(code,name,image_url,image_path)),' +
  ' events:labber_design_application_events(action,reason,created_at)';

function llEl(id) { return document.getElementById(id); }

function llShow(id, show) {
  const el = llEl(id);
  if (!el) return;
  el.hidden = !show;
  el.style.display = show ? '' : 'none';
}

function llSlotLabel(key) {
  const s = LL_SLOTS.find(x => x.key === key);
  return s ? s.label : key;
}

// RPC 응답({success:false,error,detail}) → 한글 안내문
function llErrText(res) {
  const detail = res && res.detail;
  const slot = detail ? llSlotLabel(detail) : '';
  const map = {
    NOT_AUTHENTICATED: '로그인이 필요해요.',
    FORBIDDEN: '권한이 없어요.',
    NOT_FOUND: '신청서를 찾을 수 없어요.',
    NOT_EDITABLE: '이미 제출되어 수정할 수 없어요.',
    NOT_DELETABLE: '삭제할 수 없는 신청서예요.',
    HAS_HISTORY: '심사 기록이 있는 신청서는 삭제할 수 없어요.',
    INVALID_STATUS: '이미 처리되었거나 처리할 수 없는 상태예요. 화면을 새로고침해 확인해주세요.',
    TOO_MANY_OPEN: '작성 중이거나 심사 중인 신청서는 최대 5건까지예요. 기존 신청서를 정리한 뒤 다시 시도해주세요.',
    MISSING_CHARACTER_IMAGE: '개체 이미지를 업로드해주세요.',
    MISSING_THUMBNAIL: '썸네일을 지정해주세요.',
    MISSING_ITEM: `${slot} 아이템을 선택해주세요.`,
    INSUFFICIENT_ITEM: `${slot} 아이템의 사용 가능한 수량이 부족해요. (보유하지 않았거나 다른 신청서에 예약되어 있어요)`,
    INVALID_ITEM: `${slot} 슬롯에 선택할 수 없는 아이템이에요.`,
    INVALID_SUBJECT: '선택한 SUBJECT 에 문제가 있어요. 운영진에게 문의해주세요.',
    INVALID_SUBJECT_INSTANCE: '선택한 SUBJECT 를 찾을 수 없어요. 보관소에서 다시 선택해주세요.',
    SUBJECT_INSTANCE_REQUIRED: 'SUBJECT 선택에 문제가 있어요. 보관소에서 다시 선택해주세요.',
    SUBJECT_INSTANCE_ALREADY_ASSIGNED: '선택한 SUBJECT 가 이미 다른 LABBER에 배정되어 있어요. 보관소에서 다시 선택해주세요.',
    INVALID_IMAGE_PATH: '이미지 정보가 올바르지 않아요. 이미지를 다시 업로드해주세요.',
    NOTE_TOO_LONG: `하고 싶은 말은 ${LL_NOTE_MAX}자 이하로 입력해주세요.`,
    REASON_REQUIRED: '거절 사유를 입력해주세요.',
    REASON_TOO_LONG: '거절 사유는 500자 이하로 입력해주세요.',
    RESERVATION_MISSING: `${slot} 예약 정보가 없어요. 신청서를 다시 확인해주세요.`,
    CONSUME_FAILED: `아이템 소비에 실패했어요. 신청자의 보유 수량을 확인해주세요. (${detail || ''})`,
    INVALID_PAYLOAD: '요청 형식이 올바르지 않아요.',
    INVALID_QUANTITY: '같은 카트리지는 신청서 1건에 1개까지만 사용할 수 있어요.',
    DUPLICATE_ITEM: '같은 카트리지는 중복해서 선택할 수 없어요.',
    DESIGNER_REQUIRED: '개체 디자이너를 1명 이상 추가해주세요.',
    INVALID_CREATOR: '개체 디자이너/아티스트 정보가 올바르지 않아요. (연구소 유저는 실제 존재하는 유저여야 하고, 이름은 40자, 연락처는 100자 이하예요)',
    INVALID_SUBJECT_CREATOR: 'SUBJECT 디자이너/아티스트 정보가 올바르지 않아요. (연구소 유저는 실제 존재하는 유저여야 하고, 이름은 40자, 연락처는 100자 이하예요)',
    SUBJECT_DESIGNER_REQUIRED: 'SUBJECT 디자이너를 1명 이상 추가해주세요.',
    SUBJECT_SPECIES_REQUIRED: '종족형 SUBJECT 의 연결 종족을 선택해주세요.',
    INVALID_SUBJECT_SPECIES: '선택한 종족을 찾을 수 없어요. 다시 선택해주세요.',
    SUBJECT_SPECIES_IS_LABBER: 'LABBER 는 연결 종족으로 선택할 수 없어요.',
    SUBJECT_SPECIES_NOT_OWNED: '내가 종족주인 종족만 선택할 수 있어요. (종족주가 바뀌었다면 다른 종족을 선택해주세요)',
  };
  return map[res && res.error] || `처리에 실패했어요. (${(res && res.error) || 'unknown'})`;
}

// 아이템 이미지 — items.image_url → image_path(http 만) → placeholder. (없으면 임시 이미지를 만들지 않는다)
function llItemImg(it) {
  const u = (it && it.image_url) || (it && /^https?:/.test(it.image_path || '') ? it.image_path : null);
  return u ? `<img src="${escapeHtml(u)}" alt="" loading="lazy">` : '<span class="llapp-item-ph">NO IMG</span>';
}

function llRowPaths(rows) {
  const out = [];
  rows.forEach(r => out.push(r.character_image_path, r.thumbnail_path, r.subject_image_path));
  return out;
}

// 썸네일/열기 링크 클릭 처리 (내 목록·관리자 목록 공용). 처리했으면 true.
function llHandleCommonClick(e) {
  const img = e.target.closest('.labberlab-app-thumb img');
  if (img && img.dataset.full) { window.open(img.dataset.full, '_blank', 'noopener'); return true; }
  const opener = e.target.closest('[data-open-url]');
  if (opener) { window.open(opener.dataset.openUrl, '_blank', 'noopener'); return true; }
  return false;
}

// ══════════════════════════════════════════════════════════════
// UI 바인딩
// ══════════════════════════════════════════════════════════════
function setupApprovalUi() {
  llEl('newAppBtn').addEventListener('click', () => openForm(null));
  llEl('cancelFormBtn').addEventListener('click', () => closeForm(true));   // 임시저장한 draft 가 목록에 보이도록 항상 새로고침
  llEl('saveDraftBtn').addEventListener('click', () => onSaveDraft());
  llEl('designForm').addEventListener('submit', (e) => { e.preventDefault(); onSubmitApplication(); });
  llEl('charFile').addEventListener('change', (e) => onCharacterPick(e.target));
  llEl('thumbEditBtn').addEventListener('click', () => onThumbnailEdit());
  llEl('noteInput').addEventListener('input', updateNoteCount);
  llEl('itemPickers').addEventListener('change', onPickerChange);
  llEl('itemPickers').addEventListener('click', onCartToggleClick);
  llEl('subjectInstancePicker').addEventListener('change', onSubjectInstancePickerChange);
  llEl('cropCancelBtn').addEventListener('click', onCropCancel);
  llEl('cropAsIsBtn').addEventListener('click', onCropAsIs);
  llEl('cropConfirmBtn').addEventListener('click', onCropConfirm);
  llEl('myAppList').addEventListener('click', onMyListClick);

  // 디자이너(필수) / 아티스트(선택) — character-register 와 같은 입력 방식 (js/creator-picker.js)
  if (window.CreatorPicker) {
    _llDesigner = CreatorPicker.create(llEl('designerPicker'), {
      kind: 'designer', required: true, label: '개체 디자이너', hint: 'LABBER 개체 자체의 디자이너 · 여러 명 추가 가능 · 순서대로 표시됩니다',
    });
    _llArtist = CreatorPicker.create(llEl('artistPicker'), {
      kind: 'artist', required: false, label: '개체 아티스트', hint: 'LABBER 개체 일러스트를 그린 사람 크레딧 · 여러 명 추가 가능',
    });
  }

  if (_llIsAdmin) setupAdminUi();
  else llShow('approvalModeRow', false);
}

// ══════════════════════════════════════════════════════════════
// 카드 렌더 (내 목록 / 관리자 목록 공용)
// ══════════════════════════════════════════════════════════════
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return fmtDate(ts) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function llSortItems(items) {
  const order = LL_SLOTS.map(s => s.key);
  return [...(items || [])].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
}

// SUBJECT 제작자 / 연결 종족 표시 (개체 제작자와 구분되도록 별도 블록·라벨). SUBJECT 가 없거나 값이 없으면(기능 추가 이전 신청서) 빈 문자열.
function llSubjectCreditBlock(row) {
  const des = row.subject_designer_nickname;
  const art = row.subject_artist_nickname;
  const spName = row.subject_species_id ? (_llSpeciesNames[row.subject_species_id] || '(알 수 없는 종족)') : '';
  if (!des && !art && !spName) return '';
  return `<dl class="labberlab-app-fields llapp-subject-credit-fields">
    ${des ? `<div><dt>SUBJECT 디자이너</dt><dd>${escapeHtml(des)}</dd></div>` : ''}
    ${art ? `<div><dt>SUBJECT 아티스트</dt><dd>${escapeHtml(art)}</dd></div>` : ''}
    ${spName ? `<div><dt>연결 종족</dt><dd>${escapeHtml(spName)}</dd></div>` : ''}
  </dl>`;
}

// 목록의 subject_species_id → 종족명 (카드 표시용). 실패해도 카드 렌더는 계속된다.
async function llLoadSpeciesNames(rows) {
  const ids = [...new Set((rows || []).map(r => r.subject_species_id).filter(Boolean))].filter(id => !(id in _llSpeciesNames));
  if (!ids.length) return;
  try {
    const { data, error } = await sb.from('species').select('id, name').in('id', ids);
    if (error) throw error;
    (data || []).forEach(s => { _llSpeciesNames[s.id] = s.name; });
  } catch (e) { console.warn('[labber-lab] 연결 종족명 조회 실패:', e); }
}

function appCardHtml(row, urls, opts = {}) {
  const st = row.status || 'draft';
  const charUrl = urls[row.character_image_path] || null;
  const thumbUrl = urls[row.thumbnail_path] || charUrl;
  const subjUrl = urls[row.subject_image_path] || null;
  const dateTs = row.submitted_at || row.created_at;

  const items = llSortItems(row.items);
  const itemsHtml = items.length
    ? `<ul class="llapp-card-items">${items.map(it => {
        const badge = (['submitted'].includes(st) && it.state === 'reserved') || (['approved', 'registered'].includes(st) && it.state === 'consumed')
          ? `<b class="llapp-state is-${it.state}">${LL_ITEM_STATE_KO[it.state]}</b>` : '';
        return `<li class="llapp-card-item">
          <span class="llapp-card-item-img">${llItemImg(it.item)}</span>
          <span class="llapp-card-item-txt"><em>${llSlotLabel(it.slot)}</em><span>${escapeHtml((it.item && it.item.name) || '아이템')}</span>${badge}</span>
        </li>`;
      }).join('')}</ul>`
    : '<p class="llapp-hint">선택한 아이템이 없어요.</p>';

  const links = [
    charUrl  ? `<button type="button" class="llapp-link" data-open-url="${escapeHtml(charUrl)}">원본 이미지</button>` : '',
    thumbUrl && row.thumbnail_path ? `<button type="button" class="llapp-link" data-open-url="${escapeHtml(thumbUrl)}">썸네일</button>` : '',
    subjUrl  ? `<button type="button" class="llapp-link" data-open-url="${escapeHtml(subjUrl)}">SUBJECT 이미지</button>` : '',
  ].filter(Boolean).join('');

  // 관리자 심사용 SUBJECT 이미지 미리보기 — SUBJECT 아이템이 선택돼 있고 subject_image_path 가 있을 때만 만든다.
  // (SUBJECT 없는 신청서는 영역 자체가 없다.) 이미지는 위 링크와 같은 signed URL(urls[...])을 그대로 쓰고,
  // 클릭하면 원본이 새 탭으로 열린다. signed URL 이 없거나 이미지 로딩에 실패하면 이 블록 안에서만 안내 문구로 바뀐다
  // (실패 처리는 setupAdminUi 의 capture error 리스너 — 카드 나머지 렌더링에는 영향 없음).
  const subjItem = items.find(it => it.slot === 'subject');
  const subjectPreviewBlock = (opts.subjectPreview && subjItem && row.subject_image_path)
    ? `<div class="llapp-subject-preview">
         <span class="llapp-subject-preview-label">${
           (() => {
             const nm = subjItem.item && subjItem.item.name;
             if (!nm) return 'SUBJECT';
             return /^SUBJECT/i.test(nm) ? escapeHtml(nm) : `SUBJECT <em>${escapeHtml(nm)}</em>`;   // 아이템명이 이미 "SUBJECT …"면 중복 표기 방지
           })()
         }</span>
         ${subjUrl
           ? `<img src="${escapeHtml(subjUrl)}" alt="SUBJECT 이미지 미리보기" loading="lazy" data-open-url="${escapeHtml(subjUrl)}" title="클릭하면 원본이 새 탭에서 열려요">`
           : '<span class="llapp-subject-preview-fail">이미지를 불러오지 못했어요.</span>'}
       </div>`
    : '';

  const reasonBlock = (['rejected', 'draft'].includes(st) && row.rejection_reason)
    ? `<div class="labberlab-app-comment is-strong">
         <span class="labberlab-app-comment-label">${st === 'rejected' ? '거절 사유' : '이전 거절 사유'}</span>
         <p>${escapeHtml(row.rejection_reason).replace(/\n/g, '<br>')}</p>
       </div>`
    : '';

  const events = [...(row.events || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const historyBlock = events.length
    ? `<details class="llapp-history">
         <summary>심사 기록 ${events.length}건</summary>
         <ul>${events.map(ev => `<li><span>${fmtDateTime(ev.created_at)}</span> <b>${LL_EVENT_KO[ev.action] || ev.action}</b>${ev.reason ? ` — ${escapeHtml(ev.reason)}` : ''}</li>`).join('')}</ul>
       </details>`
    : '';

  return `
  <article class="labberlab-app-card llapp-card" data-id="${row.id}">
    <div class="labberlab-app-thumb">
      ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="썸네일" loading="lazy" data-full="${escapeHtml(charUrl || thumbUrl)}">` : '<span>이미지 없음</span>'}
    </div>
    <div class="labberlab-app-main">
      <div class="labberlab-app-top">
        <span class="labberlab-app-status ${LL_STATUS_CLASS[st] || ''}">${LL_STATUS_KO[st] || st}</span>
        <span class="labberlab-app-no">No. ${shortId(row.id)}</span>
        <span class="labberlab-app-date">${row.submitted_at ? '제출 ' : '작성 '}${fmtDateTime(dateTs)}</span>
        ${row.is_legacy ? '<span class="llapp-legacy">이전 방식</span>' : ''}
        ${opts.applicantNickname ? `<span class="labberlab-app-applicant">${escapeHtml(opts.applicantNickname)}</span>` : ''}
      </div>
      ${itemsHtml}
      ${links ? `<div class="llapp-links">${links}</div>` : ''}
      ${subjectPreviewBlock}
      ${(row.designer_nickname || row.artist_nickname || row.note) ? `<dl class="labberlab-app-fields">${row.designer_nickname ? `<div><dt>개체 디자이너</dt><dd>${escapeHtml(row.designer_nickname)}</dd></div>` : ''}${row.artist_nickname ? `<div><dt>개체 아티스트</dt><dd>${escapeHtml(row.artist_nickname)}</dd></div>` : ''}${row.note ? `<div><dt>하고 싶은 말</dt><dd>${escapeHtml(row.note)}</dd></div>` : ''}</dl>` : ''}
      ${llSubjectCreditBlock(row)}
      ${reasonBlock}
      ${historyBlock}
      ${opts.footer || ''}
    </div>
  </article>`;
}

// ══════════════════════════════════════════════════════════════
// 내 신청 목록 (MY APPLICATIONS)
// ══════════════════════════════════════════════════════════════
async function loadMyList() {
  const listEl = llEl('myAppList');
  const emptyEl = llEl('myEmpty');
  const { data, error } = await sb.from('labber_design_applications')
    .select(LL_APP_SELECT).eq('user_id', _llUser.id).order('created_at', { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="auth-error">목록을 불러오지 못했어요. (${escapeHtml(error.message)})</p>`;
    return;
  }
  _llMyRows = data || [];

  await loadMySubjectRegistrations();

  if (!_llMyRows.length && !_llMySubjectRows.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  await llLoadSpeciesNames(_llMyRows);
  const urls = await signedUrlMap(llRowPaths(_llMyRows));

  // LABBER 디자인 신청 + SUBJECT 등록 신청을 시간순으로 한 목록에 섞어 보여준다(신청 유형은
  // 카드에 "SUBJECT 등록" 배지로 구분 — mySubjectRegistrationCardHtml 참고).
  const merged = [
    ..._llMyRows.map(row => ({ ts: row.created_at, html: appCardHtml(row, urls, { footer: myCardFooter(row) }) })),
    ..._llMySubjectRows.map(row => ({ ts: row.created_at, html: mySubjectRegistrationCardHtml(row) })),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  listEl.innerHTML = merged.map(x => x.html).join('');
}

// ── 내 SUBJECT 등록 신청 (2026-09-24 — "내 신청" 화면에 LABBER 디자인 신청과 함께 표시) ──
let _llMySubjectRows = [];

async function loadMySubjectRegistrations() {
  const { data, error } = await sb
    .from('labber_subject_bag_registrations')
    .select('id, subject_code, image_url, status, rejection_reason, reviewed_at, created_at, designer_nickname, artist_nickname, subject_species_id')
    .eq('user_id', _llUser.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[labber-lab] 내 SUBJECT 신청 조회 실패:', error.message);
    _llMySubjectRows = [];
    return;
  }
  _llMySubjectRows = data || [];
  await llLoadSpeciesNames(_llMySubjectRows);   // 종족형 SUBJECT 연결 종족명

  const subjectCodes = [...new Set(_llMySubjectRows.map(r => r.subject_code).filter(Boolean))];
  if (!subjectCodes.length) return;
  try {
    const { data: types, error: typeErr } = await sb.from('labber_subject_types').select('code, name').in('code', subjectCodes);
    if (typeErr) throw typeErr;
    const nameByCode = {};
    (types || []).forEach(t => { nameByCode[t.code] = t.name; });
    _llMySubjectRows.forEach(r => { r._subjectName = nameByCode[r.subject_code] || r.subject_code; });
  } catch (e) { console.warn('[labber-lab] SUBJECT 종류명 조회 실패:', e); }
}

// LABBER 디자인 신청 카드(appCardHtml)와 같은 클래스/구조를 재사용하되, "SUBJECT 등록" 배지로
// 신청 유형을 시각적으로 구분한다. data-id를 신청 id로 지정해 알림 딥링크(focusApplication)가
// 그대로 이 카드도 찾아서 스크롤·하이라이트할 수 있게 한다.
function mySubjectRegistrationCardHtml(row) {
  const st = row.status;
  const reasonBlock = (st === 'rejected' && row.rejection_reason)
    ? `<div class="labberlab-app-comment is-strong">
         <span class="labberlab-app-comment-label">반려 사유</span>
         <p>${escapeHtml(row.rejection_reason).replace(/\n/g, '<br>')}</p>
       </div>`
    : '';
  // rejected/cancelled: 이 신청 자체는 수정하지 않는다(그대로 보존) — "다시 등록하기"는 가방으로
  // 이동해서 같은 SUBJECT 아이템으로 새 신청을 만들라는 안내일 뿐, 이 신청을 되살리는 기능이 아니다.
  let footer;
  if (st === 'submitted') {
    footer = `<div class="labberlab-app-actions llapp-actions">
         <p class="llapp-hint">운영진 승인을 기다리고 있어요.</p>
         <button type="button" class="btn-ghost" data-act="cancel-subject" data-id="${row.id}">신청 취소</button>
       </div>`;
  } else if (st === 'approved') {
    footer = `<div class="labberlab-app-actions llapp-actions">
         <p class="llapp-hint">승인되어 개인연구실 SUBJECT 보관소에 등록됐어요.</p>
         <a class="btn-secondary llapp-char-link" href="labber-personal-lab.html?tab=subject">SUBJECT 보관소 바로가기</a>
       </div>`;
  } else if (st === 'cancelled') {
    footer = `<div class="labberlab-app-actions llapp-actions">
         <p class="llapp-hint">신청을 취소했어요.</p>
         <a class="btn-secondary llapp-char-link" href="my-bag.html?tab=item">다시 등록하기</a>
       </div>`;
  } else {
    footer = `<div class="labberlab-app-actions llapp-actions">
         ${row.reviewed_at ? `<p class="llapp-hint">검토 ${fmtDateTime(row.reviewed_at)}</p>` : ''}
         <a class="btn-secondary llapp-char-link" href="my-bag.html?tab=item">다시 등록하기</a>
       </div>`;
  }

  return `
  <article class="labberlab-app-card llapp-card" data-id="${row.id}">
    <div class="labberlab-app-thumb">
      ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="SUBJECT 이미지" loading="lazy" data-full="${escapeHtml(row.image_url)}">` : '<span>아트웍 없음</span>'}
    </div>
    <div class="labberlab-app-main">
      <div class="labberlab-app-top">
        <span class="llapp-legacy">SUBJECT 등록</span>
        <span class="labberlab-app-status ${LL_SUBJECT_STATUS_CLASS[st] || ''}">${LL_SUBJECT_STATUS_KO[st] || st}</span>
        <span class="labberlab-app-no">No. ${shortId(row.id)}</span>
        <span class="labberlab-app-date">신청 ${fmtDateTime(row.created_at)}</span>
      </div>
      <p class="llapp-hint">SUBJECT: ${escapeHtml(row._subjectName || row.subject_code)}</p>
      ${subjectCreatorFieldsHtml(row)}
      ${reasonBlock}
      ${footer}
    </div>
  </article>`;
}

function myCardFooter(row) {
  const st = row.status;
  if (st === 'draft') {
    const canDelete = !(row.events && row.events.length);
    return `<div class="labberlab-app-actions llapp-actions">
      ${canDelete ? `<button type="button" class="btn-ghost" data-act="delete" data-id="${row.id}">삭제</button>` : ''}
      <button type="button" class="btn-secondary" data-act="edit" data-id="${row.id}">이어서 작성</button>
    </div>`;
  }
  if (st === 'rejected') {
    return `<div class="labberlab-app-actions llapp-actions">
      <button type="button" class="btn-secondary" data-act="edit" data-id="${row.id}">수정하고 다시 제출</button>
    </div>`;
  }
  if (st === 'submitted') return '<p class="llapp-hint">심사 중이에요. 결과가 나올 때까지 수정할 수 없어요.</p>';
  if (st === 'approved') return '<p class="llapp-hint">디자인 심사를 통과했어요. 개체 등록은 운영진이 진행해요. 등록이 끝나면 \"승인\"으로 바뀌고 여기에 개체 링크가 표시돼요.</p>';
  if (st === 'registered') {
    return row.registered_character_id
      ? `<div class="labberlab-app-actions llapp-actions"><p class="llapp-hint">개체 등록까지 완료되어 최종 승인되었어요.</p><a class="btn-secondary llapp-char-link" href="character.html?id=${encodeURIComponent(row.registered_character_id)}">등록된 개체 보기</a></div>`
      : '<p class="llapp-hint">개체 등록까지 완료되어 최종 승인되었어요.</p>';
  }
  return '';
}

async function onMyListClick(e) {
  if (llHandleCommonClick(e)) return;
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'cancel-subject') { await cancelMySubjectRegistration(btn.dataset.id); return; }
  const row = _llMyRows.find(r => r.id === btn.dataset.id);
  if (!row) return;
  if (btn.dataset.act === 'edit') await openForm(row);
  else if (btn.dataset.act === 'delete') await deleteDraft(row.id);
}

// SUBJECT 등록 신청 취소(submitted 상태만) — 아이템 소비/instance 생성 없이 예약만 해제된다.
// 서버(cancel_labber_subject_bag_registration)가 소유주/상태를 다시 검증하므로, 운영진 승인과
// 거의 동시에 눌려도 둘 중 하나만 성공한다(행 잠금으로 직렬화).
async function cancelMySubjectRegistration(id) {
  if (!confirm('SUBJECT 등록 신청을 취소할까요?')) return;
  const { data, error } = await sb.rpc('cancel_labber_subject_bag_registration', { p_id: id });
  if (error) { alert(`취소에 실패했어요. (${error.message})`); return; }
  if (!data || !data.success) { alert(llErrText(data)); return; }
  await loadMyList();
}

async function deleteDraft(id) {
  if (!confirm('이 임시저장 신청서를 삭제할까요? 업로드한 이미지도 함께 삭제되며 되돌릴 수 없어요.')) return;
  const { data, error } = await sb.rpc('delete_labber_design_draft', { p_id: id });
  if (error) { alert(`삭제에 실패했어요. (${error.message})`); return; }
  if (!data || !data.success) { alert(llErrText(data)); return; }
  if (data.paths && data.paths.length) {
    sb.storage.from(LL_BUCKET).remove(data.paths)
      .then(({ error: rmErr }) => { if (rmErr) console.warn('[labber-lab] 이미지 정리 실패:', rmErr.message); });
  }
  await loadMyList();
}

// ══════════════════════════════════════════════════════════════
// 신청 폼 (작성 / 수정)
// ══════════════════════════════════════════════════════════════
function llSetError(msg) { llEl('formError').textContent = msg || ''; }
function llSetInfo(msg)  { llEl('formInfo').textContent = msg || ''; }

function llSetPending(kind, blob, ext) {
  llClearPending(kind);
  _llPending[kind] = { blob, url: URL.createObjectURL(blob), ext };
}
function llClearPending(kind) {
  if (_llPending[kind]) URL.revokeObjectURL(_llPending[kind].url);
  _llPending[kind] = null;
}

function llResetFormState() {
  ['character', 'thumbnail'].forEach(llClearPending);
  _llApp = null;
  _llSel = {};
  _llCart = new Set();
  _llSubjectInstances = [];
  _llPaths = { character: null, thumbnail: null };
  _llUrls = {};
  _llInv = [];
  llEl('noteInput').value = '';
  if (_llDesigner) _llDesigner.clear();
  if (_llArtist) _llArtist.clear();
  llSetError('');
  llSetInfo('');
}

function setFormBusy(busy, label) {
  _llBusy = busy;
  ['saveDraftBtn', 'submitBtn', 'cancelFormBtn'].forEach(id => { llEl(id).disabled = busy; });
  llEl('submitBtn').textContent = busy && label ? label : '제출하기';
}

function updateNoteCount() {
  const len = llEl('noteInput').value.length;
  const el = llEl('noteCount');
  el.textContent = `${len} / ${LL_NOTE_MAX}`;
  el.classList.toggle('is-over', len > LL_NOTE_MAX);
}

// 신청서 컬럼(designer_user_ids/designer_external …) → 선택기 값. 연구소 유저 닉네임은 현재 닉네임으로 다시 조회한다.
async function llCreatorsFromRow(row, kind) {
  const ids = (row && row[kind + '_user_ids']) || [];
  const ext = (row && row[kind + '_external']) || [];
  const nickMap = {};
  if (ids.length) {
    try { (await resolveUsersByIds(ids)).forEach(u => { nickMap[u.id] = u.nickname; }); }
    catch (e) { console.warn('[labber-lab] 제작자 닉네임 조회 실패:', e); }
  }
  const sites = ids.map(id => ({ type: 'site', userId: id, nickname: nickMap[id] || '(알 수 없음)' }));
  const exts = (Array.isArray(ext) ? ext : []).filter(e => e && e.name).map(e => ({ type: 'external', name: e.name, contact: e.contact || '' }));
  return [...sites, ...exts];
}

async function openForm(row) {
  if (!_llUser) { showLoginPrompt(); return; }
  if (_llBusy) return;
  llResetFormState();

  if (row) {
    _llApp = { id: row.id, status: row.status, items: row.items || [] };
    _llPaths = {
      character: row.character_image_path || null,
      thumbnail: row.thumbnail_path || null,
    };
    (row.items || []).forEach(it => {
      if (it.slot === 'cartridge') _llCart.add(it.item_id);
      else _llSel[it.slot] = it.item_id;
    });
    if (row.subject_instance_id) _llSel.subject = String(row.subject_instance_id);
    llEl('noteInput').value = row.note || '';
  }

  llEl('formTitle').textContent = !row ? '새 신청서 작성' : (row.status === 'rejected' ? '신청서 수정 (거절됨)' : '신청서 이어서 작성');
  const banner = llEl('rejectBanner');
  if (row && row.rejection_reason) {
    llEl('rejectBannerText').textContent = row.rejection_reason;
    banner.hidden = false; banner.style.display = '';
  } else {
    banner.hidden = true; banner.style.display = 'none';
  }

  llShow('mySection', false);
  llShow('designForm', true);
  updateNoteCount();
  refreshImagePreviews();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  await loadInventory();
  await loadSubjectInstances();
  renderPickers();
  renderSubjectInstancePicker();
  if (row) {
    if (_llDesigner) _llDesigner.setValue(await llCreatorsFromRow(row, 'designer'));
    if (_llArtist) _llArtist.setValue(await llCreatorsFromRow(row, 'artist'));
    _llUrls = await signedUrlMap([_llPaths.character, _llPaths.thumbnail]);
    refreshImagePreviews();
  }
}

async function closeForm(reload) {
  llResetFormState();
  llShow('designForm', false);
  llShow('mySection', true);
  if (reload !== false) await loadMyList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── 인벤토리 / 아이템 선택 ────────────────────────────────────
async function loadInventory() {
  const { data, error } = await sb.rpc('get_my_labber_design_inventory');
  if (error) {
    _llInv = [];
    llSetError(`인벤토리를 불러오지 못했어요. (${error.message})`);
    return;
  }
  _llInv = data || [];

  // 더 이상 사용할 수 없는 선택(보유 없음/다른 신청서에 예약)은 해제하고 알린다
  // subject 는 아이템이 아니라 SUBJECT instance id 라 이 인벤토리 목록과 무관 — loadSubjectInstances() 가 따로 재검증한다.
  const dropped = [];
  Object.keys(_llSel).forEach(slot => {
    if (slot === 'subject') return;
    if (!_llSel[slot]) return;
    const inv = _llInv.find(i => i.item_id === _llSel[slot] && i.slot === slot);
    if (!inv || inv.available < 1) { dropped.push(llSlotLabel(slot)); delete _llSel[slot]; }
  });
  // 카트리지: 더 이상 없거나 사용 가능 재고(보유-예약)가 0 이 된 종류는 선택 해제
  let cartAdjusted = false;
  Array.from(_llCart).forEach(id => {
    const inv = _llInv.find(i => i.item_id === id && i.slot === 'cartridge');
    if (!inv || inv.available < 1) { _llCart.delete(id); cartAdjusted = true; }
  });
  if (cartAdjusted) dropped.push('CARTRIDGE');
  if (dropped.length) llSetInfo(`사용할 수 없게 된 아이템의 선택이 해제·조정됐어요: ${dropped.join(', ')}`);
}

// ── SUBJECT — 아이템이 아니라 내 SUBJECT 보관소의 instance 중 하나를 선택(선택사항, 2026-09-24) ──
// 후보 = my_subject_instances 중 is_assigned=false(현재 어떤 LABBER에도 배정되지 않은 것) 인 것만.
// 이미지 업로드는 여기서 하지 않는다 — instance는 가방 SUBJECT 등록(js/my-bag.js) 시점에 이미
// 자기 이미지를 가지고 있다.
async function loadSubjectInstances() {
  const { data, error } = await sb
    .from('my_subject_instances')
    .select('instance_id, subject_code, subject_name, individual_name, image_url, is_assigned')
    .eq('is_assigned', false);
  if (error) {
    _llSubjectInstances = [];
    console.warn('[labber-lab] SUBJECT 보관소 조회 실패:', error.message);
    return;
  }
  _llSubjectInstances = data || [];

  // 이전에 선택해둔 instance가 더 이상 후보(미배정)에 없으면 선택 해제하고 알린다.
  if (_llSel.subject && !_llSubjectInstances.some(i => String(i.instance_id) === _llSel.subject)) {
    _llSel.subject = null;
    llSetInfo('선택했던 SUBJECT를 더 이상 선택할 수 없게 되어 해제됐어요. (다른 LABBER에 배정됐거나 존재하지 않아요)');
  }
}

function llSubjectInstanceCardHtml(i) {
  const checked = _llSel.subject === String(i.instance_id);
  const name = i.individual_name || i.subject_name || 'SUBJECT';
  const img = i.image_url
    ? `<span class="llapp-item-img"><img src="${escapeHtml(i.image_url)}" alt="" loading="lazy"></span>`
    : `<span class="llapp-item-img"><span class="llapp-item-ph">NO IMG</span></span>`;
  return `
    <label class="llapp-item${checked ? ' is-selected' : ''}">
      <input type="radio" name="pick-subject-instance" value="${i.instance_id}"${checked ? ' checked' : ''}>
      ${img}
      <span class="llapp-item-name">${escapeHtml(name)}</span>
      <span class="llapp-item-qty">${escapeHtml(i.subject_name || '')}</span>
    </label>`;
}

function renderSubjectInstancePicker() {
  const host = llEl('subjectInstancePicker');
  if (!_llSubjectInstances.length) {
    host.innerHTML = `<p class="llapp-picker-empty">보관소에 미배정 상태인 SUBJECT가 없어요. (가방에서 SUBJECT를 먼저 등록해주세요)</p>`;
    return;
  }
  const noneChecked = !_llSel.subject;
  const none = `
    <label class="llapp-item llapp-item-none${noneChecked ? ' is-selected' : ''}">
      <input type="radio" name="pick-subject-instance" value=""${noneChecked ? ' checked' : ''}>
      <span class="llapp-item-name">사용 안 함</span>
    </label>`;
  const cards = _llSubjectInstances.map(llSubjectInstanceCardHtml).join('');
  host.innerHTML = `<div class="llapp-picker" role="radiogroup" aria-label="SUBJECT">${none}${cards}</div>`;
}

function onSubjectInstancePickerChange(e) {
  const input = e.target.closest('input[type="radio"]');
  if (!input) return;
  _llSel.subject = input.value || null;
  llEl('subjectInstancePicker').querySelectorAll('.llapp-item').forEach(l => {
    l.classList.toggle('is-selected', l.querySelector('input').checked);
  });
}

// 수량 표기: 기본 "보유 N", 다른 신청서에 예약된 수량이 있을 때만 "보유 N · 예약 M".
// (선택 가능 여부는 보유 - 예약 = available >= 1 로 그대로 적용하고, 서버가 다시 검증한다 — 여기는 표시만 단순화)
function llQtyText(i) {
  return `보유 ${i.quantity}` + (i.reserved > 0 ? ` · 예약 ${i.reserved}` : '');
}

// CARTRIDGE: 서로 다른 "종류"를 여러 개 선택할 수 있고, 같은 종류는 신청서당 1개만 쓴다(수량 선택 없음).
function llCartSummaryText() {
  const names = Array.from(_llCart).map(id => {
    const inv = _llInv.find(i => i.item_id === id);
    return inv ? inv.name : '카트리지';
  });
  if (!names.length) return '선택한 카트리지 없음';
  return `선택한 카트리지 · ${names.join(' · ')} (${names.length}종 · 종류당 1개)`;
}

function llCartCardHtml(i) {
  const on = _llCart.has(i.item_id);
  const off = i.available < 1 && !on;   // 다른 신청서에 전량 예약되어 사용 가능한 재고가 없으면 선택 불가
  return `
    <button type="button" class="llapp-item llapp-item-cart${on ? ' is-selected' : ''}${off ? ' is-disabled' : ''}" data-cart-toggle="${i.item_id}" aria-pressed="${on}"${off ? ' disabled' : ''}>
      <span class="llapp-item-img">${llItemImg(i)}</span>
      <span class="llapp-item-name">${escapeHtml(i.name)}</span>
      <span class="llapp-item-qty">${llQtyText(i)}</span>
    </button>`;
}

function renderPickers() {
  const host = llEl('itemPickers');
  host.innerHTML = LL_SLOTS.map(s => {
    const items = _llInv.filter(i => i.slot === s.key);
    let body;
    if (!items.length) {
      body = `<p class="llapp-picker-empty">${s.emptyMsg}</p>`;
    } else if (s.key === 'cartridge') {
      // CARTRIDGE: 토글형 복수 선택 — 카드를 누르면 선택/해제. 선택한 종류마다 정확히 1개가 예약·소비된다.
      body = `<div class="llapp-picker llapp-picker-cart" data-slot="cartridge">${items.map(llCartCardHtml).join('')}</div>
        <p class="llapp-cart-summary" id="cartSummary">${escapeHtml(llCartSummaryText())}</p>`;
    } else {
      const noneChecked = !_llSel[s.key];
      const none = s.required ? '' : `
      <label class="llapp-item llapp-item-none${noneChecked ? ' is-selected' : ''}">
        <input type="radio" name="pick-${s.key}" value=""${noneChecked ? ' checked' : ''}>
        <span class="llapp-item-name">사용 안 함</span>
      </label>`;
      const cards = items.map(i => {
        const disabled = i.available < 1;
        const checked = _llSel[s.key] === i.item_id;
        return `
      <label class="llapp-item${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}">
        <input type="radio" name="pick-${s.key}" value="${i.item_id}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="llapp-item-img">${llItemImg(i)}</span>
        <span class="llapp-item-name">${escapeHtml(i.name)}</span>
        <span class="llapp-item-qty">${llQtyText(i)}</span>
      </label>`;
      }).join('');
      body = `<div class="llapp-picker" data-slot="${s.key}" role="radiogroup" aria-label="${s.label}">${none}${cards}</div>`;
    }
    const optional = s.key === 'cartridge' ? '선택 · 여러 종류 가능 (종류당 1개)' : '선택';
    return `<div class="form-group">
      <label class="form-label">${s.label} ${s.required ? '<span class="required">*</span>' : `<span class="llapp-optional">${optional}</span>`}</label>
      ${body}
    </div>`;
  }).join('');
}

// CARTRIDGE 토글: 카드 클릭 = 선택/해제. 사용 가능 재고(보유-예약)가 1 이상일 때만 선택된다. 저장/제출 시 서버가 다시 검증한다.
function onCartToggleClick(e) {
  const btn = e.target.closest('[data-cart-toggle]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.cartToggle;
  const inv = _llInv.find(i => i.item_id === id && i.slot === 'cartridge');
  if (!inv) return;
  if (_llCart.has(id)) _llCart.delete(id);
  else if (inv.available >= 1) _llCart.add(id);

  const on = _llCart.has(id);
  btn.classList.toggle('is-selected', on);
  btn.setAttribute('aria-pressed', String(on));
  const sum = llEl('cartSummary');
  if (sum) sum.textContent = llCartSummaryText();
}

function onPickerChange(e) {
  const input = e.target.closest('input[type="radio"]');
  if (!input) return;
  const picker = input.closest('.llapp-picker');
  const slot = picker && picker.dataset.slot;
  if (!slot) return;
  _llSel[slot] = input.value || null;
  picker.querySelectorAll('.llapp-item').forEach(l => {
    l.classList.toggle('is-selected', l.querySelector('input').checked);
  });
}

// ── 이미지 미리보기 ───────────────────────────────────────────
function llSetPreview(imgId, phId, url) {
  const img = llEl(imgId);
  const ph = llEl(phId);
  if (url) { img.src = url; img.style.display = 'block'; ph.style.display = 'none'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; ph.style.display = ''; }
}

function refreshImagePreviews() {
  const c = (_llPending.character && _llPending.character.url) || _llUrls[_llPaths.character] || null;
  const t = (_llPending.thumbnail && _llPending.thumbnail.url) || _llUrls[_llPaths.thumbnail] || null;
  llSetPreview('charPreview', 'charPlaceholder', c);
  llSetPreview('thumbPreview', 'thumbPlaceholder', t);
  llEl('thumbEditBtn').style.display = c ? '' : 'none';
}

// ── 개체 이미지 선택 → 크롭 ────────────────────────────────────
async function onCharacterPick(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  llSetError('');
  try {
    const blob = await compressImage(file);   // ≤1200px · ≤2MB · GIF 는 원본 유지 (utils.js — 개체 등록과 동일)
    const isGif = blob.type === 'image/gif';
    llSetPending('character', blob, isGif ? 'gif' : 'jpg');
    llClearPending('thumbnail');
    if (isGif) {
      // 개체 등록과 동일: GIF 는 크롭 모달을 건너뛰고 첫 프레임 중앙 크롭
      llSetPending('thumbnail', await autoCenterCropToBlob(blob, 3 / 4, 600, 0.85), 'jpg');
      refreshImagePreviews();
    } else {
      refreshImagePreviews();
      openCropModal(blob, true);
    }
  } catch (e) {
    llSetError(e.message || '이미지를 처리할 수 없어요.');
  }
}

async function onThumbnailEdit() {
  llSetError('');
  try {
    let src = _llPending.character && _llPending.character.blob;
    if (!src) {
      const url = _llUrls[_llPaths.character] || await signedUrlFor(_llPaths.character);
      if (!url) throw new Error('원본 이미지를 불러올 수 없어요.');
      const res = await fetch(url);
      if (!res.ok) throw new Error('원본 이미지를 불러올 수 없어요.');
      src = await res.blob();
    }
    if (src.type === 'image/gif') {
      llSetPending('thumbnail', await autoCenterCropToBlob(src, 3 / 4, 600, 0.85), 'jpg');
      refreshImagePreviews();
      return;
    }
    openCropModal(src, false);
  } catch (e) {
    llSetError(e.message || '썸네일을 편집할 수 없어요.');
  }
}

function openCropModal(blob, isNew) {
  if (typeof Cropper === 'undefined') {
    // Cropper.js 로딩 실패 시에도 신청은 가능하도록 중앙 자동 크롭으로 대체
    autoCenterCropToBlob(blob, 3 / 4, 600, 0.85)
      .then(b => { llSetPending('thumbnail', b, 'jpg'); refreshImagePreviews(); })
      .catch(err => llSetError(err.message));
    return;
  }
  _llCropSource = blob;
  _llCropIsNew = !!isNew;
  const img = llEl('cropImage');
  if (_llCropSrcUrl) URL.revokeObjectURL(_llCropSrcUrl);
  _llCropSrcUrl = URL.createObjectURL(blob);
  img.onerror = () => { llSetError('이미지 파일을 읽을 수 없어요.'); closeCropModal(); };
  img.onload = () => {
    llEl('cropModal').style.display = 'flex';
    if (_llCropper) { _llCropper.destroy(); _llCropper = null; }
    _llCropper = new Cropper(img, {           // 개체 등록(character-register.html)과 동일 옵션 — 3:4
      aspectRatio: 3 / 4,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.85,
      guides: true,
      center: true,
      highlight: true,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
    });
  };
  img.src = _llCropSrcUrl;
}

function closeCropModal() {
  llEl('cropModal').style.display = 'none';
  if (_llCropper) { _llCropper.destroy(); _llCropper = null; }
  if (_llCropSrcUrl) { URL.revokeObjectURL(_llCropSrcUrl); _llCropSrcUrl = null; }
  _llCropSource = null;
}

async function onCropConfirm() {
  try {
    const blob = await cropToBlob(_llCropper, 600, 0.85);   // 600×800 JPEG
    llSetPending('thumbnail', blob, 'jpg');
    closeCropModal();
    refreshImagePreviews();
  } catch (e) { llSetError(e.message); }
}

async function onCropAsIs() {
  if (!_llCropSource) return;
  try {
    const blob = await autoCenterCropToBlob(_llCropSource, 3 / 4, 600, 0.85);
    llSetPending('thumbnail', blob, 'jpg');
    closeCropModal();
    refreshImagePreviews();
  } catch (e) { llSetError(e.message); }
}

function onCropCancel() {
  // 새로 고른 이미지의 첫 크롭을 취소하면 그 선택 자체를 폐기(개체 등록과 동일). 기존 저장분은 그대로.
  if (_llCropIsNew) { llClearPending('character'); llClearPending('thumbnail'); }
  closeCropModal();
  refreshImagePreviews();
}

// ── 저장 / 제출 ───────────────────────────────────────────────
// 서버에 draft 를 만들고(없으면) → 새 이미지 업로드 → 저장 RPC → 이전 파일 정리. 신청서 id 를 반환.
async function persistDraft() {
  const note = llEl('noteInput').value;
  if (note.length > LL_NOTE_MAX) throw new Error(`하고 싶은 말은 ${LL_NOTE_MAX}자 이하로 입력해주세요.`);

  let appId = _llApp && _llApp.id;
  if (!appId) {
    const { data, error } = await sb.rpc('save_labber_design_draft', { p_id: null, p_payload: {} });
    if (error) throw new Error(`저장에 실패했어요. (${error.message})`);
    if (!data || !data.success) throw new Error(llErrText(data));
    appId = data.application_id;
    _llApp = { id: appId, status: 'draft', items: [] };
  }

  const paths = { ..._llPaths };
  const uploaded = [];
  try {
    for (const kind of ['character', 'thumbnail']) {
      const p = _llPending[kind];
      if (!p) continue;
      const path = `${_llUser.id}/${appId}/${kind}_${crypto.randomUUID()}.${p.ext}`;
      const { error } = await sb.storage.from(LL_BUCKET).upload(path, p.blob, {
        contentType: p.blob.type || 'image/jpeg',
        upsert: false,
      });
      if (error) throw new Error(`이미지 업로드에 실패했어요. (${error.message})`);
      uploaded.push(path);
      paths[kind] = path;
    }

    const items = {};
    LL_SLOTS.forEach(s => { if (s.key !== 'cartridge') items[s.key] = _llSel[s.key] || null; });
    // CARTRIDGE: 선택한 종류의 item_id 배열 (빈 배열 = 사용 안 함). 종류당 1개 — 서버가 중복/수량/보유량을 다시 검증한다.
    items.cartridge = Array.from(_llCart);
    const payload = {
      character_image_path: paths.character,
      thumbnail_path: paths.thumbnail,
      // SUBJECT — 아이템이 아니라 보관소 instance id(선택사항). 빈 값이면 서버가 선택 해제로 처리한다.
      subject_instance_id: _llSel.subject ? Number(_llSel.subject) : null,
      note,
      items,
      designers: _llDesigner ? _llDesigner.getValue() : [],
      artists: _llArtist ? _llArtist.getValue() : [],
    };
    const { data, error } = await sb.rpc('save_labber_design_draft', { p_id: appId, p_payload: payload });
    if (error) throw new Error(`저장에 실패했어요. (${error.message})`);
    if (!data || !data.success) throw new Error(llErrText(data));

    if (data.removed_paths && data.removed_paths.length) {
      sb.storage.from(LL_BUCKET).remove(data.removed_paths)
        .then(({ error: rmErr }) => { if (rmErr) console.warn('[labber-lab] 이전 이미지 정리 실패:', rmErr.message); });
    }

    _llPaths = { character: paths.character, thumbnail: paths.thumbnail };
    _llApp.status = 'draft';
    Object.assign(_llUrls, await signedUrlMap([_llPaths.character, _llPaths.thumbnail]));
    ['character', 'thumbnail'].forEach(llClearPending);
    refreshImagePreviews();
  } catch (e) {
    if (uploaded.length) {
      sb.storage.from(LL_BUCKET).remove(uploaded)
        .then(({ error: rmErr }) => { if (rmErr) console.warn('[labber-lab] 업로드 롤백 실패:', rmErr.message); });
    }
    throw e;
  }

  return appId;
}

async function onSaveDraft() {
  if (_llBusy) return;
  llSetError('');
  llSetInfo('');
  setFormBusy(true);
  try {
    await persistDraft();
    llSetInfo('임시저장했어요. 제출 전까지 언제든 수정할 수 있어요.');
  } catch (e) {
    llSetError(e.message || '저장 중 오류가 발생했어요.');
  } finally {
    setFormBusy(false);
  }
}

// 제출 전 화면 검증(안내용). 최종 검증은 서버(submit_labber_design)가 다시 한다.
function llMissingForSubmit() {
  if (!(_llPending.character || _llPaths.character)) return '개체 이미지를 업로드해주세요.';
  if (!(_llPending.thumbnail || _llPaths.thumbnail)) return '썸네일을 지정해주세요. (이미지를 다시 선택하거나 "썸네일 편집"을 눌러주세요)';
  for (const s of LL_SLOTS) {
    if (s.required && !_llSel[s.key]) return `${s.label} 아이템을 선택해주세요.`;
  }
  if (_llDesigner && !_llDesigner.count()) return '개체 디자이너를 1명 이상 추가해주세요.';
  return '';
}

async function onSubmitApplication() {
  if (_llBusy) return;
  llSetError('');
  llSetInfo('');
  const missing = llMissingForSubmit();
  if (missing) { llSetError(missing); return; }
  if (!confirm('제출하면 심사가 끝날 때까지 수정할 수 없어요.\n선택한 아이템은 심사 동안 예약되고, 승인되면 소비돼요.\n\n제출할까요?')) return;

  setFormBusy(true, '제출 중...');
  try {
    const appId = await persistDraft();
    const { data, error } = await sb.rpc('submit_labber_design', { p_id: appId });
    if (error) throw new Error(`제출에 실패했어요. (${error.message})`);
    if (!data || !data.success) throw new Error(llErrText(data));
    setFormBusy(false);
    alert('LABBER 디자인 승인 신청을 제출했어요.');
    await closeForm(true);
  } catch (e) {
    llSetError(e.message || '제출 중 오류가 발생했어요.');
    setFormBusy(false);
  }
}

// ══════════════════════════════════════════════════════════════
// 관리자 — 승인 관리 (admin/staff)
// ══════════════════════════════════════════════════════════════
function setupAdminUi() {
  llShow('approvalModeRow', true);
  llEl('approvalModeRow').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-amode]');
    if (btn) setApprovalMode(btn.dataset.amode);
  });
  setupAdminStatusTabs();
  setupSubjectApprovalStatusTabs();
  llEl('adminAppList').addEventListener('click', onAdminListClick);
  llEl('subjectApprovalList').addEventListener('click', onSubjectApprovalListClick);
  // SUBJECT 미리보기 이미지 로딩 실패 → 해당 이미지만 안내 문구로 교체 (error 이벤트는 버블링되지 않아 capture 로 받는다)
  llEl('adminAppList').addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.closest('.llapp-subject-preview')) return;
    const fail = document.createElement('span');
    fail.className = 'llapp-subject-preview-fail';
    fail.textContent = '이미지를 불러오지 못했어요.';
    img.replaceWith(fail);
  }, true);
  llEl('subjectApprovalList').addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.closest('.llapp-subject-preview')) return;
    const fail = document.createElement('span');
    fail.className = 'llapp-subject-preview-fail';
    fail.textContent = '이미지를 불러오지 못했어요.';
    img.replaceWith(fail);
  }, true);
  setApprovalMode('admin');   // 관리자는 평소 승인 관리 뷰를 먼저 본다
  // 다른 탭/창에 있다가 돌아오면 새로 들어온 신청 수를 다시 센다 (운영진 화면에서만 등록됨)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) llRefreshSidebarBadge(); });
}

function setApprovalMode(mode) {
  const resolved = (_llIsAdmin && (mode === 'admin' || mode === 'subject')) ? mode : 'mine';
  llShow('approvalUserView', resolved === 'mine');
  llShow('approvalAdminView', resolved === 'admin');
  llShow('approvalSubjectView', resolved === 'subject');
  llEl('approvalModeRow').querySelectorAll('[data-amode]').forEach(b => {
    b.classList.toggle('active', b.dataset.amode === resolved);
  });
}

function setupAdminStatusTabs() {
  const row = llEl('adminStatusRow');
  row.innerHTML = LL_ADMIN_TABS.map(t =>
    `<button type="button" class="shop-tab-btn${t.key === _llAdminTab ? ' active' : ''}" data-atab="${t.key}">${t.label}</button>`
  ).join('');
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-atab]');
    if (!btn) return;
    _llAdminTab = btn.dataset.atab;
    row.querySelectorAll('.shop-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.atab === _llAdminTab));
    renderAdminList();
  });
}

function adminVisible(row) { return (row.status || 'draft') !== 'draft'; }

// ── 심사 대기 배지 = 좌측 사이드바 MY 아래 "LABBER" 메뉴에만 표시 ─────────────────
// 배지 표시/집계/권한 판정은 전부 js/sidebar.js 의 refreshLabberDesignBadge() 가 담당한다
// (admin/staff 에게만, DB status='submitted' 건수, 0건이면 숨김). 이 페이지(탭/서브탭)에는 배지를 두지 않는다.
// 관리소는 승인/거절 처리 직후·탭 복귀 시 아래 래퍼로 사이드바 배지를 다시 세게 한다.
function llRefreshSidebarBadge() {
  if (typeof refreshLabberDesignBadge === 'function') refreshLabberDesignBadge();
}

async function loadAdminList() {
  const { data, error } = await sb.from('labber_design_applications')
    .select(LL_APP_SELECT).neq('status', 'draft')
    .order('submitted_at', { ascending: false, nullsFirst: false });
  if (error) {
    llEl('adminAppList').innerHTML = `<p class="auth-error">목록을 불러오지 못했어요. (${escapeHtml(error.message)})</p>`;
    return;
  }
  _llAdminRows = (data || []).filter(adminVisible);

  // 신청자 현재 닉네임 매핑
  const ids = [...new Set(_llAdminRows.map(r => r.user_id).filter(Boolean))];
  const idToNick = {};
  try {
    const users = await resolveUsersByIds(ids);
    users.forEach(u => { idToNick[u.id] = u.nickname; });
  } catch (e) { console.warn('[labber-lab] 닉네임 매핑 실패:', e); }
  _llAdminRows.forEach(r => { r._nick = idToNick[r.user_id] || r.applicant_nickname; });
  await llLoadSpeciesNames(_llAdminRows);

  renderAdminStatusCounts();
  llRefreshSidebarBadge();   // 승인/거절 처리 후에도 이 함수가 다시 호출되므로 사이드바 배지가 즉시 갱신된다
  await renderAdminList();
}

function renderAdminStatusCounts() {
  llEl('adminStatusRow').querySelectorAll('[data-atab]').forEach(btn => {
    const t = LL_ADMIN_TABS.find(x => x.key === btn.dataset.atab);
    const n = t.statuses ? _llAdminRows.filter(r => t.statuses.includes(r.status)).length : _llAdminRows.length;
    btn.textContent = `${t.label} ${n}`;
  });
}

async function renderAdminList() {
  const listEl = llEl('adminAppList');
  const emptyEl = llEl('adminEmpty');
  const t = LL_ADMIN_TABS.find(x => x.key === _llAdminTab) || LL_ADMIN_TABS[0];
  const rows = t.statuses ? _llAdminRows.filter(r => t.statuses.includes(r.status)) : _llAdminRows;

  if (!rows.length) { listEl.innerHTML = ''; emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';

  const urls = await signedUrlMap(llRowPaths(rows));
  // 승인된 신청서 → 개체 등록 화면(등록 데이터 불러오기 패널에서 이 신청서가 미리 선택됨 — 불러오기·등록은 그 화면에서 직접)
  let labberName = 'LABBER (래버)';
  try { labberName = (typeof getLabberSpeciesName === 'function' && await getLabberSpeciesName()) || labberName; } catch (e) { /* 기본값 사용 */ }
  const regUrl = (id) => `character-register.html?species_id=${LABBER_SPECIES_ID}&species=${encodeURIComponent(labberName)}&from_app=${encodeURIComponent(id)}`;
  listEl.innerHTML = rows.map(row => {
    const footer = row.status === 'submitted'
      ? `<div class="labberlab-admin-controls" data-ctl="${row.id}">
           <label class="form-label">거절 사유 <span class="llapp-optional">거절할 때만 필수 · 신청자에게 그대로 표시돼요</span></label>
           <textarea class="form-textarea llapp-reject-reason" rows="3" maxlength="500" placeholder="예: 썸네일 영역이 잘려 있어요. / 선택한 POD 형태와 이미지가 달라요."></textarea>
           <p class="auth-error labberlab-admin-err"></p>
           <div class="llapp-admin-btns">
             <button type="button" class="btn-ghost llapp-reject-btn" data-act="reject">거절</button>
             <button type="button" class="btn-secondary" data-act="approve">승인 (아이템 소비)</button>
           </div>
         </div>`
      : (row.status === 'approved' && !row.registered_character_id && !row.is_legacy
          ? `<div class="labberlab-app-actions llapp-actions"><a class="btn-secondary llapp-char-link" href="${escapeHtml(regUrl(row.id))}">개체 등록 화면으로</a></div>`
          : (row.status === 'registered' && row.registered_character_id
              ? `<div class="labberlab-app-actions llapp-actions"><p class="llapp-hint">${row.registered_at ? '등록 ' + fmtDateTime(row.registered_at) : '등록 완료'}</p><a class="btn-ghost llapp-char-link" href="character.html?id=${encodeURIComponent(row.registered_character_id)}">등록된 개체 보기</a></div>`
              : (row.reviewed_at ? `<p class="llapp-hint">검토 ${fmtDateTime(row.reviewed_at)}</p>` : '')));
    return appCardHtml(row, urls, { applicantNickname: row._nick, footer, subjectPreview: true });
  }).join('');
}

async function onAdminListClick(e) {
  if (llHandleCommonClick(e)) return;
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const ctl = btn.closest('[data-ctl]');
  if (!ctl) return;
  if (btn.dataset.act === 'approve') await adminApprove(ctl.dataset.ctl, ctl);
  else if (btn.dataset.act === 'reject') await adminReject(ctl.dataset.ctl, ctl);
}

function llSetCtlBusy(ctl, busy) {
  ctl.querySelectorAll('button').forEach(b => { b.disabled = busy; });
}

async function adminApprove(id, ctl) {
  if (_llAdminBusy) return;
  const row = _llAdminRows.find(r => r.id === id);
  if (!row) return;
  const errEl = ctl.querySelector('.labberlab-admin-err');
  errEl.textContent = '';
  if (!confirm(`${row._nick || '신청자'}님의 신청서를 승인할까요?\n예약된 아이템이 실제로 소비돼요.`)) return;

  _llAdminBusy = true;
  llSetCtlBusy(ctl, true);
  try {
    const { data, error } = await sb.rpc('approve_labber_design', { p_id: id });
    if (error) throw new Error(error.message);
    if (!data || !data.success) {
      errEl.textContent = llErrText(data);
      if (data && data.error === 'INVALID_STATUS') await loadAdminList();
      return;
    }
    logAdminAction('labber_design_approve', 'labber_design', id, row._nick, { consumed: data.consumed }).catch(() => {});
    await loadAdminList();
    if (row.user_id === _llUser.id) await loadMyList();
  } catch (err) {
    console.error('[labber-lab] 승인 오류:', err);
    errEl.textContent = `승인에 실패했어요. (${err.message})`;
  } finally {
    _llAdminBusy = false;
    llSetCtlBusy(ctl, false);
  }
}

async function adminReject(id, ctl) {
  if (_llAdminBusy) return;
  const row = _llAdminRows.find(r => r.id === id);
  if (!row) return;
  const errEl = ctl.querySelector('.labberlab-admin-err');
  const reason = ctl.querySelector('.llapp-reject-reason').value.trim();
  errEl.textContent = '';
  if (!reason) { errEl.textContent = '거절 사유를 입력해주세요.'; return; }
  if (reason.length > 500) { errEl.textContent = '거절 사유는 500자 이하로 입력해주세요.'; return; }
  if (!confirm(`${row._nick || '신청자'}님의 신청서를 거절할까요?\n예약된 아이템은 해제되고 소비되지 않아요.`)) return;

  _llAdminBusy = true;
  llSetCtlBusy(ctl, true);
  try {
    const { data, error } = await sb.rpc('reject_labber_design', { p_id: id, p_reason: reason });
    if (error) throw new Error(error.message);
    if (!data || !data.success) {
      errEl.textContent = llErrText(data);
      if (data && data.error === 'INVALID_STATUS') await loadAdminList();
      return;
    }
    logAdminAction('labber_design_reject', 'labber_design', id, row._nick, { reason }).catch(() => {});
    await loadAdminList();
    if (row.user_id === _llUser.id) await loadMyList();
  } catch (err) {
    console.error('[labber-lab] 거절 오류:', err);
    errEl.textContent = `거절에 실패했어요. (${err.message})`;
  } finally {
    _llAdminBusy = false;
    llSetCtlBusy(ctl, false);
  }
}

// ══════════════════════════════════════════════════════════════
// 관리자 — SUBJECT 승인 (가방 SUBJECT 등록 신청, 2026-09-24)
//   labber_subject_bag_registrations 를 직접 조회(RLS: 본인 또는 admin/staff) + 승인/반려는
//   approve/reject_labber_subject_bag_registration RPC. labber_design_applications 와는
//   완전히 별개 테이블/화면 흐름이며, 여기서 승인해도 LABBER 디자인 신청서 목록에는 아무 영향 없다.
// ══════════════════════════════════════════════════════════════
function setupSubjectApprovalStatusTabs() {
  const row = llEl('subjectApprovalStatusRow');
  row.innerHTML = LL_SUBJECT_APPROVAL_TABS.map(t =>
    `<button type="button" class="shop-tab-btn${t.key === _llSubjectAdminTab ? ' active' : ''}" data-stab="${t.key}">${t.label}</button>`
  ).join('');
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stab]');
    if (!btn) return;
    _llSubjectAdminTab = btn.dataset.stab;
    row.querySelectorAll('.shop-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.stab === _llSubjectAdminTab));
    renderSubjectApprovalList();
  });
}

async function loadSubjectApprovalList() {
  const { data, error } = await sb
    .from('labber_subject_bag_registrations')
    .select('id, user_id, item_id, subject_code, image_url, status, rejection_reason, resulting_instance_id, reviewed_by, reviewed_at, created_at, designer_nickname, artist_nickname, subject_species_id')
    .order('created_at', { ascending: false });
  if (error) {
    llEl('subjectApprovalList').innerHTML = `<p class="auth-error">목록을 불러오지 못했어요. (${escapeHtml(error.message)})</p>`;
    return;
  }
  _llSubjectAdminRows = data || [];
  await llLoadSpeciesNames(_llSubjectAdminRows);   // 종족형 SUBJECT 연결 종족명

  const userIds = [...new Set(_llSubjectAdminRows.map(r => r.user_id).filter(Boolean))];
  const idToNick = {};
  try {
    const users = await resolveUsersByIds(userIds);
    users.forEach(u => { idToNick[u.id] = u.nickname; });
  } catch (e) { console.warn('[labber-lab] SUBJECT 신청자 닉네임 매핑 실패:', e); }

  const itemIds = [...new Set(_llSubjectAdminRows.map(r => r.item_id).filter(Boolean))];
  const itemById = {};
  if (itemIds.length) {
    try {
      const { data: items, error: itemErr } = await sb.from('items').select('id, name').in('id', itemIds);
      if (itemErr) throw itemErr;
      (items || []).forEach(it => { itemById[it.id] = it; });
    } catch (e) { console.warn('[labber-lab] SUBJECT 아이템 조회 실패:', e); }
  }

  const subjectCodes = [...new Set(_llSubjectAdminRows.map(r => r.subject_code).filter(Boolean))];
  const subjectNameByCode = {};
  if (subjectCodes.length) {
    try {
      const { data: types, error: typeErr } = await sb.from('labber_subject_types').select('code, name').in('code', subjectCodes);
      if (typeErr) throw typeErr;
      (types || []).forEach(t => { subjectNameByCode[t.code] = t.name; });
    } catch (e) { console.warn('[labber-lab] SUBJECT 종류명 조회 실패:', e); }
  }

  _llSubjectAdminRows.forEach(r => {
    r._nick = idToNick[r.user_id] || '유저';
    r._itemName = (itemById[r.item_id] && itemById[r.item_id].name) || 'SUBJECT 아이템';
    r._subjectName = subjectNameByCode[r.subject_code] || r.subject_code;
  });

  renderSubjectApprovalStatusCounts();
  llRefreshSidebarBadge();   // 사이드바 배지는 디자인+SUBJECT 합산이라 여기서도 갱신해야 승인/반려 직후 바로 반영된다
  renderSubjectApprovalList();
}

function renderSubjectApprovalStatusCounts() {
  llEl('subjectApprovalStatusRow').querySelectorAll('[data-stab]').forEach(btn => {
    const t = LL_SUBJECT_APPROVAL_TABS.find(x => x.key === btn.dataset.stab);
    const n = t.statuses ? _llSubjectAdminRows.filter(r => t.statuses.includes(r.status)).length : _llSubjectAdminRows.length;
    btn.textContent = `${t.label} ${n}`;
  });
}

const LL_SUBJECT_STATUS_KO = { submitted: '승인 대기', approved: '승인', rejected: '반려', cancelled: '취소' };
const LL_SUBJECT_STATUS_CLASS = { submitted: 'is-pending', approved: 'is-registered', rejected: 'is-rejected', cancelled: 'is-rejected' };

// SUBJECT 등록 신청의 디자이너/아티스트/연결 종족 표시 — appCardHtml의 "개체 디자이너/아티스트" dl과 같은 구조 재사용.
// 연결 종족은 종족형 SUBJECT 만. 값이 없으면(종족 연결 복구 이전 신청 / 종족 삭제) "연결 종족 없음".
function subjectCreatorFieldsHtml(row) {
  const isSpecies = row.subject_code === LL_SPECIES_SUBJECT_CODE;
  const spName = row.subject_species_id ? (_llSpeciesNames[row.subject_species_id] || '(알 수 없는 종족)') : '';
  if (!row.designer_nickname && !row.artist_nickname && !isSpecies) return '';
  return `<dl class="labberlab-app-fields">
    ${row.designer_nickname ? `<div><dt>SUBJECT 디자이너</dt><dd>${escapeHtml(row.designer_nickname)}</dd></div>` : ''}
    ${row.artist_nickname ? `<div><dt>SUBJECT 아티스트</dt><dd>${escapeHtml(row.artist_nickname)}</dd></div>` : ''}
    ${isSpecies ? `<div><dt>연결 종족</dt><dd>${spName ? escapeHtml(spName) : '연결 종족 없음'}</dd></div>` : ''}
  </dl>`;
}

function subjectApprovalCardHtml(row) {
  const st = row.status;

  const footer = st === 'submitted'
    ? `<div class="labberlab-admin-controls" data-sctl="${row.id}">
         <label class="form-label">반려 사유 <span class="llapp-optional">반려할 때만 필수 · 신청자에게 그대로 표시돼요</span></label>
         <textarea class="form-textarea llapp-reject-reason" rows="3" maxlength="500" placeholder="예: 연결 종족 정보를 다시 확인해주세요."></textarea>
         <p class="auth-error labberlab-admin-err"></p>
         <div class="llapp-admin-btns">
           <button type="button" class="btn-ghost llapp-reject-btn" data-sact="reject">반려</button>
           <button type="button" class="btn-secondary" data-sact="approve">승인 (아이템 소비)</button>
         </div>
       </div>`
    : (row.reviewed_at ? `<p class="llapp-hint">검토 ${fmtDateTime(row.reviewed_at)}</p>` : '');

  const reasonBlock = (st === 'rejected' && row.rejection_reason)
    ? `<div class="labberlab-app-comment is-strong">
         <span class="labberlab-app-comment-label">반려 사유</span>
         <p>${escapeHtml(row.rejection_reason).replace(/\n/g, '<br>')}</p>
       </div>`
    : '';

  return `
  <article class="labberlab-app-card llapp-card" data-id="${row.id}">
    <div class="labberlab-app-thumb">
      ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="SUBJECT 이미지" loading="lazy" data-full="${escapeHtml(row.image_url)}">` : '<span>아트웍 없음</span>'}
    </div>
    <div class="labberlab-app-main">
      <div class="labberlab-app-top">
        <span class="labberlab-app-status ${LL_SUBJECT_STATUS_CLASS[st] || ''}">${LL_SUBJECT_STATUS_KO[st] || st}</span>
        <span class="labberlab-app-no">No. ${shortId(row.id)}</span>
        <span class="labberlab-app-date">신청 ${fmtDateTime(row.created_at)}</span>
        <span class="labberlab-app-applicant">${escapeHtml(row._nick)}</span>
      </div>
      <p class="llapp-hint">SUBJECT: ${escapeHtml(row._subjectName)} · 아이템: ${escapeHtml(row._itemName)}</p>
      ${subjectCreatorFieldsHtml(row)}
      ${reasonBlock}
      ${footer}
    </div>
  </article>`;
}

function renderSubjectApprovalList() {
  const listEl = llEl('subjectApprovalList');
  const emptyEl = llEl('subjectApprovalEmpty');
  const t = LL_SUBJECT_APPROVAL_TABS.find(x => x.key === _llSubjectAdminTab) || LL_SUBJECT_APPROVAL_TABS[0];
  const rows = t.statuses ? _llSubjectAdminRows.filter(r => t.statuses.includes(r.status)) : _llSubjectAdminRows;

  if (!rows.length) { listEl.innerHTML = ''; emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';

  listEl.innerHTML = rows.map(subjectApprovalCardHtml).join('');
}

function onSubjectApprovalListClick(e) {
  if (llHandleCommonClick(e)) return;
  const btn = e.target.closest('[data-sact]');
  if (!btn) return;
  const ctl = btn.closest('[data-sctl]');
  if (!ctl) return;
  if (btn.dataset.sact === 'approve') subjectApprovalApprove(ctl.dataset.sctl, ctl);
  else if (btn.dataset.sact === 'reject') subjectApprovalReject(ctl.dataset.sctl, ctl);
}

async function subjectApprovalApprove(id, ctl) {
  if (_llSubjectAdminBusy) return;
  const row = _llSubjectAdminRows.find(r => r.id === id);
  if (!row) return;
  const errEl = ctl.querySelector('.labberlab-admin-err');
  errEl.textContent = '';
  if (!confirm(`${row._nick || '신청자'}님의 SUBJECT 등록 신청을 승인할까요?\n예약된 SUBJECT 아이템이 실제로 소비되고 개인연구실에 등록돼요.`)) return;

  _llSubjectAdminBusy = true;
  llSetCtlBusy(ctl, true);
  try {
    const { data, error } = await sb.rpc('approve_labber_subject_bag_registration', { p_id: id });
    if (error) throw new Error(error.message);
    if (!data || !data.success) {
      errEl.textContent = llErrText(data);
      if (data && data.error === 'INVALID_STATUS') await loadSubjectApprovalList();
      return;
    }
    logAdminAction('labber_subject_bag_approve', 'labber_subject_bag_registration', id, row._nick, { instance_id: data.instance_id }).catch(() => {});
    await loadSubjectApprovalList();
  } catch (err) {
    console.error('[labber-lab] SUBJECT 승인 오류:', err);
    errEl.textContent = `승인에 실패했어요. (${err.message})`;
  } finally {
    _llSubjectAdminBusy = false;
    llSetCtlBusy(ctl, false);
  }
}

async function subjectApprovalReject(id, ctl) {
  if (_llSubjectAdminBusy) return;
  const row = _llSubjectAdminRows.find(r => r.id === id);
  if (!row) return;
  const errEl = ctl.querySelector('.labberlab-admin-err');
  const reason = ctl.querySelector('.llapp-reject-reason').value.trim();
  errEl.textContent = '';
  if (!reason) { errEl.textContent = '반려 사유를 입력해주세요.'; return; }
  if (reason.length > 500) { errEl.textContent = '반려 사유는 500자 이하로 입력해주세요.'; return; }
  if (!confirm(`${row._nick || '신청자'}님의 SUBJECT 등록 신청을 반려할까요?\n예약된 아이템은 해제되고 소비되지 않아요.`)) return;

  _llSubjectAdminBusy = true;
  llSetCtlBusy(ctl, true);
  try {
    const { data, error } = await sb.rpc('reject_labber_subject_bag_registration', { p_id: id, p_reason: reason });
    if (error) throw new Error(error.message);
    if (!data || !data.success) {
      errEl.textContent = llErrText(data);
      if (data && data.error === 'INVALID_STATUS') await loadSubjectApprovalList();
      return;
    }
    logAdminAction('labber_subject_bag_reject', 'labber_subject_bag_registration', id, row._nick, { reason }).catch(() => {});
    await loadSubjectApprovalList();
  } catch (err) {
    console.error('[labber-lab] SUBJECT 반려 오류:', err);
    errEl.textContent = `반려에 실패했어요. (${err.message})`;
  } finally {
    _llSubjectAdminBusy = false;
    llSetCtlBusy(ctl, false);
  }
}

// ── 딥링크 포커스 (알림 링크 ?tab=approval&app=<id>) ───────────────
function focusApplication(id) {
  setTimeout(() => {
    const card = document.querySelector(`.labberlab-app-card[data-id="${id}"]`);
    if (card) {
      card.classList.add('is-focused');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 300);
}

initPage();
