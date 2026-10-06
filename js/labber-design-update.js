// ── LABBER 관리소 · 디자인 업데이트 탭 (labber-lab.html #tab-update) ─────────────────
// 이미 등록된 "내 LABBER" 의 디자인을 바꿔 다시 승인받는 기능. 새 LABBER 최초 승인은 기존 「디자인 승인」 탭 그대로.
// DB: supabase/labber_design_update_1006.sql
//
//   유저      : LABBER 선택 → 현재 디자인 확인 → 새 디자인(이미지 + 3:4 썸네일 크롭) → POD/INK/CARTRIDGE/SUBJECT(전부 선택)
//               → 제작 정보(디자이너 필수/아티스트) → 하고 싶은 말 → 임시저장/신청. 반려되면 수정해서 다시 신청.
//   admin·staff: "업데이트 승인 관리" 에서 현재/업데이트 디자인 비교 → 승인(이미지를 public 으로 반영 + 아이템 소비) / 반려(사유)
//
// 재사용 (새 시스템 만들지 않음)
//   - 이미지: labber-designs 비공개 버킷 + signed URL, compressImage / Cropper(3:4, 600×800) / cropToBlob / autoCenterCropToBlob (utils.js)
//   - 승인 반영: 개체 등록과 같은 파이프라인(원본 → 워터마크(소유자 개인 → 없으면 기본) → 썸네일) → images 버킷
//   - 아이템 카드/카트리지 토글/신청 카드/상태 배지: labber-lab.js 의 .llapp-* / .labberlab-app-* 마크업·클래스
//   - 제작자 입력: js/creator-picker.js
//   - 공용 헬퍼(labber-lab.js 전역): signedUrlMap, llItemImg, llQtyText, fmtDateTime, shortId, llShow, llEl, _llUser, _llIsAdmin
// 원칙: 모든 쓰기는 RPC. 소유권/아이템/SUBJECT/권한 판정은 서버가 다시 한다(여기 표시는 안내용).

