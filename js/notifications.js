// 알림 조회·구독 기준: user_id (primary) + user_nickname (기존 데이터 fallback)
// 닉네임 미설정 유저도 user_id로 알림 수신 가능

async function initNotifications() {
  const user = await getUser();
  if (!user) return;
  const myNick = user.user_metadata?.display_name || user.user_metadata?.nickname;

  refreshNotifCount(user.id, myNick);

  // realtime 구독: user_id 기준 (새 알림은 항상 user_id 포함)
  sb.channel(`notif_uid_${user.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${user.id}`
    }, () => refreshNotifCount(user.id, myNick))
    .subscribe();
}

function insertNotifBell() {
  const nav = document.querySelector('.header-nav');
  if (!nav || document.getElementById('notifBellWrap')) return;


  const wrap = document.createElement('div');
  wrap.className = 'notif-bell-wrap';
  wrap.id = 'notifBellWrap';
  wrap.innerHTML = `
    <button class="notif-bell-btn" id="notifBellBtn" onclick="toggleNotifPanel(event)">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <span class="notif-badge" id="notifBadge" style="display:none">0</span>
    </button>
    <div class="notif-panel" id="notifPanel" style="display:none">
      <div class="notif-panel-header">
        <span class="notif-panel-title">알림</span>
        <button class="notif-read-all-btn" onclick="markAllRead()">모두 읽음</button>
      </div>
      <div id="notifPanelList" class="notif-panel-list">
        <p class="notif-empty">불러오는 중...</p>
      </div>
    </div>
  `;
  nav.prepend(wrap);


  document.addEventListener('click', (e) => {
    const panel   = document.getElementById('notifPanel');
    const bellWrap = document.getElementById('notifBellWrap');
    if (panel && bellWrap && !bellWrap.contains(e.target)) {
      panel.style.display = 'none';
    }
  });

  // 모바일 헤더 알림 벨 주입 (.header-inner 우측)
  const headerInner = document.querySelector('.header-inner');
  if (headerInner && !document.getElementById('mobileNotifBell')) {
    const mobileBell = document.createElement('a');
    mobileBell.id = 'mobileNotifBell';
    mobileBell.href = 'notifications.html';
    mobileBell.className = 'mobile-notif-bell';
    mobileBell.setAttribute('aria-label', '알림');
    mobileBell.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      <span class="notif-badge" id="mobileNotifBadge" style="display:none">0</span>
    `;
    headerInner.appendChild(mobileBell);
  }
}

async function toggleNotifPanel(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const user = await getUser();
    if (user) {
      const myNick = user.user_metadata?.display_name || user.user_metadata?.nickname;
      loadNotifList(user.id, myNick);
      markAllReadSilent(user.id, myNick);
    }
  }
}

async function markAllReadSilent(userId, myNick) {
  let query = sb.from('notifications').update({ is_read: true }).eq('is_read', false);
  if (myNick) {
    query = query.or(`user_id.eq.${userId},user_nickname.eq.${myNick}`);
  } else {
    query = query.eq('user_id', userId);
  }
  await query;
  refreshNotifCount(userId, myNick);
}

async function refreshNotifCount(userId, myNick) {
  let query = sb.from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (myNick) {
    query = query.or(`user_id.eq.${userId},user_nickname.eq.${myNick}`);
  } else {
    query = query.eq('user_id', userId);
  }

  const { count } = await query;

  const n = count || 0;
  const badge        = document.getElementById('notifBadge');
  const sidebarBadge = document.getElementById('sidebarNotifBadge');

  if (badge) {
    badge.textContent  = n > 99 ? '99+' : n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }
  if (sidebarBadge) {
    sidebarBadge.textContent  = n > 99 ? '99+' : n;
    sidebarBadge.style.display = n > 0 ? 'inline-flex' : 'none';
  }
  const mobileBadge = document.getElementById('mobileNotifBadge');
  if (mobileBadge) {
    mobileBadge.textContent  = n > 99 ? '99+' : n;
    mobileBadge.style.display = n > 0 ? 'flex' : 'none';
  }
}

function openNotifFromSidebar() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  panel.style.display = 'block';
  getUser().then(user => {
    if (user) {
      const myNick = user.user_metadata?.display_name || user.user_metadata?.nickname;
      loadNotifList(user.id, myNick);
    }
  });
}

async function loadNotifList(userId, myNick) {
  let query = sb.from('notifications').select('*');
  if (myNick) {
    query = query.or(`user_id.eq.${userId},user_nickname.eq.${myNick}`);
  } else {
    query = query.eq('user_id', userId);
  }
  const { data } = await query
    .order('created_at', { ascending: false })
    .limit(30);

  const listEl = document.getElementById('notifPanelList');
  if (!listEl) return;

  if (!data || data.length === 0) {
    listEl.innerHTML = '<p class="notif-empty">알림이 없어요</p>';
    return;
  }

  data.sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  listEl.innerHTML = data.map(n => `
    <a class="notif-item${n.is_read ? '' : ' notif-item--unread'}"
       href="${n.link || '#'}"
       onclick="markRead('${n.id}'); return true;">
      <span class="notif-msg">${escapeNotif(n.message)}</span>
      <span class="notif-time">${timeAgoNotif(n.created_at)}</span>
    </a>
  `).join('');
}

async function markRead(id) {
  await sb.from('notifications').update({ is_read: true }).eq('id', id);
  const user = await getUser();
  if (user) {
    const myNick = user.user_metadata?.display_name || user.user_metadata?.nickname;
    refreshNotifCount(user.id, myNick);
  }
}

async function markAllRead() {
  const user = await getUser();
  if (!user) return;
  const myNick = user.user_metadata?.display_name || user.user_metadata?.nickname;

  let query = sb.from('notifications').update({ is_read: true }).eq('is_read', false);
  if (myNick) {
    query = query.or(`user_id.eq.${user.id},user_nickname.eq.${myNick}`);
  } else {
    query = query.eq('user_id', user.id);
  }
  await query;

  refreshNotifCount(user.id, myNick);
  const listEl = document.getElementById('notifPanelList');
  if (listEl) listEl.innerHTML = '<p class="notif-empty">알림이 없어요</p>';
}

function timeAgoNotif(dateStr) {
  const m = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (m < 1)  return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function escapeNotif(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  insertNotifBell();                          // 동기 실행 — 위치 먼저 확보
  setTimeout(() => initNotifications(), 0);  // 렌더링 블록 없이 지연 실행
});
