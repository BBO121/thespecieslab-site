'use strict';

// ═══════════════════════════════════════
//  종족연구소 가이드맵 (Guide Tour)
// ═══════════════════════════════════════

// ── 가이드 카테고리 & step 데이터 ────────────────────
const GUIDE_CATEGORIES = [
  {
    id:    'species-apply',
    title: '종족주 신청',
    desc:  '종족을 등록하려면 우선 종족주 신청부터!',
    steps: [
      {
        page:        'species-apply.html',
        selector:    '#sidebar a[href="species-apply.html"]',
        sidebarOpen: true,
        title:       '종족주 신청하기',
        desc:        '이 곳에서 종족주 신청을 해야 내 종족을 등록할 수 있어요.',
        tooltipPos:  'right',
      },
      {
        page:       'species-apply.html',
        selector:   '#writeBtn',
        title:      '신청서 작성',
        desc:       '신청하기 버튼을 눌러 종족주 신청을 진행해주세요.\n이미 종족주이거나 종족주 신청이 진행 중인 경우에는 버튼이 표시되지 않을 수 있어요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'species-apply-write.html',
        selector:   '#speciesName',
        title:      '신청 내용 입력',
        desc:       '보유한 종족의 이름과 이미지 또는 링크를 입력해주세요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'species-apply.html',
        selector:   '#applyList, #emptyState',
        title:      '신청 상태 확인',
        desc:       '제출한 신청서는 목록에서 상태를 확인할 수 있습니다.\n승인되면 종족 등록 권한이 부여됩니다.',
        tooltipPos: 'top',
        dummy: {
          targetId: 'applyList',
          hideId:   'emptyState',
          check:    el => el.children.length === 0,
          html: `<a class="notice-item" style="pointer-events:none;" data-guide-dummy="1">
            <div class="notice-header-left" style="gap:8px;">
              <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap;background:#f1f5f9;color:#64748b">접수됨</span>
              <span class="notice-title">누비루</span>
            </div>
            <div class="notice-header-right">
              <span class="notice-date">2026.06.07</span>
              <span class="notice-arrow-right">›</span>
            </div>
          </a>`,
        },
      },
    ],
  },
  {
    id:    'species-register',
    title: '종족등록',
    desc:  '종족주 권한이 있다면 종족을 직접 등록할 수 있어요.',
    steps: [
      {
        page:       'species-register.html',
        selector:   'h1.register-title',
        title:      '종족 등록 시작',
        desc:       '종족주 권한이 있는 유저만 종족을 등록할 수 있어요. 사이드바 → 종족 메뉴의 종족 페이지에서 접근할 수 있어요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'species-register.html',
        selector:   '#imgUploadBox',
        title:      '대표 이미지 등록',
        desc:       '종족을 대표하는 이미지를 업로드해요. 권장 비율 1:1, 최대 2MB입니다.',
        tooltipPos: 'bottom',
      },
      {
        page:       'species-register.html',
        selector:   '#speciesName',
        title:      '종족 기본 설정',
        desc:       '종족명, 설명, 연관링크, 디자인권 정보를 입력해요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'species-register.html',
        selector:   '.guide-check-row',
        title:      '종족 설정 탭 선택',
        desc:       '세계관, 설정, 디자인 가이드, TOS 등 종족에 필요한 탭을 선택하고 내용을 입력해요.',
        tooltipPos: 'top',
      },
    ],
  },
  {
    id:    'character-register',
    title: '개체등록',
    desc:  '내 종족의 개체를 등록하는 방법을 알아봐요',
    steps: [
      {
        page:       'character-register.html',
        selector:   'h1.register-title',
        title:      '개체 등록 시작',
        desc:       '종족 상세 페이지 또는 내 종족 관리에서 개체 등록을 시작해요. 사이트 유저 소유와 오프사이트 소유를 구분해서 등록할 수 있어요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'character-register.html',
        selector:   '#uploadBox',
        title:      '이미지 업로드',
        desc:       '개체의 메인 이미지를 업로드해요. 업로드 후 썸네일을 따로 편집할 수 있어요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'character-register.html',
        selector:   '#registerForm',
        title:      '기본 정보 입력',
        desc:       '개체 이름, 소유주(사이트 유저 또는 오프사이트), 디자이너 등 기본 정보를 입력해요.',
        tooltipPos: 'top',
      },
      {
        page:       'character-register.html',
        selector:   '#thumbnailSection, #cropSection, .img-upload-box--portrait',
        title:      '썸네일 편집',
        desc:       '업로드한 이미지에서 목록에 표시될 썸네일 영역을 직접 조절할 수 있어요.',
        tooltipPos: 'top',
      },
    ],
  },
  {
    id:    'character-transfer',
    title: '개체이전',
    desc:  '등록된 개체의 소유주를 변경하는 방법을 알아봐요',
    steps: [
      {
        page:       'character-list.html',
        selector:   '.main',
        title:      '개체 이전 시작',
        desc:       '개체 상세 페이지에서 "이전 신청" 버튼을 눌러 이전을 시작해요. 현재 소유주만 신청할 수 있어요.',
        tooltipPos: 'top',
      },
      {
        page:       'character-list.html',
        selector:   '.main',
        title:      '이전 방법 선택',
        desc:       '닉네임 직접 입력 또는 링크 공유 방식으로 새 소유주를 지정할 수 있어요.',
        tooltipPos: 'top',
      },
      {
        page:       'character-list.html',
        selector:   '.main',
        title:      '이전 기록 확인',
        desc:       '사이드바 → 내 정보 → 캐릭터 이전 내역에서 과거 이전 기록을 모두 확인할 수 있어요.',
        tooltipPos: 'top',
      },
    ],
  },
  {
    id:    'adoption',
    title: '분양',
    desc:  '분양 등록, 참여, 상태 확인 방법을 알아봐요',
    steps: [
      {
        page:        'adoption.html',
        selector:    '#sidebar a[href="adoption.html"]',
        sidebarOpen: true,
        title:       '분양란 진입',
        desc:        '사이드바의 분양 메뉴를 눌러 분양란에 진입해요.',
        tooltipPos:  'right',
      },
      {
        page:       'adoption.html',
        selector:   '.filter-wrap',
        title:      '분양 타입 필터',
        desc:       '무료, 유료, 경매, 리퀘 등 분양 유형을 필터로 선택해 원하는 분양만 볼 수 있어요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'adoption.html',
        selector:   '#writeBtn, h1.list-page-title',
        title:      '분양 등록',
        desc:       '로그인 후 "글 작성" 버튼을 눌러 새 분양 글을 올릴 수 있어요. 분양 유형(무료/유료/경매/리퀘), 가격, 마감일을 설정해요.',
        tooltipPos: 'bottom',
      },
      {
        page:       'adoption.html',
        selector:   '#adoptionGrid, #emptyState',
        title:      '분양 참여 방법',
        desc:       '분양 항목을 클릭하면 상세 페이지에서 댓글/멘션으로 참여할 수 있어요. 분양 상태(분양중 → 완료)도 여기서 확인해요.',
        tooltipPos: 'top',
      },
    ],
  },
  {
    id:    'profile-settings',
    title: '프로필설정',
    desc:  '닉네임, 프로필, 내 개체/디자인, 알림 확인 방법',
    steps: [
      {
        page:       'profile.html',
        selector:   '.main',
        title:      '내 프로필',
        desc:       '사이드바 → 내 정보 → 내 프로필에서 닉네임과 프로필 이미지를 설정할 수 있어요.',
        tooltipPos: 'top',
      },
      {
        page:       'my-characters.html',
        selector:   '.main',
        title:      '내 개체 확인',
        desc:       '사이드바 → 내 캐릭터에서 내가 소유한 개체 목록을 볼 수 있어요.',
        tooltipPos: 'top',
      },
      {
        page:       'my-designs.html',
        selector:   '.main',
        title:      '내 디자인 확인',
        desc:       '사이드바 → 내 디자인에서 내가 디자인한 개체 목록을 볼 수 있어요.',
        tooltipPos: 'top',
      },
      {
        page:       'notifications.html',
        selector:   '.main',
        title:      '알림 확인',
        desc:       '사이드바의 알림 메뉴에서 받은 알림을 확인하고 관리할 수 있어요.',
        tooltipPos: 'top',
      },
    ],
  },
];

