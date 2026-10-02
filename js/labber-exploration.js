// ── LABBER 탐험 (labber-exploration.html) ──────────────────────────────
// 서버 RPC 기반. 프론트는 데이터를 조합/판정하지 않고 서버 응답을 그대로 렌더한다.
//   - get_exploration_areas()               : 탐험구역 목록 (비활성 포함)
//   - get_exploration_stages(p_area_code)    : 구역 스테이지 + is_unlocked / is_current_frontier
//   - get_exploration_daily_status()         : 오늘 남은 탐험 횟수
//   - get_available_exploration_labbers()    : 선택 가능한 LABBER
//   - explore_stage(p_stage_code, p_explorer_character_id)
//
// 잠금/해금 판정은 전적으로 서버. 프론트는 다음 스테이지를 직접 열지 않는다.
// (탐험 성공 후 newly_unlocked=true 이면 get_exploration_stages 를 재호출해 서버 기준으로 갱신)

// 화면에 고정된 카드 배치/번호/영문명. DB sort_order 와 무관하게 이 순서를 유지한다.
// area_name / progression_type / is_active / area_id 는 get_exploration_areas() 응답으로 채운다.
const AREA_META = [
  { code: 'laboratory',      en: 'LABORATORY', art: '../images/labber/explore_laboratory.png' },
  { code: 'culture_room',    en: 'CULTURE ROOM', art: '../images/labber/explore_culture_room.png' },
  { code: 'cafeteria',       en: 'CAFETERIA',    art: '../images/labber/explore_cafeteria_lunch.png' },
  { code: 'break_room',      en: 'BREAK ROOM',   art: '../images/labber/explore_snack_basket.png' },
  { code: 'restricted_area', en: 'RESTRICTED AREA' },
];

// 스테이지 전용 아트웍(stage_code 기준). 없으면 구역 아트(AREA_META.art)를 쓴다.
const STAGE_ART = {
  cafeteria_breakfast:  '../images/labber/explore_cafeteria_breakfast.png',
  cafeteria_lunch:      '../images/labber/explore_cafeteria_lunch.png',
  cafeteria_dinner:     '../images/labber/explore_cafeteria_dinner.png',
  cafeteria_late_night: '../images/labber/explore_cafeteria_late_night.png',
  breakroom_snack_basket:   '../images/labber/explore_snack_basket.png',
  breakroom_coffee_machine: '../images/labber/explore_coffee_machine.png',
  breakroom_beer_fridge:    '../images/labber/explore_beer_fridge.png',
};

// 기본 탐험 NPC(개인 LABBER 가 없을 때 동행) = NPC B (characters.id 5433 "INDIVIDUAL B", 표시 전용 실제 캐릭터).
// 탐험 RPC 는 반드시 p_explorer_character_id = null (NPC 는 서버에서 개인 LABBER 가 아닌 default 로만 취급).
// (2026-09-19 NPC A(5381) → NPC B(5433) 로 변경. NPC A 캐릭터/데이터는 그대로 두고 탐험 화면에서만 교체.)
const NPC_DEFAULT_CHARACTER_ID = 5433;
const NPC_DEFAULT_NAME         = 'NPC B';   // 캐릭터 조회 실패 시 표시 이름 fallback
const NPC_DEFAULT_INITIAL      = 'B';       // 캐릭터 이미지가 없을 때 썸네일 자리 이니셜

const ERROR_MSG = {
  NOT_AUTHENTICATED:          '로그인이 필요합니다.',
  WALLET_NOT_FOUND:           '지갑 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.',
  STAGE_NOT_FOUND:            '해당 스테이지를 찾을 수 없습니다.',
  STAGE_INACTIVE:             '지금은 탐험할 수 없는 스테이지입니다.',
  STAGE_LOCKED:               '아직 잠긴 스테이지입니다. 이전 스테이지를 먼저 탐험해 해금하세요.',
  STAGE_MISCONFIGURED:        '스테이지 설정 오류입니다. 잠시 후 다시 시도해주세요.',
  AREA_INACTIVE:              '아직 준비 중인 탐험구역입니다.',
  AREA_NOT_FOUND:             '탐험구역을 찾을 수 없습니다.',
  INVALID_EXPLORER_CHARACTER: '선택한 LABBER를 사용할 수 없습니다. 목록을 새로고침했어요.',
  DAILY_LIMIT_REACHED:        '오늘의 탐험을 모두 완료했습니다.',
};

