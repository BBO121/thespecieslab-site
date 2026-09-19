// DM/채팅 — 1단계: 헤더 아이콘 + unread 배지 + 패널 뼈대
//         2단계: 대화 목록 / 유저 검색 연결
// 이 파일은 notifications.js처럼 거의 모든 페이지에 공통 삽입되므로,
// 전역 함수/변수명은 다른 페이지 인라인 스크립트와 절대 겹치지 않도록 전부 dm 접두사를 붙인다.

let _dmChannel          = null;   // 전역 채널 — recipient_id=eq.<내 uid> 필터, 헤더 배지 전용 (5단계)
let _dmRoomChannel      = null;   // 현재 열려있는 방 전용 채널 — room_id=eq.<방> 필터, 메시지 목록 실시간 반영 (5단계)
let _dmDirectoryPromise = null;   // { id, nickname, avatar_url }[] 캐시 (페이지 1회 로드) — 기존 대화 상대 표시용

// ────────────────────────────────
// 헤더 아이콘 삽입 (1단계)
// ────────────────────────────────
function insertDmIcon() {
  const nav = document.querySelector('.header-nav');
  if (!nav || document.getElementById('dmIconWrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'dm-icon-wrap';
  wrap.id = 'dmIconWrap';
  wrap.innerHTML = `
    <button class="dm-icon-btn" id="dmIconBtn" onclick="toggleDmPanel(event)" aria-label="채팅" title="채팅">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      <span class="dm-badge" id="dmBadge" style="display:none">0</span>
    </button>
  `;
  // 알림벨(notif-bell-wrap)이 이미 prepend되어 있는 상태에서 다시 prepend →
  // DM 아이콘이 새 첫 번째 자식이 되어 벨의 바로 왼쪽에 위치하게 됨
  nav.prepend(wrap);

  // 모바일 헤더: 기존 mobileNotifBell 바로 앞에 삽입
  const headerInner = document.querySelector('.header-inner');
  if (headerInner && !document.getElementById('mobileDmIcon')) {
    const mobileBell = document.getElementById('mobileNotifBell');

    const mobileDm = document.createElement('a');
    mobileDm.id = 'mobileDmIcon';
    mobileDm.href = '#';
    mobileDm.className = 'mobile-dm-icon';
    mobileDm.setAttribute('aria-label', '채팅');
    mobileDm.addEventListener('click', (e) => { e.preventDefault(); toggleDmPanel(e); });
    mobileDm.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      <span class="dm-badge" id="mobileDmBadge" style="display:none">0</span>
    `;

    if (mobileBell) headerInner.insertBefore(mobileDm, mobileBell);
    else headerInner.appendChild(mobileDm);
  }
}

// ────────────────────────────────
// 패널 열기/닫기 (1단계)
// ────────────────────────────────
function ensureDmPanel() {
  if (document.getElementById('dmPanelOverlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'dm-panel-overlay';
  overlay.id = 'dmPanelOverlay';
  overlay.style.display = 'none';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDmPanel(); });

  overlay.innerHTML = `
    <aside class="dm-panel" id="dmPanel">
      <div class="dm-panel-header" id="dmPanelHeader"></div>
      <div class="dm-panel-body" id="dmPanelBody"></div>
      <input type="file" id="dmImageFileInput" accept="image/jpeg,image/png,image/webp,image/gif" multiple style="display:none;">
    </aside>
  `;
  const panelEl = overlay.querySelector('.dm-panel');
  panelEl.addEventListener('click', (e) => e.stopPropagation());

  document.body.appendChild(overlay);

  // .dm-panel 자체는 계속 유지되고 header/body 내용만 교체되므로, 여기 한 번만 델리게이트로
  // 붙여두면 첨부 메뉴(입력창 쪽)와 방 메뉴(헤더 ⋮) 둘 다 목록/방/피커 어느 화면이든 공통으로 동작한다.
  // 위의 stopPropagation 리스너와 같은 엘리먼트에 등록돼도, 같은 엘리먼트의 다른 리스너들은
  // 서로를 막지 않고 등록 순서대로 전부 실행된다 (stopPropagation은 "다른 엘리먼트로의 전파"만 막음).
  panelEl.addEventListener('click', (e) => {
    const attachMenu = document.getElementById('dmAttachMenu');
    if (attachMenu && attachMenu.style.display === 'block' && !e.target.closest('.dm-attach-menu-wrap')) {
      attachMenu.style.display = 'none';
    }
    const roomMenu = document.getElementById('dmRoomMenu');
    if (roomMenu && roomMenu.style.display === 'block' && !e.target.closest('.dm-room-menu-wrap')) {
      roomMenu.style.display = 'none';
    }
    // 메시지별 삭제 메뉴는 메시지 개수만큼 있을 수 있어 querySelectorAll로 열려있는 것만 찾아 닫음
    document.querySelectorAll('.dm-msg-menu').forEach(m => {
      if (m.style.display === 'block' && !e.target.closest('.dm-msg-menu-wrap')) {
        m.style.display = 'none';
      }
    });
  });

  // 파일 입력은 패널당 1개만 — dmOpenRoom이 반복 실행돼도 여기서 한 번만 리스너를 건다
  overlay.querySelector('#dmImageFileInput').addEventListener('change', (e) => {
    dmOnImageFilesSelected(e.target.files);
    e.target.value = '';   // 같은 파일을 다시 선택해도 change가 발생하도록 초기화
  });
}

async function toggleDmPanel(e) {
  if (e) e.stopPropagation();
  ensureDmPanel();
  const overlay = document.getElementById('dmPanelOverlay');
  const isOpen = overlay.style.display === 'flex';

  if (isOpen) {
    closeDmPanel();
    return;
  }

  const user = await getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  dmShowList();
}

function closeDmPanel() {
  const overlay = document.getElementById('dmPanelOverlay');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  // Esc/바깥 클릭으로 방을 보던 중 바로 닫는 경우까지 포함해, 방 채널이 남지 않도록 항상 정리
  dmTeardownRoomChannel();
  _dmCurrentRoomId = null;
  dmClearPendingImages();   // 전송 안 한 첨부 이미지가 남아있지 않도록
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const viewer = document.getElementById('dmImgViewerOverlay');
  if (viewer && viewer.style.display === 'flex') { dmCloseImageViewer(); return; }   // 뷰어가 열려있으면 뷰어만 먼저 닫음
  closeDmPanel();
});

// ────────────────────────────────
// unread 배지 (1단계)
// ────────────────────────────────
async function initDm() {
  const user = await getUser();
  if (!user) return;

  refreshDmUnread();

  _dmChannel = sb.channel(`dm_recipient_${user.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'dm_messages',
      filter: `recipient_id=eq.${user.id}`,
    }, () => refreshDmUnread())
    .subscribe();
}

async function refreshDmUnread() {
  const { data, error } = await sb.rpc('get_dm_unread_total');
  if (error) { console.warn('[DM] unread 조회 실패:', error); return; }

  const n = data || 0;
  const badge       = document.getElementById('dmBadge');
  const mobileBadge = document.getElementById('mobileDmBadge');

  if (badge) {
    badge.textContent  = n > 99 ? '99+' : n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }
  if (mobileBadge) {
    mobileBadge.textContent  = n > 99 ? '99+' : n;
    mobileBadge.style.display = n > 0 ? 'flex' : 'none';
  }
}

// ────────────────────────────────
// 공통 헬퍼 (2단계)
// ────────────────────────────────
function dmEscapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dmTimeAgoShort(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1)  return '방금';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}일`;
  const dt = new Date(dateStr);
  return `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}

// avatar_url은 user_profiles에서 그대로 읽어온 값이라 유저가 auth.updateUser()로 임의
// 문자열을 넣어뒀을 수 있음 — http/https 절대 URL인지 파싱 검증 후, 정규화된 href(따옴표 등
// 위험 문자가 자동으로 퍼센트 인코딩됨)를 다시 dmEscapeHtml로 감싸 속성 이스케이프를 이중 적용한다.
function dmSafeAvatarUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;   // 상대경로/깨진 문자열 등 절대 URL로 파싱 안 되면 무조건 fallback
  }
}

function dmAvatarHtml(nickname, avatarUrl, extraClass) {
  const cls = extraClass ? `dm-avatar ${extraClass}` : 'dm-avatar';
  const safeUrl = dmSafeAvatarUrl(avatarUrl);
  if (safeUrl) {
    return `<img src="${dmEscapeHtml(safeUrl)}" class="${cls}" alt="">`;
  }
  const initial = dmEscapeHtml((nickname || '?').charAt(0).toUpperCase());
  return `<div class="${cls} dm-avatar--fallback">${initial}</div>`;
}

// user_profiles(최신 닉네임/아바타) + get_all_users_full(아이디, user_profiles 없는 유저 fallback) 병합
// 패널을 열 때만 최초 1회 로드하고 페이지 내에서 재사용.
// 기존 대화방 목록(내가 이미 대화 중인 상대)의 닉네임/아바타 표시 전용 — 새 대화 상대
// "검색"은 전체 목록을 여기서 걸러내지 않고 search_users()로 서버에서 처리한다(dmSearchUsers).
function dmLoadUserDirectory() {
  if (!_dmDirectoryPromise) {
    _dmDirectoryPromise = Promise.all([
      sb.rpc('get_all_users_full'),
      sb.from('user_profiles').select('user_id, nickname, avatar_url'),
    ]).then(([full, profiles]) => {
      const profileMap = new Map((profiles.data || []).map(p => [p.user_id, p]));
      return (full.data || []).map(u => {
        const p = profileMap.get(u.id);
        return {
          id: u.id,
          nickname: (p && p.nickname) || u.nickname || '(알수없음)',
          avatar_url: p ? p.avatar_url : null,
        };
      });
    }).catch((err) => {
      console.warn('[DM] 유저 목록 로드 실패:', err);
      _dmDirectoryPromise = null;
      return [];
    });
  }
  return _dmDirectoryPromise;
}