// ── 상태 ─────────────────────────────────────────────
let _active       = false;
let _catId        = null;
let _stepIdx      = 0;
let _targetEl     = null;
let _stepData     = null;
let _dummyCleanup = null;

// ── DOM 요소 참조 ─────────────────────────────────────
let _overlay   = null;
let _spotlight = null;
let _tooltip   = null;
let _modal     = null;

// ── 초기화 ───────────────────────────────────────────
function _init() {
  if (document.getElementById('tourOverlay')) return; // 이미 초기화됨

  // 오버레이
  _overlay = document.createElement('div');
  _overlay.id = 'tourOverlay';
  _overlay.className = 'tour-overlay';
  _overlay.addEventListener('click', closeGuide);
  document.body.appendChild(_overlay);

  // 스포트라이트
  _spotlight = document.createElement('div');
  _spotlight.id = 'tourSpotlight';
  _spotlight.className = 'tour-spotlight';
  document.body.appendChild(_spotlight);

  // 툴팁
  _tooltip = document.createElement('div');
  _tooltip.id = 'tourTooltip';
  _tooltip.className = 'tour-tooltip';
  _tooltip.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(_tooltip);

  // 카테고리 선택 모달
  _modal = document.createElement('div');
  _modal.id = 'tourModal';
  _modal.className = 'tour-modal-wrap';
  _modal.addEventListener('click', e => { if (e.target === _modal) closeCategoryModal(); });
  document.body.appendChild(_modal);

  // 스크롤 시 spotlight/tooltip 위치 업데이트
  window.addEventListener('scroll', _onScroll, { passive: true });
  window.addEventListener('resize', _onResize, { passive: true });

  // URL parameter 자동 시작
  _autoStart();
}

