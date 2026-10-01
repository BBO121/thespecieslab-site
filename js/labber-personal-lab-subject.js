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
          <button type="button" class="subj-edit-toggle" id="labberSubjectCreditToggle" onclick="PersonalLabSubject.toggleCredits()">편집</button>
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
    detach,
    openAssignModal,
    closeAssignModal,
    pickAssign,
  };

})();
