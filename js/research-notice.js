// ============================================================
// 이번 주의 연구대상 — 접속 안내 팝업 (2026-11-06)
//   js/sidebar.js 가 로그인 상태일 때만 이 파일을 불러온다(비로그인 = 요청 0).
//   ① 새 소유주 안내(분양으로 받은 개체 중, 이전 소유주가 '안내'를 켜 둔 개체) — 여러 개체를 한 번에 묶어 ON/OFF 선택
//   ② 기능 첫 안내 — 개체를 1개 이상 가진 유저에게 1회. 확인하면 다시 띄우지 않는다(서버 research_user_notices).
//   선택하지 않거나 '나중에' 를 누르면 전부 OFF 그대로. 이후 설정은 MY > 내 캐릭터 > 연구대상 설정.
//   서버 확인은 탭 세션당 1회(sessionStorage) — 페이지 이동마다 다시 묻지 않는다.
// ============================================================
(function () {
  const SETTINGS_PAGE = 'research-settings.html';
  const esc = s => (typeof glEsc === 'function' ? glEsc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const charName = c => (c.owner_custom_name || '').trim() || c.name || '(이름 없음)';

  function thumbHtml(c) {
    const real = !c.default_image_index && (c.thumbnail_url || c.image_url);
    const src = typeof resolveCharacterImage === 'function' ? resolveCharacterImage(c) : (c.thumbnail_url || c.image_url || '');
    const sens = !!c.is_sensitive && !!real;
    return `<span class="gl-char-thumb${sens ? ' blurred' : ''}" style="background-image:url('${String(src).replace(/["'()\\\n\r]/g, encodeURIComponent)}')"></span>`;
  }

  function openOverlay(html) {
    const ov = document.createElement('div');
    ov.className = 'rs-pop-overlay';
    ov.innerHTML = `<div class="rs-pop-card" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(ov);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return { el: ov, close() { ov.remove(); document.body.style.overflow = prev; } };
  }

  async function ack(choice) {
    try { await sb.rpc('research_ack_intro', { p_choice: choice }); } catch (e) { /* 다음 세션에 다시 확인 */ }
  }
  window.ackResearchIntro = ack;

  function showIntro() {
    const pop = openOverlay(`
      <div class="rs-pop-head">
        <p class="rs-pop-title">내 개체를 이번 주의 연구대상으로 소개할까요?</p>
        <p class="rs-pop-desc">선정된 개체는 다른 연구원들의 그림 주제가 됩니다.
참여는 선택이며, 개체별로 설정할 수 있어요.
설정하지 않으면 모든 개체는 OFF 로 유지돼요.</p>
      </div>
      <div class="rs-pop-body"><p class="gl-sub" style="font-size:12px;">나중에도 MY &gt; 내 캐릭터 &gt; ‘연구대상 설정’에서 언제든 바꿀 수 있어요.</p></div>
      <div class="rs-pop-foot">
        <button type="button" class="btn-ghost rs-btn-sm" data-later>나중에 설정하기</button>
        <a class="btn-secondary rs-btn-sm" href="${SETTINGS_PAGE}" data-go>개체별로 설정하기</a>
      </div>`);
    pop.el.querySelector('[data-later]').addEventListener('click', () => { ack('later'); pop.close(); });
    pop.el.querySelector('[data-go]').addEventListener('click', e => {
      e.preventDefault();
      ack('saved').finally(() => { location.href = SETTINGS_PAGE; });
    });
  }

  function showPrompts(list) {
    const pop = openOverlay(`
      <div class="rs-pop-head">
        <p class="rs-pop-title">새로 받은 개체를 연구대상으로 소개할까요?</p>
        <p class="rs-pop-desc">이전 소유주가 ‘새 소유주에게 참여 여부 안내’를 켜 둔 개체예요(${list.length}개).
소개할 개체만 체크해 주세요. 체크하지 않은 개체와 ‘나중에’ 는 OFF 로 유지돼요.</p>
        <label class="rs-toggle" style="margin-top:8px;"><input type="checkbox" data-all>모두 선택</label>
      </div>
      <div class="rs-pop-body"><div class="rs-list rs-pop-list">
        ${list.map(c => `<label class="rs-row" style="position:relative;cursor:pointer;">
          ${thumbHtml(c)}
          <span class="gl-char-info"><span class="gl-char-name">${esc(charName(c))}</span><span class="gl-char-line">${esc(c.species_name || '')}</span></span>
          <span class="rs-toggles"><span class="rs-toggle"><input type="checkbox" data-id="${Number(c.id)}">소개 동의</span></span>
        </label>`).join('')}
      </div></div>
      <div class="rs-pop-foot">
        <button type="button" class="btn-ghost rs-btn-sm" data-later>나중에 설정하기</button>
        <button type="button" class="btn-secondary rs-btn-sm" data-save>선택 저장</button>
      </div>`);
    const boxes = () => [...pop.el.querySelectorAll('input[data-id]')];
    pop.el.querySelector('[data-all]').addEventListener('change', e => boxes().forEach(b => { b.checked = e.target.checked; }));
    const finish = async (later) => {
      const btns = pop.el.querySelectorAll('.rs-pop-foot button');
      btns.forEach(b => { b.disabled = true; });
      const ids = later ? [] : boxes().filter(b => b.checked).map(b => Number(b.dataset.id));
      const { error } = await sb.rpc('research_resolve_prompts', { p_later: later, p_consent_ids: ids });
      if (error) { btns.forEach(b => { b.disabled = false; }); alert(error.message || '저장하지 못했어요.'); return; }
      pop.close();
    };
    pop.el.querySelector('[data-later]').addEventListener('click', () => finish(true));
    pop.el.querySelector('[data-save]').addEventListener('click', () => finish(false));
  }

  window.initResearchNotice = async function (user) {
    if (!user || typeof sb === 'undefined') return;
    const page = location.pathname.split('/').pop();
    if (page === SETTINGS_PAGE || page === 'login.html' || page === 'signup.html') return;
    const key = 'rsNoticeChecked:' + user.id;
    try { if (sessionStorage.getItem(key)) return; } catch (e) { /* 저장소 없음 → 매번 확인(가벼운 숫자 조회) */ }

    const { data: st, error } = await sb.rpc('research_my_notice_state');
    if (error || !st) return;   // 기능 미배포/오류 — 조용히 넘어감
    try { sessionStorage.setItem(key, '1'); } catch (e) { /* 무시 */ }

    // 다른 팝업(이메일 인증 등)이 떠 있으면 겹치지 않게 이번엔 건너뛴다(다음 세션에 다시)
    await new Promise(r => setTimeout(r, 600));
    if (document.body.style.overflow === 'hidden') { try { sessionStorage.removeItem(key); } catch (e) { /* 무시 */ } return; }

    if (st.pending_prompts > 0) {
      const { data: list } = await sb.rpc('research_get_prompts');
      if (Array.isArray(list) && list.length) { showPrompts(list); return; }
    }
    if (st.intro_needed) showIntro();
  };
})();