// ────────────────────────────────
// 목록 화면 (2단계) — dmShowList()는 3단계에서 방 상태 초기화가 추가되어 아래쪽에 정의됨
// ────────────────────────────────
async function dmLoadRoomList() {
  const listEl = document.getElementById('dmRoomList');
  if (!listEl) return;

  const user = await getUser();
  if (!user) return;

  const [{ data: rooms, error }, directory, { data: myBlocks }] = await Promise.all([
    sb.from('dm_rooms')
      .select('id, user_a_id, user_b_id, last_message_at, last_message_type, last_message_preview')
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
      .order('last_message_at', { ascending: false, nullsFirst: false }),
    dmLoadUserDirectory(),
    // dm_blocks SELECT는 blocker_id=auth.uid() 행만 보이므로 "내가 차단한 상대" 목록만 얻어짐
    sb.from('dm_blocks').select('blocked_id').eq('blocker_id', user.id),
  ]);

  // 렌더 중 패널이 닫히거나 다른 화면으로 전환됐을 수 있으므로 재확인
  if (!document.getElementById('dmRoomList')) return;

  if (error) {
    listEl.innerHTML = '<p class="dm-panel-placeholder">대화 목록을 불러오지 못했어요.</p>';
    return;
  }
  if (!rooms || rooms.length === 0) {
    listEl.innerHTML = '<p class="dm-panel-placeholder">아직 대화가 없어요.<br>위 검색으로 연구원을 찾아 채팅을 시작해보세요.</p>';
    return;
  }

  const dirMap = new Map(directory.map(u => [u.id, u]));
  const blockedSet = new Set((myBlocks || []).map(b => b.blocked_id));
  const unreadCounts = await Promise.all(
    rooms.map(r => sb.rpc('get_dm_room_unread', { p_room_id: r.id }).then(res => res.data || 0))
  );

  if (!document.getElementById('dmRoomList')) return;

  listEl.innerHTML = rooms.map((r, i) => {
    const otherId    = r.user_a_id === user.id ? r.user_b_id : r.user_a_id;
    const other      = dirMap.get(otherId) || { nickname: '(알수없음)', avatar_url: null };
    const unread     = unreadCounts[i] || 0;
    const preview    = dmEscapeHtml(r.last_message_preview || '대화를 시작해보세요');
    const time       = r.last_message_at ? dmTimeAgoShort(r.last_message_at) : '';
    const isBlocked  = blockedSet.has(otherId);

    // 차단해도 기존 대화방은 목록에서 그대로 유지 — 옆에 작은 상태 표시만 추가
    return `
      <div class="dm-room-item" onclick="dmOpenRoom(${r.id}, '${otherId}')">
        ${dmAvatarHtml(other.nickname, other.avatar_url)}
        <div class="dm-room-info">
          <div class="dm-room-top">
            <span class="dm-room-name">${dmEscapeHtml(other.nickname)}${isBlocked ? ' <span class="dm-room-blocked-tag">차단됨</span>' : ''}</span>
            <span class="dm-room-time">${time}</span>
          </div>
          <div class="dm-room-bottom">
            <span class="dm-room-preview">${preview}</span>
            ${unread > 0 ? `<span class="dm-room-unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ────────────────────────────────
// 유저 검색 (2단계)
// ────────────────────────────────
let _dmSearchDebounce = null;
function dmOnSearchInput(q) {
  clearTimeout(_dmSearchDebounce);
  _dmSearchDebounce = setTimeout(() => dmSearchUsers(q), 150);
}

async function dmSearchUsers(q) {
  const resultsEl    = document.getElementById('dmSearchResults');
  const listSection  = document.getElementById('dmRoomListSection');
  if (!resultsEl || !listSection) return;

  const query = q.trim();
  if (!query) {
    resultsEl.style.display = 'none';
    listSection.style.display = '';
    return;
  }

  listSection.style.display = 'none';
  resultsEl.style.display   = 'block';
  resultsEl.innerHTML = '<p class="dm-panel-placeholder">검색 중...</p>';

  // js/search.js의 searchUsers()가 쓰는 것과 동일한 search_users RPC를 직접 호출한다
  // (search.js는 이 파일이 로드되는 모든 페이지에는 없어서, 새로 의존시키는 대신
  // 이미 로그인 화면 어디서나 쓸 수 있는 sb.rpc를 그대로 사용 — RPC 자체는 공용)
  const [user, { data, error }] = await Promise.all([
    getUser(),
    sb.rpc('search_users', { p_query: query, p_limit: 30 }),
  ]);
  if (!document.getElementById('dmSearchResults')) return;
  if (error) { console.warn('[DM] 유저 검색 실패:', error); dmRenderUserResults([]); return; }

  dmRenderUserResults((data || []).filter(u => u.id !== user.id));
}

function dmRenderUserResults(list) {
  const resultsEl = document.getElementById('dmSearchResults');
  if (!resultsEl) return;

  if (!list.length) {
    resultsEl.innerHTML = '<p class="dm-panel-placeholder">검색 결과가 없어요.</p>';
    return;
  }

  resultsEl.innerHTML = list.map(u => `
    <div class="dm-user-item" onclick="dmStartOrOpenRoom('${u.id}')">
      ${dmAvatarHtml(u.nickname, u.avatar_url)}
      <div class="dm-user-info">
        <span class="dm-user-nickname">${dmEscapeHtml(u.nickname)}</span>
      </div>
    </div>
  `).join('');
}

async function dmStartOrOpenRoom(otherUserId) {
  const { data: roomId, error } = await sb.rpc('get_or_create_dm_room', { p_other_user_id: otherUserId });
  if (error) {
    console.warn('[DM] 채팅 시작 실패:', error);
    // RPC가 차단(양방향) 때문에 실패해도, 어느 쪽이 누구를 차단했는지는 밝히지 않고 일반 안내만 표시
    alert(dmIsBlockRelatedError(error) ? '현재 이 사용자와 채팅을 시작할 수 없습니다.' : '채팅을 시작할 수 없어요.');
    return;
  }
  dmOpenRoom(roomId, otherUserId);
}

// ────────────────────────────────
// 개별 대화방 화면 (3~4단계 — Realtime 수신은 다음 단계에서 연결)
// ────────────────────────────────
const MAX_DM_CONTENT_LENGTH = 2000;
const MAX_DM_IMAGE_COUNT    = 5;    // 메시지 1건에 첨부 가능한 최대 이미지 장수 (8단계)
const DM_SIGNED_URL_TTL     = 3600; // 첨부 이미지 signed URL 유효시간(초)
let _dmCurrentRoomId  = null;
let _dmSending        = false;
let _dmPendingImages  = [];   // 전송 대기 중인 첨부 이미지 { id, blob, mime, ext, width, height, previewUrl }
let _dmIsBlockedByMe  = false; // 현재 방 상대를 "내가" 차단했는지 (9단계) — 상대가 나를 차단했는지는 절대 조회하지 않음

function dmShowList() {
  dmTeardownRoomChannel();   // 방을 보다가 목록으로 돌아가는 경우 — 방 전용 채널 해제
  _dmCurrentRoomId = null;   // 목록으로 돌아가면 이전 방의 비동기 콜백이 더 이상 화면에 반영되지 않도록
  dmClearPendingImages();    // 전송 안 한 첨부 이미지가 남아있지 않도록

  const header = document.getElementById('dmPanelHeader');
  const body   = document.getElementById('dmPanelBody');
  if (!header || !body) return;

  header.innerHTML = `
    <span class="dm-panel-title">채팅</span>
    <button class="dm-panel-close-btn" onclick="closeDmPanel()" aria-label="닫기">✕</button>
  `;
  body.innerHTML = `
    <div class="dm-search-wrap">
      <input type="text" id="dmSearchInput" class="dm-search-input" placeholder="🔍 연구원 검색" oninput="dmOnSearchInput(this.value)">
    </div>
    <div id="dmSearchResults" class="dm-search-results" style="display:none;"></div>
    <div id="dmRoomListSection">
      <p class="dm-section-label">최근 채팅</p>
      <div id="dmRoomList" class="dm-room-list">
        <p class="dm-panel-placeholder">불러오는 중...</p>
      </div>
    </div>
  `;
  dmLoadRoomList();
}

async function dmOpenRoom(roomId, otherUserId) {
  const header = document.getElementById('dmPanelHeader');
  const body   = document.getElementById('dmPanelBody');
  if (!header || !body) return;

  dmClearPendingImages();   // 이전 방/화면에 남아있던 첨부 대기 이미지 정리
  _dmCurrentRoomId  = roomId;
  _dmIsBlockedByMe  = false;   // 방마다 새로 확인 — 아래에서 실제 값으로 갱신됨

  const [directory, isBlocked] = await Promise.all([
    dmLoadUserDirectory(),
    dmCheckIBlocked(otherUserId),
  ]);
  if (_dmCurrentRoomId !== roomId || !document.getElementById('dmPanelHeader')) return;

  _dmIsBlockedByMe = isBlocked;

  const other = directory.find(u => u.id === otherUserId) || { nickname: '(알수없음)', avatar_url: null };

  header.innerHTML = `
    <button class="dm-back-btn" onclick="dmShowList()" aria-label="목록으로">‹</button>
    <div class="dm-room-header-user">
      ${dmAvatarHtml(other.nickname, other.avatar_url, 'dm-avatar--sm')}
      <span class="dm-panel-title">${dmEscapeHtml(other.nickname)}</span>
    </div>
    <div class="dm-room-menu-wrap">
      <button class="dm-room-menu-btn" onclick="dmToggleRoomMenu(event)" aria-label="메뉴">⋮</button>
      <div class="dm-room-menu" id="dmRoomMenu" style="display:none;">
        <button type="button" class="dm-room-menu-item" id="dmBlockMenuItem" onclick="dmConfirmToggleBlock()">${_dmIsBlockedByMe ? '차단 해제' : '사용자 차단'}</button>
      </div>
    </div>
  `;
  body.innerHTML = `
    <div class="dm-messages" id="dmMessages">
      <p class="dm-panel-placeholder">불러오는 중...</p>
    </div>
    <div class="dm-pending-images" id="dmPendingImages" style="display:none;"></div>
    <p class="dm-block-notice" id="dmBlockNotice" style="display:none;">차단한 사용자에게는 메시지를 보낼 수 없습니다.</p>
    <div class="dm-input-area">
      <div class="dm-attach-menu-wrap">
        <button type="button" class="dm-attach-btn" id="dmAttachBtn" onclick="dmToggleAttachMenu(event)" aria-label="공유">+</button>
        <div class="dm-attach-menu" id="dmAttachMenu" style="display:none;">
          <button type="button" class="dm-attach-menu-item" onclick="dmTriggerImagePick()">사진 첨부</button>
          <button type="button" class="dm-attach-menu-item" onclick="dmOpenPicker('character')">개체 불러오기</button>
          <button type="button" class="dm-attach-menu-item" onclick="dmOpenPicker('species')">종족 불러오기</button>
          <button type="button" class="dm-attach-menu-item" onclick="dmOpenPicker('adoption')">분양글 불러오기</button>
        </div>
      </div>
      <textarea id="dmMsgInput" class="dm-msg-input" placeholder="메시지를 입력하세요..." rows="1"
        maxlength="${MAX_DM_CONTENT_LENGTH}"
        oninput="dmOnInputChange(this)" onkeydown="dmOnInputKeyDown(event)"></textarea>
      <button class="dm-send-btn" id="dmSendBtn" onclick="dmSendMessage()" disabled aria-label="전송">↑</button>
    </div>
  `;
  body.dataset.roomId = roomId;
  body.dataset.otherUserId = otherUserId;

  dmApplyBlockUiState();   // 메시지를 불러오기 전에 입력창 상태부터 즉시 맞춤 (깜빡임 방지)

  await dmLoadMessages(roomId);
  if (_dmCurrentRoomId !== roomId) return;   // 로딩 중 다른 방/목록으로 이동했으면 구독·읽음처리 생략

  dmMarkRoomRead(roomId);
  dmSubscribeRoom(roomId);
}

async function dmLoadMessages(roomId) {
  const area = document.getElementById('dmMessages');
  if (!area) return;

  const user = await getUser();
  if (!user) return;

  const { data: msgs, error } = await sb
    .from('dm_messages')
    .select('id, sender_id, message_type, content, reference_type, reference_id, created_at, deleted_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });

  // 조회하는 동안 다른 방으로 전환됐거나 패널이 닫혔으면 결과를 버림
  if (_dmCurrentRoomId !== roomId || !document.getElementById('dmMessages')) return;

  if (error) {
    area.innerHTML = '<p class="dm-panel-placeholder">메시지를 불러오지 못했어요.</p>';
    return;
  }
  if (!msgs || msgs.length === 0) {
    area.innerHTML = '<p class="dm-panel-placeholder">첫 메시지를 보내보세요.</p>';
    return;
  }

  // reference 메시지가 가리키는 개체/종족/분양글, image 메시지의 첨부를 각각 한 번에 모아 일괄 조회
  // (메시지 개수만큼 개별 쿼리를 날리는 N+1 방식 방지)
  const refPairs = [];
  const seenRef  = new Set();
  const imageMsgIds = [];
  msgs.forEach(m => {
    if (m.deleted_at) return;
    if (m.message_type === 'reference' && m.reference_type && m.reference_id != null) {
      const key = `${m.reference_type}:${m.reference_id}`;
      if (!seenRef.has(key)) { seenRef.add(key); refPairs.push({ type: m.reference_type, id: m.reference_id }); }
    } else if (m.message_type === 'image') {
      imageMsgIds.push(m.id);
    }
  });
  const [refDataMap, attachMap] = await Promise.all([
    dmFetchReferenceRows(refPairs),
    dmFetchAttachmentsForMessages(imageMsgIds),
  ]);
  if (_dmCurrentRoomId !== roomId || !document.getElementById('dmMessages')) return;

  area.innerHTML = msgs.map(m => dmRenderMessageRow(m, user.id, refDataMap, attachMap)).join('');
  dmScrollToBottom();
}

// content는 반드시 escape 후 삽입 — \n → <br> 치환은 escape 이후에만 수행해야
// 치환으로 생긴 실제 <br> 태그가 다시 이스케이프되지 않는다
function dmRenderMessageRow(m, myId, refDataMap, attachMap) {
  const isMine = m.sender_id === myId;
  const time   = new Date(m.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  let bodyHtml;
  let bubbleClass = isMine ? 'dm-msg-bubble--mine' : 'dm-msg-bubble--theirs';

  if (m.deleted_at) {
    bubbleClass = 'dm-msg-bubble--deleted';
    bodyHtml = '삭제된 메시지입니다.';
  } else if (m.message_type === 'text') {
    bodyHtml = dmEscapeHtml(m.content).replace(/\n/g, '<br>');
  } else if (m.message_type === 'reference') {
    bubbleClass = 'dm-msg-bubble--reference';
    bodyHtml = dmRenderReferenceCard(m.reference_type, m.reference_id, refDataMap);
  } else if (m.message_type === 'image') {
    bubbleClass = 'dm-msg-bubble--image';
    bodyHtml = dmRenderImageGrid(attachMap ? (attachMap.get(m.id) || []) : []);
  } else {
    // system은 다음 단계에서 연결 — 지금은 텍스트/reference/image만 렌더링
    bodyHtml = '<span class="dm-msg-unsupported">[지원 예정인 메시지 형식]</span>';
  }

  // 삭제 메뉴는 "내가 보낸, 아직 삭제되지 않은" 메시지에만 표시. system은 현재 미사용이지만
  // 혹시 렌더링되더라도 일반 유저가 삭제할 수 없도록 명시적으로 제외
  const canDelete = isMine && !m.deleted_at && m.message_type !== 'system';
  const menuHtml = canDelete ? `
    <div class="dm-msg-menu-wrap">
      <button type="button" class="dm-msg-menu-btn" onclick="dmToggleMsgMenu(event, ${m.id})" aria-label="메시지 메뉴">⋯</button>
      <div class="dm-msg-menu" id="dmMsgMenu_${m.id}" style="display:none;">
        <button type="button" class="dm-msg-menu-item" onclick="dmConfirmDeleteMessage(${m.id})">메시지 삭제</button>
      </div>
    </div>
  ` : '';

  return `
    <div class="dm-msg-row${isMine ? ' dm-msg-row--mine' : ''}" data-msg-id="${m.id}">
      <div class="dm-msg-bubble ${bubbleClass}">${bodyHtml}</div>
      <div class="dm-msg-meta">
        <span class="dm-msg-time">${time}</span>
        ${menuHtml}
      </div>
    </div>
  `;
}

// myId를 항상 명시적으로 받는다 — msg.sender_id를 myId로 대신 쓰면(예전 방식) 상대가 보낸
// 메시지를 렌더링할 때도 "내 메시지"로 잘못 판정되므로 반드시 실제 현재 로그인 유저 id를 넘겨야 함
function dmAppendMessage(msg, myId, refDataMap, attachMap) {
  const area = document.getElementById('dmMessages');
  if (!area) return;
  const empty = area.querySelector('.dm-panel-placeholder');
  if (empty) empty.remove();
  area.insertAdjacentHTML('beforeend', dmRenderMessageRow(msg, myId, refDataMap, attachMap));
}

function dmScrollToBottom() {
  const area = document.getElementById('dmMessages');
  if (area) area.scrollTop = area.scrollHeight;
}

// 스크롤 위치가 "하단 근처"인지 — 실시간 수신 시 자동 스크롤 여부 판단용
function dmIsNearBottom(area) {
  const threshold = 80;
  return area.scrollHeight - area.scrollTop - area.clientHeight < threshold;
}

function dmOnInputChange(el) {
  dmAutoResize(el);
  dmUpdateSendBtnState();
}

// 텍스트/첨부 이미지 어느 쪽이든 하나라도 있으면 전송 버튼 활성화 — 이미지 첨부 목록이
// 바뀔 때(dmRenderPendingImages 등)도 이 함수를 같이 호출해 상태를 맞춘다
function dmUpdateSendBtnState() {
  const btn   = document.getElementById('dmSendBtn');
  const input = document.getElementById('dmMsgInput');
  if (!btn) return;
  const hasText   = !!(input && input.value.trim());
  const hasImages = _dmPendingImages.length > 0;
  btn.disabled = (!hasText && !hasImages) || _dmSending;
}

function dmAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function dmOnInputKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const btn = document.getElementById('dmSendBtn');
    if (btn && !btn.disabled) dmSendMessage();
  }
}

// 첨부 대기 중인 이미지가 있으면 이미지 전송이 우선 — 텍스트와 이미지를 한 메시지로 섞어 보내지 않음
// (입력창에 남은 텍스트는 지우지 않고 그대로 둬서, 이미지 전송 후 이어서 별도 텍스트 메시지로 보낼 수 있게 함)
async function dmSendMessage() {
  if (_dmPendingImages.length > 0) { dmSendImages(); return; }
  if (_dmSending) return;   // 중복 클릭/Enter 방어 (1차)

  const roomId = _dmCurrentRoomId;
  const input  = document.getElementById('dmMsgInput');
  const btn    = document.getElementById('dmSendBtn');
  if (!roomId || !input) return;

  const content = input.value.trim();
  if (!content) return;                          // 공백만 있는 메시지 전송 불가
  if (content.length > MAX_DM_CONTENT_LENGTH) {   // UI 단 길이 제한 (DB CHECK가 최종 방어선)
    alert(`메시지는 최대 ${MAX_DM_CONTENT_LENGTH}자까지 보낼 수 있어요.`);
    return;
  }

  const user = await getUser();
  if (!user) return;

  _dmSending = true;    // 중복 클릭/Enter 방어 (2차 — 버튼 disabled와 별개로 함수 자체도 잠금)
  if (btn) btn.disabled = true;

  // recipient_id는 절대 클라이언트에서 계산/전송하지 않음 — dm_messages_before_insert 트리거가
  // room_id를 기준으로 서버에서 강제로 채움 (dm_setup.sql 3절 참고)
  const { data: inserted, error } = await sb
    .from('dm_messages')
    .insert({
      room_id:      roomId,
      sender_id:    user.id,
      message_type: 'text',
      content,
    })
    .select('id, sender_id, message_type, content, reference_type, reference_id, created_at, deleted_at')
    .single();

  _dmSending = false;

  if (error) {
    console.warn('[DM] 메시지 전송 실패:', error);
    // RLS INSERT 거부(상대가 나를 차단한 경우 포함) — 내부 사유는 노출하지 않고 일반 안내만
    alert(dmIsBlockRelatedError(error) ? '현재 이 사용자에게 메시지를 보낼 수 없습니다.' : '메시지 전송에 실패했어요.');
    if (btn) btn.disabled = !input.value.trim();
    return;
  }

  input.value = '';
  input.style.height = '';
  if (btn) btn.disabled = true;

  if (_dmCurrentRoomId === roomId) {
    dmAppendMessage(inserted, user.id);
    dmScrollToBottom();
  }
  // 이 메시지는 room 채널로도 곧 들어오지만, data-msg-id 기준 중복 방지로 다시 그려지지 않는다
}

async function dmMarkRoomRead(roomId) {
  const { error } = await sb.rpc('mark_dm_room_read', { p_room_id: roomId });
  if (error) { console.warn('[DM] 읽음 처리 실패:', error); return; }
  refreshDmUnread();   // 헤더 전체 unread 배지 갱신. 방 목록의 방별 unread는 다음에 목록으로 돌아갈 때 재조회되어 갱신됨
}

// ────────────────────────────────
// Realtime — 현재 방 전용 구독 (5단계)
//
// 전역 채널(_dmChannel, initDm)과 역할 분리:
//   - 전역 채널: filter recipient_id=eq.<내 uid> → 내가 "받는" 모든 방의 새 메시지에 반응, 헤더 배지만 갱신
//   - 방 채널(이 아래):  filter room_id=eq.<지금 열린 방> → 그 방의 모든 INSERT(내가 보낸 것 포함)에 반응,
//                        화면에 말풍선을 추가하는 유일한 통로
// 두 채널은 서로 다른 필터라 이벤트를 "가로채는" 관계가 아니라, 내가 보낸 메시지가 방 채널에도
// 다시 들어오는 것 정도가 유일한 중복 지점이며 이는 data-msg-id 중복 방지로 흡수한다.
// ────────────────────────────────
function dmTeardownRoomChannel() {
  if (_dmRoomChannel) {
    sb.removeChannel(_dmRoomChannel);
    _dmRoomChannel = null;
  }
}

function dmSubscribeRoom(roomId) {
  dmTeardownRoomChannel();   // 이전 방 구독이 남아있다면 먼저 해제 후 교체 (channel 중복 방지)

  _dmRoomChannel = sb.channel(`dm_room_${roomId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'dm_messages',
      filter: `room_id=eq.${roomId}`,
    }, (payload) => dmHandleRoomInsert(payload.new, roomId))
    // 상대가 자기 메시지를 soft delete하면 dm_messages UPDATE로 들어옴 (10단계).
    // dm_messages_restrict_update 트리거가 deleted_at 세팅 외의 UPDATE를 전부 막고 있으므로,
    // 이 테이블에서 발생하는 UPDATE는 항상 "메시지가 삭제됐다"는 뜻 — old/new 값을 비교할 필요 없음.
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'dm_messages',
      filter: `room_id=eq.${roomId}`,
    }, (payload) => dmHandleRoomUpdate(payload.new, roomId))
    .subscribe();
}

// 새 메시지가 아니라 기존 말풍선을 "삭제됨" 상태로 바꾸는 것뿐이므로 unread 증가, mark_dm_room_read,
// 자동 스크롤, 새 말풍선 생성 중 어느 것도 하지 않는다 — 오직 기존 DOM 교체만 수행
function dmHandleRoomUpdate(newRow, roomId) {
  if (_dmCurrentRoomId !== roomId) return;
  if (!newRow || !newRow.deleted_at) return;   // 방어적 체크(항상 참이어야 정상) — 그 외 UPDATE는 무시
  dmMarkMessageDeletedInDom(newRow.id);
}

async function dmHandleRoomInsert(msg, roomId) {
  // 구독 해제 타이밍 사이에 옛 채널에서 이벤트가 들어온 경우 방어
  if (_dmCurrentRoomId !== roomId) return;

  const area = document.getElementById('dmMessages');
  if (!area) return;   // 피커 화면 등으로 메시지 목록이 잠시 없는 상태 — 방으로 돌아오면 재조회로 자연 반영됨

  // id 기준 중복 방지 — 내가 보낸 메시지는 전송 성공 시 이미 렌더링되어 있으므로 다시 그리지 않음.
  // sender_id 비교만으로는 "이미 그렸는지"를 알 수 없어 id로 한 번 더 확인한다.
  if (area.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const user = await getUser();
  if (!user || _dmCurrentRoomId !== roomId) return;

  // reference 메시지면 대상 데이터를 먼저 조회 (단건 — 목록 일괄조회와 같은 헬퍼 재사용)
  let refDataMap = null;
  if (msg.message_type === 'reference' && msg.reference_type && msg.reference_id != null) {
    refDataMap = await dmFetchReferenceRows([{ type: msg.reference_type, id: msg.reference_id }]);
    if (_dmCurrentRoomId !== roomId || area.querySelector(`[data-msg-id="${msg.id}"]`)) return;
  }

  // image 메시지: dm_messages INSERT 이벤트가 dm_message_attachments INSERT보다 먼저 도착할 수 있음(경쟁 상태).
  // 첨부가 아직 없으면 즉시 "만료됨"으로 단정하지 않고, attachment INSERT 이벤트를 짧게 기다렸다가 다시 조회한다.
  let attachMap = null;
  if (msg.message_type === 'image') {
    attachMap = await dmFetchAttachmentsForMessages([msg.id]);
    if (_dmCurrentRoomId !== roomId || area.querySelector(`[data-msg-id="${msg.id}"]`)) return;

    if ((attachMap.get(msg.id) || []).length === 0) {
      await dmWaitForAttachments(msg.id, 8000);   // polling 대신 postgres_changes 이벤트를 기다림 (최대 8초)
      if (_dmCurrentRoomId !== roomId || area.querySelector(`[data-msg-id="${msg.id}"]`)) return;
      attachMap = await dmFetchAttachmentsForMessages([msg.id]);
      if (_dmCurrentRoomId !== roomId || area.querySelector(`[data-msg-id="${msg.id}"]`)) return;
    }
  }

  const wasNearBottom = dmIsNearBottom(area);

  dmAppendMessage(msg, user.id, refDataMap, attachMap);

  if (wasNearBottom) dmScrollToBottom();   // 하단 근처였을 때만 자동 스크롤, 과거 대화 보던 중이면 위치 유지

  if (msg.sender_id === user.id) return;   // 내가 보낸 메시지 자체는 읽음 처리 대상 아님

  // 탭이 실제로 보이는 상태일 때만 즉시 읽음 처리 — 백그라운드 탭에서 조용히 읽음 처리되는 것 방지
  if (document.visibilityState === 'visible') {
    dmMarkRoomRead(roomId);
  }
}

// 탭이 숨겨진 동안 수신한 메시지는 unread로 남아있다가, 실제로 다시 보게 되면 그때 읽음 처리
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!_dmCurrentRoomId) return;
  const overlay = document.getElementById('dmPanelOverlay');
  if (overlay && overlay.style.display === 'flex') {
    dmMarkRoomRead(_dmCurrentRoomId);
  }
});

// ────────────────────────────────
// 개체/종족/분양글 공유 (7단계) — 이미지 첨부는 다음 단계
// ────────────────────────────────
const DM_REF_LABELS = { character: '개체', species: '종족', adoption: '분양글' };
const DM_REF_LINKS  = { character: 'character.html?id=', species: 'species.html?id=', adoption: 'adoption-detail.html?id=' };

// pairs: [{type, id}, ...] (중복 제거된 상태로 호출) → Map('type:id' → row | null)
// null은 "조회는 했지만 존재하지 않음(삭제됨/확인불가)"을 의미 — 구분해서 fallback 카드에 사용
async function dmFetchReferenceRows(pairs) {
  const map = new Map();
  if (!pairs.length) return map;

  const byType = { character: [], species: [], adoption: [] };
  pairs.forEach(p => { if (byType[p.type]) byType[p.type].push(p.id); });

  const [charRes, spRes, adRes] = await Promise.all([
    byType.character.length
      ? sb.from('characters').select('id, name, species_name, image_url, thumbnail_url, default_image_index, char_number').in('id', byType.character)
      : Promise.resolve({ data: [] }),
    byType.species.length
      ? sb.from('species').select('id, name, owner_nickname, image_url, thumbnail_url, default_image_index').in('id', byType.species)
      : Promise.resolve({ data: [] }),
    byType.adoption.length
      ? sb.from('adoptions').select('id, character_name, species_name, image_url, thumbnail_url, status').in('id', byType.adoption)
      : Promise.resolve({ data: [] }),
  ]);

  // 조회 대상 전부를 우선 null로 채운 뒤, 실제로 찾은 것만 덮어씀 → "삭제됨"과 "아직 조회 안 함"을 구분
  byType.character.forEach(id => map.set(`character:${id}`, null));
  byType.species.forEach(id => map.set(`species:${id}`, null));
  byType.adoption.forEach(id => map.set(`adoption:${id}`, null));

  (charRes.data || []).forEach(r => map.set(`character:${r.id}`, r));
  (spRes.data  || []).forEach(r => map.set(`species:${r.id}`, r));
  (adRes.data  || []).forEach(r => map.set(`adoption:${r.id}`, r));

  return map;
}

// 카드 표시용 데이터는 매번 위 함수로 "지금 시점" DB에서 새로 읽어온다 — 메시지에는
// reference_type/reference_id만 저장되어 있고 이름/이미지/상태 등은 절대 복제 저장하지 않음
function dmRenderReferenceCard(type, id, refDataMap) {
  const key  = `${type}:${id}`;
  const data = refDataMap ? refDataMap.get(key) : undefined;

  if (!data) {
    return `
      <div class="dm-ref-card dm-ref-card--missing">
        <span class="dm-ref-missing-text">삭제되었거나 확인할 수 없는 항목입니다.</span>
      </div>
    `;
  }

  const img = type === 'character' ? resolveCharacterImage(data)
            : type === 'species'   ? resolveSpeciesImage(data)
            : (data.thumbnail_url || data.image_url || '');
  const thumbHtml = img
    ? `<img src="${dmEscapeHtml(img)}" class="dm-ref-thumb" alt="">`
    : `<div class="dm-ref-thumb dm-ref-thumb--empty"></div>`;

  let rawTitle, rawSub;
  if (type === 'character') {
    rawTitle = (data.name || '(이름 없음)') + (data.char_number != null ? ` - ${data.char_number}` : '');
    rawSub   = data.species_name || '';
  } else if (type === 'species') {
    rawTitle = data.name || '(이름 없음)';
    rawSub   = data.owner_nickname ? `종족주 : ${data.owner_nickname}` : '';
  } else {
    rawTitle = data.character_name || '(제목 없음)';
    rawSub   = data.status || '';
  }

  // 상세 페이지 이동은 사이트 전역에서 쓰는 것과 동일한 ?id= 쿼리 파라미터 방식 그대로 사용
  const href = `${DM_REF_LINKS[type]}${id}`;

  return `
    <a class="dm-ref-card" href="${href}">
      ${thumbHtml}
      <div class="dm-ref-info">
        <span class="dm-ref-type">${DM_REF_LABELS[type]}</span>
        <span class="dm-ref-title">${dmEscapeHtml(rawTitle)}</span>
        ${rawSub ? `<span class="dm-ref-sub">${dmEscapeHtml(rawSub)}</span>` : ''}
      </div>
    </a>
  `;
}

function dmToggleAttachMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('dmAttachMenu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

let _dmPickerKind      = null;   // 'character' | 'species' | 'adoption'
let _dmPickerScope     = 'all';  // 'mine' | 'all' — character/adoption만 사용, species는 항상 'all'
let _dmPickerDebounce  = null;

function dmOpenPicker(kind) {
  const menu = document.getElementById('dmAttachMenu');
  if (menu) menu.style.display = 'none';
  if (!_dmCurrentRoomId) return;
  // + 버튼 자체가 disabled로 막혀있지만, 만일을 대비한 이중 방어
  if (_dmIsBlockedByMe) { alert('차단한 사용자에게는 메시지를 보낼 수 없습니다.'); return; }

  _dmPickerKind  = kind;
  _dmPickerScope = kind === 'species' ? 'all' : 'mine';

  const header = document.getElementById('dmPanelHeader');
  const body   = document.getElementById('dmPanelBody');
  if (!header || !body) return;

  const titleMap  = { character: '개체 불러오기', species: '종족 불러오기', adoption: '분양글 불러오기' };
  const placeholderMap = { character: '개체명 / 종족명 / 개체번호 검색', species: '종족명 검색', adoption: '개체명 / 종족명 검색' };

  header.innerHTML = `
    <button class="dm-back-btn" onclick="dmClosePicker()" aria-label="뒤로">‹</button>
    <span class="dm-panel-title">${titleMap[kind]}</span>
    <span style="width:30px;"></span>
  `;

  const tabsHtml = kind === 'species' ? '' : `
    <div class="dm-picker-tabs">
      <button type="button" class="dm-picker-tab dm-picker-tab--active" data-scope="mine" onclick="dmSetPickerScope('mine')">${kind === 'character' ? '내 개체' : '내 분양글'}</button>
      <button type="button" class="dm-picker-tab" data-scope="all" onclick="dmSetPickerScope('all')">${kind === 'character' ? '전체 개체' : '전체 분양글'}</button>
    </div>
  `;

  body.innerHTML = `
    <div class="dm-search-wrap">
      <input type="text" id="dmPickerSearch" class="dm-search-input" placeholder="${placeholderMap[kind]}" oninput="dmOnPickerSearchInput(this.value)">
    </div>
    ${tabsHtml}
    <div id="dmPickerList" class="dm-picker-list">
      <p class="dm-panel-placeholder">불러오는 중...</p>
    </div>
  `;

  dmLoadPickerList('');
}

function dmSetPickerScope(scope) {
  _dmPickerScope = scope;
  document.querySelectorAll('.dm-picker-tab').forEach(btn => {
    btn.classList.toggle('dm-picker-tab--active', btn.dataset.scope === scope);
  });
  const searchEl = document.getElementById('dmPickerSearch');
  dmLoadPickerList(searchEl ? searchEl.value : '');
}

function dmOnPickerSearchInput(q) {
  clearTimeout(_dmPickerDebounce);
  _dmPickerDebounce = setTimeout(() => dmLoadPickerList(q), 200);
}

async function dmLoadPickerList(q) {
  const kind   = _dmPickerKind;
  const listEl = document.getElementById('dmPickerList');
  if (!kind || !listEl) return;

  listEl.innerHTML = '<p class="dm-panel-placeholder">불러오는 중...</p>';

  const user = await getUser();
  if (!user) return;
  if (_dmPickerKind !== kind || !document.getElementById('dmPickerList')) return;

  const query = q.trim();
  let items = [];

  try {
    if (kind === 'character') {
      let sel = sb.from('characters')
        .select('id, name, species_name, image_url, thumbnail_url, default_image_index, char_number, owner_user_id');
      if (_dmPickerScope === 'mine') sel = sel.eq('owner_user_id', user.id);
      if (query) {
        const orParts = [`name.ilike.%${query}%`, `species_name.ilike.%${query}%`];
        if (/^\d+$/.test(query)) orParts.push(`char_number.eq.${query}`);
        sel = sel.or(orParts.join(','));
      }
      const { data, error } = await sel.order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      items = data || [];
    } else if (kind === 'species') {
      let sel = sb.from('species').select('id, name, owner_nickname, image_url, thumbnail_url, default_image_index');
      if (query) sel = sel.ilike('name', `%${query}%`);
      const { data, error } = await sel.order('name', { ascending: true }).limit(30);
      if (error) throw error;
      items = data || [];
    } else if (kind === 'adoption') {
      let sel = sb.from('adoptions')
        .select('id, character_name, species_name, image_url, thumbnail_url, status, user_id');
      if (_dmPickerScope === 'mine') sel = sel.eq('user_id', user.id);
      if (query) {
        sel = sel.or(`character_name.ilike.%${query}%,species_name.ilike.%${query}%`);
      }
      const { data, error } = await sel.order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      items = data || [];
    }
  } catch (err) {
    console.warn('[DM] 공유 목록 로드 실패:', err);
    if (document.getElementById('dmPickerList')) {
      document.getElementById('dmPickerList').innerHTML = '<p class="dm-panel-placeholder">목록을 불러오지 못했어요.</p>';
    }
    return;
  }

  if (_dmPickerKind !== kind || !document.getElementById('dmPickerList')) return;

  const currentListEl = document.getElementById('dmPickerList');
  if (!items.length) {
    currentListEl.innerHTML = '<p class="dm-panel-placeholder">결과가 없어요.</p>';
    return;
  }

  currentListEl.innerHTML = items.map(it => dmRenderPickerItem(kind, it)).join('');
}

function dmRenderPickerItem(kind, it) {
  const img = kind === 'character' ? resolveCharacterImage(it)
            : kind === 'species'   ? resolveSpeciesImage(it)
            : (it.thumbnail_url || it.image_url || '');
  const thumbHtml = img
    ? `<img src="${dmEscapeHtml(img)}" class="dm-picker-thumb" alt="">`
    : `<div class="dm-picker-thumb dm-picker-thumb--empty"></div>`;

  let rawTitle, rawSub;
  if (kind === 'character') {
    rawTitle = (it.name || '(이름 없음)') + (it.char_number != null ? ` - ${it.char_number}` : '');
    rawSub   = it.species_name || '';
  } else if (kind === 'species') {
    rawTitle = it.name || '(이름 없음)';
    rawSub   = it.owner_nickname ? `종족주 : ${it.owner_nickname}` : '';
  } else {
    rawTitle = it.character_name || '(제목 없음)';
    rawSub   = it.status || '';
  }

  return `
    <div class="dm-picker-item" onclick="dmSendReference('${kind}', ${it.id})">
      ${thumbHtml}
      <div class="dm-picker-info">
        <span class="dm-picker-title">${dmEscapeHtml(rawTitle)}</span>
        ${rawSub ? `<span class="dm-picker-sub">${dmEscapeHtml(rawSub)}</span>` : ''}
      </div>
    </div>
  `;
}

function dmClosePicker() {
  _dmPickerKind = null;
  const body      = document.getElementById('dmPanelBody');
  const roomId    = _dmCurrentRoomId;
  const otherUser = body ? body.dataset.otherUserId : null;

  if (roomId && otherUser) {
    dmOpenRoom(roomId, otherUser);
  } else {
    dmShowList();
  }
}

async function dmSendReference(kind, refId) {
  const roomId = _dmCurrentRoomId;
  if (!roomId) return;

  const user = await getUser();
  if (!user) return;

  const { error } = await sb
    .from('dm_messages')
    .insert({
      room_id:        roomId,
      sender_id:      user.id,
      message_type:   'reference',
      reference_type: kind,
      reference_id:   refId,
    });

  if (error) {
    console.warn('[DM] 공유 메시지 전송 실패:', error);
    alert(dmIsBlockRelatedError(error) ? '현재 이 사용자에게 메시지를 보낼 수 없습니다.' : '공유에 실패했어요.');
    return;
  }

  // 방 화면으로 복귀 — dmOpenRoom이 메시지 목록을 다시 불러오면서 방금 보낸 공유 메시지도 함께 반영됨
  _dmPickerKind = null;
  if (_dmCurrentRoomId === roomId) {
    dmOpenRoom(roomId, document.getElementById('dmPanelBody')?.dataset.otherUserId);
  }
}

// ────────────────────────────────
// 차단 (9단계)
//
// - dm_blocks SELECT 정책은 auth.uid() = blocker_id일 때만 허용 → "내가 차단한 목록"만 조회 가능,
//   상대가 나를 차단했는지는 애초에 쿼리로 알아낼 방법이 없다 (조회하면 항상 빈 결과).
// - 그래서 이 파일에는 "상대가 나를 차단했는지 미리 표시"하는 코드가 존재하지 않는다 — 대신 실제로
//   INSERT를 시도했을 때 RLS가 막으면(42501) 그 시점에 일반적인 안내만 보여준다 (dmIsBlockRelatedError).
// - 차단해도 기존 dm_rooms/dm_messages는 전혀 건드리지 않는다 — 조회(SELECT)·Realtime 구독은
//   차단과 무관하게 그대로 살아있고, 막히는 건 새 INSERT뿐이다.
// ────────────────────────────────

// RLS INSERT 거부(상대가 나를 차단한 경우 포함)와 RPC의 차단 관련 예외를 한 곳에서 판별.
// 어느 쪽이 누구를 차단했는지는 절대 노출하지 않고, 호출부에서 전부 동일한 일반 안내 문구로 처리한다.
function dmIsBlockRelatedError(error) {
  if (!error) return false;
  const msg = error.message || '';
  return error.code === '42501' || /row-level security/i.test(msg) || msg.includes('차단');
}

// "내가 상대를 차단했는지"만 확인 — RLS가 blocker_id=auth.uid()로 이미 제한하므로 이 쿼리는
// 구조적으로 상대의 차단 행을 절대 반환할 수 없다.
async function dmCheckIBlocked(otherUserId) {
  const user = await getUser();
  if (!user) return false;
  const { data, error } = await sb
    .from('dm_blocks')
    .select('blocker_id')
    .eq('blocker_id', user.id)
    .eq('blocked_id', otherUserId)
    .maybeSingle();
  if (error) { console.warn('[DM] 차단 상태 확인 실패:', error); return false; }
  return !!data;
}

function dmToggleRoomMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('dmRoomMenu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function dmUpdateRoomMenuLabel() {
  const item = document.getElementById('dmBlockMenuItem');
  if (item) item.textContent = _dmIsBlockedByMe ? '차단 해제' : '사용자 차단';
}

// 차단 상태에 따라 입력 영역 전체(텍스트/전송/+메뉴 = 이미지·개체·종족·분양글 전부 포함)를 잠그거나 푼다
function dmApplyBlockUiState() {
  const input      = document.getElementById('dmMsgInput');
  const attachBtn  = document.getElementById('dmAttachBtn');
  const notice     = document.getElementById('dmBlockNotice');
  if (!input) return;   // 방 화면이 아니면(목록/피커) 아무것도 하지 않음

  if (_dmIsBlockedByMe) {
    input.disabled = true;
    input.value = '';
    input.style.height = '';
    if (attachBtn) attachBtn.disabled = true;
    if (notice) notice.style.display = 'block';
    const sendBtn = document.getElementById('dmSendBtn');
    if (sendBtn) sendBtn.disabled = true;
  } else {
    input.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (notice) notice.style.display = 'none';
    dmUpdateSendBtnState();
  }
}

function dmConfirmToggleBlock() {
  const menu = document.getElementById('dmRoomMenu');
  if (menu) menu.style.display = 'none';
  dmShowBlockConfirm(_dmIsBlockedByMe ? 'unblock' : 'block');
}

// 기존 사이트 전역 .modal-overlay/.modal-card 스타일 재사용 (auth.js의 로그아웃 확인 모달과 동일 패턴)
function ensureDmBlockConfirmModal() {
  if (document.getElementById('dmBlockConfirmModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'dmBlockConfirmModal';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title" id="dmBlockConfirmTitle"></h3>
      <p class="modal-desc" id="dmBlockConfirmDesc"></p>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="dmCloseBlockConfirm()">취소</button>
        <button id="dmBlockConfirmBtn"></button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dmCloseBlockConfirm(); });
  document.body.appendChild(overlay);
}

function dmShowBlockConfirm(action) {
  ensureDmBlockConfirmModal();
  const title = document.getElementById('dmBlockConfirmTitle');
  const desc  = document.getElementById('dmBlockConfirmDesc');
  const btn   = document.getElementById('dmBlockConfirmBtn');

  if (action === 'block') {
    title.textContent = '사용자 차단';
    desc.textContent  = '이 사용자를 차단할까요? 기존 대화 내용은 유지되지만 새로운 메시지를 주고받을 수 없습니다.';
    btn.textContent = '차단';
    btn.className = 'btn-danger';
    btn.onclick = dmExecuteBlock;
  } else {
    title.textContent = '차단 해제';
    desc.textContent  = '이 사용자의 차단을 해제할까요? 다시 메시지를 주고받을 수 있게 됩니다.';
    btn.textContent = '차단 해제';
    btn.className = 'btn-secondary';
    btn.onclick = dmExecuteUnblock;
  }

  document.getElementById('dmBlockConfirmModal').style.display = 'flex';
}

function dmCloseBlockConfirm() {
  const modal = document.getElementById('dmBlockConfirmModal');
  if (modal) modal.style.display = 'none';
}

async function dmExecuteBlock() {
  const roomId  = _dmCurrentRoomId;
  const otherId = document.getElementById('dmPanelBody')?.dataset.otherUserId;
  if (!otherId) { dmCloseBlockConfirm(); return; }

  const user = await getUser();
  if (!user) return;

  const { error } = await sb.from('dm_blocks').insert({ blocker_id: user.id, blocked_id: otherId });
  // 23505 = unique_violation(PK 중복) — 이미 차단된 상태로 중복 요청이 온 것뿐이라 정상 흐름으로 취급
  if (error && error.code !== '23505') {
    console.warn('[DM] 차단 실패:', error);
    alert('차단에 실패했어요.');
    dmCloseBlockConfirm();
    return;
  }

  dmCloseBlockConfirm();
  if (_dmCurrentRoomId === roomId) {
    _dmIsBlockedByMe = true;
    dmApplyBlockUiState();
    dmUpdateRoomMenuLabel();
  }
}

async function dmExecuteUnblock() {
  const roomId  = _dmCurrentRoomId;
  const otherId = document.getElementById('dmPanelBody')?.dataset.otherUserId;
  if (!otherId) { dmCloseBlockConfirm(); return; }

  const user = await getUser();
  if (!user) return;

  // RLS(auth.uid() = blocker_id)가 이미 "본인이 만든 행만" 삭제되도록 강제하므로, 여기서
  // blocker_id를 명시적으로 내 uid로 한정하는 것은 정책과 이중으로 일치시키는 의미
  const { error } = await sb
    .from('dm_blocks')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', otherId);

  if (error) {
    console.warn('[DM] 차단 해제 실패:', error);
    alert('차단 해제에 실패했어요.');
    dmCloseBlockConfirm();
    return;
  }

  dmCloseBlockConfirm();
  if (_dmCurrentRoomId === roomId) {
    _dmIsBlockedByMe = false;
    dmApplyBlockUiState();
    dmUpdateRoomMenuLabel();
  }
}

// ────────────────────────────────
// 이미지 첨부 (8단계)
//
// 저장 순서(반드시 지킴 — chat-attachments Storage RLS가 message_id의 실제 존재를 검증하기 때문):
//   1) dm_messages insert (message_type='image', content 없음) → message_id 확보
//   2) 그 message_id를 경로에 넣어 Storage 업로드: {room_id}/{message_id}/{안전한 랜덤 파일명}
//   3) 업로드 성공한 파일마다 dm_message_attachments insert (message_id, storage_path, width, height)
// expires_at/created_at/purged_at은 클라이언트가 절대 지정하지 않음 — dm_attachments_set_expiry
// BEFORE INSERT 트리거가 서버 시각 기준으로 강제 설정 (dm_setup.sql 참고).
// ────────────────────────────────

function dmTriggerImagePick() {
  const menu = document.getElementById('dmAttachMenu');
  if (menu) menu.style.display = 'none';
  // + 버튼 자체가 disabled로 막혀있지만, 만일을 대비한 이중 방어
  if (_dmIsBlockedByMe) { alert('차단한 사용자에게는 메시지를 보낼 수 없습니다.'); return; }
  const input = document.getElementById('dmImageFileInput');
  if (input) input.click();
}

// 선택 즉시 업로드하지 않는다 — 압축까지만 미리 해두고 실제 전송(dmSendImages)은 사용자가 보내기를 눌렀을 때
async function dmOnImageFilesSelected(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const remainingSlots = MAX_DM_IMAGE_COUNT - _dmPendingImages.length;
  if (remainingSlots <= 0) {
    alert(`이미지는 최대 ${MAX_DM_IMAGE_COUNT}장까지 첨부할 수 있어요.`);
    return;
  }

  const toProcess = files.slice(0, remainingSlots);
  if (files.length > remainingSlots) {
    alert(`이미지는 최대 ${MAX_DM_IMAGE_COUNT}장까지 첨부할 수 있어요. 앞의 ${remainingSlots}장만 추가할게요.`);
  }

  for (const file of toProcess) {
    // SVG 등 허용 안 된 MIME은 선택 단계에서부터 차단 (accept 속성은 참고용일 뿐 강제되지 않으므로 JS로 재검증)
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      alert(`지원하지 않는 파일 형식이에요: JPG, PNG, WebP, GIF만 첨부할 수 있어요.`);
      continue;
    }
    try {
      // js/utils.js의 기존 압축 유틸 재사용. GIF는 내부적으로 canvas 재인코딩 없이 원본을 그대로 반환하고
      // (애니메이션 보존), JPEG/PNG/WebP는 큰 이미지만 축소 후 JPEG로 재인코딩 — 원본보다 작은 이미지는
      // 그대로 유지되고 확대되지 않는다. 결과물은 항상 2MB 이하로 압축되거나(GIF는 2MB 초과 시 reject) 실패한다.
      const blob = await compressImage(file);
      const { width, height } = await dmGetImageDimensions(blob);
      _dmPendingImages.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        blob, width, height,
        mime: file.type === 'image/gif' ? 'image/gif' : 'image/jpeg',
        ext:  file.type === 'image/gif' ? 'gif' : 'jpg',
        previewUrl: URL.createObjectURL(blob),
      });
    } catch (err) {
      alert(err.message || '이미지를 처리하지 못했어요.');
    }
  }

  dmRenderPendingImages();
  dmUpdateSendBtnState();
}

function dmGetImageDimensions(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ width: null, height: null }); };
    img.src = url;
  });
}

function dmRenderPendingImages() {
  const wrap = document.getElementById('dmPendingImages');
  if (!wrap) return;

  if (!_dmPendingImages.length) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  wrap.style.display = 'flex';
  wrap.innerHTML = _dmPendingImages.map(p => `
    <div class="dm-pending-item">
      <img src="${p.previewUrl}" class="dm-pending-thumb" alt="">
      <button type="button" class="dm-pending-remove" onclick="dmRemovePendingImage('${p.id}')" aria-label="제거">✕</button>
    </div>
  `).join('');
}

function dmRemovePendingImage(id) {
  const idx = _dmPendingImages.findIndex(p => p.id === id);
  if (idx === -1) return;
  URL.revokeObjectURL(_dmPendingImages[idx].previewUrl);
  _dmPendingImages.splice(idx, 1);
  dmRenderPendingImages();
  dmUpdateSendBtnState();
}

function dmClearPendingImages() {
  _dmPendingImages.forEach(p => URL.revokeObjectURL(p.previewUrl));
  _dmPendingImages = [];
  const wrap = document.getElementById('dmPendingImages');
  if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
}

// 사용자가 고른 원본 파일명은 절대 경로/DB에 쓰지 않는다 — 항상 서버가 아니라 클라이언트가 만들지만
// 내용은 파일명과 무관한 랜덤값 + 고정 확장자뿐이라 XSS·경로 조작 여지가 없다
function dmSafeFileName(mime) {
  const ext = mime === 'image/gif' ? 'gif' : 'jpg';
  const rand = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${rand}.${ext}`;
}

async function dmSendImages() {
  if (_dmSending) return;
  const roomId = _dmCurrentRoomId;
  const btn = document.getElementById('dmSendBtn');
  if (!roomId || !_dmPendingImages.length) return;

  const user = await getUser();
  if (!user) return;

  const images = _dmPendingImages.slice();   // 전송 중 목록이 바뀌지 않도록 스냅샷
  _dmSending = true;
  if (btn) btn.disabled = true;

  // 1) 메시지 먼저 생성
  const { data: inserted, error: msgErr } = await sb
    .from('dm_messages')
    .insert({ room_id: roomId, sender_id: user.id, message_type: 'image' })
    .select('id, sender_id, message_type, content, reference_type, reference_id, created_at, deleted_at')
    .single();

  if (msgErr) {
    _dmSending = false;
    dmUpdateSendBtnState();
    console.warn('[DM] 이미지 메시지 생성 실패:', msgErr);
    alert(dmIsBlockRelatedError(msgErr) ? '현재 이 사용자에게 메시지를 보낼 수 없습니다.' : '이미지 전송에 실패했어요.');
    return;
  }

  const messageId = inserted.id;

  // 2)+3) 이미지별로 독립 업로드 — 하나 실패해도 나머지는 계속 진행 (부분 실패 허용)
  let successCount = 0;
  for (const img of images) {
    try {
      const path = `${roomId}/${messageId}/${dmSafeFileName(img.mime)}`;

      const { error: upErr } = await sb.storage
        .from('chat-attachments')
        .upload(path, img.blob, { contentType: img.mime, upsert: false });
      if (upErr) throw upErr;

      const { error: attErr } = await sb
        .from('dm_message_attachments')
        .insert({ message_id: messageId, storage_path: path, width: img.width, height: img.height });
      if (attErr) throw attErr;

      successCount++;
    } catch (err) {
      console.warn('[DM] 이미지 업로드 실패:', err);
    }
  }

  _dmSending = false;

  if (successCount === 0) {
    // 전부 실패 — 첨부 없는 image 메시지가 고아로 남지 않도록, 기존 soft-delete UPDATE 정책으로 즉시 삭제 처리.
    // dm_messages는 클라이언트 DELETE가 애초에 막혀 있고(정책 없음=거부), 새 정책을 추가하지 않고도
    // "본인 메시지의 deleted_at만 세팅 가능"한 기존 dm_messages_soft_delete 정책 + dm_messages_restrict_update
    // 트리거만으로 안전하게 처리 가능해 그대로 사용한다.
    await sb.from('dm_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageId);
    alert('이미지 업로드에 실패했어요. 다시 시도해주세요.');
    dmUpdateSendBtnState();
    return;
  }

  if (successCount < images.length) {
    alert(`${images.length}장 중 ${successCount}장만 전송됐어요. 나머지는 업로드에 실패했어요.`);
  }

  dmClearPendingImages();

  if (_dmCurrentRoomId === roomId) {
    const attachMap = await dmFetchAttachmentsForMessages([messageId]);
    if (_dmCurrentRoomId === roomId) {
      dmAppendMessage(inserted, user.id, null, attachMap);
      dmScrollToBottom();
    }
  }

  dmUpdateSendBtnState();
}

// messageIds에 해당하는 첨부를 한 번에 조회하고, 만료되지 않은 것만 모아 signed URL도 배치로 한 번에 발급한다.
// purged_at이 있으면 무조건 만료 처리(서명 시도조차 하지 않음). purged_at이 없어도 실제 서명 발급이
// 실패하면(예: 파일이 이미 없어졌지만 아직 purged_at이 안 찍힌 경우) 그 자리에서 만료로 간주한다 —
// "expires_at이 지났다"는 날짜만으로는 아직 실제 파일이 살아있을 수 있으므로 "조회 성공 여부"를 기준으로 삼는다.
async function dmFetchAttachmentsForMessages(messageIds) {
  const map = new Map();
  if (!messageIds.length) return map;

  const { data, error } = await sb
    .from('dm_message_attachments')
    .select('id, message_id, storage_path, width, height, expires_at, purged_at')
    .in('message_id', messageIds)
    .order('id', { ascending: true });

  if (error || !data) return map;

  const toSign = [];
  data.forEach(att => {
    const view = {
      id: att.id, messageId: att.message_id,
      width: att.width, height: att.height,
      expired: !!att.purged_at, signedUrl: null,
    };
    if (!map.has(att.message_id)) map.set(att.message_id, []);
    map.get(att.message_id).push(view);
    if (!view.expired) toSign.push({ path: att.storage_path, view });
  });

  if (toSign.length) {
    // 참여자만 signed URL을 만들 수 있도록 chat_attachments_select RLS가 그대로 적용됨 (정책 변경 없음)
    const { data: signedList, error: signErr } = await sb.storage
      .from('chat-attachments')
      .createSignedUrls(toSign.map(t => t.path), DM_SIGNED_URL_TTL);

    if (!signErr && signedList) {
      signedList.forEach((s, i) => {
        if (s && s.signedUrl) toSign[i].view.signedUrl = s.signedUrl;
        else toSign[i].view.expired = true;   // 서명 발급 자체가 실패 = 실질적으로 조회 불가 = 만료 취급
      });
    } else {
      toSign.forEach(t => { t.view.expired = true; });
    }
  }

  return map;
}

// dm_messages INSERT 이벤트가 dm_message_attachments INSERT보다 먼저 도착하는 경쟁 상태 대응.
// polling 없이, 해당 message_id의 attachment INSERT를 짧게 구독해서 기다리고 타임아웃되면 포기한다.
function dmWaitForAttachments(messageId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const tempChannel = sb.channel(`dm_att_wait_${messageId}_${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'dm_message_attachments',
        filter: `message_id=eq.${messageId}`,
      }, () => finish())
      .subscribe();

    const timer = setTimeout(finish, timeoutMs);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sb.removeChannel(tempChannel);
      resolve();
    }
  });
}

function dmRenderImageGrid(atts) {
  if (!atts.length) {
    return '<div class="dm-img-cell dm-img-cell--expired"><span>이미지를 불러올 수 없습니다.</span></div>';
  }

  const gridClass = atts.length === 1 ? 'dm-img-grid--1' : atts.length === 2 ? 'dm-img-grid--2' : 'dm-img-grid--multi';

  const cells = atts.map(a => {
    if (a.expired || !a.signedUrl) {
      return '<div class="dm-img-cell dm-img-cell--expired"><span>첨부 이미지가 만료되었습니다.</span></div>';
    }
    // src는 서버가 발급한 signed URL뿐 — 사용자 입력이 개입할 여지가 없어 별도 escape 불필요
    return `<div class="dm-img-cell"><img src="${a.signedUrl}" loading="lazy" onclick="dmOpenImageViewer(this.src)" alt=""></div>`;
  }).join('');

  return `<div class="dm-img-grid ${gridClass}">${cells}</div>`;
}

function dmOpenImageViewer(src) {
  let overlay = document.getElementById('dmImgViewerOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dmImgViewerOverlay';
    overlay.className = 'dm-img-viewer-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dmCloseImageViewer(); });
    overlay.innerHTML = `
      <button type="button" class="dm-img-viewer-close" onclick="dmCloseImageViewer()" aria-label="닫기">✕</button>
      <img class="dm-img-viewer-img" id="dmImgViewerImg" src="" alt="">
    `;
    document.body.appendChild(overlay);
  }
  document.getElementById('dmImgViewerImg').src = src;
  overlay.style.display = 'flex';
}

function dmCloseImageViewer() {
  const overlay = document.getElementById('dmImgViewerOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ────────────────────────────────
// 메시지 삭제 — soft delete (10단계)
//
// DB는 이미 dm_setup.sql에서 준비되어 있음:
//   - dm_messages_soft_delete RLS: sender_id = auth.uid()인 본인 메시지만 UPDATE 가능
//   - dm_messages_restrict_update 트리거: deleted_at을 non-null로 세팅하는 것 외의 모든 변경(복원 포함) 차단
// 이번 단계에서는 이 기존 구조를 그대로 프론트에 연결만 한다 — DB 변경 없음.
// ────────────────────────────────

function dmToggleMsgMenu(e, messageId) {
  e.stopPropagation();
  const menu = document.getElementById(`dmMsgMenu_${messageId}`);
  if (!menu) return;
  const isOpen = menu.style.display === 'block';
  document.querySelectorAll('.dm-msg-menu').forEach(m => { m.style.display = 'none'; });
  menu.style.display = isOpen ? 'none' : 'block';
}

function dmConfirmDeleteMessage(messageId) {
  document.querySelectorAll('.dm-msg-menu').forEach(m => { m.style.display = 'none'; });
  ensureDmDeleteConfirmModal();
  document.getElementById('dmDeleteConfirmModal').dataset.messageId = messageId;
  document.getElementById('dmDeleteConfirmModal').style.display = 'flex';
}

// 기존 사이트 전역 .modal-overlay/.modal-card 스타일 재사용 (차단 확인 모달과 동일 패턴)
function ensureDmDeleteConfirmModal() {
  if (document.getElementById('dmDeleteConfirmModal')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'dmDeleteConfirmModal';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">메시지 삭제</h3>
      <p class="modal-desc">이 메시지를 삭제할까요? 삭제한 메시지는 복구할 수 없습니다.</p>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="dmCloseDeleteConfirm()">취소</button>
        <button class="btn-danger" onclick="dmExecuteDeleteMessage()">삭제</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dmCloseDeleteConfirm(); });
  document.body.appendChild(overlay);
}

function dmCloseDeleteConfirm() {
  const modal = document.getElementById('dmDeleteConfirmModal');
  if (modal) modal.style.display = 'none';
}

async function dmExecuteDeleteMessage() {
  const modal = document.getElementById('dmDeleteConfirmModal');
  const messageId = modal ? Number(modal.dataset.messageId) : null;
  dmCloseDeleteConfirm();
  if (!messageId) return;

  const user = await getUser();
  if (!user) return;

  // deleted_at 외 컬럼은 절대 페이로드에 넣지 않음 — 넣어도 dm_messages_restrict_update 트리거가
  // 거부하지만, 애초에 요청 자체를 최소한으로 구성. sender_id 조건은 RLS가 최종 방어선이고
  // 여기서는 명시적으로도 본인 것만 대상으로 좁혀 의도를 분명히 한다.
  const { error } = await sb
    .from('dm_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('sender_id', user.id);

  if (error) {
    console.warn('[DM] 메시지 삭제 실패:', error);
    alert('메시지 삭제에 실패했어요.');
    return;
  }

  // DB UPDATE가 성공한 뒤에만 로컬 DOM을 삭제 상태로 바꾼다 (낙관적으로 먼저 바꾸지 않음)
  dmMarkMessageDeletedInDom(messageId);
}

// 실제 DOM에서 해당 메시지 말풍선만 "삭제된 메시지입니다"로 교체 — 방 전체를 다시 조회하지 않음.
// 내가 직접 삭제했을 때(dmExecuteDeleteMessage)와, 상대의 삭제가 Realtime UPDATE로 들어왔을 때
// (dmHandleRoomUpdate) 양쪽에서 공용으로 사용 — 이미 삭제 표시된 메시지에 다시 호출돼도 안전(멱등).
function dmMarkMessageDeletedInDom(messageId) {
  const row = document.querySelector(`.dm-msg-row[data-msg-id="${messageId}"]`);
  if (!row) return;   // 아직 로딩 안 된 화면일 수 있음 — 다음에 방을 열 때 DB에서 정상 반영됨

  const bubble = row.querySelector('.dm-msg-bubble');
  if (bubble) {
    bubble.className = 'dm-msg-bubble dm-msg-bubble--deleted';
    bubble.textContent = '삭제된 메시지입니다.';
  }
  const menuWrap = row.querySelector('.dm-msg-menu-wrap');
  if (menuWrap) menuWrap.remove();   // 삭제된 메시지는 더 이상 삭제 메뉴를 가질 필요 없음
}

document.addEventListener('DOMContentLoaded', () => {
  insertDmIcon();                    // 동기 실행 — 위치 먼저 확보
  setTimeout(() => initDm(), 0);     // 렌더링 블록 없이 지연 실행
});
