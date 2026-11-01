// ── 개인연구실 [SUBJECT] 탭 (pages/labber-personal-lab.html) ─────────────
// 작성일: 2026-09-24 (SUBJECT 개체화 5단계 — 배정 관리 UI)
// 2026-09-24 위치 정정: 처음엔 개체기록실(labber-records.html)에 얹었으나, 개체기록실은
// 기존 기능(소속 개체 전체 로스터) 그대로 유지하기로 하고, SUBJECT 개체 보관/관리는
// 신규 페이지 "개인연구실"(labber-personal-lab.html)로 옮겼다. 로직/마크업은 그대로,
// 파일명과 전역 객체 이름만 LabberRecordsSubject → PersonalLabSubject로 바뀌었다.
//
// public.my_subject_instances(supabase/labber_subject_storage_0922.sql +
// labber_subject_instances_view_patch_0924.sql)를 읽어 "내가 실제로 등록한 SUBJECT
// 개체" 목록을 개체(instance) 단위 카드로 보여준다. 같은 subject_code라도 개체 수만큼
// 여러 카드가 나온다 — 종류(type) 발견 도감은 pages/dogam.html [SUBJECT] 탭에 남아있고,
// 이 파일은 그것과 완전히 별개다(user×subject_code 집계 아님, 절대 섞지 않는다).
//
// 카드 뼈대(.labber-subject-*) CSS는 pages/character.html의 SUBJECT 육성 카드를 그대로
// 복사했다(labber-personal-lab.html 쪽 <style>에만 추가, character.html 자체는 무수정).
//
// 배정 관리:
//   - [분리] → detach_labber_subject_instance(character_id) RPC. 자동 재배정 없음.
//   - [LABBER에 배정] → 본인 소유 LABBER 중 "현재 활성 SUBJECT가 없는" 개체만 골라
//     attach_labber_subject_instance(character_id, instance_id) RPC. 이미 SUBJECT가
//     있는 LABBER는 목록에 아예 안 뜬다(자동 교체/자동 detach 없음 — 서버 RPC도 동일하게
//     CHARACTER_ALREADY_ASSIGNED로 막는다, 이건 그 이중 방어의 클라이언트 쪽일 뿐).
//   - transfer(다른 유저에게 이전)는 이번 단계 UI에 붙이지 않는다. RPC만 준비된 상태.
//
// "함께한 기간"은 my_subject_instances.current_assigned_at(현재 활성 assignment의
// assigned_at) 기준으로 클라이언트에서 날짜 차이만 계산한다(배정한 날 = 1일째, 새 계산식
// 아님 — 서버가 이미 확정한 assigned_at 값을 그대로 씀). "과거 함께한 LABBER" 이력은
// 상세 모달을 열 때 labber_subject_assignments를 instance_id로 직접 조회한다(RLS로
// 본인 것만 허용).
//
// 탐험 EXP 트리거/로직은 이 단계에서 건드리지 않는다 — 표시만 my_subject_instances의
// level/exp_in_level/exp_to_next/is_max(기존 labber_subject_level_info 그대로)를 쓴다.

