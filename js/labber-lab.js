// ── LABBER 관리소 (labber-lab.html) ─────────────────────────────
// 탭: ABOUT LABBER(세계관/설정 기록) / 특성(준비중 placeholder) / 디자인 승인
// - 디자인 승인 탭 = 신청 폼 + "내 디자인 승인 신청" 목록(구 MY APPLICATIONS 통합)
//   + admin·staff 승인 관리. 본인 신청 조회/수정/상태·코멘트 확인 기능은 그대로 유지.
//
// 디자인 이미지는 비공개 버킷 'labber-designs' 에 저장하고
// 표시할 때마다 signed URL 을 발급한다 (public URL 아님).
// 관리자 권한 실제 판정은 DB RLS(app_metadata.role)가 담당하고,
// 여기서 isAdminOrStaff(user_metadata.role)는 UI 게이트로만 쓴다.

const LL_BUCKET = 'labber-designs';
const LL_SIGNED_TTL = 3600;

const LL_STATUS_KO = {
  pending: '검토중',
  approved: '승인',
  revision_requested: '수정요청',
  rejected: '반려',
};
const LL_STATUS_CLASS = {
  pending: 'is-pending',
  approved: 'is-approved',
  revision_requested: 'is-revision',
  rejected: 'is-rejected',
};
const LL_EDITABLE = ['pending', 'revision_requested'];

// status 변경 시 신청자에게 보낼 알림 문구 (실제로 status가 바뀐 경우에만 발송)
const LL_NOTIFY_MSG = {
  approved: 'LABBER 디자인 승인 신청이 승인되었어요.',
  revision_requested: 'LABBER 디자인 승인 신청에 수정 요청이 있어요.',
  rejected: 'LABBER 디자인 승인 신청이 반려되었어요.',
};

const LL_MANAGER_LINE = '지금 몇시야... ... 어, 왔어? LABBER 디자인 검토해줄까?';

const LL_ADMIN_TABS = [
  { key: 'all', label: '전체', statuses: null },
  { key: 'pending', label: '검토중', statuses: ['pending'] },
  { key: 'revision_requested', label: '수정요청', statuses: ['revision_requested'] },
  { key: 'approved', label: '승인', statuses: ['approved'] },
  { key: 'rejected', label: '반려', statuses: ['rejected'] },
];

// ── 디자인 승인 기능 노출 플래그 ─────────────────────────────
// 런칭 임시 비공개. 아이템/특성 적용 시스템 완성 후 true 로 되돌리면 기존 신청 폼/관리자 UI가
// 그대로 복구된다. DB(labber_design_applications)·RLS·기존 폼 HTML·JS 로직은 삭제하지 않는다.
//   false → '디자인 승인' 탭 진입 시 준비중 화면만 표시 + 제출 진입점(onFormSubmit/saveAdminDecision) 차단
//   true  → 기존 동작 그대로
const DESIGN_APPROVAL_ENABLED = false;

let _llUser = null;
let _llIsAdmin = false;
let _llPendingBlob = null;      // 폼에서 새로 고른 이미지 (compressImage 결과)
let _llCurrentImagePath = null; // 수정 모드에서 기존 이미지 경로
let _llAdminTab = 'all';
let _llAdminRows = [];