// ── 카테고리 모달 ─────────────────────────────────────
function openCategoryModal() {
  _modal.innerHTML = _buildModalHTML();
  _modal.addEventListener('click', e => { if (e.target === _modal) closeCategoryModal(); });
  _modal.classList.add('tour-modal-wrap--open');
  document.body.style.overflow = 'hidden';
}

function closeCategoryModal() {
  _modal.classList.remove('tour-modal-wrap--open');
  document.body.style.overflow = '';
}

function _buildModalHTML() {
  const cards = GUIDE_CATEGORIES.map(cat => {
    const done = _isDone(cat.id);
    return `<button class="tour-cat-card${done ? ' tour-cat-card--done' : ''}" onclick="startGuide('${cat.id}')">
      <span class="tour-cat-title">${cat.title}</span>
      <span class="tour-cat-desc">${cat.desc}</span>
    </button>`;
  }).join('');

  return `<div class="tour-modal">
    <div class="tour-modal-head">
      <span class="tour-modal-title">연구소 가이드</span>
      <button class="tour-modal-close-btn" onclick="closeCategoryModal()">✕</button>
    </div>
    <p class="tour-modal-sub">연구소에 대해 알아봅시다!</p>
    <div class="tour-cat-grid">${cards}</div>
  </div>`;
}

// ── 가이드 시작 ───────────────────────────────────────
function startGuide(catId, stepIdx) {
  stepIdx = stepIdx !== undefined ? parseInt(stepIdx, 10) : 0;
  if (isNaN(stepIdx)) stepIdx = 0;

  const cat = GUIDE_CATEGORIES.find(c => c.id === catId);
  if (!cat || !cat.steps.length) return;

  closeCategoryModal();

  _catId   = catId;
  _stepIdx = stepIdx;
  _active  = true;

  const step       = cat.steps[stepIdx];
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  if (step.page !== currentPage) {
    const p = new URLSearchParams({ guide: catId, step: stepIdx });
    window.location.href = step.page + '?' + p.toString();
    return;
  }

  _showStep(stepIdx);
}

// ── URL parameter 자동 시작 ───────────────────────────
function _autoStart() {
  const p    = new URLSearchParams(window.location.search);
  const gid  = p.get('guide');
  const sidx = p.get('step');
  if (!gid) return;
  setTimeout(() => startGuide(gid, sidx), 600);
}

// ── Step 표시 ─────────────────────────────────────────
function _showStep(idx) {
  const cat  = GUIDE_CATEGORIES.find(c => c.id === _catId);
  if (!cat) return;

  const step = cat.steps[idx];
  _stepData  = step;
  _stepIdx   = idx;

  // 사이드바가 필요한 step — 모바일에서 자동 열기 + 최상위 z-index 부여
  if (step.sidebarOpen && window.innerWidth <= 767) {
    document.body.classList.add('tour-sidebar-step');
    const sidebar = document.getElementById('sidebar');
    const isOpen  = sidebar && sidebar.classList.contains('sidebar--open');
    if (!isOpen && typeof toggleSidebar === 'function') {
      toggleSidebar();
    }
    setTimeout(() => _render(step, cat, idx), 380);
    return;
  }

  // 사이드바가 필요 없는 step — 모바일에서 사이드바 닫기
  document.body.classList.remove('tour-sidebar-step');
  if (!step.sidebarOpen && window.innerWidth <= 767) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('sidebar--open') && typeof closeSidebar === 'function') {
      closeSidebar();
    }
  }

  _render(step, cat, idx);
}