// 마지막 선택 탐험 LABBER 기억 (localStorage, 로그인 유저별 key 분리)
//   key   = labber_exploration_selected:{user_id}
//   value = 'npc' (NPC B) | character_id 문자열 (개인 LABBER)
const EXPLORER_STORE_PREFIX = 'labber_exploration_selected:';
const EXPLORER_STORE_NPC    = 'npc';

let _user            = null;
let _explorers        = { default: null, labbers: [] };
let _explorersLoaded  = false;    // get_available_exploration_labbers 성공 여부 (실패 시 저장값 보존)
let _selectedExplorer  = null;    // null = NPC B(기본) / 그 외 = character_id(bigint)
let _daily             = null;    // { daily_limit, used_today, remaining_today }
let _areas             = [];      // AREA_META + get_exploration_areas() 병합, AREA_META 순서
let _stagesByArea      = {};      // { area_code: get_exploration_stages 응답 }
let _itemNames         = {};      // { item_code: name }
let _npcCharacter      = null;    // characters_public id=NPC_DEFAULT_CHARACTER_ID (표시 전용)

let _activeArea        = null;    // 모달에 열린 area_code
let _modalStages       = [];      // 현재 모달 구역의 stages 배열
let _stageIndex        = 0;
let _exploring         = false;
let _modalOpen         = false;
let _lastFocused       = null;

// 확률 공개 패널 — stage_code 별 캐시(같은 스테이지 다시 열 때 재요청 안 함)
let _probCache  = {};   // { stage_code: get_exploration_reward_table() 응답 }
let _probOpen   = false;

// ── 초기화 ────────────────────────────────────────────────────────────
async function initPage() {
  try {
    _user = await getUser();
    if (!_user) { window.location.href = 'login.html'; return; }

    await loadAll();

    // 목록 로드가 끝난 뒤, 첫 렌더 전에 한 번만 복원 (기본값 NPC 로 덮어쓰는 경쟁 없음)
    restoreSelectedExplorer();

    renderExplorers();
    renderDaily();
    renderAreaGrid();

    document.getElementById('stagePrev').addEventListener('click', () => moveStage(-1));
    document.getElementById('stageNext').addEventListener('click', () => moveStage(1));
    document.getElementById('exploreBtn').addEventListener('click', doExplore);
    document.getElementById('probToggleBtn').addEventListener('click', toggleProbPanel);

    document.getElementById('stageModalClose').addEventListener('click', closeStageModal);
    document.getElementById('stageModalBackdrop').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeStageModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (_modalOpen) closeStageModal();
      else closeExplorerPanel();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#explorerRow')) closeExplorerPanel();
    });
    document.getElementById('resultCloseBtn').addEventListener('click', () => {
      document.getElementById('exploreResult').hidden = true;
    });

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[labber-exploration] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

async function loadAll() {
  const [labbersRes, dailyRes, areasRes, itemsRes, npcRes] = await Promise.all([
    sb.rpc('get_available_exploration_labbers'),
    sb.rpc('get_exploration_daily_status'),
    sb.rpc('get_exploration_areas'),
    sb.from('items').select('code, name'),
    sb.from('characters_public')
      .select('id, name, thumbnail_url, image_url, default_image_index')
      .eq('id', NPC_DEFAULT_CHARACTER_ID)
      .maybeSingle(),
  ]);

  if (labbersRes.data && !labbersRes.data.error) {
    _explorers = {
      default: labbersRes.data.default || { type: 'default', code: 'npc_a', name: NPC_DEFAULT_NAME, bonus_rate: 0 },
      labbers: labbersRes.data.labbers || [],
    };
    _explorersLoaded = true;
  }
  if (dailyRes.data && !dailyRes.data.error) _daily = dailyRes.data;
  (itemsRes.data || []).forEach(it => { _itemNames[it.code] = it.name; });
  _npcCharacter = (npcRes && !npcRes.error && npcRes.data) ? npcRes.data : null;

  // 구역: AREA_META 순서에 DB 정보 병합
  const dbAreas = Array.isArray(areasRes.data) ? areasRes.data : [];
  const byCode = {};
  dbAreas.forEach(a => { byCode[a.area_code] = a; });
  _areas = AREA_META
    .filter(m => byCode[m.code])
    .map(m => ({
      code:             m.code,
      en:               m.en,
      area_id:          byCode[m.code].area_id,
      name:             byCode[m.code].area_name,
      progression_type: byCode[m.code].progression_type,
      is_active:        byCode[m.code].is_active === true,
    }));

  // 활성 구역의 스테이지 미리 로드 (모달 즉시 오픈 + 카드에 현재 진행 표시)
  const active = _areas.filter(a => a.is_active);
  const stageResults = await Promise.all(
    active.map(a => sb.rpc('get_exploration_stages', { p_area_code: a.code }))
  );
  active.forEach((a, i) => {
    const r = stageResults[i];
    if (r && r.data && !r.data.error) _stagesByArea[a.code] = r.data;
  });
}

