// ── LABBER "등록 데이터 불러오기" (pages/character-register.html 전용 모듈) ─────────────
// LABBER 디자인 승인에서 승인된 신청서를 기존 개체 등록 폼으로 "이식"하는 프리셋 기능이다. 자동 등록이 아니다.
//   · 운영진(admin/staff)이 LABBER 종족(species_id=204) 등록 화면 상단에서 승인+미등록 신청서를 골라 "불러오기"
//   · 불러오기만으로는 아무것도 저장/변경되지 않는다 (application 은 계속 approved). 실제 등록 버튼을 눌렀을 때만
//     register_labber_design_character RPC 가 characters 생성 + application registered 처리를 한 트랜잭션으로 한다.
//   · 서버가 결정하는 값(소유주=신청자 / 종족 / 특성 POD·CARTRIDGE·SUBJECT·INK / 아이템 소비 없음)은 이 화면에서 바꿀 수 없다.
//     운영진이 최종 확정하는 값: 이름 / 디자이너 / 아티스트 / 번호 / 설명 등. (등록 화면에서 디자이너를 바꿔도 신청서 원본은 그대로)
//   · 이미지는 기존 등록 파이프라인(압축 → 원본 → 워터마크 → 썸네일 → public images 업로드)을 그대로 쓴다.
//     승인 이미지를 selectedMainFile / pendingThumbnailBlob 에 넣고 업로드 입력을 잠근다. 업로드 경로만
//     labber-character/{application_id}/ 로 묶어 RPC 가 "이 신청서 폴더의 파일인지" 검증한다. (Edge Function 없음)
//
// 이 파일은 LABBER 모드가 켜졌을 때만 동작한다. LABBER 종족이 아니거나 운영진이 아니면 init 이 아무것도 하지 않는다.
// 페이지 전역(selectedMainFile, pendingThumbnailBlob, designers, artists, ownerType, selectedNick, selectedNickId, userWatermarkUrl,
// extraFiles, renderDesignerItems, renderArtistItems, setOwnerType, selectDefaultImage, loadUsers, loadCustomFields)은
// 호출 시점(초기화 이후)에 참조한다.
// 의존: main.js(escapeHtml), utils.js(LABBER_SPECIES_ID, isAdminOrStaff), labber-traits.js(특성 이름/등급)