window.PersonalLabSubject = (function () {

  let _rows = [];          // my_subject_instances 전체
  let _pendingAssignInstanceId = null;
  let _charDisplayNameMap = {}; // character_id -> 표시명(owner_custom_name 우선, 없으면 등록명)
  let _historyRows = [];        // 현재 상세 모달의 "함께한 LABBER" 이력 전체(정렬됨)
  let _historyExpanded = false; // false면 최신 3건만, true면 전체
  let _openDetailInstanceId = null; // 현재 상세 모달에 열려있는 instance_id(이름 저장 대상 식별용)

  // LABBER 표시명 우선순위(2026-09-24 확정): owner_custom_name(소유주가 정한 이름)이
  // 있으면 그걸, 없으면 character.name(종족주가 정한 등록명)을 쓴다. DB의 실제 값은
  // 바꾸지 않고 화면 표시에서만 적용한다.
  function labberDisplayName(c) {
    if (!c) return '';
    const custom = typeof c.owner_custom_name === 'string' ? c.owner_custom_name.trim() : '';
    return custom || c.name || '';
  }

  async function init() {
    const grid = document.getElementById('personalLabSubjectGrid');
    grid.innerHTML = `<p class="personal-lab-empty">불러오는 중...</p>`;

    const { data, error } = await sb
      .from('my_subject_instances')
      .select('*');

    if (error) {
      console.error('[personal-lab-subject] init 오류:', error);
      grid.innerHTML = `<p class="personal-lab-empty">불러오지 못했어요. 새로고침 해주세요.</p>`;
      return;
    }

    _rows = data || [];

    const charIds = [...new Set(_rows.filter(r => r.current_character_id).map(r => r.current_character_id))];
    _charDisplayNameMap = {};
    if (charIds.length) {
      const { data: chars, error: charErr } = await sb
        .from('characters')
        .select('id, name, owner_custom_name')
        .in('id', charIds);
      if (charErr) {
        console.error('[personal-lab-subject] 배정 LABBER 표시명 조회 오류:', charErr);
      } else {
        (chars || []).forEach(c => { _charDisplayNameMap[c.id] = labberDisplayName(c); });
      }
    }

    render();
  }

  function render() {
    document.getElementById('subjInstCount').textContent = String(_rows.length);
    const grid = document.getElementById('personalLabSubjectGrid');
    grid.innerHTML = _rows.length
      ? _rows.map(renderCard).join('')
      : `<p class="personal-lab-empty">아직 등록된 SUBJECT 개체가 없어요.</p>`;
  }

  function displayName(r) {
    return r.individual_name || r.subject_name || '';
  }

  function imgFallback(img) {
    const wrap = img && img.closest('.labber-subject-img');
    if (!wrap) return;
    wrap.classList.add('is-empty');
    wrap.innerHTML = '<span class="labber-subject-img-empty">아트웍 없음</span>';
  }

  function imgHtml(r) {
    if (r.image_url) {
      return `<div class="labber-subject-img">
        <img src="${escapeHtml(r.image_url)}" alt="${escapeHtml(displayName(r))} 아트웍" loading="lazy"
             onerror="PersonalLabSubject.imgFallback(this)"></div>`;
    }
    return `<div class="labber-subject-img is-empty"><span class="labber-subject-img-empty">아트웍 없음</span></div>`;
  }

  function lvHtml(r) {
    const level = Number(r.level) || 1;
    const isMax = r.is_max === true;
    return `<p class="labber-subject-lv">LV.${level}${isMax ? ' · MAX' : ''}</p>`;
  }

  function expHtml(r) {
    const inLv  = Number(r.exp_in_level) || 0;
    const toNx  = Number(r.exp_to_next)  || 0;
    const isMax = r.is_max === true;
    const pct   = isMax ? 100 : (toNx > 0 ? Math.max(0, Math.min(100, Math.round(inLv / toNx * 100))) : 0);
    return `
      ${isMax ? '' : `<p class="labber-subject-exp-text">EXP ${inLv} / ${toNx}</p>`}
      <div class="labber-subject-exp-bar${isMax ? ' is-max' : ''}" role="progressbar" aria-label="${escapeHtml(displayName(r))} 경험치"
           aria-valuemin="0" aria-valuemax="${isMax ? 1 : toNx}" aria-valuenow="${isMax ? 1 : inLv}">
        <div class="labber-subject-exp-fill" style="width:${pct}%"></div>
      </div>`;
  }

  // 배정한 날 = 1일째. 오늘 배정했으면 경과 0일 + 1 = 1일째.
  function daysTogether(assignedAt) {
    if (!assignedAt) return null;
    const start = new Date(assignedAt);
    if (Number.isNaN(start.getTime())) return null;
    const elapsedMs = Date.now() - start.getTime();
    const elapsedDays = Math.floor(elapsedMs / 86400000);
    return Math.max(1, elapsedDays + 1);
  }

  function assignLineHtml(r) {
    if (r.is_assigned) {
      const days = daysTogether(r.current_assigned_at);
      const name = _charDisplayNameMap[r.current_character_id] || r.current_character_name || '';
      return `
        <div class="labber-subject-assign-line">
          <p class="labber-subject-assign-status is-assigned">${escapeHtml(name)}에 배정 중</p>
          ${days ? `<p class="labber-subject-assign-period">함께한 기간 ${days}일째</p>` : ''}
        </div>`;
    }
    return `
      <div class="labber-subject-assign-line">
        <p class="labber-subject-assign-status is-unassigned">보관 중 (미배정)</p>
      </div>`;
  }

  function renderCard(r) {
    return `
      <div class="labber-subject-card" onclick="PersonalLabSubject.openDetail(${r.instance_id})">
        ${imgHtml(r)}
        <div class="labber-subject-body">
          <div class="labber-subject-head">
            <p class="labber-subject-name">${escapeHtml(displayName(r))}</p>
            ${lvHtml(r)}
          </div>
          <p class="labber-subject-type">${escapeHtml(r.subject_name || '')}</p>
          ${expHtml(r)}
          ${assignLineHtml(r)}
        </div>
      </div>`;
  }

  // ── 상세 모달 ────────────────────────────────────────────────────────
  async function openDetail(instanceId) {
    const r = _rows.find(x => x.instance_id === instanceId);
    if (!r) return;

    _openDetailInstanceId = instanceId;

    document.getElementById('labberSubjectDetailCard').innerHTML = `
      ${imgHtml(r)}
      <div class="labber-subject-body">
        <div class="labber-subject-head">
          <p class="labber-subject-name">${escapeHtml(displayName(r))}</p>
          ${lvHtml(r)}
        </div>
        <p class="labber-subject-type">${escapeHtml(r.subject_name || '')}</p>
        ${expHtml(r)}
        ${assignLineHtml(r)}
      </div>`;

    renderNameEditBox(r);
    renderEditBox(r);
    renderUpdateBox(r);

    document.getElementById('labberSubjectDetailActions').innerHTML = r.is_assigned
      ? `<button type="button" onclick="PersonalLabSubject.detach(${r.instance_id})">분리</button>`
      : `<button type="button" class="is-primary" onclick="PersonalLabSubject.openAssignModal(${r.instance_id})">LABBER에 배정</button>`;

    _historyExpanded = false;
    _historyRows = [];
    document.getElementById('labberSubjectHoldersList').innerHTML = `<p class="subj-holders-empty">불러오는 중...</p>`;
    document.getElementById('labberSubjectDetailModal').style.display = 'flex';

    const { data, error } = await sb
      .from('labber_subject_assignments')
      .select('character_id, assigned_at, detached_at, characters(name, char_number, owner_custom_name)')
      .eq('subject_instance_id', instanceId)
      .order('assigned_at', { ascending: false });

    if (error) {
      console.error('[personal-lab-subject] 이력 조회 오류:', error);
      document.getElementById('labberSubjectHoldersList').innerHTML = `<p class="subj-holders-empty">이력을 불러오지 못했습니다.</p>`;
      return;
    }

    // 현재 배정 중(detached_at NULL)인 행이 가장 위, 이후 최신순 — 서버 정렬(assigned_at desc)만으로도
    // 보통 자동으로 맞지만(가장 최근 배정이 곧 현재인 경우가 대부분) 명시적으로 한 번 더 보정한다.
    _historyRows = (data || []).slice().sort((a, b) => {
      if (!a.detached_at && b.detached_at) return -1;
      if (a.detached_at && !b.detached_at) return 1;
      return new Date(b.assigned_at) - new Date(a.assigned_at);
    });

    renderHistoryList();
  }

  // 기본 3건만 표시, 4건 이상이면 [더보기]/[접기] 토글 — 이력 데이터 자체는 항상 전부 유지된다.
  function renderHistoryList() {
    const el = document.getElementById('labberSubjectHoldersList');
    if (!_historyRows.length) {
      el.innerHTML = `<p class="subj-holders-empty">아직 어떤 LABBER에도 등록된 적이 없습니다.</p>`;
      return;
    }

    const visible = _historyExpanded ? _historyRows : _historyRows.slice(0, 3);
    const rowsHtml = visible.map(renderHistoryRow).join('');
    const toggleHtml = _historyRows.length > 3
      ? `<button type="button" class="subj-holders-toggle" onclick="PersonalLabSubject.toggleHistory()">${_historyExpanded ? '접기' : `더보기 (${_historyRows.length - 3}건 더)`}</button>`
      : '';

    el.innerHTML = rowsHtml + toggleHtml;
  }

  function toggleHistory() {
    _historyExpanded = !_historyExpanded;
    renderHistoryList();
  }

  function renderHistoryRow(h) {
    const c = h.characters || {};
    const numberHtml = c.char_number ? ` <span class="subj-holder-number">#${escapeHtml(String(c.char_number))}</span>` : '';
    const periodHtml = h.detached_at
      ? `<p class="subj-holder-indiv">${formatDate(h.assigned_at)} ~ ${formatDate(h.detached_at)}</p>`
      : `<p class="subj-holder-indiv">${formatDate(h.assigned_at)} ~ 현재</p>`;
    return `
      <div class="subj-holder-row">
        <div class="subj-holder-info">
          <p class="subj-holder-name">${escapeHtml(labberDisplayName(c))}${numberHtml}</p>
          ${periodHtml}
        </div>
        <a class="subj-holder-link" href="character.html?id=${encodeURIComponent(h.character_id)}">개체 보러가기</a>
      </div>`;
  }

  function formatDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  function closeDetail() {
    document.getElementById('labberSubjectDetailModal').style.display = 'none';
  }

  // ── 개체명(개별 이름) 수정 — 2026-09-24 ─────────────────────────────────
  // set_labber_subject_instance_name(instance_id, name) RPC 사용(subject_bag_register 단계 이후
  // 정책 확정: "SUBJECT는 가방 등록 순간부터 LABBER와 독립된 개체" → LABBER 미배정 상태에서도
  // 이름을 바꿀 수 있어야 한다). 권한은 instance 소유주(owner_user_id) 기준으로 서버가 검사한다.
  // 2026-09-24 후속: character-edit.html(LABBER 개체 수정)의 SUBJECT 이름 UI는 완전히
  // 제거됐다 — 이름 수정은 이제 이 화면(개인연구실 > SUBJECT)에서만 한다. 레거시
  // set_labber_subject_name(character_id, ...) RPC는 더 이상 어떤 화면에서도 호출하지
  // 않지만, DB 함수 자체는 DROP하지 않고 남겨뒀다(뽀 지시).
  function renderNameEditBox(r) {
    const box = document.getElementById('labberSubjectNameEditBox');
    if (!box) return;
    box.innerHTML = `
      <div class="subj-name-edit-row">
        <input type="text" id="labberSubjectNameEditInput" maxlength="16"
               placeholder="개체명 (선택, 최대 16자)"
               value="${escapeHtml(r.individual_name || '')}">
        <button type="button" onclick="PersonalLabSubject.saveIndividualName()">이름 변경</button>
      </div>`;
  }

  async function saveIndividualName() {
    const r = _rows.find(x => x.instance_id === _openDetailInstanceId);
    if (!r) return;

    const input = document.getElementById('labberSubjectNameEditInput');
    if (!input) return;

    const { data, error } = await sb.rpc('set_labber_subject_instance_name', {
      p_instance_id: r.instance_id,
      p_name: input.value,
    });

    if (error || !data || data.success !== true) {
      console.error('[personal-lab-subject] 이름 저장 오류:', error, data);
      alert('개체명 저장에 실패했어요. 잠시 후 다시 시도해주세요.');
      return;
    }

    // 서버 정규화 결과(또는 빈 이름이면 null)로 로컬 상태를 갱신하고 목록/모달을 즉시 다시 그린다.
    r.individual_name = data.individual_name || null;
    render();
    openDetail(r.instance_id);
  }

  // ── 크레딧 편집 (이미지는 읽기 전용) — 2026-09-30 / 2026-10-01 ────────────────
  // 정책(뽀 확정 2026-10-01): SUBJECT 이미지는 가방 등록 신청 때 첨부하고 운영진이 승인한 이미지가 그대로
  // instance 이미지가 된다. 승인 후 사용자는 이미지를 바꾸거나 지울 수 없다 — 이 화면에는 이미지 편집 UI 가 없고,
  // 서버도 set/delete_labber_subject_instance_image 를 admin/staff 전용으로 막는다(supabase/labber_subject_image_approval_1001.sql).
  // 이름·크레딧 편집 권한 = 현재 instance 소유자 OR admin/staff — 서버 RPC(_labber_subject_instance_edit_check)가 검사한다
  // (supabase/labber_subject_instance_edit_0930.sql). 이 화면은 본인 소유 instance(my_subject_instances)만 보여준다.
  //   크레딧: get_labber_subject_instance_credits_for_edit / set_labber_subject_instance_credits
  //           (js/creator-picker.js 재사용, 디자이너·아티스트 모두 선택). 종족형의 연결 종족은 표시만(편집 없음).
  let _editBusy = false;
  let _creditDesigner = null;   // CreatorPicker
  let _creditArtist   = null;   // CreatorPicker
  let _creditsLoadedFor = null; // 크레딧 편집기에 값을 채운 instance_id

  const EDIT_ERR = {
    NOT_AUTHENTICATED:  '로그인이 필요해요.',
    NOT_INSTANCE_OWNER: '이 SUBJECT를 편집할 권한이 없어요. (소유자가 바뀌었을 수 있어요)',
    INSTANCE_NOT_FOUND: 'SUBJECT 개체를 찾을 수 없어요.',
    INVALID_IMAGE_URL:  '이미지 정보가 올바르지 않아요. 다시 업로드해주세요.',
    INVALID_IMAGE_PATH: '이미지 정보가 올바르지 않아요. 다시 업로드해주세요.',
    IMAGE_NOT_UPLOADED: '이미지 업로드가 완료되지 않았어요. 잠시 후 다시 시도해주세요.',
    INVALID_CREATOR:    '디자이너/아티스트 정보가 올바르지 않아요. (연구소 유저는 실제 존재하는 유저여야 하고, 이름은 40자, 연락처는 100자 이하예요)',
  };
  const editErrMsg = (code, action) => EDIT_ERR[code] || `${action} 중 오류가 발생했어요.${code ? `\n[${code}]` : ''}`;

  function renderEditBox(r) {
    const box = document.getElementById('labberSubjectEditBox');
    if (!box) return;
    // 아트웍은 편집 영역에 두지 않는다(2026-10-01) — 운영진이 승인한 신청 이미지가 위 상세 아트웍에 읽기 전용으로 표시된다.
    box.innerHTML = `
      <div class="subj-edit-section">
        <div class="subj-edit-head">
          <p class="subj-edit-title">크레딧</p>
          <button type="button" class="subj-edit-toggle" id="labberSubjectCreditToggle" onclick="PersonalLabSubject.toggleCredits()" hidden>편집</button>
        </div>
        <p class="subj-credit-summary" id="labberSubjectCreditSummary">불러오는 중...</p>
        <div id="labberSubjectCreditEditor" hidden>
          <div id="labberSubjectCreditDesigner"></div>
          <div class="cp-divider"></div>
          <div id="labberSubjectCreditArtist"></div>
          <p class="auth-error" id="labberSubjectCreditError"></p>
          <div class="subj-edit-row">
            <button type="button" id="labberSubjectCreditSaveBtn" onclick="PersonalLabSubject.saveCredits()">크레딧 저장</button>
          </div>
        </div>
      </div>`;
    _creditDesigner = null;
    _creditArtist = null;
    _creditsLoadedFor = null;
    loadCredits(r.instance_id);
    // 2026-10-07 핫픽스: 승인된 크레딧(제작자)은 소유자가 바꿀 수 없다 — 편집 버튼은 운영진(app_metadata.role)에게만.
    // 서버(set_labber_subject_instance_credits)도 admin/staff 전용으로 막는다(supabase/labber_subject_bag_creator_required_1007.sql).
    getUser().then(user => {
      const role = user && user.app_metadata && user.app_metadata.role;
      const btn = document.getElementById('labberSubjectCreditToggle');
      if (btn && _openDetailInstanceId === r.instance_id) btn.hidden = !isAdminOrStaff(role);
    }).catch(() => {});
  }

  function creditNames(list) {
    return (list || []).map(d => d.type === 'site' ? (d.nickname || '(알 수 없음)') : d.name).filter(Boolean).join(', ');
  }

  async function loadCredits(instanceId) {
    const sumEl = document.getElementById('labberSubjectCreditSummary');
    const { data, error } = await sb.rpc('get_labber_subject_instance_credits_for_edit', { p_instance_id: instanceId });
    if (_openDetailInstanceId !== instanceId || !sumEl) return;   // 로딩 중 다른 개체로 바뀐 경우
    if (error || !data || data.success !== true) {
      console.error('[personal-lab-subject] 크레딧 조회 오류:', error, data);
      sumEl.textContent = '크레딧을 불러오지 못했어요.';
      return;
    }
    const d = creditNames(data.designers), a = creditNames(data.artists);
    sumEl.innerHTML = [
      `<span>디자이너</span> ${d ? escapeHtml(d) : '<em>없음</em>'}`,
      `<span>아티스트</span> ${a ? escapeHtml(a) : '<em>없음</em>'}`,
      data.subject_code === 'labber_subject_species'
        ? `<span>연결 종족</span> ${data.species_name ? escapeHtml(data.species_name) : '<em>없음</em>'}` : '',
    ].filter(Boolean).join('<br>');

    if (window.CreatorPicker && !_creditDesigner) {
      _creditDesigner = CreatorPicker.create(document.getElementById('labberSubjectCreditDesigner'), {
        kind: 'designer', required: false, label: 'SUBJECT 디자이너', hint: '사이트 유저 검색 또는 사이트 밖 제작자 · 선택',
      });
      _creditArtist = CreatorPicker.create(document.getElementById('labberSubjectCreditArtist'), {
        kind: 'artist', required: false, label: 'SUBJECT 아티스트', hint: '이 SUBJECT 아트웍을 그린 사람 · 선택',
      });
    }
    if (_creditDesigner) _creditDesigner.setValue(data.designers || []);
    if (_creditArtist)   _creditArtist.setValue(data.artists || []);
    _creditsLoadedFor = instanceId;
  }

  function toggleCredits() {
    const ed = document.getElementById('labberSubjectCreditEditor');
    const btn = document.getElementById('labberSubjectCreditToggle');
    if (!ed) return;
    ed.hidden = !ed.hidden;
    if (btn) btn.textContent = ed.hidden ? '편집' : '닫기';
  }

  async function saveCredits() {
    const instanceId = _openDetailInstanceId;
    if (_editBusy || !instanceId || _creditsLoadedFor !== instanceId || !_creditDesigner) return;
    const btn = document.getElementById('labberSubjectCreditSaveBtn');
    const err = document.getElementById('labberSubjectCreditError');
    if (err) err.textContent = '';
    _editBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
    try {
      const { data, error } = await sb.rpc('set_labber_subject_instance_credits', {
        p_instance_id: instanceId,
        p_designers: _creditDesigner.getValue(),
        p_artists: _creditArtist ? _creditArtist.getValue() : [],
      });
      if (error) throw new Error(`저장에 실패했어요. (${error.message})`);
      if (!data || data.success !== true) throw new Error(editErrMsg(data && data.error, '크레딧 저장'));
      await loadCredits(instanceId);
      toggleCredits();
    } catch (e) {
      console.error('[personal-lab-subject] 크레딧 저장 오류:', e);
      if (err) err.textContent = e.message || '저장 중 오류가 발생했어요.';
    } finally {
      _editBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '크레딧 저장'; }
    }
  }

  // (이미지 업로드/교체/삭제 경로는 2026-10-01 제거 — 승인된 SUBJECT 이미지는 운영진만 변경. set/delete_labber_subject_instance_image 는 서버에서 admin/staff 전용)

  // ── SUBJECT 이미지 업데이트 신청 + 표본장식키트 — 2026-11 ─────────────────
  // 정책(뽀 확정 2026-10-31): 등록된 SUBJECT 도 정체성을 유지하는 범위에서 새 디자인 이미지를 신청 → 운영진 승인 시
  // instance 이미지·액세서리만 갱신(레벨·EXP·소유권·LABBER 연결 유지). 즉시 교체 아님. 일반 업데이트는 레벨 제한·키트 없음.
  //   아이템 사용 = 표본장식키트: 1개당 SUBJECT 에 직접 닿는 장식 1종 추가/교체, 신청 1회 최대 3종, instance Lv.3 이상.
  //   서버: get_my_subject_image_update_form / submit_ / cancel_labber_subject_image_update (supabase/labber_1101_launch.sql [C])
  //   신청 이미지는 가방 등록 신청과 같은 public images 버킷 경로(labber-subject-instance/{uid}/...)로 올린다.
  const UPD_NOTE_MAX = 500;
  const UPD_NAME_MAX = 40;
  const UPD_ERR = {
    NOT_AUTHENTICATED: '로그인이 필요해요.',
    NOT_INSTANCE_OWNER: '내가 소유한 SUBJECT만 이미지 업데이트를 신청할 수 있어요.',
    OPEN_REQUEST_EXISTS: '이 SUBJECT는 이미 승인 대기 중인 이미지 업데이트 신청이 있어요.',
    IMAGE_REQUIRED: '새 디자인 이미지를 첨부해주세요.',
    INVALID_IMAGE_URL: '이미지 정보가 올바르지 않아요. 다시 첨부해주세요.',
    INVALID_IMAGE_PATH: '이미지 정보가 올바르지 않아요. 다시 첨부해주세요.',
    IMAGE_NOT_UPLOADED: '이미지 업로드가 완료되지 않았어요. 잠시 후 다시 시도해주세요.',
    SAME_IMAGE: '현재 이미지와 같은 이미지예요. 새 이미지를 첨부해주세요.',
    NOTE_REQUIRED: '변경 설명을 입력해주세요.',
    NOTE_TOO_LONG: `변경 설명은 ${UPD_NOTE_MAX}자 이하로 입력해주세요.`,
    INVALID_ACCESSORY: '장식은 신청 1회에 최대 3종까지 신청할 수 있어요.',
    INVALID_ADDON_NAME: `장식 설명을 1~${UPD_NAME_MAX}자로 입력해주세요.`,
    INVALID_ACCESSORY_REPLACE: '교체할 기존 장식이 현재 SUBJECT와 맞지 않아요. 새로고침 후 다시 선택해주세요.',
    ACCESSORY_LEVEL: '표본장식키트는 SUBJECT Lv.3 이상부터 사용할 수 있어요.',
    INSUFFICIENT_ITEM: '표본장식키트의 사용 가능한 수량이 부족해요. (보유하지 않았거나 다른 신청에 예약되어 있어요)',
    INVALID_ITEM: '표본장식키트 정보를 찾을 수 없어요. 운영진에게 문의해주세요.',
    NOT_FOUND: '신청서를 찾을 수 없어요.',
    INVALID_STATUS: '이미 처리된 신청이에요. 새로고침해 확인해주세요.',
  };
  const updErr = (code) => UPD_ERR[code] || `처리에 실패했어요.${code ? ` [${code}]` : ''}`;
  let _upd = null;   // { instanceId, form, open: bool, useKit, ops: [{op, from, name}], pending: {blob, url, ext}, busy }

  async function renderUpdateBox(r) {
    const box = document.getElementById('labberSubjectUpdateBox');
    if (!box) return;
    box.innerHTML = '';
    if (_upd && _upd.pending) URL.revokeObjectURL(_upd.pending.url);
    _upd = { instanceId: r.instance_id, form: null, open: false, useKit: false, ops: [], pending: null, busy: false };
    const { data, error } = await sb.rpc('get_my_subject_image_update_form', { p_instance_id: r.instance_id });
    if (!_upd || _upd.instanceId !== r.instance_id) return;
    if (error || !data || data.success !== true) {
      // 서버 기능(11/1 [C]) 적용 전이거나 권한 없음 → 섹션을 그리지 않는다
      if (error) console.warn('[personal-lab-subject] 이미지 업데이트 정보 조회 실패:', error.message);
      return;
    }
    _upd.form = data;
    drawUpdateBox();
  }

  function updAccessoryList(f) {
    const list = (f && f.accessories) || [];
    return list.length ? list.map(escapeHtml).join(' · ') : '<em>없음</em>';
  }

  function updOpsHtml(ops) {
    return (ops || []).map(o => o.op === 'replace'
      ? `${escapeHtml(o.from)} → <b>${escapeHtml(o.name)}</b> <span class="subj-upd-tag">교체</span>`
      : `<b>${escapeHtml(o.name)}</b> <span class="subj-upd-tag">추가</span>`).join('<br>');
  }

  function drawUpdateBox() {
    const box = document.getElementById('labberSubjectUpdateBox');
    const f = _upd && _upd.form;
    if (!box || !f) return;
    const open = f.open_request;
    const last = f.last_closed;
    let body;
    if (open) {
      body = `
        <p class="subj-upd-status">승인 대기 중 · ${formatDate(open.created_at)} 신청</p>
        <div class="subj-upd-compare">
          <figure><figcaption>현재</figcaption>${f.image_url ? `<img src="${escapeHtml(f.image_url)}" alt="현재 이미지">` : '<span>없음</span>'}</figure>
          <figure><figcaption>신청</figcaption><img src="${escapeHtml(open.image_url)}" alt="신청 이미지"></figure>
        </div>
        <p class="subj-upd-line"><span>변경 설명</span> ${escapeHtml(open.note || '')}</p>
        ${(open.accessory_ops || []).length ? `<p class="subj-upd-line"><span>장식 변경</span> ${updOpsHtml(open.accessory_ops)}</p>
        <p class="subj-upd-line"><span>표본장식키트</span> ${open.kit_qty}개 예약 중 (승인 시 소비 · 반려/취소 시 해제)</p>` : ''}
        <p class="subj-name-edit-note">승인 전까지 현재 이미지·장식이 그대로 유지돼요.</p>
        <div class="subj-edit-row"><button type="button" class="is-ghost" onclick="PersonalLabSubject.cancelUpdate('${open.id}')">신청 취소</button></div>`;
    } else if (!_upd.open) {
      body = `
        ${last && last.status === 'rejected' ? `<p class="subj-upd-reject"><span>최근 신청 반려</span> ${escapeHtml(last.rejection_reason || '')}</p>` : ''}
        <p class="subj-name-edit-note">정체성을 유지하는 범위에서 새 디자인 이미지로 바꾸도록 신청할 수 있어요. 운영진이 승인하면 바뀌어요.</p>
        <div class="subj-edit-row"><button type="button" onclick="PersonalLabSubject.openUpdateForm()">이미지 업데이트 신청</button></div>`;
    } else {
      body = updFormHtml(f);
    }
    box.innerHTML = `
      <div class="subj-edit-section subj-upd">
        <div class="subj-edit-head"><p class="subj-edit-title">이미지 업데이트</p></div>
        <p class="subj-upd-line"><span>현재 장식</span> ${updAccessoryList(f)}</p>
        ${body}
      </div>`;
  }

  function updFormHtml(f) {
    const kit = f.kit;
    const kitName = (kit && kit.name) || '표본장식키트';
    const lvOk = Number(f.level) >= Number(f.kit_level || 3);
    const max = Number(f.max_per_request || 3);
    const cur = f.accessories || [];
    const need = _upd.useKit ? _upd.ops.length : 0;
    const avail = kit ? kit.available : 0;
    const opsHtml = _upd.ops.map((o, i) => {
      // 교체 대상 = 현재 장식 − 다른 행이 이미 고른 교체 대상 (같은 이름이 여러 개면 개수만큼 고를 수 있다)
      const left = [...cur];
      _upd.ops.forEach((x, j) => {
        if (j === i || x.op !== 'replace') return;
        const k = left.indexOf(x.from);
        if (k >= 0) left.splice(k, 1);
      });
      const options = [`<option value="add"${o.op === 'add' ? ' selected' : ''}>새 장식 추가</option>`]
        .concat([...new Set(left)]
          .map(n => `<option value="replace:${escapeHtml(n)}"${o.op === 'replace' && o.from === n ? ' selected' : ''}>교체: ${escapeHtml(n)}</option>`));
      return `<div class="subj-upd-op">
        <select onchange="PersonalLabSubject.setUpdateOp(${i}, this.value)">${options.join('')}</select>
        <input type="text" maxlength="${UPD_NAME_MAX}" value="${escapeHtml(o.name)}" placeholder="예: 머리 리본 / 케이프 / 발목 붕대"
               oninput="PersonalLabSubject.setUpdateOpName(${i}, this.value)">
        <button type="button" class="is-ghost" onclick="PersonalLabSubject.removeUpdateOp(${i})">삭제</button>
      </div>`;
    }).join('');
    const prev = (_upd.pending && _upd.pending.url) || null;
    return `
      <p class="subj-name-edit-note">허용: 그림체·포즈·구도 변경, 작화 보완, 기존 특징을 유지한 세부 표현 조정 · 불가: 원본 생물·연결 종족 변경, 핵심 신체 구조·대표 특징을 바꿔 다른 개체처럼 보이는 변경.
        기존 SUBJECT 디자인 규정(POD 액체 안에 완전히 잠김 · SD·모에화 가능 · 과도한 크리쳐화 불가 · 원본 생물 특징 유지)도 그대로 적용돼요.</p>
      <div class="subj-upd-compare">
        <figure><figcaption>현재</figcaption>${f.image_url ? `<img src="${escapeHtml(f.image_url)}" alt="현재 이미지">` : '<span>없음</span>'}</figure>
        <figure><figcaption>신청할 이미지</figcaption>${prev ? `<img src="${escapeHtml(prev)}" alt="신청 이미지 미리보기">` : '<span>이미지를 첨부해주세요</span>'}</figure>
      </div>
      <input type="file" id="labberSubjectUpdFile" accept="image/png,image/jpeg,image/webp" style="display:none;" onchange="PersonalLabSubject.pickUpdateImage(this)">
      <div class="subj-edit-row"><button type="button" class="is-ghost" onclick="document.getElementById('labberSubjectUpdFile').click()">${prev ? '이미지 다시 선택' : '이미지 첨부'}</button></div>
      <p class="subj-upd-label">변경 설명 <em>필수</em></p>
      <textarea id="labberSubjectUpdNote" class="subj-upd-note" rows="3" maxlength="${UPD_NOTE_MAX}" placeholder="무엇을 바꿨는지 적어주세요. 예: 포즈 변경, 꼬리 작화 보완">${escapeHtml(_upd.note || '')}</textarea>
      <p class="subj-upd-label">아이템 사용 <em>선택</em></p>
      <label class="subj-upd-kit${lvOk ? '' : ' is-disabled'}">
        <input type="checkbox" ${_upd.useKit ? 'checked' : ''} ${lvOk ? '' : 'disabled'} onchange="PersonalLabSubject.toggleUpdateKit(this.checked)">
        <span>${escapeHtml(kitName)} <em>보유 ${kit ? kit.quantity : 0} · 사용 가능 ${avail}</em></span>
      </label>
      <p class="subj-name-edit-note">SUBJECT에 직접 닿는 장식을 키트 1개당 1종 추가하거나 교체해요. 신청 1회 최대 ${max}종 · 기존 장식 유지에는 키트가 필요 없어요 · SUBJECT Lv.${f.kit_level || 3} 이상 (현재 Lv.${f.level}).
        신청 이미지에 신청한 장식이 반영되어 있어야 해요.</p>
      ${_upd.useKit ? `
        ${opsHtml}
        <div class="subj-edit-row"><button type="button" class="is-ghost" ${_upd.ops.length >= max ? 'disabled' : ''} onclick="PersonalLabSubject.addUpdateOp()">+ 장식 추가</button></div>
        <p class="subj-upd-need">${need ? `${escapeHtml(kitName)} <b>${need}개</b> 사용 (사용 가능 ${avail})` : '장식을 추가해주세요.'}</p>` : ''}
      <p class="auth-error" id="labberSubjectUpdError"></p>
      <div class="subj-edit-row">
        <button type="button" class="is-ghost" onclick="PersonalLabSubject.closeUpdateForm()">닫기</button>
        <button type="button" id="labberSubjectUpdSubmitBtn" onclick="PersonalLabSubject.submitUpdate()">신청하기</button>
      </div>`;
  }

  function keepNote() { const el = document.getElementById('labberSubjectUpdNote'); if (el && _upd) _upd.note = el.value; }
  function openUpdateForm() { if (!_upd || !_upd.form) return; _upd.open = true; drawUpdateBox(); }
  function closeUpdateForm() {
    if (!_upd) return;
    if (_upd.pending) URL.revokeObjectURL(_upd.pending.url);
    Object.assign(_upd, { open: false, useKit: false, ops: [], pending: null, note: '' });
    drawUpdateBox();
  }
  function toggleUpdateKit(on) {
    keepNote();
    _upd.useKit = !!on;
    if (_upd.useKit && !_upd.ops.length) _upd.ops.push({ op: 'add', from: null, name: '' });
    drawUpdateBox();
  }
  function addUpdateOp() {
    keepNote();
    if (_upd.ops.length >= Number(_upd.form.max_per_request || 3)) return;
    _upd.ops.push({ op: 'add', from: null, name: '' });
    drawUpdateBox();
  }
  function removeUpdateOp(i) { keepNote(); _upd.ops.splice(i, 1); drawUpdateBox(); }
  function setUpdateOpName(i, v) { if (_upd.ops[i]) _upd.ops[i].name = v; }
  function setUpdateOp(i, v) {
    keepNote();
    const o = _upd.ops[i];
    if (!o) return;
    if (v.startsWith('replace:')) { o.op = 'replace'; o.from = v.slice(8); } else { o.op = 'add'; o.from = null; }
    drawUpdateBox();
  }

  async function pickUpdateImage(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    keepNote();
    const err = document.getElementById('labberSubjectUpdError');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 형식의 이미지만 등록할 수 있어요.');
      const blob = await compressImage(file, 800, 0.85, { keepAlpha: true });   // 가방 SUBJECT 등록과 같은 800px · 투명 유지
      const ext = imageExtOfBlob(blob);
      if (!['jpg', 'png', 'webp'].includes(ext)) throw new Error('JPG, PNG, WebP 형식의 이미지만 등록할 수 있어요.');
      if (_upd.pending) URL.revokeObjectURL(_upd.pending.url);
      _upd.pending = { blob, url: URL.createObjectURL(blob), ext };
      drawUpdateBox();
    } catch (e) {
      if (err) err.textContent = e.message || '이미지를 처리할 수 없어요.';
    }
  }

  async function submitUpdate() {
    if (!_upd || _upd.busy || !_upd.form) return;
    keepNote();
    const err = document.getElementById('labberSubjectUpdError');
    const btn = document.getElementById('labberSubjectUpdSubmitBtn');
    const fail = (m) => { if (err) err.textContent = m; };
    fail('');
    const note = String(_upd.note || '').trim();
    if (!_upd.pending) return fail('새 디자인 이미지를 첨부해주세요.');
    if (!note) return fail('변경 설명을 입력해주세요.');
    const ops = _upd.useKit ? _upd.ops.map(o => ({ op: o.op, from: o.op === 'replace' ? o.from : undefined, name: String(o.name || '').trim() })) : [];
    if (_upd.useKit && !ops.length) return fail('장식을 1종 이상 추가하거나 아이템 사용을 해제해주세요.');
    if (ops.some(o => !o.name)) return fail('장식 설명을 입력해주세요.');
    const kit = _upd.form.kit;
    if (ops.length && (!kit || kit.available < ops.length)) return fail(`표본장식키트가 부족해요. (필요 ${ops.length} · 사용 가능 ${kit ? kit.available : 0})`);
    const confirmMsg = `SUBJECT 이미지 업데이트를 신청할까요?\n운영진이 승인하면 이미지${ops.length ? '와 장식' : ''}이 바뀌어요. 승인 전까지는 현재 이미지가 유지돼요.`
      + (ops.length ? `\n표본장식키트 ${ops.length}개가 예약되고, 승인되면 소비돼요. (반려·취소 시 해제)` : '');
    if (!confirm(confirmMsg)) return;

    _upd.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '신청 중...'; }
    let uploadedPath = null;
    try {
      const user = await getUser();
      if (!user) throw new Error('로그인이 필요해요.');
      const path = `labber-subject-instance/${user.id}/${crypto.randomUUID()}.${_upd.pending.ext}`;
      const { error: upErr } = await sb.storage.from('images').upload(path, _upd.pending.blob, {
        contentType: _upd.pending.blob.type || 'image/jpeg', upsert: false,
      });
      if (upErr) throw new Error(`이미지 업로드에 실패했어요. (${upErr.message})`);
      uploadedPath = path;
      const imageUrl = sb.storage.from('images').getPublicUrl(path).data.publicUrl;
      const { data, error } = await sb.rpc('submit_labber_subject_image_update', {
        p_instance_id: _upd.instanceId, p_image_url: imageUrl, p_note: note, p_accessories: ops,
      });
      if (error) throw new Error(`신청에 실패했어요. (${error.message})`);
      if (!data || data.success !== true) throw new Error(updErr(data && data.error));
      uploadedPath = null;   // 신청 이미지로 쓰인다
      alert('SUBJECT 이미지 업데이트를 신청했어요.\n운영진이 확인해 승인하면 반영돼요.');
      const r = _rows.find(x => x.instance_id === _upd.instanceId);
      if (r) await renderUpdateBox(r);
    } catch (e) {
      console.error('[personal-lab-subject] 이미지 업데이트 신청 오류:', e);
      if (uploadedPath) sb.storage.from('images').remove([uploadedPath]).catch(() => {});
      fail(e.message || '신청 중 오류가 발생했어요.');
    } finally {
      if (_upd) _upd.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '신청하기'; }
    }
  }

  async function cancelUpdate(id) {
    if (!confirm('이미지 업데이트 신청을 취소할까요?\n예약된 표본장식키트는 해제돼요.')) return;
    const { data, error } = await sb.rpc('cancel_labber_subject_image_update', { p_id: id });
    if (error || !data || data.success !== true) {
      alert(error ? `취소에 실패했어요. (${error.message})` : updErr(data && data.error));
      return;
    }
    const r = _rows.find(x => x.instance_id === (_upd && _upd.instanceId));
    if (r) await renderUpdateBox(r);
  }

  // ── 분리 ────────────────────────────────────────────────────────────
  async function detach(instanceId) {
    const r = _rows.find(x => x.instance_id === instanceId);
    if (!r || !r.current_character_id) return;

    const { data, error } = await sb.rpc('detach_labber_subject_instance', {
      p_character_id: r.current_character_id,
    });

    if (error || !data || data.success !== true) {
      console.error('[personal-lab-subject] detach 오류:', error, data);
      alert('분리에 실패했어요. 잠시 후 다시 시도해주세요.');
      return;
    }

    closeDetail();
    await init(); // 목록/카운트 새로고침
  }

  // ── 배정(attach) ─────────────────────────────────────────────────────
  async function openAssignModal(instanceId) {
    _pendingAssignInstanceId = instanceId;
    const listEl = document.getElementById('labberSubjectAssignList');
    listEl.innerHTML = `<p class="subj-assign-empty">불러오는 중...</p>`;
    document.getElementById('labberSubjectAssignModal').style.display = 'flex';

    try {
      const user = await getUser();
      if (!user) throw new Error('NOT_AUTHENTICATED');

      const { data: species, error: spErr } = await sb
        .from('species')
        .select('name')
        .eq('id', LABBER_SPECIES_ID)
        .single();
      if (spErr || !species) throw spErr || new Error('SPECIES_NOT_FOUND');

      const { data: chars, error: charErr } = await sb
        .from('characters')
        .select('id, name, char_number, owner_custom_name')
        .eq('owner_user_id', user.id)
        .eq('species_name', species.name)
        .order('created_at', { ascending: false });
      if (charErr) throw charErr;

      const ids = (chars || []).map(c => c.id);
      let assignedSet = new Set();
      if (ids.length) {
        const { data: activeAsg, error: asgErr } = await sb
          .from('labber_subject_assignments')
          .select('character_id')
          .in('character_id', ids)
          .is('detached_at', null);
        if (asgErr) throw asgErr;
        assignedSet = new Set((activeAsg || []).map(a => a.character_id));
      }

      const assignable = (chars || []).filter(c => !assignedSet.has(c.id));

      listEl.innerHTML = assignable.length
        ? assignable.map(c => `
            <div class="subj-assign-row" onclick="PersonalLabSubject.pickAssign(${c.id})">
              <p class="subj-assign-row-name" title="${escapeHtml(labberDisplayName(c))}">${escapeHtml(labberDisplayName(c))}</p>
              <span class="subj-holder-link">배정</span>
            </div>`).join('')
        : `<p class="subj-assign-empty">SUBJECT가 없는 LABBER가 없어요. 먼저 다른 LABBER의 SUBJECT를 분리해주세요.</p>`;
    } catch (e) {
      console.error('[personal-lab-subject] 배정 가능 LABBER 조회 오류:', e);
      listEl.innerHTML = `<p class="subj-assign-empty">목록을 불러오지 못했어요.</p>`;
    }
  }

  async function pickAssign(characterId) {
    const instanceId = _pendingAssignInstanceId;
    if (!instanceId) return;

    const { data, error } = await sb.rpc('attach_labber_subject_instance', {
      p_character_id: characterId,
      p_instance_id: instanceId,
    });

    if (error || !data || data.success !== true) {
      console.error('[personal-lab-subject] attach 오류:', error, data);
      alert('배정에 실패했어요. 이미 SUBJECT가 있는 LABBER는 아닌지 확인해주세요.');
      return;
    }

    closeAssignModal();
    closeDetail();
    await init();
  }

  function closeAssignModal() {
    document.getElementById('labberSubjectAssignModal').style.display = 'none';
    _pendingAssignInstanceId = null;
  }

  return {
    init,
    imgFallback,
    openDetail,
    closeDetail,
    toggleHistory,
    saveIndividualName,
    toggleCredits,
    saveCredits,
    openUpdateForm,
    closeUpdateForm,
    toggleUpdateKit,
    addUpdateOp,
    removeUpdateOp,
    setUpdateOp,
    setUpdateOpName,
    pickUpdateImage,
    submitUpdate,
    cancelUpdate,
    detach,
    openAssignModal,
    closeAssignModal,
    pickAssign,
  };

})();
