// ============================================================
// 댓글·답글 이모지 반응 공용 모듈 (2026-11-06)
//   적용: 분양 상세(pages/adoption-detail.html)
//         · 문의/버그리포트 상세(pages/inquiry-detail.html, pages/bug-report-detail.html — 댓글 id 가 uuid)
//   서버: supabase/adoption_comment_reactions_apply_1106.sql, 
//         supabase/support_comment_reactions_apply_1106.sql
//
//   · 1인 1댓글 1반응 — 안 누른 상태에서 이모지 = 등록, 다른 이모지 = 변경, 내 이모지 다시 = 취소
//   · 서버에는 "최종 상태"(코드 또는 null)만 보낸다 → 연타·여러 탭에서도 결과가 한 가지로 정해짐
//   · 낙관적 표시: 서버가 확인한 상태(confirmed) + 내가 원하는 상태(desired)로 화면을 계산하고,
//     요청 중 추가 클릭은 desired 만 바꿔 두었다가 응답 뒤 한 번 더 보낸다. 실패하면 confirmed 로 되돌림.
//   · 조회는 화면에 표시한 댓글 id 를 묶어서 한 번(200개 단위) — 댓글마다 요청하지 않는다.
//   이 파일은 sb(js/auth.js) 뒤에 로드한다. 사용자 입력은 다루지 않는다(코드/숫자만 출력).
// ============================================================
(function () {
  // 반응 아트웍(2026-11-07) — images/icons/reaction-*.png, 표시 순서 = 배열 순서
  //   경로는 이 스크립트 위치 기준(js/ → ../images/icons/) — pages/ 의 정적 태그·DM(chat.js 지연 로딩) 모두 같은 결과
  //   서버 코드: supabase/comment_reactions_artwork_codes_1107.sql (sad→cry 전환, laugh·surprised 는 보류 — 아래 목록에 없으면 표시 안 함)
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src)
    || (document.querySelector('script[src*="comment-reactions.js"]') || {}).src
    || location.href;
  const icon = file => new URL(`../images/icons/${file}`, SCRIPT_SRC).href;
  const EMOJIS = [
    { code: 'heart',     img: icon('reaction-heart.png'),     label: '하트' },
    { code: 'check',     img: icon('reaction-check.png'),     label: '체크' },
    { code: 'thumbs_up', img: icon('reaction-thumbs-up.png'), label: '따봉' },
    { code: 'cry',       img: icon('reaction-cry.png'),       label: 'ㅠㅠ' },
    { code: 'blank',     img: icon('reaction-blank.png'),     label: '멍' },
  ];
  const BY_CODE = Object.fromEntries(EMOJIS.map(e => [e.code, e]));
  const CHUNK = 200;
  // 이미지는 장식(alt="") — 이름은 버튼의 aria-label/title 이 맡아 중복 낭독 없음. width/height 로 로딩 전후 크기 고정
  const imgTag = (e, size, cls) => `<img class="${cls}" src="${e.img}" alt="" width="${size}" height="${size}" decoding="async" draggable="false">`;
  // 첫 선택창이 비어 보이지 않게 — 반응 영역을 처음 그릴 때 한 번 미리 받아 둔다
  let preloaded = false;
  function preload() {
    if (preloaded) return;
    preloaded = true;
    EMOJIS.forEach(e => { const i = new Image(); i.decoding = 'async'; i.src = e.img; });
  }

  // 화면 낭독기 안내 + 오류 알림(짧게 떴다 사라짐) — 페이지당 1개
  let liveEl = null, toastTimer = null;
  function announce(msg, isError) {
    if (!liveEl) {
      liveEl = document.createElement('div');
      liveEl.className = 'cr-toast';
      liveEl.setAttribute('role', 'status');
      liveEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(liveEl);
    }
    liveEl.textContent = msg;
    liveEl.classList.toggle('is-visible', !!isError);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { liveEl.classList.remove('is-visible'); liveEl.textContent = ''; }, isError ? 3200 : 1500);
  }

  function errorText(error) {
    const m = `${error?.message || ''} ${error?.details || ''}`;
    if (/NOT_AUTHENTICATED|JWT|not authenticated/i.test(m)) return '로그인이 필요해요.';
    if (/COMMENT_NOT_FOUND/.test(m)) return '삭제됐거나 볼 수 없는 댓글이에요.';
    if (/INVALID_REACTION/.test(m)) return '지원하지 않는 반응이에요.';
    if (/DM_UNAVAILABLE/.test(m)) return '현재 이 사용자에게 반응을 남길 수 없습니다.';   // DM 차단 — 방향은 알리지 않음(기존 DM 안내와 동일)
    if (/테스트 기간/.test(m)) return '지금은 테스트 기간이라 운영진만 반응할 수 있어요.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return '네트워크 오류로 반응을 저장하지 못했어요.';
    return '반응을 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
  }

  /**
   * @param {object} opts
   *   summaryRpc  : 조회 RPC 이름 (p_comment_ids bigint[] | uuid[])
   *   setRpc      : 등록/변경/취소 RPC 이름 (p_comment_id, p_reaction text|null)
   *   idType      : 'bigint'(기본 — 분양) | 'uuid'(문의·버그리포트 — jsonb 댓글 id)
   *   extraArgs   : 두 RPC 에 함께 보낼 인자 (예: { p_kind: 'inquiry', p_post_id: '…' })
   *   isLoggedIn  : () => boolean
   *   onLoginRequired : () => void   (기본: login.html 이동 — 기존 북마크와 같은 방식)
   */
  window.createCommentReactions = function createCommentReactions(opts) {
    const st = new Map();   // id(string) → { counts:{code:n}, mine:code|null, desired:code|null|undefined, busy:bool }
    const isLoggedIn = opts.isLoggedIn || (() => false);
    const onLoginRequired = opts.onLoginRequired || (() => { window.location.href = 'login.html'; });
    let openPop = null;     // { bar, pop, trigger }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    // 댓글 id 정규화 — 형식이 맞지 않으면 null (화면에 반응 버튼을 만들지 않음)
    const normId = opts.idType === 'uuid'
      ? id => { const v = String(id ?? '').trim().toLowerCase(); return UUID_RE.test(v) ? v : null; }
      : id => { const n = Number(id); return Number.isSafeInteger(n) && n > 0 ? String(n) : null; };
    const toArg = key => opts.idType === 'uuid' ? key : Number(key);
    const extra = () => ({ ...(typeof opts.extraArgs === 'function' ? opts.extraArgs() : (opts.extraArgs || {})) });

    function viewOf(id) {
      const s = st.get(id);
      if (!s) return null;
      const want = s.desired === undefined ? s.mine : s.desired;
      const counts = { ...s.counts };
      if (s.mine) counts[s.mine] = (counts[s.mine] || 0) - 1;
      if (want) counts[want] = (counts[want] || 0) + 1;
      return { counts, mine: want };
    }

    function barHtml(id) {
      const key = normId(id);
      return key ? `<span class="cr-bar" data-cr-cid="${key}"></span>` : '';
    }

    function renderBar(bar) {
      preload();
      const id = bar.dataset.crCid;
      const v = viewOf(id);
      const wasOpen = openPop && openPop.bar === bar;
      if (wasOpen) closePop(false);
      const chips = v ? EMOJIS.filter(e => (v.counts[e.code] || 0) > 0).map(e => {
        const n = v.counts[e.code];
        const mine = v.mine === e.code;
        const label = `${e.label} ${n}명${mine ? ', 내 반응 — 누르면 취소' : ' — 누르면 이 반응으로 표시'}`;
        return `<button type="button" class="cr-chip${mine ? ' is-mine' : ''}" data-cr-code="${e.code}" aria-pressed="${mine}" aria-label="${label}" title="${e.label}">`
             + `${imgTag(e, 20, 'cr-img')}<span class="cr-n" aria-hidden="true">${n}</span></button>`;
      }).join('') : '';
      bar.innerHTML = chips + (opts.showAdd === false ? ''
        : `<span class="cr-add-wrap"><button type="button" class="cr-add" aria-haspopup="true" aria-expanded="false" aria-label="반응 추가" title="반응 추가">`
        + `${imgTag(BY_CODE.thumbs_up, 19, 'cr-add-img')}<span class="cr-plus" aria-hidden="true">+</span></button></span>`);   // 아이콘일 뿐 — 누르면 선택창만 열림
      bar.classList.toggle('cr-empty', !chips);
      if (typeof opts.onRender === 'function') opts.onRender(bar, !!chips);
      if (wasOpen) openPopFor(bar, false);
    }

    function renderId(id) {
      document.querySelectorAll(`.cr-bar[data-cr-cid="${CSS.escape(String(id))}"]`).forEach(renderBar);
    }

    // ── 조회 (표시 중인 id 묶음) ──
    async function load(ids, root) {
      const list = [...new Set((ids || []).map(normId).filter(Boolean))];
      const paint = () => (root || document).querySelectorAll('.cr-bar[data-cr-cid]').forEach(b => {
        if (list.includes(b.dataset.crCid)) renderBar(b);
      });
      paint();   // 목록을 다시 그린 직후 — 이미 아는 값으로 먼저 그려 깜빡임 방지
      for (let i = 0; i < list.length; i += CHUNK) {
        const part = list.slice(i, i + CHUNK);
        const { data, error } = await sb.rpc(opts.summaryRpc, { ...extra(), p_comment_ids: part.map(toArg) });
        if (error) { console.warn('[comment-reactions] 조회 실패', error); continue; }
        part.forEach(key => {
          const row = data?.[key];
          const prev = st.get(key);
          if (prev?.busy) return;      // 저장 중인 항목은 응답이 정리한다
          if (row) st.set(key, { counts: row.counts || {}, mine: row.mine || null, desired: undefined, busy: false });
          else st.delete(key);         // 볼 수 없는 댓글 → 표시 안 함
        });
      }
      paint();
    }

    // ── 저장 (최종 상태 전송, 응답 뒤 원하는 상태와 다르면 한 번 더) ──
    async function flush(id) {
      const s = st.get(id);
      if (!s || s.busy) return;
      if (s.desired === undefined || s.desired === s.mine) { s.desired = undefined; renderId(id); return; }
      s.busy = true;
      const sending = s.desired;
      const { data, error } = await sb.rpc(opts.setRpc, { ...extra(), p_comment_id: toArg(id), p_reaction: sending });
      s.busy = false;
      if (error) {
        s.desired = undefined;       // 서버가 확인한 상태로 복구
        renderId(id);
        announce(errorText(error), true);
        if (/COMMENT_NOT_FOUND/.test(`${error.message} ${error.details || ''}`)) { st.delete(id); renderId(id); }
        return;
      }
      s.counts = data?.counts || {};
      s.mine = data?.mine || null;
      if (s.desired === sending) s.desired = undefined;
      renderId(id);
      if (s.desired !== undefined) flush(id);
      else announce(s.mine && BY_CODE[s.mine] ? `${BY_CODE[s.mine].label} 반응을 남겼어요.` : '반응을 취소했어요.');
    }

    function choose(id, code) {
      if (!isLoggedIn()) { onLoginRequired(); return; }
      let s = st.get(id);
      if (!s) { s = { counts: {}, mine: null, desired: undefined, busy: false }; st.set(id, s); }
      const cur = s.desired === undefined ? s.mine : s.desired;
      s.desired = cur === code ? null : code;      // 같은 것 = 취소, 다른 것 = 변경/등록
      renderId(id);
      flush(id);
    }

    // ── 팝오버 ──
    //   두 가지 여는 방식
    //   · 인라인(댓글·답글): 묶음 안의 [반응 추가] 버튼 아래에 붙는다 — openPopFor(bar)
    //   · 기준 요소(DM): 말풍선·작은 반응 버튼 기준으로 화면에 띄운다(position:fixed) — openPicker(id, anchor)
    //   선택·키보드·포커스 처리는 팝오버 요소 자체에 붙여 두 방식이 똑같이 동작한다.
    function buildPop(id) {
      const v = viewOf(id);
      const pop = document.createElement('div');
      pop.className = 'cr-pop';
      pop.setAttribute('role', 'group');
      pop.setAttribute('aria-label', '이모지 반응 선택');
      pop.innerHTML = EMOJIS.map(e => {
        const mine = v?.mine === e.code;
        return `<button type="button" class="cr-pop-btn${mine ? ' is-mine' : ''}" data-cr-pick="${e.code}" aria-pressed="${mine}" aria-label="${e.label}${mine ? ' (내 반응 — 누르면 취소)' : ''}" title="${e.label}">${imgTag(e, 30, 'cr-pop-img')}</button>`;
      }).join('');
      pop.addEventListener('click', e => {
        const b = e.target.closest('[data-cr-pick]');
        if (!b || !openPop || openPop.pop !== pop) return;
        e.stopPropagation();
        const { id: pid, bar } = openPop;
        const back = openPop.returnFocus;
        closePop(false);
        choose(pid, b.dataset.crPick);
        // 선택 완료 → 포커스 복귀 (인라인: 다시 그려진 [반응 추가], 기준 요소: 연 버튼 — 길게 누르기는 복귀 없음)
        const t = bar && bar.isConnected ? bar.querySelector('.cr-add') : (back && back.isConnected ? back : null);
        if (t) t.focus({ preventScroll: true });
      });
      pop.addEventListener('keydown', e => {
        const btns = [...pop.querySelectorAll('button')];
        const i = btns.indexOf(e.target);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); btns[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1].focus(); }
      });
      // Tab 으로 팝오버 밖에 나가면 닫기
      pop.addEventListener('focusout', e => {
        if (!openPop || openPop.pop !== pop) return;
        const next = e.relatedTarget;
        if (!next || pop.contains(next) || next === openPop.trigger) return;
        closePop(false);
      });
      return pop;
    }

    // 잘리지 않아야 하는 영역 = 화면 ∩ 가장 가까운 스크롤/잘림 영역
    function clipBox(el) {
      let box = { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: window.innerHeight };
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) {
          const pr = p.getBoundingClientRect();
          box = { left: Math.max(box.left, pr.left), right: Math.min(box.right, pr.right), top: Math.max(box.top, pr.top), bottom: Math.min(box.bottom, pr.bottom) };
          break;
        }
      }
      return box;
    }

    function focusInto(pop) { (pop.querySelector('.is-mine') || pop.querySelector('button')).focus({ preventScroll: true }); }

    function openPopFor(bar, focusIt = true) {
      closePop(false);
      const trigger = bar.querySelector('.cr-add');
      const wrap = bar.querySelector('.cr-add-wrap');
      if (!trigger || !wrap) return;
      const pop = buildPop(bar.dataset.crCid);
      wrap.appendChild(pop);
      trigger.setAttribute('aria-expanded', 'true');
      // 화면·스크롤 영역 밖으로 나가지 않게 — 좌우는 밀어 넣고, 아래가 잘리면 위로 연다
      pop.style.left = '0px';
      const box = clipBox(wrap);
      const r = pop.getBoundingClientRect();
      const overR = r.right - (box.right - 8);
      const overL = (box.left + 8) - r.left;
      if (overR > 0) pop.style.left = `${-Math.min(overR, Math.max(0, r.left - (box.left + 8)))}px`;
      else if (overL > 0) pop.style.left = `${overL}px`;
      if (r.bottom > box.bottom - 4 && (r.top - box.top) > r.height + 48) pop.classList.add('cr-pop--up');
      openPop = { id: bar.dataset.crCid, bar, pop, trigger, returnFocus: trigger };
      if (focusIt) focusInto(pop);
    }

    /**
     * 기준 요소 옆에 선택창 열기 (DM 등)
     *   o.trigger     : 연 버튼(aria-expanded 갱신, 다시 누르면 닫힘 판단) — 길게 누르기는 없음
     *   o.returnFocus : 닫힌 뒤 포커스를 돌려줄 요소 (없으면 이동 안 함)
     *   o.align       : 'start' | 'end' (기준 요소의 왼쪽/오른쪽 끝에 맞춤)
     *   o.focus       : 열자마자 선택창 안으로 포커스 (기본 true)
     */
    function openPicker(id, anchor, o = {}) {
      const key = normId(id);
      if (!key || !anchor) return;
      if (!isLoggedIn()) { onLoginRequired(); return; }
      closePop(false);
      const pop = buildPop(key);
      pop.classList.add('cr-pop--fixed');
      pop.style.visibility = 'hidden';
      document.body.appendChild(pop);
      const a = anchor.getBoundingClientRect();
      const box = clipBox(anchor);
      const w = pop.offsetWidth, h = pop.offsetHeight;
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      let left = o.align === 'end' ? a.right - w : a.left;
      left = Math.min(Math.max(left, Math.max(8, box.left + 4)), Math.min(vw - 8, box.right - 4) - w);
      left = Math.max(8, left);
      // 기본은 위(말풍선을 가리지 않게) — 위 공간이 없으면 아래, 둘 다 없으면 보이는 영역 안으로 밀어 넣음
      let top = a.top - h - 6;
      if (top < Math.max(8, box.top + 4)) top = a.bottom + 6;
      if (top + h > Math.min(vh - 8, box.bottom - 4)) top = Math.max(8, Math.min(vh - 8, box.bottom - 4) - h);
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      pop.style.visibility = '';
      if (o.trigger) o.trigger.setAttribute('aria-expanded', 'true');
      openPop = { id: key, bar: null, pop, trigger: o.trigger || null, returnFocus: o.returnFocus || null, fixed: true };
      // 떠 있는 창은 기준 요소가 스크롤되면 위치가 어긋나므로 닫는다
      openPop.onScroll = e => { if (openPop && openPop.pop === pop && !pop.contains(e.target)) closePop(false); };
      window.addEventListener('scroll', openPop.onScroll, true);
      window.addEventListener('resize', openPop.onScroll);
      if (o.focus !== false) focusInto(pop);
    }

    function closePop(returnFocus) {
      if (!openPop) return;
      const { pop, trigger } = openPop;
      const back = openPop.returnFocus;
      if (openPop.onScroll) {
        window.removeEventListener('scroll', openPop.onScroll, true);
        window.removeEventListener('resize', openPop.onScroll);
      }
      openPop = null;
      pop.remove();
      if (trigger && trigger.isConnected) trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus && back && back.isConnected) back.focus({ preventScroll: true });
    }

    function isOpenFor(id, trigger) {
      return !!openPop && openPop.id === normId(id) && (!trigger || openPop.trigger === trigger);
    }

    // ── 이벤트 (root 단위 위임 — 다시 그려도 유지) ──
    function attach(root) {
      if (root.__crAttached) return;
      root.__crAttached = true;
      root.addEventListener('click', e => {
        if (e.target.closest('.cr-pop')) return;   // 선택창 안 클릭은 선택창이 처리
        const bar = e.target.closest('.cr-bar');
        if (!bar || !root.contains(bar)) return;
        const id = bar.dataset.crCid;
        const chip = e.target.closest('.cr-chip');
        if (chip) { choose(id, chip.dataset.crCode); const again = bar.querySelector(`.cr-chip[data-cr-code="${chip.dataset.crCode}"]`) || bar.querySelector('.cr-add'); again?.focus(); return; }
        if (e.target.closest('.cr-add')) {
          if (!isLoggedIn()) { onLoginRequired(); return; }
          if (openPop && openPop.bar === bar) closePop(true); else openPopFor(bar);
        }
      });
    }
    // 바깥 클릭·Escape 로 닫기 (페이지 전체)
    document.addEventListener('pointerdown', e => {
      if (openPop && !openPop.pop.contains(e.target) && !(openPop.trigger && openPop.trigger.contains(e.target))) closePop(false);
    }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && openPop) { closePop(true); }
    });

    return { barHtml, load, attach, render: renderId, openPicker, closePicker: () => closePop(true), isOpenFor, EMOJIS };
  };
})();