async function refreshAreaStages(areaCode) {
  const { data } = await sb.rpc('get_exploration_stages', { p_area_code: areaCode });
  if (data && !data.error) {
    _stagesByArea[areaCode] = data;
    return data;
  }
  return null;
}

// ── 탐험 LABBER 선택 (기존 유지) ────────────────────────────────────
function explorerList() {
  const list = [{
    id: null,
    // 서버 RPC default 의 name 은 아직 'NPC A' 이므로 쓰지 않는다(표시 이름은 NPC B 캐릭터 또는 fallback 상수).
    name: (_npcCharacter && _npcCharacter.name) || NPC_DEFAULT_NAME,
    thumb: _npcCharacter ? resolveCharacterImage(_npcCharacter) : null,
    isDefault: true,
  }];
  _explorers.labbers.forEach(l => {
    list.push({
      id: l.character_id,
      name: l.name || '내 LABBER',
      thumb: l.thumbnail_url || null,
      isDefault: false,
    });
  });
  return list;
}

// ── 마지막 선택 LABBER 저장/복원 ──────────────────────────────────────
function explorerStoreKey() {
  return _user && _user.id ? EXPLORER_STORE_PREFIX + _user.id : null;
}

function saveSelectedExplorer() {
  const key = explorerStoreKey();
  if (!key) return;
  try {
    localStorage.setItem(key, _selectedExplorer === null ? EXPLORER_STORE_NPC : String(_selectedExplorer));
  } catch (_) { /* 저장 불가(사생활 보호 모드 등) — 선택 자체는 그대로 동작 */ }
}

// 저장값이 현재 탐험 가능 목록(서버가 본인 소유·204·양도대기 아님·offsite 아님으로 필터)에
// 있을 때만 선택. 없으면 NPC B 로 되돌리고 저장값도 NPC 로 정리한다.
// 목록 RPC 자체가 실패한 경우엔 판단 불가 → 이번 화면만 NPC, 저장값은 건드리지 않는다.
function restoreSelectedExplorer() {
  _selectedExplorer = null;
  const key = explorerStoreKey();
  if (!key) return;

  let raw = null;
  try { raw = localStorage.getItem(key); } catch (_) { return; }
  if (raw === null || raw === EXPLORER_STORE_NPC) return;
  if (!_explorersLoaded) return;

  const id = Number(raw);
  const ok = Number.isSafeInteger(id) && id > 0
    && _explorers.labbers.some(l => Number(l.character_id) === id);

  if (ok) {
    _selectedExplorer = id;
  } else {
    saveSelectedExplorer();   // 사용 불가 → NPC 로 정리
  }
}

function selectedExplorerData() {
  const list = explorerList();
  const found = list.find(e => e.id === _selectedExplorer);
  if (!found) _selectedExplorer = null;
  return found || list[0];
}

function explorerThumbHtml(e, sizeClass) {
  const ch = escapeHtml(e.isDefault ? NPC_DEFAULT_INITIAL : (e.name?.[0] || '?'));
  if (e.thumb) {
    return `<img class="${sizeClass}" src="${escapeHtml(e.thumb)}" alt="" data-ph="${ch}" onerror="onExplorerThumbError(this)">`;
  }
  return `<span class="${sizeClass} is-ph">${ch}</span>`;
}

function onExplorerThumbError(img) {
  const span = document.createElement('span');
  span.className = img.className + ' is-ph';
  span.textContent = img.dataset.ph || NPC_DEFAULT_INITIAL;
  img.replaceWith(span);
}