function _render(step, cat, idx) {
  _removeDummy();

  if (step.dummy) {
    const target = document.getElementById(step.dummy.targetId);
    if (target && step.dummy.check(target)) {
      target.className = 'notice-list';
      target.insertAdjacentHTML('beforeend', step.dummy.html);
      const hideEl = step.dummy.hideId ? document.getElementById(step.dummy.hideId) : null;
      const prevDisplay = hideEl ? hideEl.style.display : null;
      if (hideEl) hideEl.style.display = 'none';
      _dummyCleanup = () => {
        target.querySelectorAll('[data-guide-dummy]').forEach(el => el.remove());
        if (hideEl && prevDisplay !== null) hideEl.style.display = prevDisplay;
      };
    }
  }

  _targetEl = _findTarget(step.selector);

  _overlay.classList.add('tour-overlay--active');

  if (_targetEl) {
    _targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      _placeSpotlight(_targetEl);
      _placeTooltip(step, cat, idx);
    }, 350);
  } else {
    _spotlight.style.opacity = '0';
    _placeTooltipCenter(step, cat, idx);
  }
}

// ── 요소 탐색 ─────────────────────────────────────────
function _findTarget(selector) {
  const parts = selector.split(',');
  for (const s of parts) {
    const el = document.querySelector(s.trim());
    if (el) return el;
  }
  return null;
}

// ── Spotlight 위치 ────────────────────────────────────
function _placeSpotlight(el) {
  const r   = el.getBoundingClientRect();
  const pad = 8;

  _spotlight.style.opacity = '1';
  _spotlight.style.top     = (r.top    - pad) + 'px';
  _spotlight.style.left    = (r.left   - pad) + 'px';
  _spotlight.style.width   = (r.width  + pad * 2) + 'px';
  _spotlight.style.height  = (r.height + pad * 2) + 'px';
}

// ── Tooltip 위치 ──────────────────────────────────────
function _placeTooltip(step, cat, idx) {
  if (!_targetEl) return;

  _tooltip.innerHTML = _buildTooltipHTML(step, cat, idx);
  _tooltip.style.transform = '';
  _tooltip.style.opacity   = '1';
  _tooltip.style.display   = 'block';

  const r    = _targetEl.getBoundingClientRect();
  const tw   = 284;
  const th   = _tooltip.offsetHeight || 160;
  const gap  = 14;
  const pad  = 16;
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  const pos  = step.tooltipPos || 'bottom';

  let top, left;

  if (pos === 'bottom') {
    top  = r.bottom + gap;
    left = r.left + r.width / 2 - tw / 2;
  } else if (pos === 'top') {
    top  = r.top - th - gap;
    left = r.left + r.width / 2 - tw / 2;
  } else if (pos === 'right') {
    top  = r.top + r.height / 2 - th / 2;
    left = r.right + gap;
  } else if (pos === 'left') {
    top  = r.top + r.height / 2 - th / 2;
    left = r.left - tw - gap;
  }

  // 뷰포트 안으로 보정
  left = Math.max(pad, Math.min(left, vw - tw - pad));
  top  = Math.max(pad, Math.min(top,  vh - th - pad));

  _tooltip.style.top  = top  + 'px';
  _tooltip.style.left = left + 'px';
}

function _placeTooltipCenter(step, cat, idx) {
  _tooltip.innerHTML = _buildTooltipHTML(step, cat, idx);
  _tooltip.style.top       = '50%';
  _tooltip.style.left      = '50%';
  _tooltip.style.transform = 'translate(-50%, -50%)';
  _tooltip.style.opacity   = '1';
  _tooltip.style.display   = 'block';
}

// ── Tooltip HTML ──────────────────────────────────────
function _buildTooltipHTML(step, cat, idx) {
  const total   = cat.steps.length;
  const isFirst = idx === 0;
  const isLast  = idx === total - 1;

  const dots = Array.from({ length: total }, (_, i) =>
    `<span class="tour-dot${i === idx ? ' tour-dot--on' : ''}"></span>`
  ).join('');

  const prevBtn = !isFirst
    ? `<button class="tour-btn tour-btn--prev" onclick="guidePrev()">이전</button>`
    : '';
  const nextBtn = isLast
    ? `<button class="tour-btn tour-btn--done" onclick="completeGuide()">완료</button>`
    : `<button class="tour-btn tour-btn--next" onclick="guideNext()">다음</button>`;

  return `<div class="tour-tt-head">
    <span class="tour-tt-cat">${cat.title}</span>
    <button class="tour-tt-close" onclick="closeGuide()">✕</button>
  </div>
  <div class="tour-tt-step-label">${idx + 1} / ${total}</div>
  <p class="tour-tt-title">${step.title}</p>
  <p class="tour-tt-desc">${step.desc.replace(/\n/g, '<br>')}</p>
  <div class="tour-tt-foot">
    <div class="tour-dots">${dots}</div>
    <div class="tour-tt-btns">${prevBtn}${nextBtn}</div>
  </div>`;
}