(function () {
  'use strict';

  // 이 값을 false 로 두면 탭 버튼과 패널을 숨긴다 (PUBLIC 공개 시점 제어용 — SQL 실행 전에는 false 로 둘 것)
  const DESIGN_UPDATE_ENABLED = true;

  const BUCKET = 'labber-designs';
  const NOTE_MAX = 500;
  const STATUS_KO = { draft: '작성중', submitted: '승인 대기', approved: '승인', rejected: '반려' };
  const STATUS_CLASS = { draft: 'is-draft', submitted: 'is-pending', approved: 'is-registered', rejected: 'is-rejected' };
  const EVENT_KO = { submitted: '신청', approved: '승인', rejected: '반려' };
  const SLOT_LABEL = { pod: 'POD', ink: 'INK', cartridge: 'CARTRIDGE' };
  const ADMIN_TABS = [
    { key: 'submitted', label: '승인 대기', statuses: ['submitted'] },
    { key: 'approved',  label: '승인',      statuses: ['approved'] },
    { key: 'rejected',  label: '반려',      statuses: ['rejected'] },
    { key: 'all',       label: '전체',      statuses: null },
  ];

  const S = {
    inited: false,
    busy: false,
    myRows: [],
    adminRows: [],
    adminTab: 'submitted',
    adminBusy: false,
    // 폼
    req: null,                // { id, status, character_id } — null = 아직 서버에 없는 새 신청
    targets: [],              // get_my_labber_design_update_targets
    target: null,             // 선택한 LABBER (targets 원소)
    inv: [],                  // get_my_labber_design_update_inventory
    subjects: [],             // 보관소 미배정 SUBJECT instance
    sel: { pod: null, ink: null, subject: null },
    cart: new Set(),          // 추가할 CARTRIDGE item_id
    remove: new Set(),        // 제외할 기존 CARTRIDGE trait code
    paths: { character: null, thumbnail: null },
    urls: {},
    pending: { character: null, thumbnail: null },
    designer: null,
    artist: null,
    cropper: null,
    cropSource: null,
    cropSrcUrl: null,
    cropIsNew: false,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? '' : s));

  // ── 공용 표시 헬퍼 ───────────────────────────────────────
  function traitName(code) {
    const t = (typeof labberTraitByCode === 'function') ? labberTraitByCode(code) : null;
    return t ? t.name : code;
  }
  function traitList(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v) return [v];
    return [];
  }
  function labberName(c) {
    if (!c) return 'LABBER';
    return c.owner_custom_name ? `${c.owner_custom_name} (${c.name})` : (c.name || 'LABBER');
  }
  function subjectLabel(s) {
    if (!s) return '';
    return s.individual_name ? `${s.individual_name} · ${s.subject_name || ''}` : (s.subject_name || 'SUBJECT');
  }
  function errText(res) {
    const d = res && res.detail;
    const slot = d ? (SLOT_LABEL[d] || d) : '';
    const map = {
      NOT_AUTHENTICATED: '로그인이 필요해요.',
      FORBIDDEN: '권한이 없어요.',
      NOT_FOUND: '신청서를 찾을 수 없어요.',
      NOT_EDITABLE: '이미 신청되어 수정할 수 없어요.',
      NOT_DELETABLE: '삭제할 수 없는 신청서예요.',
      HAS_HISTORY: '심사 기록이 있는 신청서는 삭제할 수 없어요.',
      INVALID_STATUS: '이미 처리되었거나 처리할 수 없는 상태예요. 화면을 새로고침해 확인해주세요.',
      NOT_LABBER_OWNER: '현재 내가 소유한 LABBER만 디자인 업데이트를 신청할 수 있어요.',
      OPEN_REQUEST_EXISTS: '이 LABBER는 이미 작성 중이거나 심사 중인 디자인 업데이트 신청이 있어요. 기존 신청을 이어서 작성해주세요.',
      MISSING_CHARACTER_IMAGE: '새 디자인 이미지를 업로드해주세요.',
      MISSING_THUMBNAIL: '썸네일을 지정해주세요.',
      INVALID_IMAGE_PATH: '이미지 정보가 올바르지 않아요. 이미지를 다시 업로드해주세요.',
      INVALID_ITEM: `${slot} 슬롯에 선택할 수 없는 아이템이에요.`,
      INSUFFICIENT_ITEM: `${slot} 아이템의 사용 가능한 수량이 부족해요. (보유하지 않았거나 다른 신청에 예약되어 있어요)`,
      DUPLICATE_ITEM: '같은 카트리지는 중복해서 선택할 수 없어요.',
      TRAIT_ALREADY_PRESENT: '이 LABBER가 이미 가진 CARTRIDGE예요. 다시 선택할 수 없어요.',
      TRAIT_CODE_MISSING: `${slot} 아이템의 특성 정보가 준비되지 않았어요. 운영진에게 문의해주세요.`,
      INVALID_REMOVE_CARTRIDGE: '제외할 CARTRIDGE 정보가 현재 LABBER와 맞지 않아요. 화면을 새로고침해주세요.',
      INVALID_SUBJECT_INSTANCE: '선택한 SUBJECT를 찾을 수 없어요. 다시 선택해주세요.',
      SUBJECT_INSTANCE_ALREADY_ASSIGNED: '선택한 SUBJECT가 이미 다른 LABBER에 장착되어 있어요. 다시 선택해주세요.',
      NOTE_TOO_LONG: `하고 싶은 말은 ${NOTE_MAX}자 이하로 입력해주세요.`,
      DESIGNER_REQUIRED: '개체 디자이너를 1명 이상 추가해주세요.',
      INVALID_CREATOR: '개체 디자이너/아티스트 정보가 올바르지 않아요. (연구소 유저는 실제 존재하는 유저여야 하고, 이름은 40자, 연락처는 100자 이하예요)',
      REASON_REQUIRED: '반려 사유를 입력해주세요.',
      REASON_TOO_LONG: '반려 사유는 500자 이하로 입력해주세요.',
      INVALID_IMAGE_URL: '반영할 이미지 업로드 경로가 올바르지 않아요. 다시 시도해주세요.',
      OWNER_CHANGED: '신청 이후 LABBER 소유자가 바뀌었어요. 이 신청은 반려해주세요.',
      CHARACTER_NOT_FOUND: '대상 LABBER를 찾을 수 없어요.',
      RESERVATION_MISSING: '아이템 예약 정보가 올바르지 않아요.',
      CONSUME_FAILED: `아이템 소비에 실패했어요. 신청자의 보유 수량을 확인해주세요. (${d || ''})`,
      INVALID_PAYLOAD: '요청 형식이 올바르지 않아요.',
    };
    return map[res && res.error] || `처리에 실패했어요. (${(res && res.error) || 'unknown'})`;
  }
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message);
    return data;
  }

  // ══════════════════════════════════════════════════════════
  // 초기화 / 탭
  // ══════════════════════════════════════════════════════════
  function hideFeature() {
    document.querySelectorAll('#tabRow [data-tab="update"]').forEach(b => { b.hidden = true; b.style.display = 'none'; });
    const panel = $('tab-update');
    if (panel && !panel.hidden && typeof switchTab === 'function') switchTab('about');   // ?tab=update 딥링크로 열린 상태였다면 첫 탭으로
    if (panel) panel.hidden = true;
  }

  async function init(opts = {}) {
    if (!DESIGN_UPDATE_ENABLED) { hideFeature(); return; }
    if (S.inited) return;
    S.inited = true;
    bindUi();
    if (!_llUser) return;   // 비로그인 — 탭을 열면 onTabShown 이 로그인 안내를 띄운다
    await loadMyList();
    if (_llIsAdmin) {
      setupAdmin();
      await loadAdminList();
    }
    if (opts.focusId) {
      if (_llIsAdmin) setMode('mine');
      focusCard(opts.focusId);
    }
  }

  function onTabShown() {
    if (!DESIGN_UPDATE_ENABLED) return;
    if (!_llUser) {
      llShow('updGuest', true);
      ['updUserView', 'updAdminView', 'updModeRow'].forEach(id => llShow(id, false));
    }
  }

  function bindUi() {
    $('updNewBtn').addEventListener('click', () => openForm(null));
    $('updCancelBtn').addEventListener('click', () => closeForm(true));
    $('updSaveBtn').addEventListener('click', onSaveDraft);
    $('updForm').addEventListener('submit', (e) => { e.preventDefault(); onSubmit(); });
    $('updCharFile').addEventListener('change', (e) => onCharacterPick(e.target));
    $('updThumbEditBtn').addEventListener('click', onThumbnailEdit);
    $('updNoteInput').addEventListener('input', updateNoteCount);
    $('updTargetPicker').addEventListener('change', onTargetChange);
    $('updItemPickers').addEventListener('change', onItemChange);
    $('updItemPickers').addEventListener('click', onCartToggle);
    $('updSubjectPicker').addEventListener('change', onSubjectChange);
    $('updCurrent').addEventListener('click', onOpenImage);
    $('updCropCancelBtn').addEventListener('click', onCropCancel);
    $('updCropAsIsBtn').addEventListener('click', onCropAsIs);
    $('updCropConfirmBtn').addEventListener('click', onCropConfirm);
    $('updMyList').addEventListener('click', onMyListClick);

    if (window.CreatorPicker) {
      S.designer = CreatorPicker.create($('updDesignerPicker'), {
        kind: 'designer', required: true, label: '개체 디자이너', hint: 'LABBER 개체 자체의 디자이너 · 여러 명 추가 가능 · 순서대로 표시됩니다',
      });
      S.artist = CreatorPicker.create($('updArtistPicker'), {
        kind: 'artist', required: false, label: '개체 아티스트', hint: 'LABBER 개체 일러스트를 그린 사람 크레딧 · 여러 명 추가 가능',
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  // 신청 카드 (내 신청 / 관리자 공용)
  // ══════════════════════════════════════════════════════════
  function rowPaths(rows) {
    const out = [];
    rows.forEach(r => out.push(r.character_image_path, r.thumbnail_path));
    return out;
  }

  // 현재 디자인 = 승인 전엔 개체의 지금 이미지, 승인 후엔 previous_design(덮어쓰기 전 스냅샷)
  function compareHtml(row, urls) {
    const prev = row.status === 'approved' && row.previous_design ? row.previous_design : null;
    const c = row.character || {};
    const curThumb = prev ? (prev.thumbnail_url || prev.image_url) : (c.thumbnail_url || c.image_url);
    const curFull  = prev ? (prev.image_url || prev.thumbnail_url) : (c.image_url || c.thumbnail_url);
    const newThumb = urls[row.thumbnail_path] || urls[row.character_image_path] || null;
    const newFull  = urls[row.character_image_path] || newThumb;
    const box = (label, thumb, full, empty) => `
      <figure class="lldu-compare-col">
        <figcaption>${label}</figcaption>
        <div class="lldu-compare-img">${thumb
          ? `<img src="${esc(thumb)}" alt="${label}" loading="lazy" data-open-url="${esc(full || thumb)}" title="클릭하면 원본이 새 탭에서 열려요">`
          : `<span>${empty}</span>`}</div>
      </figure>`;
    return `<div class="lldu-compare">
      ${box(prev ? '이전 디자인' : '현재 디자인', curThumb, curFull, '이미지 없음')}
      <span class="lldu-compare-arrow" aria-hidden="true">→</span>
      ${box('업데이트 디자인', newThumb, newFull, '이미지 없음')}
    </div>`;
  }

  function changesHtml(row) {
    const items = row.items || [];
    const lis = items.map(it => {
      const badge = (row.status === 'submitted' && it.state === 'reserved') || (row.status === 'approved' && it.state === 'consumed')
        ? `<b class="llapp-state is-${it.state}">${it.state === 'reserved' ? '예약' : '소비됨'}</b>` : '';
      return `<li class="llapp-card-item">
        <span class="llapp-card-item-img">${llItemImg(it)}</span>
        <span class="llapp-card-item-txt"><em>${SLOT_LABEL[it.slot] || it.slot}</em><span>${esc(it.name || '아이템')}</span>${badge}</span>
      </li>`;
    });
    (row.remove_cartridge_codes || []).forEach(code => {
      lis.push(`<li class="llapp-card-item lldu-card-remove">
        <span class="llapp-card-item-img"><span class="llapp-item-ph">REMOVE</span></span>
        <span class="llapp-card-item-txt"><em>CARTRIDGE 제외</em><span>${esc(traitName(code))}</span></span>
      </li>`);
    });
    if (row.subject_instance) {
      const s = row.subject_instance;
      lis.push(`<li class="llapp-card-item">
        <span class="llapp-card-item-img">${s.image_url ? `<img src="${esc(s.image_url)}" alt="" loading="lazy">` : '<span class="llapp-item-ph">NO IMG</span>'}</span>
        <span class="llapp-card-item-txt"><em>SUBJECT 장착</em><span>${esc(subjectLabel(s))}</span></span>
      </li>`);
    }
    return lis.length
      ? `<ul class="llapp-card-items">${lis.join('')}</ul>`
      : '<p class="llapp-hint">아이템·SUBJECT 변경 없이 디자인 이미지만 업데이트해요.</p>';
  }

  function currentTraitsHtml(c) {
    if (!c || !c.traits) return '';
    const t = c.traits;
    const pod = traitList(t.POD).map(traitName).join(', ') || '-';
    const ink = traitList(t.INK).map(traitName).join(', ') || '-';
    const cart = traitList(t.CARTRIDGE).map(traitName).join(', ') || '-';
    const subj = c.current_subject ? subjectLabel(c.current_subject) : '-';
    return `<dl class="labberlab-app-fields lldu-current-traits">
      <div><dt>현재 POD</dt><dd>${esc(pod)}</dd></div>
      <div><dt>현재 INK</dt><dd>${esc(ink)}</dd></div>
      <div><dt>현재 CARTRIDGE</dt><dd>${esc(cart)}</dd></div>
      <div><dt>현재 SUBJECT</dt><dd>${esc(subj)}</dd></div>
    </dl>`;
  }

  function cardHtml(row, urls, opts = {}) {
    const st = row.status || 'draft';
    const c = row.character || {};
    const thumb = urls[row.thumbnail_path] || urls[row.character_image_path] || c.thumbnail_url || c.image_url || null;
    const full  = urls[row.character_image_path] || thumb;
    const dateTs = row.submitted_at || row.created_at;
    const events = [...(row.events || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    const history = events.length
      ? `<details class="llapp-history"><summary>심사 기록 ${events.length}건</summary>
           <ul>${events.map(ev => `<li><span>${fmtDateTime(ev.at)}</span> <b>${EVENT_KO[ev.action] || esc(ev.action)}</b>${ev.reason ? ` — ${esc(ev.reason)}` : ''}</li>`).join('')}</ul>
         </details>`
      : '';
    const reason = (['rejected', 'draft'].includes(st) && row.rejection_reason)
      ? `<div class="labberlab-app-comment is-strong">
           <span class="labberlab-app-comment-label">${st === 'rejected' ? '반려 사유' : '이전 반려 사유'}</span>
           <p>${esc(row.rejection_reason).replace(/\n/g, '<br>')}</p>
         </div>`
      : '';
    const fields = (row.designer_nickname || row.artist_nickname || row.note)
      ? `<dl class="labberlab-app-fields">
           ${row.designer_nickname ? `<div><dt>개체 디자이너</dt><dd>${esc(row.designer_nickname)}</dd></div>` : ''}
           ${row.artist_nickname ? `<div><dt>개체 아티스트</dt><dd>${esc(row.artist_nickname)}</dd></div>` : ''}
           ${row.note ? `<div><dt>하고 싶은 말</dt><dd>${esc(row.note)}</dd></div>` : ''}
         </dl>`
      : '';

    return `
    <article class="labberlab-app-card llapp-card lldu-card" data-id="${row.id}">
      <div class="labberlab-app-thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="썸네일" loading="lazy" data-full="${esc(full)}">` : '<span>이미지 없음</span>'}
      </div>
      <div class="labberlab-app-main">
        <div class="labberlab-app-top">
          <span class="llapp-legacy">디자인 업데이트</span>
          <span class="labberlab-app-status ${STATUS_CLASS[st] || ''}">${STATUS_KO[st] || st}</span>
          <span class="labberlab-app-no">No. ${shortId(row.id)}</span>
          <span class="labberlab-app-date">${row.submitted_at ? '신청 ' : '작성 '}${fmtDateTime(dateTs)}</span>
          ${opts.applicant ? `<span class="labberlab-app-applicant">${esc(row.applicant_nickname)}</span>` : ''}
        </div>
        <p class="lldu-card-target">대상 LABBER · <a href="character.html?id=${encodeURIComponent(row.character_id)}">${esc(labberName(c))}</a>${c.char_number ? ` <span class="lldu-card-no">No. ${esc(c.char_number)}</span>` : ''}</p>
        ${compareHtml(row, urls)}
        ${opts.showCurrent ? currentTraitsHtml(c) : ''}
        ${changesHtml(row)}
        ${fields}
        ${reason}
        ${history}
        ${opts.footer || ''}
      </div>
    </article>`;
  }

  function onOpenImage(e) {
    const el = e.target.closest('[data-open-url]');
    if (el) window.open(el.dataset.openUrl, '_blank', 'noopener');
  }
  function commonClick(e) {
    const img = e.target.closest('.labberlab-app-thumb img');
    if (img && img.dataset.full) { window.open(img.dataset.full, '_blank', 'noopener'); return true; }
    const opener = e.target.closest('[data-open-url]');
    if (opener) { window.open(opener.dataset.openUrl, '_blank', 'noopener'); return true; }
    return false;
  }

  // ══════════════════════════════════════════════════════════
  // 내 신청 목록
  // ══════════════════════════════════════════════════════════
  async function loadMyList() {
    const listEl = $('updMyList');
    let data;
    try { data = await rpc('list_labber_design_update_requests', { p_scope: 'mine' }); }
    catch (e) { listEl.innerHTML = `<p class="auth-error">목록을 불러오지 못했어요. (${esc(e.message)})</p>`; return; }
    if (!data || !data.success) { listEl.innerHTML = `<p class="auth-error">${esc(errText(data))}</p>`; return; }
    S.myRows = data.requests || [];
    if (!S.myRows.length) { listEl.innerHTML = ''; $('updMyEmpty').style.display = 'flex'; return; }
    $('updMyEmpty').style.display = 'none';
    const urls = await signedUrlMap(rowPaths(S.myRows));
    listEl.innerHTML = S.myRows.map(r => cardHtml(r, urls, { footer: myFooter(r) })).join('');
  }

  function myFooter(row) {
    const st = row.status;
    if (st === 'draft') {
      const canDelete = !(row.events && row.events.length);
      return `<div class="labberlab-app-actions llapp-actions">
        ${canDelete ? `<button type="button" class="btn-ghost" data-act="delete" data-id="${row.id}">삭제</button>` : ''}
        <button type="button" class="btn-secondary" data-act="edit" data-id="${row.id}">이어서 작성</button>
      </div>`;
    }
    if (st === 'rejected') {
      const open = S.myRows.some(r => r.character_id === row.character_id && ['draft', 'submitted'].includes(r.status));
      return open ? '' : `<div class="labberlab-app-actions llapp-actions">
        <button type="button" class="btn-secondary" data-act="edit" data-id="${row.id}">수정하고 다시 신청</button>
      </div>`;
    }
    if (st === 'submitted') return '<p class="llapp-hint">심사 중이에요. 결과가 나올 때까지 수정할 수 없어요. 선택한 아이템은 심사 동안 예약돼요.</p>';
    if (st === 'approved') {
      return `<div class="labberlab-app-actions llapp-actions"><p class="llapp-hint">승인되어 LABBER에 새 디자인이 반영됐어요.</p>
        <a class="btn-secondary llapp-char-link" href="character.html?id=${encodeURIComponent(row.character_id)}">LABBER 보기</a></div>`;
    }
    return '';
  }

  async function onMyListClick(e) {
    if (commonClick(e)) return;
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = S.myRows.find(r => r.id === btn.dataset.id);
    if (!row) return;
    if (btn.dataset.act === 'edit') await openForm(row);
    else if (btn.dataset.act === 'delete') await deleteDraft(row.id);
  }

  async function deleteDraft(id) {
    if (!confirm('이 임시저장 신청을 삭제할까요? 업로드한 이미지도 함께 삭제되며 되돌릴 수 없어요.')) return;
    let data;
    try { data = await rpc('delete_labber_design_update_draft', { p_id: id }); }
    catch (e) { alert(`삭제에 실패했어요. (${e.message})`); return; }
    if (!data || !data.success) { alert(errText(data)); return; }
    if (data.paths && data.paths.length) {
      sb.storage.from(BUCKET).remove(data.paths).then(({ error }) => { if (error) console.warn('[design-update] 이미지 정리 실패:', error.message); });
    }
    await loadMyList();
  }

  function focusCard(id) {
    setTimeout(() => {
      const card = document.querySelector(`.lldu-card[data-id="${CSS.escape(id)}"]`);
      if (card) { card.classList.add('is-focused'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 300);
  }

  // ══════════════════════════════════════════════════════════
  // 신청 폼
  // ══════════════════════════════════════════════════════════
  function setError(m) { $('updFormError').textContent = m || ''; }
  function setInfo(m) { $('updFormInfo').textContent = m || ''; }

  function setPending(kind, blob, ext) {
    clearPending(kind);
    S.pending[kind] = { blob, url: URL.createObjectURL(blob), ext };
  }
  function clearPending(kind) {
    if (S.pending[kind]) URL.revokeObjectURL(S.pending[kind].url);
    S.pending[kind] = null;
  }

  function resetForm() {
    ['character', 'thumbnail'].forEach(clearPending);
    S.req = null; S.target = null;
    S.sel = { pod: null, ink: null, subject: null };
    S.cart = new Set(); S.remove = new Set();
    S.paths = { character: null, thumbnail: null };
    S.urls = {}; S.inv = []; S.subjects = []; S.targets = [];
    $('updNoteInput').value = '';
    if (S.designer) S.designer.clear();
    if (S.artist) S.artist.clear();
    setError(''); setInfo('');
  }

  function setBusy(busy, label) {
    S.busy = busy;
    ['updSaveBtn', 'updSubmitBtn', 'updCancelBtn'].forEach(id => { $(id).disabled = busy; });
    $('updSubmitBtn').textContent = busy && label ? label : '디자인 업데이트 신청';
  }

  function updateNoteCount() {
    const len = $('updNoteInput').value.length;
    const el = $('updNoteCount');
    el.textContent = `${len} / ${NOTE_MAX}`;
    el.classList.toggle('is-over', len > NOTE_MAX);
  }

  function creatorsToPicker(list) {
    return (list || []).map(c => c.type === 'site'
      ? { type: 'site', userId: c.userId, nickname: c.nickname || '(알 수 없음)' }
      : { type: 'external', name: c.name, contact: c.contact || '' });
  }

  async function openForm(row) {
    if (!_llUser) { onTabShown(); return; }
    if (S.busy) return;
    resetForm();

    llShow('updMySection', false);
    llShow('updForm', true);
    $('updFormTitle').textContent = !row ? '새 디자인 업데이트 신청' : (row.status === 'rejected' ? '디자인 업데이트 수정 (반려됨)' : '디자인 업데이트 이어서 작성');
    if (row && row.rejection_reason) { $('updRejectBannerText').textContent = row.rejection_reason; llShow('updRejectBanner', true); }
    else llShow('updRejectBanner', false);
    updateNoteCount();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('updTargetPicker').innerHTML = '<p class="llapp-picker-empty">불러오는 중...</p>';

    try {
      const [tg, inv, subj] = await Promise.all([
        rpc('get_my_labber_design_update_targets'),
        rpc('get_my_labber_design_update_inventory'),
        sb.from('my_subject_instances').select('instance_id, subject_code, subject_name, individual_name, image_url, is_assigned').eq('is_assigned', false),
      ]);
      if (!tg || !tg.success) throw new Error(errText(tg));
      S.targets = tg.targets || [];
      S.inv = inv || [];
      if (subj.error) console.warn('[design-update] SUBJECT 보관소 조회 실패:', subj.error.message);
      S.subjects = subj.data || [];
    } catch (e) {
      setError(`정보를 불러오지 못했어요. (${e.message})`);
    }

    if (row) {
      S.req = { id: row.id, status: row.status, character_id: row.character_id };
      S.target = S.targets.find(t => t.id === row.character_id) || null;
      S.paths = { character: row.character_image_path, thumbnail: row.thumbnail_path };
      (row.items || []).forEach(it => {
        if (it.slot === 'cartridge') S.cart.add(it.item_id);
        else S.sel[it.slot] = it.item_id;
      });
      (row.remove_cartridge_codes || []).forEach(c => S.remove.add(c));
      if (row.subject_instance_id) S.sel.subject = String(row.subject_instance_id);
      $('updNoteInput').value = row.note || '';
      updateNoteCount();
      if (S.designer) S.designer.setValue(creatorsToPicker(row.designers));
      if (S.artist) S.artist.setValue(creatorsToPicker(row.artists));
      S.urls = await signedUrlMap([S.paths.character, S.paths.thumbnail]);
      if (!S.target) setError('이 신청의 LABBER를 더 이상 소유하고 있지 않아요. 신청을 진행할 수 없어요.');
      dropUnavailable();
    }

    renderTargetPicker();
    renderTargetDependent();
    refreshPreviews();
  }

  async function closeForm(reload) {
    resetForm();
    llShow('updForm', false);
    llShow('updMySection', true);
    if (reload !== false) await loadMyList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 사용할 수 없게 된 선택(보유 0 · 다른 신청 예약 · 이미 가진 CARTRIDGE · 장착된 SUBJECT)은 해제하고 알린다
  function dropUnavailable() {
    const dropped = [];
    ['pod', 'ink'].forEach(slot => {
      if (!S.sel[slot]) return;
      const inv = S.inv.find(i => i.item_id === S.sel[slot] && i.slot === slot);
      if (!inv || inv.available < 1) { dropped.push(SLOT_LABEL[slot]); S.sel[slot] = null; }
    });
    const owned = new Set(S.target ? traitList(S.target.traits.CARTRIDGE) : []);
    let cartDropped = false;
    Array.from(S.cart).forEach(id => {
      const inv = S.inv.find(i => i.item_id === id && i.slot === 'cartridge');
      if (!inv || inv.available < 1 || owned.has(inv.trait_code)) { S.cart.delete(id); cartDropped = true; }
    });
    if (cartDropped) dropped.push('CARTRIDGE');
    Array.from(S.remove).forEach(code => { if (!owned.has(code)) S.remove.delete(code); });
    if (S.sel.subject && !S.subjects.some(s => String(s.instance_id) === S.sel.subject)) {
      S.sel.subject = null; dropped.push('SUBJECT');
    }
    if (dropped.length) setInfo(`사용할 수 없게 된 선택이 해제됐어요: ${dropped.join(', ')}`);
  }

  // ── ① LABBER 선택 ──
  function renderTargetPicker() {
    const host = $('updTargetPicker');
    if (!S.targets.length) {
      host.innerHTML = '<p class="llapp-picker-empty">소유한 LABBER가 없어요. 디자인 업데이트는 내가 소유한 LABBER만 신청할 수 있어요.</p>';
      return;
    }
    const locked = !!S.req;   // 서버에 만들어진 신청은 대상 LABBER 를 바꿀 수 없다
    host.innerHTML = `<div class="llapp-picker lldu-target-picker" role="radiogroup" aria-label="업데이트할 LABBER">${S.targets.map(t => {
      const checked = S.target && S.target.id === t.id;
      const busyOther = t.open_request && (!S.req || t.open_request.id !== S.req.id);
      const disabled = (locked && !checked) || busyOther;
      const img = t.thumbnail_url || t.image_url;
      return `<label class="llapp-item lldu-target${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}">
        <input type="radio" name="upd-target" value="${t.id}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="lldu-target-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="llapp-item-ph">NO IMG</span>'}</span>
        <span class="llapp-item-name">${esc(t.owner_custom_name || t.name)}</span>
        <span class="llapp-item-qty">${t.owner_custom_name ? esc(t.name) + ' · ' : ''}${t.char_number ? 'No. ' + esc(t.char_number) : '#' + t.id}</span>
        ${busyOther ? `<span class="lldu-target-badge">${t.open_request.status === 'submitted' ? '심사 중' : '작성 중'}</span>` : ''}
      </label>`;
    }).join('')}</div>`;
  }

  function onTargetChange(e) {
    const input = e.target.closest('input[name="upd-target"]');
    if (!input) return;
    const t = S.targets.find(x => String(x.id) === input.value);
    if (!t || S.req) return;
    S.target = t;
    // 새 신청: 대상에 맞춰 특성 관련 선택 초기화 + 제작 정보를 현재 개체 값으로 미리 채운다
    S.cart = new Set(); S.remove = new Set(); S.sel.subject = null;
    if (S.designer) S.designer.setValue(creatorsToPicker(t.designers));
    if (S.artist) S.artist.setValue(creatorsToPicker(t.artists));
    $('updTargetPicker').querySelectorAll('.lldu-target').forEach(l => l.classList.toggle('is-selected', l.querySelector('input').checked));
    renderTargetDependent();
  }

  // ── ② 현재 디자인 + ④ 아이템 + ⑤ SUBJECT (LABBER 선택에 따라 달라지는 영역) ──
  function renderTargetDependent() {
    const t = S.target;
    ['updCurrentGroup', 'updImageGroup', 'updItemGroup', 'updSubjectGroup', 'updCreatorSection', 'updNoteGroup'].forEach(id => llShow(id, !!t));
    if (!t) { $('updCurrent').innerHTML = ''; return; }

    const img = t.thumbnail_url || t.image_url;
    $('updCurrent').innerHTML = `
      <div class="lldu-current">
        <div class="lldu-compare-img lldu-current-img">${img
          ? `<img src="${esc(img)}" alt="현재 디자인" data-open-url="${esc(t.image_url || img)}" title="클릭하면 원본이 새 탭에서 열려요">`
          : '<span>이미지 없음</span>'}</div>
        ${currentTraitsHtml(t)}
      </div>`;
    renderItemPickers();
    renderSubjectPicker();
  }

  // ── ④ 아이템 (전부 선택) ──
  function qtyText(i) { return typeof llQtyText === 'function' ? llQtyText(i) : `보유 ${i.quantity}`; }

  function radioPicker(slot, emptyMsg) {
    const items = S.inv.filter(i => i.slot === slot);
    if (!items.length) return `<p class="llapp-picker-empty">${emptyMsg}</p>`;
    const noneChecked = !S.sel[slot];
    const none = `<label class="llapp-item llapp-item-none${noneChecked ? ' is-selected' : ''}">
        <input type="radio" name="upd-pick-${slot}" value=""${noneChecked ? ' checked' : ''}>
        <span class="llapp-item-name">변경 안 함</span>
      </label>`;
    const cards = items.map(i => {
      const disabled = i.available < 1 && S.sel[slot] !== i.item_id;
      const checked = S.sel[slot] === i.item_id;
      return `<label class="llapp-item${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}">
        <input type="radio" name="upd-pick-${slot}" value="${i.item_id}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        <span class="llapp-item-img">${llItemImg(i)}</span>
        <span class="llapp-item-name">${esc(i.name)}</span>
        <span class="llapp-item-qty">${qtyText(i)}</span>
      </label>`;
    }).join('');
    return `<div class="llapp-picker" data-slot="${slot}" role="radiogroup" aria-label="${SLOT_LABEL[slot]}">${none}${cards}</div>`;
  }

  function cartSummary() {
    const names = Array.from(S.cart).map(id => (S.inv.find(i => i.item_id === id) || {}).name || '카트리지');
    const removed = Array.from(S.remove).map(traitName);
    const parts = [];
    parts.push(names.length ? `추가 · ${names.join(' · ')}` : '추가 없음');
    if (removed.length) parts.push(`제외 · ${removed.join(' · ')}`);
    return parts.join('  /  ');
  }

  function renderItemPickers() {
    const owned = traitList(S.target.traits.CARTRIDGE);
    const ownedSet = new Set(owned);
    const carts = S.inv.filter(i => i.slot === 'cartridge' && !ownedSet.has(i.trait_code));
    const cartBody = carts.length
      ? `<div class="llapp-picker llapp-picker-cart" data-slot="cartridge">${carts.map(i => {
          const on = S.cart.has(i.item_id);
          const off = i.available < 1 && !on;
          return `<button type="button" class="llapp-item llapp-item-cart${on ? ' is-selected' : ''}${off ? ' is-disabled' : ''}" data-cart-toggle="${i.item_id}" aria-pressed="${on}"${off ? ' disabled' : ''}>
            <span class="llapp-item-img">${llItemImg(i)}</span>
            <span class="llapp-item-name">${esc(i.name)}</span>
            <span class="llapp-item-qty">${qtyText(i)}</span>
          </button>`;
        }).join('')}</div>`
      : '<p class="llapp-picker-empty">추가할 수 있는 카트리지가 없어요. (보유하지 않았거나 이 LABBER가 이미 가진 종류예요)</p>';
    const removeBody = owned.length
      ? `<div class="lldu-remove-list">${owned.map(code => `
          <label class="lldu-remove">
            <input type="checkbox" data-remove-code="${esc(code)}"${S.remove.has(code) ? ' checked' : ''}>
            <span>${esc(traitName(code))}</span>
          </label>`).join('')}</div>`
      : '<p class="llapp-hint">현재 CARTRIDGE가 없어요.</p>';

    $('updItemPickers').innerHTML = `
      <div class="form-group">
        <label class="form-label">POD <span class="llapp-optional">선택 · 고르면 현재 POD를 교체</span></label>
        ${radioPicker('pod', '보유 중인 POD 모듈이 없어요.')}
      </div>
      <div class="form-group">
        <label class="form-label">INK <span class="llapp-optional">선택 · 고르면 현재 INK를 교체</span></label>
        ${radioPicker('ink', '보유 중인 INK가 없어요.')}
      </div>
      <div class="form-group">
        <label class="form-label">CARTRIDGE <span class="llapp-optional">선택 · 현재 CARTRIDGE에 추가 · 여러 종류 가능 (종류당 1개)</span></label>
        ${cartBody}
        <p class="lldu-label-sub">이번 디자인에서 제외할 현재 CARTRIDGE <span class="llapp-optional">선택 · 아이템 불필요</span></p>
        ${removeBody}
        <p class="llapp-cart-summary" id="updCartSummary">${esc(cartSummary())}</p>
      </div>`;
  }

  function onItemChange(e) {
    const rm = e.target.closest('input[data-remove-code]');
    if (rm) {
      if (rm.checked) S.remove.add(rm.dataset.removeCode); else S.remove.delete(rm.dataset.removeCode);
      $('updCartSummary').textContent = cartSummary();
      return;
    }
    const input = e.target.closest('input[type="radio"]');
    if (!input) return;
    const picker = input.closest('.llapp-picker');
    const slot = picker && picker.dataset.slot;
    if (!slot) return;
    S.sel[slot] = input.value || null;
    picker.querySelectorAll('.llapp-item').forEach(l => l.classList.toggle('is-selected', l.querySelector('input').checked));
  }

  function onCartToggle(e) {
    const btn = e.target.closest('[data-cart-toggle]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.cartToggle;
    const inv = S.inv.find(i => i.item_id === id && i.slot === 'cartridge');
    if (!inv) return;
    if (S.cart.has(id)) S.cart.delete(id);
    else if (inv.available >= 1) S.cart.add(id);
    const on = S.cart.has(id);
    btn.classList.toggle('is-selected', on);
    btn.setAttribute('aria-pressed', String(on));
    $('updCartSummary').textContent = cartSummary();
  }

  // ── ⑤ SUBJECT (보관소 미배정 instance, 선택) ──
  function renderSubjectPicker() {
    const host = $('updSubjectPicker');
    const cur = S.target.current_subject;
    const curNote = cur
      ? `<p class="form-hint">현재 장착 SUBJECT: <strong>${esc(subjectLabel(cur))}</strong> — 다른 SUBJECT를 고르면 승인 시 현재 SUBJECT는 해제되어 보관소로 돌아가요. (EXP·레벨·이름·이미지는 그대로 보존)</p>`
      : '<p class="form-hint">현재 장착된 SUBJECT가 없어요. 고르면 승인 시 이 LABBER에 장착돼요.</p>';
    if (!S.subjects.length) {
      host.innerHTML = curNote + '<p class="llapp-picker-empty">보관소에 미배정 상태인 SUBJECT가 없어요. (가방에서 SUBJECT를 먼저 등록해주세요)</p>';
      return;
    }
    const noneChecked = !S.sel.subject;
    host.innerHTML = curNote + `<div class="llapp-picker" role="radiogroup" aria-label="SUBJECT">
      <label class="llapp-item llapp-item-none${noneChecked ? ' is-selected' : ''}">
        <input type="radio" name="upd-pick-subject" value=""${noneChecked ? ' checked' : ''}>
        <span class="llapp-item-name">변경 안 함</span>
      </label>
      ${S.subjects.map(i => {
        const checked = S.sel.subject === String(i.instance_id);
        return `<label class="llapp-item${checked ? ' is-selected' : ''}">
          <input type="radio" name="upd-pick-subject" value="${i.instance_id}"${checked ? ' checked' : ''}>
          <span class="llapp-item-img">${i.image_url ? `<img src="${esc(i.image_url)}" alt="" loading="lazy">` : '<span class="llapp-item-ph">NO IMG</span>'}</span>
          <span class="llapp-item-name">${esc(i.individual_name || i.subject_name || 'SUBJECT')}</span>
          <span class="llapp-item-qty">${esc(i.subject_name || '')}</span>
        </label>`;
      }).join('')}
    </div>`;
  }

  function onSubjectChange(e) {
    const input = e.target.closest('input[name="upd-pick-subject"]');
    if (!input) return;
    S.sel.subject = input.value || null;
    $('updSubjectPicker').querySelectorAll('.llapp-item').forEach(l => l.classList.toggle('is-selected', l.querySelector('input').checked));
  }

  // ── ③ 새 디자인 이미지 + 썸네일 크롭 (디자인 승인과 같은 처리) ──
  function setPreview(imgId, phId, url) {
    const img = $(imgId), ph = $(phId);
    if (url) { img.src = url; img.style.display = 'block'; ph.style.display = 'none'; }
    else { img.removeAttribute('src'); img.style.display = 'none'; ph.style.display = ''; }
  }
  function refreshPreviews() {
    const c = (S.pending.character && S.pending.character.url) || S.urls[S.paths.character] || null;
    const t = (S.pending.thumbnail && S.pending.thumbnail.url) || S.urls[S.paths.thumbnail] || null;
    setPreview('updCharPreview', 'updCharPlaceholder', c);
    setPreview('updThumbPreview', 'updThumbPlaceholder', t);
    $('updThumbEditBtn').style.display = c ? '' : 'none';
  }

  async function onCharacterPick(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    setError('');
    try {
      const blob = await compressImage(file);   // ≤1200px · ≤2MB · GIF 원본 유지 (개체 등록·디자인 승인과 동일)
      const isGif = blob.type === 'image/gif';
      setPending('character', blob, isGif ? 'gif' : 'jpg');
      clearPending('thumbnail');
      if (isGif) {
        setPending('thumbnail', await autoCenterCropToBlob(blob, 3 / 4, 600, 0.85), 'jpg');
        refreshPreviews();
      } else {
        refreshPreviews();
        openCrop(blob, true);
      }
    } catch (e) { setError(e.message || '이미지를 처리할 수 없어요.'); }
  }

  async function onThumbnailEdit() {
    setError('');
    try {
      let src = S.pending.character && S.pending.character.blob;
      if (!src) {
        const url = S.urls[S.paths.character] || (await signedUrlMap([S.paths.character]))[S.paths.character];
        if (!url) throw new Error('원본 이미지를 불러올 수 없어요.');
        const res = await fetch(url);
        if (!res.ok) throw new Error('원본 이미지를 불러올 수 없어요.');
        src = await res.blob();
      }
      if (src.type === 'image/gif') {
        setPending('thumbnail', await autoCenterCropToBlob(src, 3 / 4, 600, 0.85), 'jpg');
        refreshPreviews();
        return;
      }
      openCrop(src, false);
    } catch (e) { setError(e.message || '썸네일을 편집할 수 없어요.'); }
  }

  function openCrop(blob, isNew) {
    if (typeof Cropper === 'undefined') {
      autoCenterCropToBlob(blob, 3 / 4, 600, 0.85)
        .then(b => { setPending('thumbnail', b, 'jpg'); refreshPreviews(); })
        .catch(err => setError(err.message));
      return;
    }
    S.cropSource = blob;
    S.cropIsNew = !!isNew;
    const img = $('updCropImage');
    if (S.cropSrcUrl) URL.revokeObjectURL(S.cropSrcUrl);
    S.cropSrcUrl = URL.createObjectURL(blob);
    img.onerror = () => { setError('이미지 파일을 읽을 수 없어요.'); closeCrop(); };
    img.onload = () => {
      $('updCropModal').style.display = 'flex';
      if (S.cropper) { S.cropper.destroy(); S.cropper = null; }
      S.cropper = new Cropper(img, {           // 디자인 승인·개체 등록과 동일 옵션 — 3:4
        aspectRatio: 3 / 4, viewMode: 1, dragMode: 'move', autoCropArea: 0.85,
        guides: true, center: true, highlight: true,
        cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false,
      });
    };
    img.src = S.cropSrcUrl;
  }
  function closeCrop() {
    $('updCropModal').style.display = 'none';
    if (S.cropper) { S.cropper.destroy(); S.cropper = null; }
    if (S.cropSrcUrl) { URL.revokeObjectURL(S.cropSrcUrl); S.cropSrcUrl = null; }
    S.cropSource = null;
  }
  async function onCropConfirm() {
    try {
      setPending('thumbnail', await cropToBlob(S.cropper, 600, 0.85), 'jpg');
      closeCrop(); refreshPreviews();
    } catch (e) { setError(e.message); }
  }
  async function onCropAsIs() {
    if (!S.cropSource) return;
    try {
      setPending('thumbnail', await autoCenterCropToBlob(S.cropSource, 3 / 4, 600, 0.85), 'jpg');
      closeCrop(); refreshPreviews();
    } catch (e) { setError(e.message); }
  }
  function onCropCancel() {
    if (S.cropIsNew) { clearPending('character'); clearPending('thumbnail'); }
    closeCrop(); refreshPreviews();
  }

  // ── 저장 / 신청 ──
  async function persistDraft() {
    const note = $('updNoteInput').value;
    if (note.length > NOTE_MAX) throw new Error(`하고 싶은 말은 ${NOTE_MAX}자 이하로 입력해주세요.`);
    if (!S.target) throw new Error('업데이트할 LABBER를 선택해주세요.');

    let id = S.req && S.req.id;
    if (!id) {
      const data = await rpc('save_labber_design_update_draft', { p_id: null, p_payload: { character_id: S.target.id } });
      if (!data || !data.success) throw new Error(errText(data));
      id = data.request_id;
      S.req = { id, status: 'draft', character_id: S.target.id };
      renderTargetPicker();   // 이제 대상 고정
    }

    const paths = { ...S.paths };
    const uploaded = [];
    try {
      for (const kind of ['character', 'thumbnail']) {
        const p = S.pending[kind];
        if (!p) continue;
        const path = `${_llUser.id}/update/${id}/${kind}_${crypto.randomUUID()}.${p.ext}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, p.blob, { contentType: p.blob.type || 'image/jpeg', upsert: false });
        if (error) throw new Error(`이미지 업로드에 실패했어요. (${error.message})`);
        uploaded.push(path);
        paths[kind] = path;
      }

      const payload = {
        character_image_path: paths.character,
        thumbnail_path: paths.thumbnail,
        note,
        items: { pod: S.sel.pod || null, ink: S.sel.ink || null, cartridge: Array.from(S.cart) },
        remove_cartridges: Array.from(S.remove),
        subject_instance_id: S.sel.subject ? Number(S.sel.subject) : null,
        designers: S.designer ? S.designer.getValue() : [],
        artists: S.artist ? S.artist.getValue() : [],
      };
      const data = await rpc('save_labber_design_update_draft', { p_id: id, p_payload: payload });
      if (!data || !data.success) throw new Error(errText(data));

      if (data.removed_paths && data.removed_paths.length) {
        sb.storage.from(BUCKET).remove(data.removed_paths).then(({ error }) => { if (error) console.warn('[design-update] 이전 이미지 정리 실패:', error.message); });
      }
      S.paths = { character: paths.character, thumbnail: paths.thumbnail };
      S.req.status = 'draft';
      Object.assign(S.urls, await signedUrlMap([S.paths.character, S.paths.thumbnail]));
      ['character', 'thumbnail'].forEach(clearPending);
      refreshPreviews();
    } catch (e) {
      if (uploaded.length) {
        sb.storage.from(BUCKET).remove(uploaded).then(({ error }) => { if (error) console.warn('[design-update] 업로드 롤백 실패:', error.message); });
      }
      throw e;
    }
    return id;
  }

  async function onSaveDraft() {
    if (S.busy) return;
    setError(''); setInfo('');
    setBusy(true);
    try {
      await persistDraft();
      setInfo('임시저장했어요. 신청 전까지 언제든 수정할 수 있어요.');
    } catch (e) { setError(e.message || '저장 중 오류가 발생했어요.'); }
    finally { setBusy(false); }
  }

  function missingForSubmit() {
    if (!S.target) return '업데이트할 LABBER를 선택해주세요.';
    if (!(S.pending.character || S.paths.character)) return '새 디자인 이미지를 업로드해주세요.';
    if (!(S.pending.thumbnail || S.paths.thumbnail)) return '썸네일을 지정해주세요. (이미지를 다시 선택하거나 "썸네일 편집"을 눌러주세요)';
    if (S.designer && !S.designer.count()) return '개체 디자이너를 1명 이상 추가해주세요.';
    return '';
  }

  async function onSubmit() {
    if (S.busy) return;
    setError(''); setInfo('');
    const missing = missingForSubmit();
    if (missing) { setError(missing); return; }
    const usesItems = S.sel.pod || S.sel.ink || S.cart.size;
    if (!confirm(`디자인 업데이트를 신청할까요?\n신청하면 심사가 끝날 때까지 수정할 수 없어요.${usesItems ? '\n선택한 아이템은 심사 동안 예약되고, 승인되면 소비돼요. 반려되면 예약만 해제돼요.' : ''}`)) return;

    setBusy(true, '신청 중...');
    try {
      const id = await persistDraft();
      const data = await rpc('submit_labber_design_update', { p_id: id });
      if (!data || !data.success) throw new Error(errText(data));
      setBusy(false);
      alert('LABBER 디자인 업데이트를 신청했어요.');
      await closeForm(true);
    } catch (e) {
      setError(e.message || '신청 중 오류가 발생했어요.');
      setBusy(false);
    }
  }

  // ══════════════════════════════════════════════════════════
  // 관리자 — 업데이트 승인 관리
  // ══════════════════════════════════════════════════════════
  function setupAdmin() {
    llShow('updModeRow', true);
    $('updModeRow').addEventListener('click', (e) => {
      const b = e.target.closest('[data-umode]');
      if (b) setMode(b.dataset.umode);
    });
    const row = $('updAdminStatusRow');
    row.innerHTML = ADMIN_TABS.map(t => `<button type="button" class="shop-tab-btn${t.key === S.adminTab ? ' active' : ''}" data-utab="${t.key}">${t.label}</button>`).join('');
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-utab]');
      if (!b) return;
      S.adminTab = b.dataset.utab;
      row.querySelectorAll('.shop-tab-btn').forEach(x => x.classList.toggle('active', x.dataset.utab === S.adminTab));
      renderAdminList();
    });
    $('updAdminList').addEventListener('click', onAdminClick);
    setMode('admin');
  }

  function setMode(mode) {
    const m = (_llIsAdmin && mode === 'admin') ? 'admin' : 'mine';
    llShow('updUserView', m === 'mine');
    llShow('updAdminView', m === 'admin');
    $('updModeRow').querySelectorAll('[data-umode]').forEach(b => b.classList.toggle('active', b.dataset.umode === m));
  }

  async function loadAdminList() {
    const listEl = $('updAdminList');
    let data;
    try { data = await rpc('list_labber_design_update_requests', { p_scope: 'admin' }); }
    catch (e) { listEl.innerHTML = `<p class="auth-error">목록을 불러오지 못했어요. (${esc(e.message)})</p>`; return; }
    if (!data || !data.success) { listEl.innerHTML = `<p class="auth-error">${esc(errText(data))}</p>`; return; }
    S.adminRows = data.requests || [];
    $('updAdminStatusRow').querySelectorAll('[data-utab]').forEach(btn => {
      const t = ADMIN_TABS.find(x => x.key === btn.dataset.utab);
      const n = t.statuses ? S.adminRows.filter(r => t.statuses.includes(r.status)).length : S.adminRows.length;
      btn.textContent = `${t.label} ${n}`;
    });
    await renderAdminList();
  }

  async function renderAdminList() {
    const listEl = $('updAdminList');
    const t = ADMIN_TABS.find(x => x.key === S.adminTab) || ADMIN_TABS[0];
    const rows = t.statuses ? S.adminRows.filter(r => t.statuses.includes(r.status)) : S.adminRows;
    if (!rows.length) { listEl.innerHTML = ''; $('updAdminEmpty').style.display = 'flex'; return; }
    $('updAdminEmpty').style.display = 'none';
    const urls = await signedUrlMap(rowPaths(rows));
    listEl.innerHTML = rows.map(row => {
      const footer = row.status === 'submitted'
        ? `<div class="labberlab-admin-controls" data-uctl="${row.id}">
             <label class="form-label">반려 사유 <span class="llapp-optional">반려할 때만 필수 · 신청자에게 그대로 표시돼요</span></label>
             <textarea class="form-textarea llapp-reject-reason" rows="3" maxlength="500" placeholder="예: 새 디자인에 선택한 POD 형태가 보이지 않아요. / 썸네일 영역이 잘려 있어요."></textarea>
             <p class="auth-error labberlab-admin-err"></p>
             <div class="llapp-admin-btns">
               <button type="button" class="btn-ghost llapp-reject-btn" data-uact="reject">반려</button>
               <button type="button" class="btn-secondary" data-uact="approve">승인 (디자인 반영${(row.items || []).length ? ' · 아이템 소비' : ''})</button>
             </div>
           </div>`
        : (row.reviewed_at ? `<p class="llapp-hint">검토 ${fmtDateTime(row.reviewed_at)}</p>` : '');
      return cardHtml(row, urls, { applicant: true, showCurrent: row.status === 'submitted', footer });
    }).join('');
  }

  function onAdminClick(e) {
    if (commonClick(e)) return;
    const btn = e.target.closest('[data-uact]');
    if (!btn) return;
    const ctl = btn.closest('[data-uctl]');
    if (!ctl) return;
    if (btn.dataset.uact === 'approve') adminApprove(ctl.dataset.uctl, ctl);
    else adminReject(ctl.dataset.uctl, ctl);
  }

  function ctlBusy(ctl, busy) { ctl.querySelectorAll('button').forEach(b => { b.disabled = busy; }); }

  async function downloadPrivate(path) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`신청 이미지를 불러오지 못했어요. (${error ? error.message : 'no data'})`);
    return data;
  }

  // 신청 이미지 → 개체 등록과 같은 파이프라인으로 images 버킷 labber-character/update/{id}/ 에 업로드
  async function uploadApprovedImages(row) {
    const prefix = `labber-character/update/${row.id}/`;
    const ts = Date.now();
    const uploaded = [];
    const put = async (name, blob, type) => {
      const { error } = await sb.storage.from('images').upload(prefix + name, blob, { contentType: type });
      if (error) throw new Error(`이미지 업로드에 실패했어요. (${error.message})`);
      uploaded.push(prefix + name);
      return sb.storage.from('images').getPublicUrl(prefix + name).data.publicUrl;
    };
    try {
      let blob = await downloadPrivate(row.character_image_path);
      const isGif = /\.gif$/i.test(row.character_image_path);
      if (!isGif && blob.type !== 'image/jpeg') blob = await compressImage(new File([blob], 'design', { type: blob.type || 'image/png' }));
      const original_image_url = await put(`${ts}_orig.${isGif ? 'gif' : 'jpg'}`, blob, isGif ? 'image/gif' : 'image/jpeg');
      let image_url = original_image_url;
      let watermark_type = null;
      if (!isGif) {
        const wmBlob = await applyWatermark(blob, row.owner_watermark_url || '../images/watermark.png');
        image_url = await put(`${ts}.jpg`, wmBlob, 'image/jpeg');
        watermark_type = row.owner_watermark_url ? 'personal' : 'lab_black';
      }
      const thumbBlob = await downloadPrivate(row.thumbnail_path);
      const thumbnail_url = await put(`${ts}_thumb.jpg`, thumbBlob, 'image/jpeg');
      return { payload: { image_url, original_image_url, thumbnail_url, watermark_type }, uploaded };
    } catch (e) {
      if (uploaded.length) sb.storage.from('images').remove(uploaded).catch(() => {});
      throw e;
    }
  }

  async function adminApprove(id, ctl) {
    if (S.adminBusy) return;
    const row = S.adminRows.find(r => r.id === id);
    if (!row) return;
    const errEl = ctl.querySelector('.labberlab-admin-err');
    errEl.textContent = '';
    const c = row.character || {};
    if (!confirm(`${row.applicant_nickname || '신청자'}님의 「${labberName(c)}」 디자인 업데이트를 승인할까요?\n새 디자인이 LABBER에 반영되고${(row.items || []).length ? ', 예약된 아이템이 소비돼요' : '요'}.${row.subject_instance ? '\n선택한 SUBJECT가 장착돼요(현재 SUBJECT는 해제).' : ''}`)) return;

    S.adminBusy = true;
    ctlBusy(ctl, true);
    let uploaded = [];
    try {
      const up = await uploadApprovedImages(row);
      uploaded = up.uploaded;
      const data = await rpc('approve_labber_design_update', { p_id: id, p_payload: up.payload });
      if (!data || !data.success) {
        sb.storage.from('images').remove(uploaded).catch(() => {});
        errEl.textContent = errText(data);
        if (data && data.error === 'INVALID_STATUS') await loadAdminList();
        return;
      }
      if (typeof logAdminAction === 'function') {
        logAdminAction('labber_design_update_approve', 'labber_design_update', id, row.applicant_nickname, { character_id: row.character_id, consumed: data.consumed }).catch(() => {});
      }
      await loadAdminList();
      if (row.user_id === _llUser.id) await loadMyList();
    } catch (err) {
      console.error('[design-update] 승인 오류:', err);
      if (uploaded.length) sb.storage.from('images').remove(uploaded).catch(() => {});
      errEl.textContent = `승인에 실패했어요. (${err.message})`;
    } finally {
      S.adminBusy = false;
      ctlBusy(ctl, false);
    }
  }

  async function adminReject(id, ctl) {
    if (S.adminBusy) return;
    const row = S.adminRows.find(r => r.id === id);
    if (!row) return;
    const errEl = ctl.querySelector('.labberlab-admin-err');
    const reason = ctl.querySelector('.llapp-reject-reason').value.trim();
    errEl.textContent = '';
    if (!reason) { errEl.textContent = '반려 사유를 입력해주세요.'; return; }
    if (reason.length > 500) { errEl.textContent = '반려 사유는 500자 이하로 입력해주세요.'; return; }
    if (!confirm(`${row.applicant_nickname || '신청자'}님의 디자인 업데이트를 반려할까요?\n현재 디자인은 그대로 유지되고, 예약된 아이템은 해제돼요.`)) return;

    S.adminBusy = true;
    ctlBusy(ctl, true);
    try {
      const data = await rpc('reject_labber_design_update', { p_id: id, p_reason: reason });
      if (!data || !data.success) {
        errEl.textContent = errText(data);
        if (data && data.error === 'INVALID_STATUS') await loadAdminList();
        return;
      }
      if (typeof logAdminAction === 'function') {
        logAdminAction('labber_design_update_reject', 'labber_design_update', id, row.applicant_nickname, { reason }).catch(() => {});
      }
      await loadAdminList();
      if (row.user_id === _llUser.id) await loadMyList();
    } catch (err) {
      console.error('[design-update] 반려 오류:', err);
      errEl.textContent = `반려에 실패했어요. (${err.message})`;
    } finally {
      S.adminBusy = false;
      ctlBusy(ctl, false);
    }
  }

  window.LabberDesignUpdate = { init, onTabShown, enabled: DESIGN_UPDATE_ENABLED };
})();