function renderExplorers() {
  const row  = document.getElementById('explorerRow');
  const cur  = selectedExplorerData();
  const list = explorerList();
  const hasChoice = list.length > 1;

  const curSub = cur.isDefault
    ? '기본 LABBER · 보너스 없음'
    : '개인 LABBER · <span class="is-bonus">연구기록 +5</span>';

  const pickBtn = hasChoice ? `
    <button type="button" class="labexp-explorer-pick" id="explorerPickBtn" aria-expanded="false" aria-controls="explorerPanel">
      LABBER 선택
      <svg class="labexp-explorer-pick-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>` : '';

  // 선택 목록: 작은 정사각 썸네일 + 이름만 (개인 LABBER/보너스 등 부가정보는 상단 현재 카드에서만 표시).
  // 기본 NPC(isDefault)와 사용자가 실제 소유한 같은 이름의 LABBER 는 별개 항목이므로 합치거나 제거하지 않는다.
  // 모든 항목을 동일하게 [정사각 썸네일] + [이름] 으로만 표시한다(구분용 칩/라벨 없음).
  const options = list.map(e => {
    const sel = e.id === _selectedExplorer;
    return `
      <button type="button" class="labexp-explorer-option${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-explorer="${e.id === null ? 'null' : e.id}" title="${escapeHtml(e.name)}">
        <span class="labexp-explorer-opt-thumb">
          ${explorerThumbHtml(e, 'labexp-explorer-thumb-sm')}
        </span>
        <span class="labexp-explorer-opt-name">${escapeHtml(e.name)}</span>
      </button>`;
  }).join('');

  row.innerHTML = `
    <div class="labexp-explorer-current">
      <div class="labexp-explorer-portrait">${explorerThumbHtml(cur, 'labexp-explorer-thumb-lg')}</div>
      <div class="labexp-explorer-current-info">
        <span class="labexp-explorer-name">${escapeHtml(cur.name)}</span>
        <span class="labexp-explorer-sub">${curSub}</span>
      </div>
    </div>
    ${pickBtn}
    <div class="labexp-explorer-panel" id="explorerPanel" role="listbox" hidden>${options}</div>`;

  const pick  = document.getElementById('explorerPickBtn');
  const panel = document.getElementById('explorerPanel');
  if (pick && panel) {
    pick.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      pick.setAttribute('aria-expanded', String(open));
    });
  }

  row.querySelectorAll('[data-explorer]').forEach(el => {
    el.addEventListener('click', () => {
      const raw = el.dataset.explorer;
      _selectedExplorer = raw === 'null' ? null : Number(raw);
      saveSelectedExplorer();
      renderExplorers();
    });
  });
}

function closeExplorerPanel() {
  const panel = document.getElementById('explorerPanel');
  const pick  = document.getElementById('explorerPickBtn');
  if (panel && !panel.hidden) {
    panel.hidden = true;
    if (pick) pick.setAttribute('aria-expanded', 'false');
  }
}

// ── 오늘 남은 탐험 (기존 유지) ──────────────────────────────────────
function renderDaily() {
  const el = document.getElementById('dailyStatus');
  if (!_daily) { el.innerHTML = '<span class="labexp-daily-text">불러올 수 없음</span>'; return; }

  const limit = _daily.daily_limit ?? 3;
  const used  = _daily.used_today ?? 0;
  const remaining = _daily.remaining_today ?? Math.max(limit - used, 0);

  let dots = '';
  for (let i = 0; i < limit; i++) {
    dots += `<span class="labexp-daily-dot${i < remaining ? '' : ' is-used'}"></span>`;
  }
  el.innerHTML = `
    <span class="labexp-daily-dots">${dots}</span>
    <span class="labexp-daily-text">${remaining} / ${limit}</span>`;

  updateExploreButtonState();
}

// 구역 아트웍 — placeholder 영역 안에 cover 로 깔린다. 로드 실패 시 img 를 제거해 placeholder 가 그대로 보인다.
function areaArtHtml(areaCode) {
  const meta = AREA_META.find(m => m.code === areaCode);
  if (!meta || !meta.art) return '';
  return `<img class="labexp-art" src="${meta.art}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
}

// 스테이지 아트웍 — STAGE_ART 에 있으면 그것, 없으면 구역 아트로 폴백.
function stageArtHtml(areaCode, stageCode) {
  const art = STAGE_ART[stageCode];
  if (!art) return areaArtHtml(areaCode);
  return `<img class="labexp-art" src="${art}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
}