// ── 다음 / 이전 ───────────────────────────────────────
function guideNext() {
  const cat  = GUIDE_CATEGORIES.find(c => c.id === _catId);
  if (!cat) return;

  const next = _stepIdx + 1;
  if (next >= cat.steps.length) { completeGuide(); return; }

  const nextStep    = cat.steps[next];
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  if (nextStep.page !== currentPage) {
    const p = new URLSearchParams({ guide: _catId, step: next });
    window.location.href = nextStep.page + '?' + p.toString();
  } else {
    _showStep(next);
  }
}

function guidePrev() {
  if (_stepIdx <= 0) return;

  const cat  = GUIDE_CATEGORIES.find(c => c.id === _catId);
  if (!cat) return;

  const prev = _stepIdx - 1;
  const prevStep    = cat.steps[prev];
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  if (prevStep.page !== currentPage) {
    const p = new URLSearchParams({ guide: _catId, step: prev });
    window.location.href = prevStep.page + '?' + p.toString();
  } else {
    _showStep(prev);
  }
}

// ── 닫기 / 완료 ───────────────────────────────────────
function closeGuide() {
  if (!_active) return;
  _active    = false;
  _targetEl  = null;
  _stepData  = null;

  _removeDummy();
  document.body.classList.remove('tour-sidebar-step');
  _overlay.classList.remove('tour-overlay--active');
  _spotlight.style.opacity = '0';
  _tooltip.style.opacity   = '0';
  _tooltip.style.display   = 'none';

  // URL 파라미터 제거
  const url = new URL(window.location.href);
  url.searchParams.delete('guide');
  url.searchParams.delete('step');
  history.replaceState(null, '', url.toString());

  // 모바일에서 열었던 사이드바 닫기
  if (window.innerWidth <= 767 && typeof closeSidebar === 'function') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('sidebar--open')) closeSidebar();
  }
}

function completeGuide() {
  const catId = _catId;
  closeGuide();
  localStorage.setItem('tour_done_' + catId, '1');
  _showToast(GUIDE_CATEGORIES.find(c => c.id === catId)?.title || '');
}

function _isDone(catId) {
  return localStorage.getItem('tour_done_' + catId) === '1';
}

// ── 완료 토스트 ───────────────────────────────────────
function _showToast(catTitle) {
  const t = document.createElement('div');
  t.className = 'tour-toast';
  t.textContent = '✓ ' + catTitle + ' 가이드 완료!';
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('tour-toast--show'));
  setTimeout(() => {
    t.classList.remove('tour-toast--show');
    setTimeout(() => t.remove(), 400);
  }, 2600);
}

// ── 더미 데이터 ───────────────────────────────────────
function _removeDummy() {
  if (_dummyCleanup) { _dummyCleanup(); _dummyCleanup = null; }
}

// ── 스크롤 / 리사이즈 대응 ────────────────────────────
function _onScroll() {
  if (!_active || !_targetEl || !_stepData) return;
  const cat = GUIDE_CATEGORIES.find(c => c.id === _catId);
  _placeSpotlight(_targetEl);
  _placeTooltip(_stepData, cat, _stepIdx);
}

function _onResize() {
  if (!_active || !_targetEl || !_stepData) return;
  const cat = GUIDE_CATEGORIES.find(c => c.id === _catId);
  _placeSpotlight(_targetEl);
  _placeTooltip(_stepData, cat, _stepIdx);
}

// ── 전역 노출 ─────────────────────────────────────────
window.openCategoryModal  = openCategoryModal;
window.closeCategoryModal = closeCategoryModal;
window.startGuide         = startGuide;
window.guideNext          = guideNext;
window.guidePrev          = guidePrev;
window.closeGuide         = closeGuide;
window.completeGuide      = completeGuide;

// ── 실행 ─────────────────────────────────────────────
// 정적 로드 및 동적 로드(sidebar.js에서 inject) 모두 지원
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _init);
} else {
  _init();
}