(function () {
  'use strict';

  const BUCKET = 'labber-designs';
  const TRAIT_ORDER = [['POD', 'POD'], ['CARTRIDGE', 'CARTRIDGE'], ['SUBJECT', 'SUBJECT'], ['INK', 'INK']];

  const state = {
    ready: false,        // 패널이 만들어졌는가 (운영진 + LABBER 종족)
    active: false,       // 승인 데이터가 폼에 불러와진 상태인가
    busy: false,
    appId: null,
    data: null,          // get_labber_design_for_registration 결과
    subjectBlob: null,
    subjectExt: 'jpg',
    suggestedName: null,
    list: [],
    saved: null,         // 해제 시 복원할 원래 상태
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));

  function setError(msg) { const el = $('lrError'); if (el) el.textContent = msg || ''; }
  function fmtMd(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }

  const ERR_KO = {
    NOT_AUTHENTICATED: '로그인이 필요해요.',
    FORBIDDEN: '운영진(admin/staff)만 사용할 수 있어요.',
    NOT_FOUND: '신청서를 찾을 수 없어요.',
    ALREADY_REGISTERED: '이미 개체로 등록된 신청서예요. 목록을 새로고침해주세요.',
    INVALID_STATUS: '승인 상태의 신청서가 아니에요. 목록을 새로고침해주세요.',
    LEGACY_APPLICATION: '이전 방식으로 접수된 신청서라 이 방법으로 등록할 수 없어요.',
    MISSING_IMAGE: '신청서에 이미지 정보가 없어요.',
    ITEMS_NOT_CONSUMED: '승인 시 소비된 아이템 기록이 올바르지 않아요. (신청서를 확인해주세요)',
    SUBJECT_IMAGE_REQUIRED: 'SUBJECT 승인 이미지가 필요해요.',
    SUBJECT_IMAGE_NOT_ALLOWED: 'SUBJECT가 없는 신청서에는 SUBJECT 이미지를 등록할 수 없어요.',
    TRAIT_CODE_MISSING: '아이템의 특성 코드가 준비되지 않았어요. 운영 SQL(trait_code 매핑)을 확인해주세요.',
    NAME_REQUIRED: '이름을 입력해주세요.',
    NAME_TOO_LONG: '이름은 100자 이하로 입력해주세요.',
    DESIGNER_REQUIRED: '디자이너를 1명 이상 추가해주세요.',
    INVALID_CREATOR: '디자이너/아티스트 정보가 올바르지 않아요.',
    INVALID_IMAGE_URL: '업로드된 이미지 경로가 승인 신청서와 맞지 않아요. 신청서를 다시 불러와주세요.',
    DESCRIPTION_TOO_LONG: '설명이 너무 길어요.',
    CHAR_NUMBER_TOO_LONG: '개체번호는 50자 이하로 입력해주세요.',
    INVALID_PAYLOAD: '요청 형식이 올바르지 않아요.',
  };
  function errText(res) {
    const base = ERR_KO[res && res.error] || `등록 데이터 처리에 실패했어요. (${(res && res.error) || 'unknown'})`;
    return res && res.detail ? `${base} [${res.detail}]` : base;
  }

  // ── 패널 ─────────────────────────────────────────────
  function buildPanelShell() {
    const host = $('labberImportPanel');
    host.hidden = false;
    host.innerHTML = `
      <section class="lr-panel" aria-label="등록 데이터 불러오기">
        <div class="lr-head">
          <h2 class="lr-title">등록 데이터 불러오기</h2>
          <span class="lr-badge">운영진 전용</span>
        </div>
        <p class="lr-desc">LABBER 디자인 승인에서 <b>승인된 신청서</b>를 아래 등록 폼으로 가져와요.
          불러오기만으로는 등록되지 않고, 내용을 눈으로 확인한 뒤 맨 아래 <b>등록하기</b>를 눌러야 개체가 만들어져요.</p>
        <div class="lr-list" id="lrList" role="radiogroup" aria-label="승인된 신청서"><p class="lr-empty">불러오는 중...</p></div>
        <p class="lr-error" id="lrError"></p>
        <div class="lr-actions">
          <button type="button" class="btn-ghost" id="lrRefresh">목록 새로고침</button>
          <button type="button" class="btn-secondary" id="lrLoad" disabled>불러오기</button>
        </div>
        <div class="lr-loaded" id="lrLoaded" hidden></div>
      </section>`;

    $('lrRefresh').addEventListener('click', () => refreshList());
    $('lrLoad').addEventListener('click', () => loadSelected());
    $('lrList').addEventListener('change', () => { $('lrLoad').disabled = state.busy || !selectedId(); });
    $('lrLoaded').addEventListener('click', (e) => { if (e.target.closest('#lrUnload')) unload(); });
  }

  function selectedId() {
    const r = document.querySelector('input[name="lrApp"]:checked');
    return r ? r.value : null;
  }

  async function signedThumbs(rows) {
    const map = {};
    const paths = [...new Set(rows.map(r => r.thumbnail_path).filter(Boolean))];
    if (!paths.length) return map;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (error) { console.warn('[labber-register] 썸네일 서명 URL 실패:', error.message); return map; }
    (data || []).forEach(d => { if (d.path && d.signedUrl) map[d.path] = d.signedUrl; });
    return map;
  }

  async function refreshList(preselect) {
    setError('');
    const listEl = $('lrList');
    listEl.innerHTML = '<p class="lr-empty">불러오는 중...</p>';
    $('lrLoad').disabled = true;
    const { data, error } = await sb.rpc('list_labber_registrable_applications');
    if (error || !data || !data.success) {
      listEl.innerHTML = '';
      setError(error ? `목록을 불러오지 못했어요. (${error.message})` : errText(data));
      return;
    }
    state.list = data.items || [];
    if (!state.list.length) {
      listEl.innerHTML = '<p class="lr-empty">등록 대기 중인 승인 신청서가 없어요.</p>';
      return;
    }
    const thumbs = await signedThumbs(state.list);
    listEl.innerHTML = state.list.map(it => {
      const bits = [
        it.subject_name ? `SUBJECT ${esc(it.subject_name)}` : 'SUBJECT 없음',
        it.subject_species_name ? `연결 종족 ${esc(it.subject_species_name)}` : '',
        it.subject_designer_nickname ? `SUBJECT 디자이너 ${esc(it.subject_designer_nickname)}` : '',
        it.pod_name ? esc(it.pod_name) : '',
        it.ink_name ? esc(it.ink_name) : '',
        (it.cartridge_names && it.cartridge_names.length) ? `카트리지 ${it.cartridge_names.length}종` : '',
      ].filter(Boolean).join(' · ');
      const thumb = thumbs[it.thumbnail_path];
      return `<label class="lr-item${it.application_id === state.appId ? ' is-loaded' : ''}">
        <input type="radio" name="lrApp" value="${esc(it.application_id)}"${it.application_id === preselect ? ' checked' : ''}>
        <span class="lr-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : '<i>NO IMG</i>'}</span>
        <span class="lr-info">
          <b>${esc(it.applicant_nickname)}</b>
          <span>${fmtMd(it.approved_at)} 승인 · ${bits}</span>
          ${it.designer_nickname ? `<span class="lr-sub">디자이너 ${esc(it.designer_nickname)}</span>` : '<span class="lr-sub">디자이너 미입력</span>'}
          <em>#${esc(String(it.application_id).slice(0, 8).toUpperCase())}${it.application_id === state.appId ? ' · 불러온 신청서' : ''}</em>
        </span>
      </label>`;
    }).join('');
    $('lrLoad').disabled = !selectedId();
  }

  // ── 불러오기 ─────────────────────────────────────────
  function formHasInput() {
    return !!(($('charName').value || '').trim() || ($('charDesc').value || '').trim() ||
              ($('charNumber') && $('charNumber').value.trim()) ||
              selectedMainFile || designers.length || artists.length);
  }

  async function downloadBlob(path) {
    const { data, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`승인 이미지를 불러오지 못했어요. (${(error && error.message) || 'no data'})`);
    return data;
  }

  function extOf(path, blob) {
    const m = /\.([a-z0-9]+)$/i.exec(path || '');
    const e = m ? m[1].toLowerCase() : '';
    if (e === 'jpeg') return 'jpg';
    if (['jpg', 'png', 'webp', 'gif'].includes(e)) return e;
    const t = (blob && blob.type) || '';
    return t.includes('png') ? 'png' : t.includes('webp') ? 'webp' : t.includes('gif') ? 'gif' : 'jpg';
  }
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

  async function loadSelected() {
    const id = selectedId();
    if (!id || state.busy) return;
    setError('');

    if (state.active) {
      if (!confirm('이미 불러온 승인 데이터가 있어요.\n다른 신청서로 바꾸면 지금 폼에 입력한 내용이 초기화돼요. 계속할까요?')) return;
    } else if (formHasInput()) {
      if (!confirm('등록 폼에 이미 입력한 내용이 있어요.\n불러오면 이름/이미지/제작자/특성이 승인 데이터로 덮어써져요. 계속할까요?')) return;
    }

    state.busy = true;
    $('lrLoad').disabled = true;
    $('lrLoad').textContent = '불러오는 중...';
    try {
      const { data, error } = await sb.rpc('get_labber_design_for_registration', { p_app_id: id });
      if (error) throw new Error(`불러오기에 실패했어요. (${error.message})`);
      if (!data || !data.success) throw new Error(errText(data));

      // 승인 이미지 (원본 / 썸네일 / SUBJECT) — 실패하면 폼을 건드리지 않는다
      const charBlob = await downloadBlob(data.images.character_path);
      const thumbBlob = await downloadBlob(data.images.thumbnail_path);
      // SUBJECT — instance 방식(subject_instance_id, 2026-09-24~)이면 이미지가 이미 그 instance에
      // 연결돼 있어 다시 올릴 필요가 없다. images.subject_path 가 있는 건 이 기능 이전(레거시) 신청서뿐.
      let subjBlob = null;
      if (data.subject_code && !data.subject_instance_id) {
        if (!data.images.subject_path) throw new Error(errText({ error: 'SUBJECT_IMAGE_REQUIRED' }));
        subjBlob = await downloadBlob(data.images.subject_path);
      }

      applyToForm(data, charBlob, thumbBlob, subjBlob);
      await refreshList(id);
    } catch (e) {
      console.error('[labber-register] 불러오기 오류:', e);
      setError(e.message || '불러오기 중 오류가 발생했어요.');
    } finally {
      state.busy = false;
      $('lrLoad').textContent = '불러오기';
      $('lrLoad').disabled = !selectedId();
    }
  }

  function hideEl(el, hide) {
    if (!el) return;
    if (hide) { if (el.dataset.lrPrev === undefined) el.dataset.lrPrev = el.style.display || ''; el.style.display = 'none'; }
    else if (el.dataset.lrPrev !== undefined) { el.style.display = el.dataset.lrPrev; delete el.dataset.lrPrev; }
  }

  function traitChipsHtml(traits) {
    return TRAIT_ORDER.map(([key, label]) => {
      const codes = (traits && traits[key]) || [];
      if (!codes.length) return '';
      const chips = codes.map(code => {
        const t = typeof labberTraitByCode === 'function' ? labberTraitByCode(code) : null;
        return `<span class="lr-trait">${esc(t ? t.name : code)}${t && typeof labberTraitGradeBadgeHtml === 'function' ? labberTraitGradeBadgeHtml(t.grade) : ''}</span>`;
      }).join('');
      return `<div class="form-group lr-trait-row"><label class="form-label" style="font-size:13px; font-weight:500;">${label}</label><div class="lr-trait-list">${chips}</div></div>`;
    }).join('');
  }

  function applyToForm(data, charBlob, thumbBlob, subjBlob) {
    // 1) 이전 상태 백업 (최초 1회) — 해제 시 복원
    if (!state.saved) {
      state.saved = {
        wm: userWatermarkUrl,
        customHtml: $('customFieldInputs') ? $('customFieldInputs').innerHTML : '',
        customDisplay: $('customFieldsSection') ? $('customFieldsSection').style.display : '',
      };
    }

    state.active = true;
    state.appId = data.application_id;
    state.data = data;
    state.suggestedName = data.suggested_name;

    const form = $('registerForm');
    form.classList.add('lr-mode');

    // 2) 대표 이미지 / 썸네일 — 기존 파이프라인 입력 변수에 그대로 넣는다 (승인 이미지 외 입력은 잠금)
    const cExt = extOf(data.images.character_path, charBlob);
    selectedMainFile = new File([charBlob], `labber_approved.${cExt}`, { type: MIME[cExt] || charBlob.type || 'image/jpeg' });
    // 썸네일도 경로 확장자(서버 검증: jpg|png|webp)로 type 을 고정 — 등록 시 확장자/contentType 을 blob.type 으로 정한다
    const tExt = extOf(data.images.thumbnail_path, thumbBlob);
    pendingThumbnailBlob = new Blob([thumbBlob], { type: MIME[tExt] || 'image/jpeg' });
    const prev = $('imagePreview');
    if (prev) {
      if (prev.dataset.lrObj) URL.revokeObjectURL(prev.dataset.lrObj);
      const u = URL.createObjectURL(thumbBlob);
      prev.dataset.lrObj = u;
      prev.src = u;
      prev.style.display = 'block';
    }
    if ($('uploadPlaceholder')) $('uploadPlaceholder').style.display = 'none';
    $('imageFile').value = '';
    $('imageFile').disabled = true;
    $('uploadBox').classList.add('lr-locked');
    if (!$('lrImageNote')) {
      $('uploadBox').insertAdjacentHTML('afterend', '<p class="lr-lock-note" id="lrImageNote">🔒 승인된 이미지예요 (변경할 수 없어요). 상세 이미지에는 워터마크가 적용되고, 썸네일은 신청자가 지정한 3:4 영역을 그대로 사용해요.</p>');
    }
    selectDefaultImage(null);
    extraFiles.length = 0;
    if ($('extraImageList')) $('extraImageList').innerHTML = '';

    // 3) SUBJECT 승인 이미지 (등록 시 labber_subject_images 로 연결)
    state.subjectBlob = subjBlob;
    state.subjectExt = subjBlob ? extOf(data.images.subject_path, subjBlob) : 'jpg';

    // 4) 이름(INDIVIDUAL-NNN) / 개체번호(LB-NNN) 를 각각 기본 제안값으로 채운다 — 둘 다 운영진이 등록 전에 자유롭게 수정할 수 있다.
    //    설명은 비워 둔다 (note 는 description 으로 복사하지 않는다).
    //    개체번호는 기존 폼의 "개체번호" 입력칸(#charNumber → characters.char_number) 그대로 재사용한다.
    $('charName').value = data.suggested_name || '';
    $('charDesc').value = '';
    if ($('charNumber')) $('charNumber').value = data.suggested_char_number || '';

    // 5) 소유주 = 신청자 (고정)
    ownerType = 'site';
    if (typeof setOwnerType === 'function') setOwnerType('site');
    selectedNick = data.applicant.nickname;
    selectedNickId = data.applicant.user_id;
    const disp = $('ownerSelectedDisplay');
    if (disp) { disp.textContent = `소유주: ${selectedNick} (신청자 · 변경할 수 없어요)`; disp.style.display = 'block'; }
    hideEl($('ownerSearch'), true);
    hideEl($('ownerUserList'), true);
    hideEl($('btnSiteUser') && $('btnSiteUser').closest('.io-tabs'), true);
    hideEl($('ownerExternalSection'), true);

    // 6) 디자이너 / 아티스트 — 승인 데이터를 초기값으로. 운영진이 수정할 수 있고, 수정해도 신청서 원본은 바뀌지 않는다.
    designers.length = 0;
    (data.designers || []).forEach(d => designers.push(d.type === 'site'
      ? { type: 'site', userId: d.userId, nickname: d.nickname }
      : { type: 'external', name: d.name, contact: d.contact || '' }));
    artists.length = 0;
    (data.artists || []).forEach(a => artists.push(a.type === 'site'
      ? { type: 'site', userId: a.userId, nickname: a.nickname }
      : { type: 'external', name: a.name }));
    renderDesignerItems();
    renderArtistItems();

    // 7) 특성 (POD / CARTRIDGE / SUBJECT / INK) — 서버가 조립한 값을 읽기 전용으로만 보여준다
    const sec = $('customFieldsSection');
    const box = $('customFieldInputs');
    if (sec && box) {
      box.innerHTML = traitChipsHtml(data.traits) + '<p class="lr-lock-note">🔒 승인된 특성이에요 (변경할 수 없어요). 등록 시 서버가 신청서의 소비된 아이템으로 다시 만들어요.</p>';
      sec.style.display = '';
    }

    // 8) 워터마크 — 신청자 본인 워터마크가 있으면 사용, 없으면 연구소 기본. 운영진 개인 워터마크는 쓰지 않는다.
    userWatermarkUrl = data.applicant.watermark_url || null;

    renderLoadedBanner();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderLoadedBanner() {
    const d = state.data;
    const box = $('lrLoaded');
    if (!d) { box.hidden = true; box.innerHTML = ''; return; }
    const subj = d.subject_name ? ` · SUBJECT ${esc(d.subject_name)}` : '';

    // SUBJECT 제작자 / 연결 종족 — 레거시(신청서 컬럼 직접 입력) 신청서만 값이 있다.
    // instance 방식(subject_instance_id)은 등록 시 서버가 기존 instance를 그대로 배정할 뿐, 여기서
    // 새로 만들 크레딧이 없으므로 이 블록 자체를 보여주지 않는다(TODO: instance 크레딧 편집은
    // 현재 character-edit.html에서 LABBER 배정 후에만 가능 — 범위 밖).
    const sc = d.subject_credits;
    const names = (arr) => (arr || []).map(x => esc(x.type === 'site' ? x.nickname : x.name)).join(', ');
    let subjCreditHtml = '';
    if (d.subject_instance_id) {
      const inst = d.subject_instance || {};
      const instName = inst.individual_name || inst.subject_name || 'SUBJECT';
      subjCreditHtml = `<p class="lr-loaded-line">🔒 SUBJECT 보관소에서 선택됨 — ${esc(instName)} <span class="lr-loaded-hint" style="display:inline;">(이미 이미지가 연결된 개체예요 · 등록 시 이 LABBER에 자동 배정)</span></p>`;
    } else if (sc) {
      const lines = [];
      if (sc.designers && sc.designers.length) lines.push(`SUBJECT 디자이너: ${names(sc.designers)}`);
      if (sc.artists && sc.artists.length) lines.push(`SUBJECT 아티스트: ${names(sc.artists)}`);
      if (sc.species && sc.species.name) lines.push(`연결 종족: ${esc(sc.species.name)}`);
      subjCreditHtml = lines.length
        ? `<p class="lr-loaded-line">🔒 ${lines.join(' · ')} <span class="lr-loaded-hint" style="display:inline;">(승인 데이터 · 등록 시 자동 연결 · 이 화면에서 수정할 수 없어요)</span></p>`
        : `<p class="lr-loaded-line">🔒 SUBJECT 제작자 정보 없음 <span class="lr-loaded-hint" style="display:inline;">(이 기능 이전에 승인된 신청서예요 · 등록 후 개체 수정 화면에서 추가할 수 있어요)</span></p>`;
    }
    box.hidden = false;
    box.innerHTML = `
      <p class="lr-loaded-title">불러온 승인 데이터</p>
      <p class="lr-loaded-line"><b>${esc(d.applicant.nickname)}</b>${subj} · ${fmtMd(d.approved_at)} 승인
        <span class="lr-loaded-id">#${esc(String(d.application_id).slice(0, 8).toUpperCase())}</span></p>
      ${subjCreditHtml}
      <p class="lr-loaded-hint">소유주 · 승인 이미지 · 특성은 고정이에요. 이름 · 개체 디자이너 · 개체 아티스트 등은 자유롭게 고칠 수 있고, 아직 아무것도 저장되지 않았어요.</p>
      <button type="button" class="btn-ghost" id="lrUnload">불러오기 해제</button>`;
  }

  // ── 해제 (등록 폼을 일반 상태로 되돌림 — 서버 상태는 그대로) ─────────────
  async function unload(skipConfirm) {
    if (!state.active) return;
    if (!skipConfirm && !confirm('불러온 승인 데이터를 해제할까요?\n폼이 초기화돼요. (신청서는 승인 상태 그대로 남아요)')) return;

    const form = $('registerForm');
    form.classList.remove('lr-mode');
    state.active = false;
    state.appId = null;
    state.data = null;
    state.subjectBlob = null;

    selectedMainFile = null;
    pendingThumbnailBlob = null;
    const prev = $('imagePreview');
    if (prev) {
      if (prev.dataset.lrObj) { URL.revokeObjectURL(prev.dataset.lrObj); delete prev.dataset.lrObj; }
      prev.removeAttribute('src');
      prev.style.display = 'none';
    }
    if ($('uploadPlaceholder')) $('uploadPlaceholder').style.display = '';
    $('imageFile').disabled = false;
    $('uploadBox').classList.remove('lr-locked');
    if ($('lrImageNote')) $('lrImageNote').remove();

    $('charName').value = '';
    $('charDesc').value = '';
    if ($('charNumber')) $('charNumber').value = '';
    designers.length = 0;
    artists.length = 0;
    renderDesignerItems();
    renderArtistItems();

    hideEl($('ownerSearch'), false);
    hideEl($('ownerUserList'), false);
    hideEl($('btnSiteUser') && $('btnSiteUser').closest('.io-tabs'), false);
    hideEl($('ownerExternalSection'), false);
    if (typeof loadUsers === 'function') await loadUsers();   // 소유주를 다시 "나"로

    if (state.saved) {
      userWatermarkUrl = state.saved.wm;
      if ($('customFieldInputs')) $('customFieldInputs').innerHTML = state.saved.customHtml;
      if ($('customFieldsSection')) $('customFieldsSection').style.display = state.saved.customDisplay;
      state.saved = null;
    }

    renderLoadedBanner();
    await refreshList();
  }

  // ── 페이지 훅 ────────────────────────────────────────
  function isActive() { return state.active; }
  function uploadPrefix() { return state.active ? `labber-character/${state.appId}/` : ''; }

  // 등록 실패(이름 충돌 포함) 시 이번 시도에서 올라간 public 파일 정리 — 신청서 폴더 전체 (아직 미등록이므로 안전)
  async function cleanupUploads() {
    if (!state.appId) return;
    try {
      const folder = `labber-character/${state.appId}`;
      const { data } = await sb.storage.from('images').list(folder, { limit: 100 });
      const names = (data || []).filter(f => f.name).map(f => `${folder}/${f.name}`);
      if (names.length) await sb.storage.from('images').remove(names);
    } catch (e) { console.warn('[labber-register] 업로드 정리 실패(고아 파일 가능):', e); }
  }

  // insertPayload = 페이지가 characters INSERT 용으로 만든 객체. 이 중 "운영진이 확정하는 값"만 RPC 로 보낸다.
  // (소유주 / 종족 / 특성 / design_application_id 는 서버가 신청서에서 직접 결정 — 여기 값은 무시된다)
  async function registerCharacter(insertPayload) {
    const d = state.data;
    const fail = (message) => ({ data: null, error: { message } });
    if (!state.active || !d) return fail('불러온 승인 데이터가 없어요.');

    try {
      // SUBJECT — instance 방식(subject_instance_id)이면 이미지가 이미 그 instance에 연결돼 있어
      // 여기서 다시 올리지 않는다. register_labber_design_character 는 신청서의 subject_instance_id를
      // 서버에서 직접 읽어 배정하므로 payload에 SUBJECT 관련 값을 보낼 필요가 없다.
      // subject_code 만 있고 subject_instance_id 가 없는 경우는 이 기능 이전(레거시) 신청서뿐이며,
      // 이번 전환 시점(2026-09-24)에 진행 중인 신청서가 0건이라 실제로는 나타나지 않는다 — 방어적으로만 막는다.
      if (d.subject_code && !d.subject_instance_id) {
        return fail('이 신청서는 예전 방식의 SUBJECT 데이터를 사용하고 있어요. 운영진에게 문의해주세요.');
      }

      const p = insertPayload || {};
      const payload = {
        name: p.name,
        suggested_name: state.suggestedName,
        image_url: p.image_url,
        original_image_url: p.original_image_url,
        thumbnail_url: p.thumbnail_url,
        watermark_type: p.watermark_type || null,
        designers: designers.map(x => (x.type === 'site' ? { type: 'site', userId: x.userId } : { type: 'external', name: x.name, contact: x.contact || '' })),
        artists: artists.map(x => (x.type === 'site' ? { type: 'site', userId: x.userId } : { type: 'external', name: x.name })),
        char_number: p.char_number || null,
        description: p.description || null,
        is_sensitive: !!p.is_sensitive,
        sensitive_note: p.sensitive_note || null,
        allow_free_adoption: p.allow_free_adoption,
        allow_resale: p.allow_resale,
        allow_paid_adoption: p.allow_paid_adoption,
        allow_other_adoption: p.allow_other_adoption,
        char_categories: p.char_categories || null,
        char_sections: p.char_sections || null,
      };

      const { data, error } = await sb.rpc('register_labber_design_character', { p_app_id: state.appId, p_payload: payload });
      if (error) { await cleanupUploads(); return fail(error.message); }
      if (!data || !data.success) {
        await cleanupUploads();
        if (data && data.error === 'NAME_CONFLICT' && data.suggested_name) {
          // 다른 운영진이 그 사이 같은 번호로 등록함 — 이름 입력칸을 최신 제안값으로 바꾸고 다시 등록하도록 안내
          state.suggestedName = data.suggested_name;
          $('charName').value = data.suggested_name;
          return fail(`다른 운영진이 먼저 같은 이름으로 등록했어요. 이름을 다음 번호(${data.suggested_name})로 바꿨어요. 확인 후 다시 등록해주세요.`);
        }
        if (data && data.error === 'ALREADY_REGISTERED') await refreshList();
        return fail(errText(data));
      }
      return { data: { id: data.character_id }, error: null };
    } catch (e) {
      await cleanupUploads();
      return fail(e.message);
    }
  }

  // 페이지의 업로드/등록 도중 예외가 나면(이미지 업로드 실패 등) 이번 시도에서 올린 파일 정리
  function onRegisterFailed() { if (state.active) cleanupUploads(); }

  async function init(ctx) {
    const user = ctx && ctx.user;
    if (typeof LABBER_SPECIES_ID === 'undefined' || !ctx || String(ctx.speciesId) !== String(LABBER_SPECIES_ID)) return;
    const meta = user && user.user_metadata && user.user_metadata.role;
    const app = user && user.app_metadata && user.app_metadata.role;
    if (!(isAdminOrStaff(meta) && isAdminOrStaff(app))) return;   // 운영진만 (서버 RPC 도 admin/staff 재검증)
    if (!$('labberImportPanel')) return;

    buildPanelShell();
    state.ready = true;
    const pre = new URLSearchParams(location.search).get('from_app');
    await refreshList(pre || undefined);
    if (pre && selectedId()) {
      $('lrList').querySelector('input[name="lrApp"]:checked')?.closest('.lr-item')?.scrollIntoView({ block: 'nearest' });
    }
  }

  window.LabberRegister = { init, isActive, uploadPrefix, registerCharacter, onRegisterFailed };
})();