// ── 탐험구역 카드 grid ────────────────────────────────────────────────
function renderAreaGrid() {
  const grid = document.getElementById('areaGrid');

  grid.innerHTML = _areas.map((a, i) => {
    const num = String(i + 1).padStart(2, '0');
    let infoTail;

    if (!a.is_active) {
      infoTail = `<span class="labexp-area-card-status is-locked">준비중</span>`;
    } else {
      const stagesRes = _stagesByArea[a.code];
      let stageLine = '';
      if (stagesRes && a.progression_type === 'sequential') {
        const frontier = (stagesRes.stages || []).find(s => s.is_current_frontier);
        if (frontier) {
          stageLine = `<span class="labexp-area-card-stage">현재 스테이지 · ${escapeHtml(frontier.display_name)}</span>`;
        }
      }
      infoTail = `${stageLine}<span class="labexp-area-card-status is-open">● 탐험 가능</span>`;
    }

    return `
    <button type="button"
            class="labexp-area-card${a.is_active ? '' : ' is-disabled'}"
            data-area="${a.code}"
            ${a.is_active ? '' : 'aria-disabled="true"'}>
      <span class="labexp-area-card-img labexp-area-card-img--ph">${areaArtHtml(a.code)}</span>
      <span class="labexp-area-card-info">
        <span class="labexp-area-card-meta">
          <span class="labexp-area-card-num">${num}</span>
          <span class="labexp-area-card-en">${a.en}</span>
        </span>
        <span class="labexp-area-card-name">${escapeHtml(a.name)}</span>
        ${infoTail}
      </span>
    </button>`;
  }).join('');

  grid.querySelectorAll('[data-area]').forEach(btn => {
    btn.addEventListener('click', () => {
      const area = _areas.find(a => a.code === btn.dataset.area);
      if (!area || !area.is_active) return;   // 준비중 구역: 모달 열지 않음
      openStageModal(area.code);
    });
  });
}

// ── 스테이지 선택 모달 ────────────────────────────────────────────────
function openStageModal(areaCode) {
  const area = _areas.find(a => a.code === areaCode);
  if (!area || !area.is_active) return;

  const stagesRes = _stagesByArea[areaCode];
  if (!stagesRes) return;   // 스테이지 로드 실패 — 조용히 무시(카드 상태로 안내)

  _activeArea  = areaCode;
  _modalStages = stagesRes.stages || [];

  // sequential: 현재 최전선에서 시작 / free_select: 첫 번째
  const frontierIdx = _modalStages.findIndex(s => s.is_current_frontier);
  _stageIndex = frontierIdx >= 0 ? frontierIdx : 0;

  document.getElementById('stageModalTitle').textContent = area.name;
  renderStageCarousel();

  _lastFocused = document.activeElement;
  const backdrop = document.getElementById('stageModalBackdrop');
  backdrop.hidden = false;
  _modalOpen = true;
  document.body.style.overflow = 'hidden';
  document.getElementById('stageModalClose').focus();
}

function closeStageModal() {
  if (!_modalOpen) return;
  closeProbPanel();
  document.getElementById('stageModalBackdrop').hidden = true;
  _modalOpen = false;
  document.body.style.overflow = '';
  if (_lastFocused && typeof _lastFocused.focus === 'function') {
    try { _lastFocused.focus({ preventScroll: true }); } catch (_) { _lastFocused.focus(); }
  }
}

function moveStage(delta) {
  if (!_modalStages.length) return;
  _stageIndex = (_stageIndex + delta + _modalStages.length) % _modalStages.length;
  renderStageCarousel();
}

function currentStage() {
  if (!_modalStages.length) return null;
  return _modalStages[_stageIndex] || null;
}

