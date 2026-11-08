// ============================================================
// 연구과제·갤러리 로컬 미리보기 (2026-11-07) — localhost / 127.0.0.1 전용
//   · 기본(on): 갤러리·연구과제 함수 호출을 전부 가짜 데이터로 응답 — 운영에 함수가 있어도 운영으로 보내지 않는다
//     (1106 이 운영에 적용돼 있어 auto 로 두면 글쓰기 등이 실제 운영에 저장될 수 있음).
//     ?preview=off = 실제 백엔드 사용(실제 테스트용 — 미적용 함수는 오류 그대로 표시). auto 모드는 폐지.
//   · 가짜 시드는 실제 설정(주간 과제 + 첫 회차 공오)만 — 예시 과제·더미 연구·가짜 제출 없음(2026-11-07).
//   · 가짜 데이터는 이 브라우저의 localStorage(galleryPreviewStore) 에만 저장 — 탭끼리 공유, 운영 DB·Storage 에 아무것도 쓰지 않는다.
//     (예외: 실제 공개 개체 정보 읽기 — 공오(id=30) 카드·개체 검색에 characters_public 을 "읽기만" 한다)
//   · 화면 아래 노란 표시줄로 "미리보기 데이터" 임을 항상 보여준다.
//   · 운영 호스트에서는 첫 줄에서 바로 끝난다(아무 동작 없음).
// ============================================================
(function () {
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  if (typeof sb === 'undefined' || window.__galleryPreview) return;

  // 저장 위치(2026-11-07 수정): 탭별 sessionStorage 는 심사 화면의 새 탭(noopener)에 넘어가지 않아 '글을 찾을 수 없어요'가 났고,
  //   시드가 바뀔 때마다 키를 올려 등록한 연구까지 초기화됐다 → 브라우저 공용 localStorage 한 키 + 시드 버전(과제 설정만 갱신, 연구·제출 유지)
  const STORE_KEY = 'galleryPreviewStore';
  const SEED_VER = 13;   // 과제·주차 시드 문구가 바뀌면 올린다 — 사용자 연구·댓글·제출·이미지는 그대로 두고 시드 과제만 새로 고친다
  const LEGACY_KEYS = ['galleryPreviewStore_v9', 'galleryPreviewStore_v8', 'galleryPreviewStore_v7', 'galleryPreviewStore_v6'];   // 예전 탭별 저장(옮겨 오기)
  const store = { get: () => { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } },
                  set: v => { localStorage.setItem(STORE_KEY, v); },
                  del: () => { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 무시 */ } } };
  const qp = new URLSearchParams(location.search).get('preview');
  if (qp === 'on' || qp === 'off') { try { localStorage.setItem('galleryPreviewMode', qp); } catch (e) { /* 무시 */ } }
  // 'auto'(운영에 없는 함수만 가짜로 대체)는 폐지 — 백엔드 미적용 오류를 가짜 데이터로 숨기지 않는다. 예전 값은 'on' 으로.
  const mode = (() => { try { const m = localStorage.getItem('galleryPreviewMode'); return m === 'off' ? 'off' : 'on'; } catch (e) { return 'on'; } })();
  if (mode === 'off') return;

  const NAMES = ['gallery_list_posts', 'gallery_get_post', 'gallery_create_post', 'gallery_update_post', 'gallery_delete_post',
    'gallery_list_comments', 'gallery_add_comment', 'gallery_update_comment', 'gallery_delete_comment', 'gallery_search_characters',
    'research_get_current', 'research_list_weeks', 'research_get_week', 'research_my_notice_state', 'research_my_settings',
    'research_save_settings', 'research_get_prompts', 'research_resolve_prompts', 'research_ack_intro',
    'research_admin_list_weeks', 'research_admin_draw', 'research_admin_create_week', 'research_admin_update_week',
    'research_admin_delete_week', 'research_weekly_rollover', 'research_list_tasks', 'research_get_task',
    'research_my_archive_posts', 'research_submit', 'research_withdraw_submission', 'research_review_list',
    'research_review_submission', 'research_admin_list_tasks', 'research_admin_save_task',
    'gallery_admin_storage_report', 'gallery_admin_enqueue_orphans', 'gallery_admin_retry_purge',
    'research_archive_filters', 'research_archive_list', 'research_weekly_rollover_recover', 'research_post_link', 'research_entry_options', 'research_admin_search_items', 'research_relation_partners', 'research_my_submissions',
    'gallery_link_state', 'gallery_link_images', 'gallery_unlink_image'];   // 내 개체 갤러리에 담기(1107) — 미리보기에선 이 브라우저에만 기록
  const MOCKED = new Set(NAMES);
  const active = () => mode === 'on';

  // ── 저장소 ──
  let S = null;
  // 저장 실패(공간 부족)를 조용히 넘기지 않는다 → 호출부(mock)가 변경을 되돌리고 오류로 알린다(다음 페이지에서 연구가 사라지는 일 방지)
  let saveFailed = false;
  const save = () => { try { store.set(JSON.stringify(S)); return true; } catch (e) { saveFailed = true; console.warn('[미리보기] 저장 공간 부족', e); return false; } };
  const nid = () => (S.seq = (S.seq || 1000) + 1);
  const nowIso = () => new Date().toISOString();
  const FAKE_USER = { id: '00000000-0000-4000-8000-00000000beef', app_metadata: { role: 'admin' },
                      user_metadata: { display_name: '미리보기 관리자' }, email: 'preview@local' };
  const realGetUser = window.getUser;
  let me = null;
  async function meUser() {
    if (me) return me;
    let u = null; try { u = realGetUser ? await realGetUser() : null; } catch (e) { /* 무시 */ }
    me = u || FAKE_USER;
    return me;
  }
  const nickOf = uid => (S.nicks || {})[uid] || '미리보기 연구원';

  function addImage(dataUrl, w, h) { const p = 'preview/' + nid(); S.images[p] = dataUrl; return { id: nid(), path: p, thumb_path: p, width: w, height: h }; }

  async function charBrief(id) {
    try {
      const { data } = await sb.from('characters_public').select('id,name,owner_custom_name,species_name,char_number,thumbnail_url,image_url,default_image_index,is_sensitive,sensitive_note,owner_nickname,owner_user_id').eq('id', id).maybeSingle();
      if (data) return { ...data, owner_user_nick: data.owner_nickname };
    } catch (e) { /* 읽기 실패 → 가짜 */ }
    return { id, name: '공오', owner_custom_name: null, species_name: '(미리보기)', thumbnail_url: null, image_url: null,
             default_image_index: 1, is_sensitive: false, owner_nickname: '(미리보기)', owner_user_id: null };
  }

  // 제출 당시 내용 스냅샷(1107 SQL _research_post_snapshot 과 같은 모양)
  function snapOf(p) {
    if (!p) return null;
    return { captured_at: nowIso(), title: p.title, content: p.content, board: p.board,
             images: p.images.map(i => ({ id: i.id, path: i.path, thumb_path: i.thumb_path, width: i.width, height: i.height })),
             characters: p.characters.map(c => ({ id: c.id, name: c.name, owner_custom_name: c.owner_custom_name, species_name: c.species_name, is_research_target: !!c.is_research_target })) };
  }

  let seeding = null;
  async function ensure() {
    if (S && S.ready) return;
    if (seeding) return seeding;
    seeding = (async () => {
      let saved = null;
      try { saved = JSON.parse(store.get() || 'null'); } catch (e) { saved = null; }
      if (!saved || !saved.ready) {
        for (const k of LEGACY_KEYS) {   // 예전 탭별 저장이 이 탭에 남아 있으면 한 번 옮겨 온다
          try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); if (v && v.ready) { saved = v; saved.seedVer = 0; break; } } catch (e) { /* 무시 */ }
        }
      }
      if (saved && saved.ready && saved.seedVer === SEED_VER) { S = saved; return; }
      const u = await meUser();
      const keep = saved && saved.ready ? saved : null;   // 사용자 데이터 보존
      S = keep ? { ...keep } : { seq: 1000, images: {}, posts: [], comments: [], uploads: {}, settings: {}, subs: [], nicks: {} };
      S.nicks = S.nicks || {};
      S.nicks[u.id] = u.user_metadata?.display_name || u.user_metadata?.nickname || '나';
      const gongo = await charBrief(30);
      const now = Date.now();
      // 실제 설정만 그대로 옮긴다(1107 SQL 시드와 같은 값): 주간 과제 1개 + 첫 회차(공오 id=30, SQL 적용 시각 ~ 2026-11-16 00:00 KST 전)
      //   예시 과제·더미 연구·가짜 제출 내역은 두지 않는다 — 비어 있으면 화면이 빈 상태 안내를 보여준다.
      const startMin = keep?.weeks?.find(w => w.id === 1)?.starts_at || new Date(Math.floor(now / 60000) * 60000).toISOString();   // SQL: date_trunc('minute', now())
      const keepWeeks = (keep?.weeks || []).filter(w => w.id !== 1);
      const keepTasks = (keep?.tasks || []).filter(t => ![1, 2, 3, 4].includes(t.id));   // 미리보기에서 새로 만든 과제는 유지
      S.weeks = [...keepWeeks, { id: 1, title: '첫 회차', starts_at: startMin, ends_at: '2026-11-15T15:00:00Z',
                   status: 'selected', character: gongo, is_fixed: true, note: '첫 회차 지정 대상(공오). 2026-11-16 00:00 KST 부터 랜덤 선정.' }];
      S.tasks = [
        { id: 1, kind: 'weekly', title: '이번 주의 연구대상', category: '주간', reward_amount: 300, submit_limit: 'once_per_user_week', status: 'open', sort_order: 0,
          // 1107 SQL 의 주간 과제 안내문과 같은 문구
          summary: '이번 주의 연구는 끝냈나요?',
          guide: '이번 주의 연구대상을 연구해 봅시다!\n연구대상의 외형, 성격, 일상 등 무엇이든 자유롭게 표현해 주세요.',
          conditions: '· 그림과 글 모두 참여할 수 있습니다.\n· 해당 주의 연구대상이 등장하거나, 연구의 주제가 되어야 합니다.',
          prompt_image: '개체 전신 단색이상 채색', prompt_text: '공백 미포함 1,000자 이상', prompt_spec: {"common":"**이번 주의 연구대상**","image":{"lines":[{"t":"**전신 단색이상 채색**"}]},"text":{"lines":[{"t":"공백 미포함 **1,000자 이상**"}]},"either":true},
          notes: null, image_url: null, starts_at: null, ends_at: null },
        { id: 2, code: 'weekly_daily_life', kind: 'general', title: '개체의 일상 탐구', category: '주간', status: 'open', sort_order: 1,
          summary: '여러분의 개체는 평소에 무엇을 하고 있나요?',
          guide: '여러분의 개체는 평소에 무엇을 하고 있나요?\n공부하거나 맛있는 음식을 먹고, 전투를 하거나 잠을 잘 수도 있겠지요.\n여러분의 개체가 보내는 일상을 자유롭게 표현해 주세요.',
          conditions: '· 그림 또는 글 중 하나로 참여할 수 있습니다.',
          prompt_image: '본인 소유 개체 1체의 전신 단색이상 채색', prompt_text: '본인 소유 개체 1체가 등장하는 글, 공백 미포함 1,000자 이상', prompt_spec: {"common":"본인 소유 개체 **1체**","image":{"lines":[{"t":"**전신 단색이상 채색**"}]},"text":{"lines":[{"t":"대상 개체가 등장하는 글"},{"t":"공백 미포함 **1,000자 이상**"}]},"either":true},
          reward_amount: 100, reward_items: [{ item_id: null, name: '기다란 철사', qty: 1 }], reward_random: null,
          submit_limit: 'per_user_week', limit_count: 3, entry_rule: 'own_character', image_url: null, starts_at: null, ends_at: null },
        { id: 3, code: 'weekly_relation', kind: 'general', title: '개체의 관계 탐구', category: '주간', status: 'open', sort_order: 2,
          summary: '여러분의 개체는 어떤 관계를 맺고 있나요?',
          guide: '친구, 스승과 제자, 혹은 연인일 수도 있겠지요.\n서로에게 어떤 존재인지, 함께할 때 어떤 모습을 보이는지\n개체들의 관계를 표현해 주세요.',
          conditions: '· 그림 또는 글 중 하나로 참여할 수 있습니다.\n· 개체의 관계란에 등록된 관계여야 합니다.',
          prompt_image: '본인 소유 개체 1체와 해당 개체의 관계 상대 1체, 총 2체의 전신 단색이상 채색',
          prompt_text: '본인 소유 개체 1체와 해당 개체의 관계 상대 1체가 등장하는 글, 공백 미포함 1,000자 이상', prompt_spec: {"common":"본인 소유 개체 **1체** + 관계 상대 **1체**","image":{"lines":[{"t":"총 **2체 전신 단색이상 채색**"}]},"text":{"lines":[{"t":"총 **2체**가 등장하는 글"},{"t":"공백 미포함 **1,000자 이상**"}]},"notes":["※ 개체의 관계란에 등록된 관계여야 합니다."],"either":true},
          reward_amount: 200, reward_items: [{ item_id: null, name: '기다란 철사', qty: 1 }], reward_random: null,
          submit_limit: 'per_user_week', limit_count: 3, entry_rule: 'own_character_relation', image_url: null, starts_at: null, ends_at: null },
        { id: 4, code: 'monthly_labber_research', kind: 'general', title: '래버의 연구', category: '월간,래버', status: 'open', sort_order: 3,
          summary: '연구에 몰두하는 래버의 모습을 보여 주세요.',
          guide: '래버는 연구를 좋아합니다.\n좋아하는 것을 넘어, 집착에 가깝다고 할 수도 있겠지요.\n래버가 서브젝트를 연구하는 모습을 표현해 주세요.\n어떤 서브젝트든 괜찮습니다.',
          conditions: '· 그림 또는 글 중 하나로 참여할 수 있습니다.',
          prompt_image: '본인 소유 래버 1체 또는 래버 NPC 1체와 서브젝트가 등장하는 3컷 이상 만화 또는 간단한 배경이 포함된 일러스트. 만화는 각 컷의 배경이 반복되지 않아야 함',
          prompt_text: '본인 소유 래버 1체 또는 래버 NPC 1체가 서브젝트를 연구하는 글, 공백 미포함 2,500자 이상', prompt_spec: {"common":"본인 소유 **래버** 또는 **래버 NPC 1체** + **서브젝트**","image":{"lead":"아래 중 하나","lines":[{"t":"**3컷 이상** 만화","sub":"컷마다 배경이 반복되지 않아야 합니다."},{"t":"**간단한 배경**이 포함된 일러스트"}]},"text":{"lines":[{"t":"서브젝트를 연구하는 내용"},{"t":"공백 미포함 **2,500자 이상**"}]},"either":true},
          reward_amount: 0, reward_items: [],
          reward_random: { confirmed: false, options: [{ item_id: 'preview-species', name: '종족 서브젝트', weight: 1 }, { item_id: 'preview-creature', name: '크리쳐 서브젝트', weight: 1 }] },
          submit_limit: 'per_user_month', limit_count: 1, entry_rule: 'labber_or_npc', image_url: null, starts_at: null, ends_at: null },
        ...keepTasks,
      ];
      S.seedVer = SEED_VER;
      S.ready = true;   // 시드 완료 표시 — 그 전에는 다른 호출이 기다린다
      save();
      if (keep) for (const k of LEGACY_KEYS) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }
    })();
    return seeding;
  }

  // ── 표시줄 ──
  function bar() {
    if (document.getElementById('glPreviewBar') || !document.body) return;
    const el = document.createElement('div');
    el.id = 'glPreviewBar'; el.className = 'gl-preview-bar';
    el.innerHTML = `🧪 로컬 미리보기 — 갤러리·연구과제 화면은 <u>가짜 데이터</u>예요(운영에 저장되지 않음 · 이 브라우저에만 저장)
      <button type="button" data-r>미리보기 초기화</button><button type="button" data-o>미리보기 끄기</button>`;
    el.querySelector('[data-r]').onclick = () => { if (!confirm('미리보기에서 등록한 연구·제출을 모두 지울까요? (운영 데이터와는 무관)')) return; store.del(); sessionStorage.removeItem('rsCurrentCache'); location.reload(); };
    el.querySelector('[data-o]').onclick = () => { try { localStorage.setItem('galleryPreviewMode', 'off'); } catch (e) { /* 무시 */ } location.reload(); };
    document.body.appendChild(el);
    document.body.classList.add('gl-preview-on');
  }
  const showBar = () => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar(); };
  if (active()) showBar();

  // ── 응답 도우미 ──
  const ok = data => ({ data, error: null });
  const err = message => ({ data: null, error: { message } });
  const postById = id => S.posts.find(p => p.id === Number(id));
  const lockOf = pid => S.subs.some(s => s.post_id === pid && s.status === 'pending') ? 'pending'
    : S.subs.some(s => s.post_id === pid && s.status === 'approved') ? 'approved' : 'none';
  const curWeek = () => S.weeks.find(w => Date.parse(w.starts_at) <= Date.now() && Date.now() < Date.parse(w.ends_at)) || null;
  const weekJson = w => w && ({ ...w, post_count: S.subs.filter(s => s.week_id === w.id).length });
  const rewardView = (items, rnd, admin) => ({ items: (items || []).map(i => ({ item_id: i.item_id || null, code: i.item_id ? (i.code || i.item_id) : null, name: i.name, qty: i.qty || 1, unlinked: !i.item_id })),
    random: rnd ? { confirmed: admin ? !!rnd.confirmed : undefined, options: (rnd.options || []).map(o => ({ item_id: o.item_id || null, code: o.item_id ? (o.code || o.item_id) : null, name: o.name, unlinked: !o.item_id, ...(admin ? { weight: o.weight } : {}) })) } : null });
  const taskJson = t => ({ ...t, limit_count: t.limit_count || 1, entry_rule: t.entry_rule || 'none', rewards: rewardView(t.reward_items, t.reward_random, false),
    reward_items: undefined, reward_random: undefined, rewards_enabled: false, test_mode: true, approved_count: S.subs.filter(s => s.task_id === t.id && s.status === 'approved').length,
    is_open_now: t.status === 'open' && (!t.starts_at || Date.parse(t.starts_at) <= Date.now()) && (!t.ends_at || Date.now() < Date.parse(t.ends_at)) });
  const listPost = p => ({ id: p.id, board: p.board, title: p.title, user_id: p.user_id, nickname: nickOf(p.user_id), created_at: p.created_at,
    edited_at: p.edited_at, image_count: p.images.length, cover_thumb_path: p.images[0]?.thumb_path || null, excerpt: (p.content || '').slice(0, 120),
    comment_count: S.comments.filter(c => c.post_id === p.id && !c.is_deleted).length, research_week_id: p.research_week_id });

  // 등록 시 과제 연결 검증(1107 SQL _research_task_link 과 같은 규칙)
  function taskLink(taskId, keepTask, keepWeek) {
    if (!taskId) return { task: null, week: null };
    if (Number(taskId) === keepTask) return { task: keepTask, week: keepWeek };
    const t = S.tasks.find(x => x.id === Number(taskId));
    if (!t || t.status === 'draft') return { error: '선택한 연구 과제를 찾을 수 없어요.' };
    if (!taskJson(t).is_open_now) return { error: '지금은 연결할 수 없는 연구 과제예요.' };
    if (t.kind !== 'weekly') return { task: t.id, week: null };
    const w = curWeek();
    if (!w || w.status !== 'selected' || !w.character) return { error: '이번 주 연구대상이 정해지면 연결할 수 있어요.' };
    return { task: t.id, week: w.id };
  }

  // 관계 상대(실제 SQL research_relation_partners 와 같은 기준): 고른 개체 관계란 + 상대 관계란에 이 개체가 적힌 경우. 본인 소유만
  const CP_COLS = 'id,name,owner_custom_name,species_name,owner_user_id,char_sections';
  const nm = c => (c.owner_custom_name || '').trim() || c.name;
  async function relationPartners(cid) {
    const u = await meUser();
    const { data: c, error: e1 } = await sb.from('characters_public').select(CP_COLS).eq('id', cid).maybeSingle();
    if (e1) return { error: '관계 정보를 불러오지 못했어요. (' + (e1.message || '조회 오류') + ')' };
    if (!c) return { error: '참여 개체를 찾을 수 없어요.' };
    if (c.owner_user_id !== u.id) return { error: '본인 소유 개체만 참여 개체로 고를 수 있어요.' };
    const rels = sec => (Array.isArray(sec) ? sec : []).filter(x => x && x.type === 'relation').flatMap(x => Array.isArray(x.relations) ? x.relations : []);
    const fwd = rels(c.char_sections).map(r => ({ pid: Number(String(r.char_id ?? '').trim()), label: r.relation_label || null, side: 'self' })).filter(x => x.pid && x.pid !== cid);
    const { data: back, error: e2 } = await sb.from('characters_public').select(CP_COLS)
      .contains('char_sections', JSON.stringify([{ type: 'relation', relations: [{ char_id: String(cid) }] }])).limit(200);
    if (e2) return { error: '관계 정보를 불러오지 못했어요. (' + (e2.message || '조회 오류') + ')' };
    const rev = (back || []).filter(o => o.id !== cid).map(o => ({ pid: o.id, label: (rels(o.char_sections).find(r => String(r.char_id).trim() === String(cid)) || {}).relation_label || null, side: 'partner', row: o }));
    const seen = new Map(); [...fwd, ...rev].forEach(x => { if (!seen.has(x.pid)) seen.set(x.pid, x); });
    const need = [...seen.keys()].filter(id => !rev.some(r => r.pid === id));
    let rows = rev.map(r => r.row);
    if (need.length) { const { data: more, error: e3 } = await sb.from('characters_public').select(CP_COLS).in('id', need); if (e3) return { error: '관계 정보를 불러오지 못했어요.' }; rows = rows.concat(more || []); }
    const byId = new Map(rows.map(r => [r.id, r]));
    const partners = [...seen.values()].filter(x => byId.has(x.pid)).map(x => ({ id: x.pid, name: nm(byId.get(x.pid)), species_name: byId.get(x.pid).species_name, label: x.label, registered_on: x.side }))
      .sort((p, q) => p.name.localeCompare(q.name, 'ko'));
    return { partners, character: c };
  }

  const H = {
    async gallery_list_posts(a) {
      const all = S.posts.filter(p => p.board === a.p_board).sort((x, y) => y.created_at.localeCompare(x.created_at));
      return ok({ total: all.length, items: all.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 20)).map(listPost) });
    },
    async gallery_get_post(a) {
      const p = postById(a.p_post_id); if (!p) return ok(null);
      const u = await meUser();
      return ok({ ...listPost(p), content: p.content, images: p.images, characters: p.characters,
                  can_edit: p.user_id === u.id, can_delete: true, week: null });
    },
    async research_post_link(a) {
      const p = postById(a.p_post_id); if (!p || p.board !== 'research' || !p.link_task_id) return ok(null);
      const t = S.tasks.find(x => x.id === p.link_task_id); const w = S.weeks.find(x => x.id === p.link_week_id);
      return ok({ task_id: p.link_task_id, task_title: t?.title, task_kind: t?.kind, task_status: t?.status, week_id: w?.id || null, week_title: w?.title || null,
                  week_character_name: w?.character ? ((w.character.owner_custom_name || '').trim() || w.character.name) : null });
    },
    async gallery_create_post(a) {
      const u = await meUser();
      const imgs = (a.p_images || []).map(x => S.uploads[x.upload_id]).filter(Boolean);
      if (!(a.p_title || '').trim()) return err('제목을 입력해주세요.');
      if (!imgs.length && !(a.p_content || '').trim()) return err('본문을 쓰거나 이미지를 1장 이상 올려주세요. (제목만 있는 빈 연구는 등록할 수 없어요)');
      const chars = await Promise.all((a.p_character_ids || []).map(charBrief));
      const id = nid();
      if (a.p_task_id && a.p_board !== 'research') return err('연구 과제 연결은 연구 자료 보관소에서만 할 수 있어요.');
      const link = taskLink(a.p_task_id ?? null, null, null); if (link.error) return err(link.error);
      S.posts.push({ id, board: a.p_board, user_id: u.id, title: a.p_title, content: a.p_content || '', created_at: nowIso(), edited_at: null, images: imgs, characters: chars, research_week_id: null,
                     link_task_id: link.task, link_week_id: link.week });
      save(); return ok(id);
    },
    async gallery_update_post(a) {
      const p = postById(a.p_post_id); if (!p) return err('게시글을 찾을 수 없어요.');
      if (lockOf(p.id) === 'pending') return err('심사 중인 작품은 수정할 수 없어요. 제출을 취소한 뒤 수정해주세요.');
      const imgs = (a.p_images || []).map(x => x.image_id ? p.images.find(i => i.id === x.image_id) : S.uploads[x.upload_id]).filter(Boolean);
      if (lockOf(p.id) === 'approved' && JSON.stringify(imgs.map(i => i.id)) !== JSON.stringify(p.images.map(i => i.id))) return err('승인된 작품은 이미지를 바꿀 수 없어요. 제목·본문·관련 개체는 수정할 수 있어요.');
      if (!imgs.length && !(a.p_content || '').trim()) return err('본문을 쓰거나 이미지를 1장 이상 올려주세요. (제목만 있는 빈 연구는 등록할 수 없어요)');
      const keepTarget = p.characters.filter(c => c.is_research_target);
      const chars = await Promise.all((a.p_character_ids || []).filter(id => !keepTarget.some(t => t.id === id)).map(charBrief));
      let link = { task: p.link_task_id || null, week: p.link_week_id || null };
      if (a.p_task_link) { link = taskLink(a.p_task_link.task_id ?? null, p.link_task_id, p.link_week_id); if (link.error) return err(link.error); }
      Object.assign(p, { title: a.p_title, content: a.p_content || '', images: imgs, characters: [...keepTarget, ...chars], edited_at: nowIso(), link_task_id: link.task, link_week_id: link.week });
      save(); return ok(p.id);
    },
    async gallery_delete_post(a) {
      const p = postById(a.p_post_id); if (!p) return ok(false);
      if (lockOf(p.id) === 'pending') return err('심사 중인 작품은 삭제할 수 없어요. 제출을 취소한 뒤 삭제해주세요.');
      if (lockOf(p.id) === 'approved') return err('승인된 작품은 삭제할 수 없어요. 필요하면 문의해주세요.');
      S.posts = S.posts.filter(x => x.id !== p.id); save(); return ok(true);
    },
    // ── 내 개체 갤러리에 담기(1107 SQL 과 같은 모양) — 내 개체 여부는 실제 공개 개체 정보를 "읽기만" 해서 판단 ──
    //   ※ 담은 연결은 미리보기 저장소에만 있으므로 개체 상세(character.html, 미리보기 미적용)에는 보이지 않는다.
    async gallery_link_state(a) {
      const p = postById(a.p_post_id); if (!p) return err('게시물을 찾을 수 없어요. 삭제되었을 수 있어요.');
      const u = await meUser();
      const { data: mine } = await sb.from('characters_public').select('id').eq('owner_user_id', u.id).limit(1000);
      const mineIds = new Set((mine || []).map(c => Number(c.id)));
      const cid = a.p_character_id == null ? null : Number(a.p_character_id);
      if (cid != null && !mineIds.has(cid)) return err('지금 소유한 개체만 고를 수 있어요.');
      if (cid != null && !p.characters.some(c => Number(c.id) === cid)) return err('이 글에 연결된 개체만 고를 수 있어요.');
      const links = S.links || [];
      return ok({ post_id: p.id,
        images: p.images.map(i => ({ id: i.id, path: i.path, thumb_path: i.thumb_path, width: i.width, height: i.height,
                                     linked: cid != null && links.some(l => l.character_id === cid && l.image_id === i.id) })),
        my_character_count: mineIds.size,
        related_mine: p.characters.filter(c => mineIds.has(Number(c.id))),
        character: cid != null ? await charBrief(cid) : null });
    },
    async gallery_link_images(a) {
      const p = postById(a.p_post_id); if (!p) return err('게시물을 찾을 수 없어요. 삭제되었을 수 있어요.');
      const u = await meUser();
      const cid = Number(a.p_character_id);
      const { data: c } = await sb.from('characters_public').select('id,owner_user_id').eq('id', cid).maybeSingle();
      if (!c || c.owner_user_id !== u.id) return err('지금 소유한 개체에만 담을 수 있어요.');
      if (!p.characters.some(x => Number(x.id) === cid)) return err('이 글에 연결된 개체에만 담을 수 있어요.');
      const ids = (a.p_image_ids || []).map(Number);
      if (!ids.length) return err('담을 이미지를 1장 이상 골라주세요.');
      if (new Set(ids).size !== ids.length || ids.some(id => !p.images.some(i => i.id === id))) return err('이 게시물에 올라간 이미지가 아니에요. 화면을 새로고침해 주세요.');
      S.links = S.links || [];
      let added = 0;
      ids.forEach(id => { if (!S.links.some(l => l.character_id === cid && l.image_id === id)) { S.links.push({ character_id: cid, image_id: id, created_at: nowIso() }); added++; } });
      save();
      return ok({ character_id: cid, added, already: ids.length - added,
                  linked_image_ids: S.links.filter(l => l.character_id === cid && p.images.some(i => i.id === l.image_id)).map(l => l.image_id) });
    },
    async gallery_unlink_image(a) {
      const before = (S.links || []).length;
      S.links = (S.links || []).filter(l => !(l.character_id === Number(a.p_character_id) && l.image_id === Number(a.p_image_id)));
      save(); return ok(S.links.length !== before);
    },
    async gallery_list_comments(a) {
      const u = await meUser();
      const conv = c => ({ ...c, nickname: c.is_deleted ? null : nickOf(c.user_id), content: c.is_deleted ? null : c.content,
        can_edit: !c.is_deleted && c.user_id === u.id, can_delete: !c.is_deleted });
      const tops = S.comments.filter(c => c.post_id === Number(a.p_post_id) && !c.parent_id);
      return ok({ total: tops.length, items: tops.map(c => ({ ...conv(c), replies: S.comments.filter(r => r.parent_id === c.id).map(conv) })) });
    },
    async gallery_add_comment(a) {
      const u = await meUser();
      if (!(a.p_content || '').trim()) return err('댓글 내용을 입력해주세요.');
      const id = nid(); S.comments.push({ id, post_id: Number(a.p_post_id), parent_id: a.p_parent_id || null, user_id: u.id, content: a.p_content.trim(), is_deleted: false, created_at: nowIso(), updated_at: null });
      save(); return ok(id);
    },
    async gallery_update_comment(a) { const c = S.comments.find(x => x.id === a.p_comment_id); if (c) { c.content = a.p_content; c.updated_at = nowIso(); save(); } return ok(true); },
    async gallery_delete_comment(a) {
      const c = S.comments.find(x => x.id === a.p_comment_id); if (!c) return ok('not_found');
      if (!c.parent_id && S.comments.some(r => r.parent_id === c.id)) { c.is_deleted = true; c.content = null; save(); return ok('masked'); }
      S.comments = S.comments.filter(x => x.id !== c.id); save(); return ok('deleted');
    },
    async gallery_search_characters(a) {   // 실제 공개 개체를 "읽기만" — 운영에 쓰지 않음
      const q = (a.p_query || '').trim(); if (!q) return ok({ items: [], has_more: false });
      const COLS = 'id,name,owner_custom_name,species_name,char_number,thumbnail_url,image_url,default_image_index,is_sensitive,sensitive_note,owner_nickname,owner_user_id';
      const safe = q.replace(/[%_\\,()"*]/g, ' ').trim(); if (!safe) return ok({ items: [], has_more: false });
      let req = sb.from('characters_public').select(COLS);
      if (a.p_scope === 'mine' || a.p_scope === 'mine_labber') { const u = await meUser(); req = req.eq('owner_user_id', u.id); if (a.p_scope === 'mine_labber') req = req.eq('species_name', 'LABBER'); }
      req = a.p_mode === 'all'
        ? req.or(['name', 'owner_custom_name', 'owner_nickname', 'species_name'].map(c => `${c}.ilike.%${safe}%`).join(','))
        : req.ilike({ name: 'name', owner: 'owner_nickname', species: 'species_name', user: 'owner_nickname' }[a.p_mode] || 'name', `%${safe}%`);
      const { data } = await req.order('id').range(a.p_offset || 0, (a.p_offset || 0) + 20);
      const seen = new Set();
      const items = (data || []).filter(c => !seen.has(c.id) && seen.add(c.id)).map(c => ({ ...c, owner_user_nick: c.owner_nickname }));
      return ok({ items: items.slice(0, 20), has_more: items.length > 20 });
    },
    async research_get_current() { return ok({ server_now: nowIso(), week: weekJson(curWeek()) }); },
    async research_list_weeks() { return ok({ total: S.weeks.length, items: S.weeks.map(weekJson) }); },
    async research_get_week(a) { return ok(weekJson(S.weeks.find(w => w.id === Number(a.p_week_id)))); },
    async research_my_notice_state() { return ok(null); },
    async research_my_settings() {
      const u = await meUser();
      const { data } = await sb.from('characters_public').select('id,name,owner_custom_name,species_name,char_number,thumbnail_url,image_url,default_image_index,is_sensitive,owner_nickname,owner_user_id').eq('owner_user_id', u.id).limit(60);
      const items = (data || []).map(c => ({ ...c, consent: !!S.settings[c.id]?.consent, notify_new_owner: !!S.settings[c.id]?.notify }));
      return ok({ total_owned: items.length, filtered_total: items.length, consent_on: items.filter(i => i.consent).length, notify_on: items.filter(i => i.notify_new_owner).length, items });
    },
    async research_save_settings(a) {
      for (const it of a.p_items || []) { S.settings[it.id] = { consent: it.consent ?? S.settings[it.id]?.consent, notify: it.notify_new_owner ?? S.settings[it.id]?.notify }; }
      save(); return ok({ rejected: [] });
    },
    async research_get_prompts() { return ok([]); },
    async research_resolve_prompts() { return ok({ resolved: 0, consent_on: 0 }); },
    async research_ack_intro() { return ok(true); },
    async research_list_tasks() { return ok({ server_now: nowIso(), current_week: weekJson(curWeek()), items: S.tasks.filter(t => t.status !== 'draft').map(taskJson) }); },
    async research_get_task(a) {
      const t = a.p_task_id ? S.tasks.find(x => x.id === Number(a.p_task_id)) : S.tasks.find(x => x.kind === 'weekly');
      if (!t) return ok(null);
      const u = await meUser();
      const mine = S.subs.filter(s => s.task_id === t.id && s.user_id === u.id).sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map(s => ({ ...s, rewards: rewardView(s.reward_items, s.reward_random, false), post_title: postById(s.post_id)?.title, week_title: S.weeks.find(w => w.id === s.week_id)?.title }));
      return ok({ ...taskJson(t), server_now: nowIso(), current_week: t.kind === 'weekly' ? weekJson(curWeek()) : null, my_submissions: mine });
    },
    async research_my_archive_posts() {
      const u = await meUser();
      const items = S.posts.filter(p => p.user_id === u.id && p.board === 'research' && (p.images.length || (p.content || '').trim()))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map(p => ({ id: p.id, title: p.title, cover_thumb_path: p.images[0]?.thumb_path || null, image_count: p.images.length,
                     excerpt: (p.content || '').slice(0, 120), created_at: p.created_at, lock: lockOf(p.id) }));
      return ok({ total: items.length, items });
    },
    async research_my_submissions(a) {
      const u = await meUser();
      const mine = S.subs.filter(x => x.user_id === u.id);
      const byTask = mine.filter(x => !a.p_task_id || x.task_id === Number(a.p_task_id));
      const counts = {}; byTask.forEach(x => { counts[x.status] = (counts[x.status] || 0) + 1; });
      const rows = byTask.filter(x => !a.p_status || x.status === a.p_status).sort((x, y) => y.created_at.localeCompare(x.created_at) || y.id - x.id);
      const off = a.p_offset || 0, lim = a.p_limit || 20;
      return ok({ total: rows.length, counts,
        tasks: S.tasks.filter(t => t.status !== 'draft' || mine.some(x => x.task_id === t.id)).map(t => ({ id: t.id, title: t.title })),
        items: rows.slice(off, off + lim).map(x => { const t = S.tasks.find(tt => tt.id === x.task_id); const p = postById(x.post_id); const w = S.weeks.find(ww => ww.id === x.week_id);
          return { id: x.id, task_id: x.task_id, task_title: t?.title, task_kind: t?.kind, status: x.status, is_test: x.is_test, post_id: p ? p.id : null,
                   post_title: p?.title || x.snapshot?.title, post_deleted: !p, week_title: w?.title || null, message: x.message, entry_check: x.entry_check,
                   reject_reason: x.status === 'rejected' ? x.reject_reason : null, review_comment: x.status === 'approved' ? (x.review_comment || null) : null,
                   reward_amount: x.reward_amount, rewards: rewardView(x.reward_items, x.reward_random, false), reward_status: x.reward_status, reward_result: x.reward_result,
                   created_at: x.created_at, reviewed_at: x.reviewed_at || null }; }) });
    },
    async research_relation_partners(a) {
      const r = await relationPartners(Number(a.p_character_id));
      return r.error ? err(r.error) : ok({ character_id: Number(a.p_character_id), partners: r.partners });
    },
    async research_entry_options(a) {
      const t = S.tasks.find(x => x.id === Number(a.p_task_id)); if (!t) return ok(null);
      const rule = t.entry_rule || 'none'; if (rule === 'none') return ok({ rule, characters: [] });
      const u = await meUser();
      // 실제 공개 개체 정보를 "읽기만"(로그인한 본인 소유). 관계는 characters_public 에 없어서 미리보기에서는 비워 둔다.
      let rows = [];
      try { const { data } = await sb.from('characters_public').select('id,name,owner_custom_name,species_name').eq('owner_user_id', u.id).limit(500); rows = data || []; } catch (e) { rows = []; }
      if (rule === 'labber_or_npc') rows = rows.filter(c => c.species_name === 'LABBER');
      return ok({ rule, characters: rows.map(c => ({ id: c.id, name: (c.owner_custom_name || '').trim() || c.name, species_name: c.species_name, partners: [] })) });
    },
    async research_submit(a) {
      const u = await meUser();
      const t = S.tasks.find(x => x.id === Number(a.p_task_id)); const p = postById(a.p_post_id);
      if (!t || t.status !== 'open') return err('지금은 제출할 수 없는 과제예요.');
      if (!p || p.user_id !== u.id) return err('본인 작품만 제출할 수 있어요.');
      const w = t.kind === 'weekly' ? curWeek() : null;
      if (t.kind === 'weekly' && (!w || w.status !== 'selected')) return err('이번 주 연구대상을 준비 중이에요. 연구대상이 정해지면 참여할 수 있어요.');
      if (!p.images.length && !(p.content || '').trim()) return err('본문이나 이미지가 없는 빈 연구는 제출할 수 없어요.');
      const rule = t.entry_rule || 'none', e = a.p_entry || {};
      let entry = null;
      if (rule !== 'none') {
        if (rule === 'labber_or_npc' && e.npc) entry = { rule, npc: true };
        else if (!e.character_id) return err('참여할 본인 소유 개체를 골라주세요.');
        else if (rule === 'own_character_relation' && !e.partner_id) return err('관계 상대 개체를 골라주세요.');
        else {
          const { data: ch } = await sb.from('characters_public').select(CP_COLS).eq('id', Number(e.character_id)).maybeSingle();
          if (!ch) return err('참여 개체를 찾을 수 없어요.');
          if (ch.owner_user_id !== u.id) return err('본인 소유 개체만 참여 개체로 고를 수 있어요.');
          if (rule === 'labber_or_npc' && ch.species_name !== 'LABBER') return err('본인 소유 래버 개체 또는 래버 NPC 로만 참여할 수 있어요.');
          let partner, relation;
          if (rule === 'own_character_relation') {
            const r = await relationPartners(Number(e.character_id));
            if (r.error) return err(r.error);
            const pp = r.partners.find(x => x.id === Number(e.partner_id));
            if (!pp) return err('개체의 관계란에 등록된 관계가 아니에요. 관계란에 상대를 등록한 뒤 제출해주세요.');
            partner = { id: pp.id, name: pp.name, species_name: pp.species_name }; relation = { label: pp.label, registered_on: pp.registered_on };
          }
          entry = { rule, owner_verified: true, character: { id: ch.id, name: nm(ch), species_name: ch.species_name }, partner, relation };
        }
      }
      // 미리보기 = 테스트 기간: 테스트 제출끼리만 제한(정식 제한과 분리). 대기·승인만 슬롯 차지
      const live = S.subs.filter(s => s.task_id === t.id && s.user_id === u.id && s.is_test && ['pending', 'approved'].includes(s.status));
      if (live.some(s => s.post_id === p.id)) return err('이 연구는 이미 이 과제에 제출했어요. (승인 대기 또는 승인)');
      const kst = d => new Date(Date.parse(d) + 9 * 3600e3);
      const nowK = kst(nowIso());
      const weekKey = d => { const k = kst(d); const day = (k.getUTCDay() + 6) % 7; k.setUTCDate(k.getUTCDate() - day); return k.toISOString().slice(0, 10); };
      const monthKey = d => kst(d).toISOString().slice(0, 7);
      if (t.kind === 'weekly' && live.some(s => s.week_id === w.id)) return err('이번 주차에는 이미 제출했어요. (승인 대기 또는 승인 — 반려되면 다시 제출할 수 있어요)');
      if (t.submit_limit === 'once_per_user' && live.length) return err('이 과제에는 이미 제출한 작품이 있어요. (승인 대기 또는 승인 — 반려되면 다시 제출할 수 있어요)');
      if (t.submit_limit === 'per_user_week' && live.filter(s => weekKey(s.created_at) === weekKey(nowIso())).length >= (t.limit_count || 1))
        return err(`이번 주 제출 횟수(${t.limit_count}회)를 모두 사용했어요. (승인 대기·승인 기준 — 반려·취소되면 다시 제출할 수 있어요)`);
      if (t.submit_limit === 'per_user_month' && live.filter(s => monthKey(s.created_at) === monthKey(nowIso())).length >= (t.limit_count || 1))
        return err(`이번 달 제출 횟수(${t.limit_count}회)를 모두 사용했어요. (승인 대기·승인 기준 — 반려·취소되면 다시 제출할 수 있어요)`);
      void nowK;
      const id = nid();
      if (w && !p.characters.some(c => c.id === w.character.id)) p.characters.unshift({ ...w.character, is_research_target: !p.characters.some(c => c.is_research_target) });
      S.subs.push({ id, task_id: t.id, week_id: w?.id || null, user_id: u.id, post_id: p.id, message: (a.p_message || '').trim() || null, status: 'pending',
                    reward_amount: t.reward_amount, reward_items: t.reward_items || [], reward_random: t.reward_random || null, entry_check: entry,
                    reward_status: 'none', is_test: true, snapshot: snapOf(p), created_at: nowIso() });
      save(); return ok(id);
    },
    async research_withdraw_submission(a) { const s = S.subs.find(x => x.id === a.p_submission_id && x.status === 'pending'); if (s) { s.status = 'withdrawn'; save(); } return ok(!!s); },
    async research_review_list(a) {
      const counts = {}; S.subs.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });
      const rows = S.subs.filter(s => !a.p_status || s.status === a.p_status).map(s => {
        const t = S.tasks.find(x => x.id === s.task_id); const w = S.weeks.find(x => x.id === s.week_id); const p = postById(s.post_id);
        return { ...s, rewards: rewardView(s.reward_items, s.reward_random, false), task_title: t?.title, task_kind: t?.kind, week_title: w?.title, week_character: w?.character, user_nick: nickOf(s.user_id),
                 post_title: p?.title, post_cover: p?.images[0]?.thumb_path || null, post_image_count: p?.images.length || 0,
                 post_edited_after: !!(p && p.edited_at && p.edited_at > (s.reviewed_at || s.created_at)) };
      });
      return ok({ counts, total: rows.length, items: rows });
    },
    async research_review_submission(a) {
      const s = S.subs.find(x => x.id === a.p_submission_id); if (!s) return err('제출을 찾을 수 없어요.');
      if (s.status !== 'pending') return ok({ status: s.status, already: true, reward_result: s.reward_result });
      if (a.p_decision === 'reject' && !(a.p_reason || '').trim()) return err('반려 사유를 입력해주세요.');
      if ((a.p_reason || '').trim().length > 500) return err(a.p_decision === 'approve' ? '운영진 코멘트는 500자까지 쓸 수 있어요.' : '반려 사유는 500자까지 쓸 수 있어요.');
      const u = await meUser();
      const has = s.reward_amount || (s.reward_items || []).length || (s.reward_random?.options || []).length;
      let pick = null;
      if (a.p_decision === 'approve' && (s.reward_random?.options || []).length) {
        const opts = s.reward_random.options; const total = opts.reduce((n, o) => n + (o.weight ?? 1), 0); let roll = Math.floor(Math.random() * total);
        pick = opts.find(o => (roll -= (o.weight ?? 1)) < 0) || opts[0];
      }
      Object.assign(s, a.p_decision === 'approve'
        ? { status: 'approved', review_comment: (a.p_reason || '').trim() || null, reward_status: !has ? 'none' : s.is_test ? 'test' : 'disabled',
            reward_result: { granted: false, records: s.reward_amount, items: s.reward_items || [], random: pick ? { item_id: pick.item_id, name: pick.name } : null, decided_at: nowIso() } }
        : { status: 'rejected', reject_reason: a.p_reason.trim() },
        { reviewed_by_nick: nickOf(u.id), reviewed_at: nowIso(), snapshot: snapOf(postById(s.post_id)) || s.snapshot });   // 심사 당시 내용 고정
      save(); return ok({ status: s.status, reward_status: s.reward_status, reward_amount: s.reward_amount, is_test: s.is_test, reward_result: s.reward_result });
    },
    async research_admin_list_tasks() { return ok(S.tasks.map(t => ({ ...taskJson(t), rewards_admin: rewardView(t.reward_items, t.reward_random, true), needs_item_link: [...(t.reward_items || []), ...(t.reward_random?.options || [])].some(x => !x.item_id), pending_count: S.subs.filter(s => s.task_id === t.id && s.status === 'pending').length }))); },
    async research_admin_search_items() { return ok([]); },   // 미리보기에는 실제 아이템 목록이 없음(운영 아이템은 읽지 않음)
    async research_admin_save_task(a) {
      const v = { ...(a.p_task || {}) };
      if (v.reward_items) v.reward_items = v.reward_items.map(r => ({ item_id: r.item_id || null, name: r.name, qty: r.qty || 1 }));
      if (v.id) { const t = S.tasks.find(x => x.id === Number(v.id)); Object.assign(t, v, { id: t.id, kind: t.kind, submit_limit: t.kind === 'weekly' ? t.submit_limit : (v.submit_limit || t.submit_limit), reward_amount: Number(v.reward_amount ?? t.reward_amount) }); save(); return ok(t.id); }
      const id = nid(); S.tasks.push({ kind: 'general', status: 'draft', submit_limit: 'once_per_user', reward_amount: 0, sort_order: 0, ...v, id, reward_amount: Number(v.reward_amount || 0) }); save(); return ok(id);
    },
    async research_admin_list_weeks() {
      return ok({ server_now: nowIso(), candidate_count_now: 0, items: S.weeks.map(w => ({ ...weekJson(w), consent_now: false, owner_changed: false, character_deleted: false, drawn_at: w.starts_at, drawn_by_nick: '첫 회차 지정' })) });
    },
    async research_weekly_rollover() { return ok({ action: 'none', week_id: curWeek()?.id, status: curWeek()?.status, preview: true }); },
    async research_weekly_rollover_recover() { return ok({ action: 'none', mode: 'recover', preview: true }); },
    async research_archive_filters() {
      return ok({ tasks: S.tasks.filter(t => t.status !== 'draft').sort((x, y) => (y.kind === 'weekly') - (x.kind === 'weekly') || x.sort_order - y.sort_order)
                    .map(t => ({ id: t.id, title: t.title, kind: t.kind, status: t.status })),
                  weeks: S.weeks.filter(w => Date.parse(w.starts_at) <= Date.now()).map(w => ({ id: w.id, title: w.title, starts_at: w.starts_at, ends_at: w.ends_at, status: w.status,
                    character_name: w.character ? ((w.character.owner_custom_name || '').trim() || w.character.name) : null })) });
    },
    async research_archive_list(a) {
      const tid = a.p_task_id ? Number(a.p_task_id) : null, wid = a.p_week_id ? Number(a.p_week_id) : null;
      const live = s => ['pending', 'approved'].includes(s.status);
      const weekly = tid && S.tasks.find(t => t.id === tid)?.kind === 'weekly';
      const all = S.posts.filter(p => p.board === 'research'
          && (!tid || S.subs.some(s => s.post_id === p.id && s.task_id === tid && live(s)) || (weekly && p.research_week_id) || p.link_task_id === tid)
          && (!wid || p.research_week_id === wid || p.link_week_id === wid || S.subs.some(s => s.post_id === p.id && s.week_id === wid && live(s))))
        .sort((x, y) => y.created_at.localeCompare(x.created_at));
      return ok({ total: all.length, items: all.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 20)).map(listPost) });
    },
    async research_admin_draw() { return err('미리보기에서는 추첨하지 않아요.'); },
    async research_admin_create_week() { return err('미리보기에서는 주차를 만들지 않아요.'); },
    async research_admin_update_week() { return err('미리보기에서는 주차를 바꾸지 않아요.'); },
    async research_admin_delete_week() { return err('미리보기에서는 주차를 지우지 않아요.'); },
    async gallery_admin_storage_report() { return ok({ queue_pending: 0, queue_failed: 0, stale_uploads: 0, stale_slots: 0, orphan_objects: 0, bucket_objects: Object.keys(S.images).length, bucket_bytes: 0, failed: [], orphans: [] }); },
    async gallery_admin_enqueue_orphans() { return ok(0); },
    async gallery_admin_retry_purge() { return ok(0); },
  };

  const withLock = fn => (navigator.locks?.request ? navigator.locks.request('galleryPreviewStore', fn) : fn());
  async function mock(name, args) { return withLock(() => mockUnlocked(name, args)); }
  async function mockUnlocked(name, args) {
    await ensure();
    showBar();
    try { const v = JSON.parse(store.get() || 'null'); if (v && v.ready && v.seedVer === SEED_VER) S = v; } catch (e) { /* 메모리 값 사용 */ }   // 다른 탭의 변경 반영
    const before = JSON.stringify(S);
    saveFailed = false;
    let r;
    try { r = await H[name](args || {}); } catch (e) { console.error('[미리보기]', name, e); r = err('미리보기 처리 중 오류: ' + e.message); }
    if (saveFailed) {
      S = JSON.parse(before);   // 저장되지 않은 변경은 되돌린다(화면에는 있다가 다음 페이지에서 사라지는 일 방지)
      return err('미리보기 저장 공간이 부족해 저장하지 못했어요. 표시줄의 [미리보기 초기화]로 비운 뒤 다시 시도해 주세요. (운영 데이터와는 무관)');
    }
    return r;
  }

  const realRpc = sb.rpc.bind(sb);
  sb.rpc = function (name, args, opts) {
    if (!MOCKED.has(name)) return realRpc(name, args, opts);
    // 미리보기 on: 갤러리·연구과제 호출은 전부 이 탭 안의 저장소로(운영 쓰기 없음). 운영 응답을 가짜로 바꿔치기하지 않는다.
    const p = mock(name, args);
    p.abortSignal = () => p;   // 호출부 호환
    return p;
  };

  // 비로그인 로컬 확인용: 미리보기가 켜졌을 때만 가짜 관리자(운영 계정과 무관, 화면 확인용)
  if (realGetUser) {
    window.getUser = async () => { const u = await realGetUser(); return u || (active() ? FAKE_USER : null); };
  }

  // Edge Function(gallery-image) 대신: 이미지를 이 탭에만 보관(작게 줄여 저장)
  function patchImageFns() {
    if (typeof window.glInvokeImageFn === 'function' && !window.glInvokeImageFn.__preview) {
      const real = window.glInvokeImageFn;
      const fn = async body => {
        if (!active()) return real(body);
        return withLock(() => fnUnlocked(body));
      };
      const fnUnlocked = async body => {
        await ensure();
        if (body instanceof FormData) {
          const blob = body.get('image');
          const bmp = await createImageBitmap(blob);
          const scale = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
          const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          try { const v = JSON.parse(store.get() || 'null'); if (v && v.ready && v.seedVer === SEED_VER) S = v; } catch (e) { /* 무시 */ }
          const img = addImage(c.toDataURL(blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', 0.82), bmp.width, bmp.height);
          const uid = nid(); S.uploads[uid] = img;
          if (!save()) { delete S.uploads[uid]; delete S.images[img.path]; throw new Error('미리보기 저장 공간이 부족해요. 표시줄의 [미리보기 초기화] 후 다시 올려 주세요.'); }
          return { upload_id: uid, path: img.path, thumb_path: img.thumb_path, width: img.width, height: img.height, size: blob.size };
        }
        return { ok: true, purged: 0, kept_in_use: 0, failed: 0, expired_slots: 0 };
      };
      fn.__preview = true;
      window.glInvokeImageFn = fn;
    }
    if (typeof window.glImgUrl === 'function' && !window.glImgUrl.__preview) {
      const realUrl = window.glImgUrl;
      const fu = path => (String(path || '').startsWith('preview/') ? ((S && S.images[path]) || (() => { try { return JSON.parse(store.get() || '{}').images?.[path] || ''; } catch (e) { return ''; } })()) : realUrl(path));
      fu.__preview = true;
      window.glImgUrl = fu;
    }
  }
  patchImageFns();
  document.addEventListener('DOMContentLoaded', patchImageFns);

  window.__galleryPreview = { rpc: (n, a) => mock(n, a), active };
})();