// ── 초기화 ────────────────────────────────────────────────────
async function initPage() {
  try {
    _llUser = await getUser();
    _llIsAdmin = !!_llUser && isAdminOrStaff(_llUser.user_metadata?.role);

    setupTabs();
    renderTraits();
    setupTraitSubtabs();
    runManagerTyping();
    wireForm();   // 항상 바인딩 — onFormSubmit 이 플래그 확인 후 차단(DOM 조작 대비)

    // DESIGN APPROVAL
    if (DESIGN_APPROVAL_ENABLED) {
      await populateSpeciesSelect();
      // 유저 폼 / 관리자 뷰 분기
      if (_llIsAdmin) {
        document.getElementById('approvalUserView').hidden = true;
        document.getElementById('approvalAdminView').hidden = false;
        setupAdminStatusTabs();
      }
    } else {
      showApprovalPending();   // 런칭 임시 비공개 — 준비중 화면
    }

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';

    // 딥링크: ?tab=about|traits|approval , ?app=<id>
    // 구 링크(?tab=my)는 '디자인 승인' 탭으로 매핑 (MY APPLICATIONS 통합됨)
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'my') switchTab('approval');
    else if (['about', 'traits', 'approval'].includes(tab)) switchTab(tab);

    // 특성 딥링크(#trait-*) — ?tab= 처리 뒤에 실행해 특성 탭/하위 탭을 확정하고 스크롤
    handleTraitHashDeepLink();
    window.addEventListener('hashchange', handleTraitHashDeepLink);

    // 데이터 로드 (디자인 승인 공개 시에만)
    if (DESIGN_APPROVAL_ENABLED) {
      if (_llUser) await loadMyList();
      if (_llIsAdmin) await loadAdminList();
      if (!_llUser) document.getElementById('myGuestDesc').style.display = '';

      const focusId = params.get('app');
      if (focusId) focusApplication(focusId);
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
  const el = document.getElementById(anchor);
  if (el) {
    // 탭이 표시(hidden 해제)된 뒤 레이아웃이 잡히도록 다음 프레임에 스크롤
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function switchTab(tab) {
  document.querySelectorAll('#tabRow .shop-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['about', 'traits', 'approval'].forEach(t => {
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

// 비로그인 사용자가 '디자인 승인' 탭을 열었을 때 신청 폼 자리에 로그인 안내
function showLoginPrompt() {
  const host = document.getElementById('approvalUserView');
  if (host.querySelector('.labberlab-login-prompt')) return;
  document.getElementById('designForm').style.display = 'none';
  const box = document.createElement('div');
  box.className = 'labberlab-login-prompt empty-state-wrap';
  box.innerHTML = `
    <div class="empty-state-icon">🔒</div>
    <p class="empty-state-title">로그인이 필요해요</p>
    <a href="login.html" class="btn-secondary" style="margin-top:12px;">로그인하러 가기</a>`;
  host.appendChild(box);
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

// ── 종족 셀렉트 ──────────────────────────────────────────────
async function populateSpeciesSelect() {
  const sel = document.getElementById('subjectSpeciesSelect');
  if (!sel) return;
  try {
    const list = await window._getSpeciesData();
    (list || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('[labber-lab] 종족 목록 로드 실패:', e);
  }
}

// ── 이미지 선택 ──────────────────────────────────────────────
async function onImagePick(input) {
  const file = input.files[0];
  if (!file) return;
  const errEl = document.getElementById('formError');
  errEl.textContent = '';
  try {
    const blob = await compressImage(file);
    _llPendingBlob = blob;
    const url = URL.createObjectURL(blob);
    const img = document.getElementById('imagePreview');
    img.src = url;
    img.style.display = 'block';
    document.getElementById('uploadPlaceholder').style.display = 'none';
    document.getElementById('removeImageBtn').style.display = '';
  } catch (e) {
    input.value = '';
    errEl.textContent = e.message || '이미지를 처리할 수 없어요.';
  }
}

function clearImage() {
  _llPendingBlob = null;
  document.getElementById('imageFile').value = '';
  const img = document.getElementById('imagePreview');
  img.src = '';
  img.style.display = 'none';
  document.getElementById('uploadPlaceholder').style.display = '';
  document.getElementById('removeImageBtn').style.display = 'none';
  // 수정 모드에서 기존 이미지를 지운 경우에도 제출 시 "이미지 필수" 검증에 걸리도록
  if (document.getElementById('editingId').value) _llCurrentImagePath = null;
}

// ── 폼 제출 (신규 / 수정) ────────────────────────────────────
function wireForm() {
  const form = document.getElementById('designForm');
  if (!form) return;
  form.addEventListener('submit', onFormSubmit);
}

function readForm() {
  return {
    pod_description: document.getElementById('podInput').value.trim(),
    ink: document.getElementById('inkInput').value.trim(),
    subject_description: document.getElementById('subjectDescInput').value.trim(),
    subject_species_id: document.getElementById('subjectSpeciesSelect').value || null,
    subject_species_name: document.getElementById('subjectSpeciesNameInput').value.trim() || null,
    designer: document.getElementById('designerInput').value.trim(),
    note: document.getElementById('noteInput').value.trim() || null,
  };
}

async function uploadDesignImage(blob) {
  const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
  const path = `${_llUser.id}/${crypto.randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const { error } = await sb.storage.from(LL_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new Error(`이미지 업로드에 실패했어요. (${error.message})`);
  return path;
}

async function onFormSubmit(e) {
  e.preventDefault();
  // 런칭 임시 비공개 — 폼이 DOM 조작으로 다시 보여도 제출 로직은 실행하지 않는다.
  if (!DESIGN_APPROVAL_ENABLED) return;
  if (!_llUser) { showLoginPrompt(); return; }

  const errEl = document.getElementById('formError');
  const btn = document.getElementById('submitBtn');
  const editingId = document.getElementById('editingId').value;
  const v = readForm();
  errEl.textContent = '';

  if (!editingId && !_llPendingBlob) { errEl.textContent = '디자인 이미지를 업로드해주세요.'; return; }
  if (editingId && !_llPendingBlob && !_llCurrentImagePath) { errEl.textContent = '디자인 이미지를 업로드해주세요.'; return; }
  if (!v.pod_description) { errEl.textContent = 'POD 설명을 입력해주세요.'; return; }
  if (!v.ink) { errEl.textContent = 'INK 색상/명칭을 입력해주세요.'; return; }
  if (!v.subject_description) { errEl.textContent = 'SUBJECT 설명을 입력해주세요.'; return; }
  if (!v.designer) { errEl.textContent = '디자이너를 입력해주세요.'; return; }

  btn.disabled = true;
  btn.textContent = editingId ? '수정 중...' : '제출 중...';

  try {
    const nickname = _llUser.user_metadata?.display_name || _llUser.user_metadata?.nickname || '유저';

    let imagePath = _llCurrentImagePath;
    let oldPathToRemove = null;
    if (_llPendingBlob) {
      imagePath = await uploadDesignImage(_llPendingBlob);
      if (editingId && _llCurrentImagePath && _llCurrentImagePath !== imagePath) {
        oldPathToRemove = _llCurrentImagePath;
      }
    }

    if (editingId) {
      const { error } = await sb.from('labber_design_applications').update({
        image_path: imagePath,
        pod_description: v.pod_description,
        ink: v.ink,
        subject_description: v.subject_description,
        subject_species_id: v.subject_species_id,
        subject_species_name: v.subject_species_name,
        designer: v.designer,
        note: v.note,
      }).eq('id', editingId);
      if (error) throw new Error(`수정에 실패했어요. (${error.message})`);

      if (oldPathToRemove) {
        sb.storage.from(LL_BUCKET).remove([oldPathToRemove])
          .then(({ error }) => { if (error) console.warn('[labber-lab] 이전 이미지 정리 실패:', error.message); });
      }
    } else {
      const { error } = await sb.from('labber_design_applications').insert({
        user_id: _llUser.id,
        applicant_nickname: nickname,
        image_path: imagePath,
        pod_description: v.pod_description,
        ink: v.ink,
        subject_description: v.subject_description,
        subject_species_id: v.subject_species_id,
        subject_species_name: v.subject_species_name,
        designer: v.designer,
        note: v.note,
        status: 'pending',
      });
      if (error) throw new Error(`제출에 실패했어요. (${error.message})`);
    }

    resetForm();
    restoreApprovalView();
    switchTab('approval');
    await loadMyList();
    if (_llIsAdmin) await loadAdminList();
    alert(editingId ? '신청을 수정했어요.' : 'LABBER 디자인 승인 신청을 제출했어요.');
  } catch (err) {
    console.error('[labber-lab] 제출 오류:', err);
    errEl.textContent = err.message || '처리 중 오류가 발생했어요.';
  } finally {
    btn.disabled = false;
    btn.textContent = document.getElementById('editingId').value ? '수정하기' : '제출하기';
  }
}

function resetForm() {
  document.getElementById('designForm').reset();
  document.getElementById('editingId').value = '';
  _llPendingBlob = null;
  _llCurrentImagePath = null;
  const img = document.getElementById('imagePreview');
  img.src = ''; img.style.display = 'none';
  document.getElementById('uploadPlaceholder').style.display = '';
  document.getElementById('removeImageBtn').style.display = 'none';
  document.getElementById('formError').textContent = '';
  document.getElementById('submitBtn').textContent = '제출하기';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

function cancelEdit() {
  resetForm();
  restoreApprovalView();
  switchTab('approval');
}

// 관리자는 평소 DESIGN APPROVAL 탭에서 "승인 관리" 뷰를 본다.
// 본인 신청을 수정할 때만 잠시 신청 폼 뷰로 전환하고, 끝나면 되돌린다.
function restoreApprovalView() {
  if (!_llIsAdmin) return;
  document.getElementById('approvalUserView').hidden = true;
  document.getElementById('approvalAdminView').hidden = false;
}

async function startEdit(row) {
  if (_llIsAdmin) {
    document.getElementById('approvalUserView').hidden = false;
    document.getElementById('approvalAdminView').hidden = true;
    document.getElementById('designForm').style.display = '';
  }
  document.getElementById('editingId').value = row.id;
  _llCurrentImagePath = row.image_path;
  _llPendingBlob = null;

  document.getElementById('podInput').value = row.pod_description || '';
  document.getElementById('inkInput').value = row.ink || '';
  document.getElementById('subjectDescInput').value = row.subject_description || '';
  document.getElementById('subjectSpeciesSelect').value = row.subject_species_id ? String(row.subject_species_id) : '';
  document.getElementById('subjectSpeciesNameInput').value = row.subject_species_name || '';
  document.getElementById('designerInput').value = row.designer || '';
  document.getElementById('noteInput').value = row.note || '';

  const img = document.getElementById('imagePreview');
  const signed = await signedUrlFor(row.image_path);
  if (signed) {
    img.src = signed;
    img.style.display = 'block';
    document.getElementById('uploadPlaceholder').style.display = 'none';
    document.getElementById('removeImageBtn').style.display = '';
  }

  document.getElementById('submitBtn').textContent = '수정하기';
  document.getElementById('cancelEditBtn').style.display = '';
  document.getElementById('formError').textContent = '';
  switchTab('approval');
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function appCardHtml(row, imgUrl, opts = {}) {
  const st = row.status || 'pending';
  const speciesLabel = row.subject_species_name
    || (row.subject_species_id ? (opts.speciesNames?.[row.subject_species_id] || '연계 종족') : '—');
  const commentBlock = row.admin_comment
    ? `<div class="labberlab-app-comment ${st === 'revision_requested' || st === 'rejected' ? 'is-strong' : ''}">
         <span class="labberlab-app-comment-label">관리자 코멘트</span>
         <p>${escapeHtml(row.admin_comment).replace(/\n/g, '<br>')}</p>
       </div>`
    : '';

  return `
  <article class="labberlab-app-card" data-id="${row.id}">
    <div class="labberlab-app-thumb">
      ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="디자인" loading="lazy" data-full="${escapeHtml(imgUrl)}">` : '<span>이미지 없음</span>'}
    </div>
    <div class="labberlab-app-main">
      <div class="labberlab-app-top">
        <span class="labberlab-app-status ${LL_STATUS_CLASS[st]}">${LL_STATUS_KO[st] || st}</span>
        <span class="labberlab-app-no">No. ${shortId(row.id)}</span>
        <span class="labberlab-app-date">${fmtDate(row.created_at)}</span>
        ${opts.applicantNickname ? `<span class="labberlab-app-applicant">${escapeHtml(opts.applicantNickname)}</span>` : ''}
      </div>
      <dl class="labberlab-app-fields">
        <div><dt>POD</dt><dd>${escapeHtml(row.pod_description)}</dd></div>
        <div><dt>INK</dt><dd>${escapeHtml(row.ink)}</dd></div>
        <div><dt>SUBJECT</dt><dd>${escapeHtml(row.subject_description)}</dd></div>
        <div><dt>SUBJECT 종족</dt><dd>${escapeHtml(speciesLabel)}</dd></div>
        <div><dt>디자이너</dt><dd>${escapeHtml(row.designer)}</dd></div>
        ${row.note ? `<div><dt>비고</dt><dd>${escapeHtml(row.note)}</dd></div>` : ''}
      </dl>
      ${commentBlock}
      ${opts.footer || ''}
    </div>
  </article>`;
}

// 썸네일 클릭 → 원본 이미지 새 탭 (signed URL). 리스트 컨테이너에 위임.
function wireThumbZoom(containerId) {
  const el = document.getElementById(containerId);
  if (!el || el._zoomWired) return;
  el._zoomWired = true;
  el.addEventListener('click', (e) => {
    const img = e.target.closest('.labberlab-app-thumb img');
    if (img && img.dataset.full) window.open(img.dataset.full, '_blank', 'noopener');
  });
}

// ── 내 디자인 승인 신청 목록 (디자인 승인 탭 내부) ──────────
async function loadMyList() {
  const listEl = document.getElementById('myAppList');
  const emptyEl = document.getElementById('myEmpty');
  const mySection = document.getElementById('mySection');
  const { data, error } = await sb.from('labber_design_applications')
    .select('*').eq('user_id', _llUser.id).order('created_at', { ascending: false });

  if (error) { listEl.innerHTML = `<p class="auth-error">목록을 불러오지 못했어요. (${error.message})</p>`; return; }
  if (!data || !data.length) {
    listEl.innerHTML = '';
    // admin/staff 는 보통 본인 신청이 없으므로 섹션 자체를 숨겨 관리 화면을 깔끔하게 유지
    if (_llIsAdmin) { mySection.hidden = true; return; }
    emptyEl.style.display = 'flex';
    return;
  }
  mySection.hidden = false;
  emptyEl.style.display = 'none';

  const urls = await signedUrlMap(data.map(r => r.image_path));
  const speciesNames = await speciesNameMap(data);

  listEl.innerHTML = data.map(row => {
    const editable = LL_EDITABLE.includes(row.status);
    const footer = editable
      ? `<div class="labberlab-app-actions"><button type="button" class="btn-ghost" data-edit="${row.id}">수정</button></div>`
      : '';
    return appCardHtml(row, urls[row.image_path], { speciesNames, footer });
  }).join('');

  listEl.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', () => {
      const row = data.find(r => r.id === b.dataset.edit);
      if (row) startEdit(row);
    });
  });
  wireThumbZoom('myAppList');
}

async function speciesNameMap(rows) {
  const ids = [...new Set(rows.map(r => r.subject_species_id).filter(Boolean).map(String))];
  if (!ids.length) return {};
  try {
    const list = await window._getSpeciesData();
    const map = {};
    (list || []).forEach(s => { if (ids.includes(String(s.id))) map[s.id] = s.name; });
    return map;
  } catch { return {}; }
}

// ── DESIGN APPROVAL (admin) ─────────────────────────────────
function setupAdminStatusTabs() {
  const row = document.getElementById('adminStatusRow');
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

async function loadAdminList() {
  const { data, error } = await sb.from('labber_design_applications')
    .select('*').order('created_at', { ascending: false });
  if (error) {
    document.getElementById('adminAppList').innerHTML =
      `<p class="auth-error">목록을 불러오지 못했어요. (${error.message})</p>`;
    return;
  }
  _llAdminRows = data || [];

  // 신청자 현재 닉네임 매핑
  const ids = [...new Set(_llAdminRows.map(r => r.user_id).filter(Boolean))];
  let idToNick = {};
  try {
    const users = await resolveUsersByIds(ids);
    users.forEach(u => { idToNick[u.id] = u.nickname; });
  } catch (e) { console.warn('[labber-lab] 닉네임 매핑 실패:', e); }
  _llAdminRows.forEach(r => { r._nick = idToNick[r.user_id] || r.applicant_nickname; });

  renderAdminStatusCounts();
  await renderAdminList();
}

function renderAdminStatusCounts() {
  const row = document.getElementById('adminStatusRow');
  row.querySelectorAll('[data-atab]').forEach(btn => {
    const t = LL_ADMIN_TABS.find(x => x.key === btn.dataset.atab);
    const n = t.statuses ? _llAdminRows.filter(r => t.statuses.includes(r.status || 'pending')).length : _llAdminRows.length;
    btn.textContent = `${t.label} ${n}`;
  });
}

async function renderAdminList() {
  const listEl = document.getElementById('adminAppList');
  const emptyEl = document.getElementById('adminEmpty');
  const t = LL_ADMIN_TABS.find(x => x.key === _llAdminTab) || LL_ADMIN_TABS[0];
  const rows = t.statuses ? _llAdminRows.filter(r => t.statuses.includes(r.status || 'pending')) : _llAdminRows;

  if (!rows.length) { listEl.innerHTML = ''; emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';

  const urls = await signedUrlMap(rows.map(r => r.image_path));
  const speciesNames = await speciesNameMap(rows);

  listEl.innerHTML = rows.map(row => {
    const st = row.status || 'pending';
    const footer = `
      <div class="labberlab-admin-controls" data-ctl="${row.id}">
        <label class="form-label">상태 변경</label>
        <select class="form-input labberlab-admin-status">
          ${['pending', 'revision_requested', 'approved', 'rejected'].map(s =>
            `<option value="${s}"${s === st ? ' selected' : ''}>${LL_STATUS_KO[s]}</option>`).join('')}
        </select>
        <label class="form-label">관리자 코멘트</label>
        <textarea class="form-textarea labberlab-admin-comment" rows="3" placeholder="수정요청/반려 사유 등 신청자에게 전달할 내용">${escapeHtml(row.admin_comment || '')}</textarea>
        <p class="auth-error labberlab-admin-err"></p>
        <button type="button" class="btn-secondary labberlab-admin-save">저장 + 알림</button>
      </div>`;
    return appCardHtml(row, urls[row.image_path], { speciesNames, applicantNickname: row._nick, footer });
  }).join('');

  listEl.querySelectorAll('[data-ctl]').forEach(ctl => {
    ctl.querySelector('.labberlab-admin-save').addEventListener('click', () => {
      saveAdminDecision(ctl.dataset.ctl, ctl);
    });
  });
  wireThumbZoom('adminAppList');
}

async function saveAdminDecision(id, ctl) {
  if (!DESIGN_APPROVAL_ENABLED) return;   // 런칭 임시 비공개 — 승인 처리 진입점 차단
  const row = _llAdminRows.find(r => r.id === id);
  if (!row) return;
  const errEl = ctl.querySelector('.labberlab-admin-err');
  const btn = ctl.querySelector('.labberlab-admin-save');
  const newStatus = ctl.querySelector('.labberlab-admin-status').value;
  const newComment = ctl.querySelector('.labberlab-admin-comment').value.trim() || null;
  const oldStatus = row.status || 'pending';
  errEl.textContent = '';

  if (newStatus === 'revision_requested' && !newComment) {
    errEl.textContent = '수정요청은 코멘트를 함께 입력해주세요.'; return;
  }
  if (newStatus === 'rejected' && !newComment) {
    errEl.textContent = '반려는 사유(코멘트)를 함께 입력해주세요.'; return;
  }

  btn.disabled = true;
  btn.textContent = '저장 중...';
  try {
    const { error } = await sb.from('labber_design_applications').update({
      status: newStatus,
      admin_comment: newComment,
      admin_checked_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(error.message);

    // 알림: 실제로 status가 바뀐 경우에만
    const statusChanged = newStatus !== oldStatus;
    if (statusChanged && LL_NOTIFY_MSG[newStatus] && row.user_id) {
      const { error: nErr } = await sb.rpc('notify_user_by_id', {
        p_user_id: row.user_id,
        p_type: 'labber_design',
        p_message: LL_NOTIFY_MSG[newStatus],
        p_link: `labber-lab.html?tab=approval&app=${id}`,
      });
      if (nErr) console.warn('[labber-lab] 알림 발송 실패:', nErr.message);
    }

    logAdminAction('labber_design_decision', 'labber_design', id, row._nick, {
      from: oldStatus, to: newStatus, notified: statusChanged && !!LL_NOTIFY_MSG[newStatus],
    }).catch(() => {});

    row.status = newStatus;
    row.admin_comment = newComment;
    renderAdminStatusCounts();
    await renderAdminList();
  } catch (e) {
    console.error('[labber-lab] 관리자 저장 오류:', e);
    errEl.textContent = `저장에 실패했어요. (${e.message})`;
    btn.disabled = false;
    btn.textContent = '저장 + 알림';
  }
}

// ── 딥링크 포커스 ───────────────────────────────────────────
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