function renderStageCarousel() {
  const wrap  = document.getElementById('stageCardWrap');
  const count = document.getElementById('stageCount');
  const prev  = document.getElementById('stagePrev');
  const next  = document.getElementById('stageNext');

  const multi = _modalStages.length > 1;
  prev.disabled = !multi;
  next.disabled = !multi;

  // 스테이지가 바뀌면 확률 패널은 접어둔다(이전 스테이지 내용이 잠깐 보이는 것 방지).
  closeProbPanel();

  const stage = currentStage();
  if (!stage) {
    wrap.innerHTML = `
      <div class="labexp-stage-card labexp-stage-card--empty">
        <div class="labexp-stage-thumb labexp-stage-thumb--ph"></div>
        <p class="labexp-stage-name">준비중</p>
        <p class="labexp-stage-status is-locked">아직 탐험할 수 없습니다</p>
      </div>`;
    count.textContent = '';
    updateExploreButtonState();
    return;
  }

  const locked   = stage.is_unlocked !== true;
  const frontier = stage.is_current_frontier === true;

  let statusHtml;
  if (locked) {
    statusHtml = `<p class="labexp-stage-status is-locked">🔒 잠김</p>`;
  } else if (frontier) {
    statusHtml = `<p class="labexp-stage-status is-open">현재 진행 · 탐험 가능</p>`;
  } else {
    statusHtml = `<p class="labexp-stage-status is-open">탐험 가능</p>`;
  }

  wrap.innerHTML = `
    <div class="labexp-stage-card${locked ? ' labexp-stage-card--locked' : ''}">
      <div class="labexp-stage-thumb labexp-stage-thumb--ph">${stageArtHtml(_activeArea, stage.stage_code)}</div>
      <p class="labexp-stage-name">${escapeHtml(stage.display_name || stage.stage_code)}</p>
      <p class="labexp-stage-desc">${escapeHtml(stage.description || '')}</p>
      <p class="labexp-stage-reward">기본 보상 · 연구기록 +${stage.base_record_reward ?? 0}</p>
      ${statusHtml}
    </div>`;
  count.textContent = multi ? `${_stageIndex + 1} / ${_modalStages.length}` : '';
  updateExploreButtonState();
}

// ── 확률 공개 패널 ────────────────────────────────────────────────────
// get_exploration_reward_table(stage_code) 는 explore_stage 가 실제 판정에 쓰는
// exploration_reward_slots / exploration_item_drops 를 그대로 읽어서 반환한다 —
// 서버 실제 확률과 이 화면 표시 확률이 항상 같은 source of truth.

async function toggleProbPanel() {
  if (_probOpen) { closeProbPanel(); return; }

  const stage = currentStage();
  if (!stage) return;

  const btn   = document.getElementById('probToggleBtn');
  const panel = document.getElementById('probPanel');
  _probOpen = true;
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = '획득 확률 닫기';
  panel.hidden = false;

  if (_probCache[stage.stage_code]) {
    renderProbPanelContent(_probCache[stage.stage_code]);
    return;
  }

  panel.classList.add('is-loading');
  panel.textContent = '불러오는 중...';

  const { data, error } = await sb.rpc('get_exploration_reward_table', { p_stage_code: stage.stage_code });

  panel.classList.remove('is-loading');

  if (error || !data || data.error) {
    panel.innerHTML = '<p class="labexp-prob-empty">확률 정보를 불러오지 못했습니다.</p>';
    return;
  }

  _probCache[stage.stage_code] = data;
  renderProbPanelContent(data);
}

function closeProbPanel() {
  _probOpen = false;
  const btn   = document.getElementById('probToggleBtn');
  const panel = document.getElementById('probPanel');
  if (btn)   { btn.setAttribute('aria-expanded', 'false'); btn.textContent = '획득 확률 보기'; }
  if (panel) { panel.hidden = true; panel.innerHTML = ''; }
}

// ── 확률 목록 렌더 ────────────────────────────────────────────────────
// 화면에는 [항목명] / [실제 획득 확률] 2열만 보여준다(등급·용도·조합재료 표시 없음).
//  · 확률은 서버가 실제 판정하는 값과 같아야 한다:
//      - 연구기록 슬롯은 같은 (최소~최대) 구간끼리 합산한다. 상급 후보가 없어 연구기록으로 대체된
//        [상] 슬롯도 여기에 합쳐진다.
//      - item_pool 슬롯은 서버가 후보 중 균등 무작위 1개를 고르므로 "슬롯 확률 ÷ 후보 수" 가
//        각 아이템의 최종 개별 획득 확률이다.
//  · 정렬: 최종 확률 내림차순. 같은 확률이면 서버가 준 슬롯/후보 순서를 유지한다(안정 정렬).
function roundPct(n) { return Math.round(Number(n) * 100) / 100; }

function researchLabel(min, max) {
  return min === max ? `연구기록 ${min}개` : `연구기록 ${min}~${max}개`;
}

function buildProbEntries(slots) {
  const entries  = [];
  const research = new Map();   // '3~7' → entry (같은 구간 합산)
  let order = 0;

  const addResearch = (min, max, pct) => {
    const key = `${min}~${max}`;
    const cur = research.get(key);
    if (cur) { cur.pct += pct; return; }
    const entry = { label: researchLabel(min, max), pct, order: order++ };
    research.set(key, entry);
    entries.push(entry);
  };

  slots.forEach(s => {
    const w = Number(s.weight_pct);
    if (s.kind === 'research') {
      addResearch(s.research_min, s.research_max, w);
      return;
    }
    const items = s.items || [];
    if (!items.length) {
      // 활성 후보가 0개인 슬롯(정상 데이터에는 없음). 서버 최후 안전장치가 연구기록 +3을 지급하므로
      // 화면도 실제 결과와 같게 연구기록 3개로 합산한다.
      addResearch(3, 3, w);
      return;
    }
    const each = w / items.length;
    items.forEach(it => entries.push({ label: it.item_name, pct: each, order: order++ }));
  });

  entries.forEach(en => { en.pct = roundPct(en.pct); });
  entries.sort((a, b) => b.pct - a.pct || a.order - b.order);
  return entries;
}

function probRowHtml(label, pct) {
  return `
    <div class="labexp-prob-row">
      <div class="labexp-prob-row-head">
        <span class="labexp-prob-label">${escapeHtml(label)}</span>
        <span class="labexp-prob-pct">${pct}%</span>
      </div>
    </div>`;
}

function renderProbPanelContent(data) {
  const panel   = document.getElementById('probPanel');
  const entries = buildProbEntries(data.slots || []);

  let html = `<p class="labexp-prob-sub" style="margin:0 0 8px;">기본 보상 연구기록 +${data.base_record_reward ?? 0}은 결과와 무관하게 항상 지급됩니다. 아래는 그 위에 추가로 판정되는 보상입니다.</p>`;

  if (!entries.length) {
    html += '<p class="labexp-prob-empty">표시할 확률 정보가 없습니다.</p>';
  } else {
    html += '<div class="labexp-prob-row labexp-prob-row--head"><span>항목</span><span>확률</span></div>';
    html += entries.map(en => probRowHtml(en.label, en.pct)).join('');
  }

  panel.innerHTML = html;
}

// ── 탐험 버튼 상태 ────────────────────────────────────────────────────
function updateExploreButtonState() {
  const btn  = document.getElementById('exploreBtn');
  const note = document.getElementById('exploreNote');
  const stage = currentStage();
  const remaining = _daily?.remaining_today ?? 0;

  if (_exploring) {
    btn.disabled = true;
    btn.textContent = '탐험 중...';
    note.textContent = '';
    return;
  }

  btn.textContent = '탐험하기';

  if (!stage) {
    btn.disabled = true;
    note.textContent = '';
    return;
  }
  if (stage.is_unlocked !== true) {
    btn.disabled = true;
    note.textContent = '이전 스테이지를 먼저 탐험해 해금하세요.';
    return;
  }
  if (remaining <= 0) {
    btn.disabled = true;
    note.textContent = '오늘의 탐험을 모두 완료했습니다.';
    return;
  }
  btn.disabled = false;
  note.textContent = '';
}

// ── 탐험 실행 ─────────────────────────────────────────────────────────
async function doExplore() {
  const stage = currentStage();
  if (!stage || _exploring) return;
  if (stage.is_unlocked !== true) return;   // 잠긴 스테이지 클라 차단 (서버도 STAGE_LOCKED 로 차단)

  _exploring = true;
  updateExploreButtonState();

  const areaCode = _activeArea;
  const { data, error } = await sb.rpc('explore_stage', {
    p_stage_code: stage.stage_code,
    p_explorer_character_id: _selectedExplorer,   // null = NPC B(기본 탐험 NPC)
  });

  _exploring = false;

  if (error) {
    console.error('[labber-exploration] explore_stage 오류:', error);
    alert('탐험 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    updateExploreButtonState();
    return;
  }

  if (!data || data.success !== true) {
    await handleExploreError(data?.error, data, areaCode);
    return;
  }

  // 성공 — 서버 반환값 기준으로 갱신
  _daily = {
    daily_limit:     data.daily_limit,
    used_today:      data.used_today,
    remaining_today: data.remaining_today,
  };

  // 다음 스테이지가 해금됐으면 서버 기준으로 구역 스테이지 재조회 (프론트가 직접 해금하지 않음)
  if (data.newly_unlocked === true && areaCode) {
    await refreshAreaStages(areaCode);
  }

  closeStageModal();
  renderResult(data);
  renderDaily();
  renderAreaGrid();   // 카드의 "현재 스테이지" 표시 갱신
}

async function handleExploreError(code, data, areaCode) {
  if (code === 'DAILY_LIMIT_REACHED') {
    _daily = {
      daily_limit:     data?.daily_limit ?? _daily?.daily_limit ?? 3,
      used_today:      data?.used_today ?? _daily?.daily_limit ?? 3,
      remaining_today: 0,
    };
    renderDaily();
  }

  // 잠금/구역 상태 불일치 → 서버 기준으로 재동기화 (보상 결과처럼 표시하지 않음)
  if ((code === 'STAGE_LOCKED' || code === 'STAGE_INACTIVE' || code === 'AREA_INACTIVE') && areaCode) {
    const fresh = await refreshAreaStages(areaCode);
    if (fresh && _modalOpen && _activeArea === areaCode) {
      _modalStages = fresh.stages || [];
      if (_stageIndex >= _modalStages.length) _stageIndex = Math.max(_modalStages.length - 1, 0);
      renderStageCarousel();
    }
    renderAreaGrid();
  }

  if (code === 'INVALID_EXPLORER_CHARACTER') {
    const { data: freshLabbers } = await sb.rpc('get_available_exploration_labbers');
    if (freshLabbers && !freshLabbers.error) {
      _explorers = {
        default: freshLabbers.default || _explorers.default,
        labbers: freshLabbers.labbers || [],
      };
    }
    _selectedExplorer = null;
    saveSelectedExplorer();   // 서버가 거부한 LABBER 는 저장값에서도 정리
    renderExplorers();
  }

  if (code === 'NOT_AUTHENTICATED') {
    alert(ERROR_MSG.NOT_AUTHENTICATED);
    window.location.href = 'login.html';
    return;
  }

  alert(ERROR_MSG[code] || '탐험을 진행할 수 없습니다.');
  updateExploreButtonState();
}

// ── 결과 렌더 (기존 패널 유지 — 탐험 1회당 최종 보상 1개) ─────────────
// 서버가 판정한 reward_type 만 신뢰: 'item' 이면 아이템, 그 외(연구기록/EMPTY_ITEM_POOL fallback)는 연구기록.
// fallback 내부 사정(초희귀 걸렸는데 풀이 없어 연구기록)은 사용자에게 노출하지 않는다.
// 기본 보상(항상 지급)과 추가 보상(확률 판정)을 구분해서 보여준다 — 뽀 지시사항:
// "기본 보상 연구기록 +5 / 탐험 보상 ○○○" 처럼 혼동되지 않게.
function renderResult(data) {
  const box  = document.getElementById('exploreResult');
  const body = document.getElementById('exploreResultBody');

  const lines = [];

  // ── 기본 보상 ──
  const base   = data.base_reward || {};
  const baseAmt = base.base_record_reward ?? data.base_record_reward ?? 0;
  const labberBonus = base.labber_bonus_reward ?? data.bonus_record_reward ?? 0;
  lines.push('<div class="labexp-result-group">');
  lines.push('<p class="labexp-result-group-label">기본 보상</p>');
  lines.push(`<p class="labexp-result-reward">연구기록 +${baseAmt}</p>`);
  if (labberBonus > 0) {
    lines.push(`<p class="labexp-result-bonus">LABBER 보너스 +${labberBonus}</p>`);
  }
  lines.push('</div>');

  // ── 탐험 보상(추가, 확률 판정 결과) ──
  const tier = data.tier_reward || {};
  const wonItem = tier.item || (data.reward_type === 'item' ? data.reward_item : null);
  lines.push('<div class="labexp-result-group">');
  lines.push('<p class="labexp-result-group-label">탐험 보상</p>');
  if (wonItem) {
    const name = _itemNames[wonItem.item_code] || wonItem.item_name || wonItem.item_code;
    lines.push(`<p class="labexp-result-reward">${escapeHtml(name)} <span class="labexp-result-qty">×${wonItem.quantity ?? 1}</span></p>`);
  } else if ((tier.record_reward ?? 0) > 0) {
    lines.push(`<p class="labexp-result-reward">연구기록 +${tier.record_reward}</p>`);
  } else {
    lines.push('<p class="labexp-result-nodrop">이번엔 추가 보상이 없었습니다.</p>');
  }
  lines.push('</div>');

  if (data.newly_unlocked === true) {
    lines.push(`<p class="labexp-result-bonus">다음 스테이지가 해금되었다.</p>`);
  }

  lines.push(`<p class="labexp-result-daily">오늘 남은 탐험 ${data.remaining_today} / ${data.daily_limit}</p>`);

  body.innerHTML = lines.join('');
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── util ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

initPage();
