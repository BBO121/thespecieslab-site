// ── 디자이너 / 아티스트 선택 컴포넌트 (LABBER 디자인 승인 신청 폼용) ─────────────────
// pages/character-register.html 의 "제작자(디자이너 + 아티스트)" 입력 방식을 그대로 따른다:
//   · 사이트 유저(닉네임/아이디 검색) / 사이트 밖 유저(이름 직접 입력) 두 탭, 여러 명, 추가 순서대로 표시
//   · 디자이너: 외부 유저에 연락처(선택) 있음 / 아티스트: 연락처 없음
//   · 값 형태도 등록 화면의 designers/artists 배열과 같다:
//       { type:'site', userId, nickname }  |  { type:'external', name, contact? }
// character-register.html 의 기존 인라인 함수는 건드리지 않는다(일반 등록 회귀 방지) — 이 파일은 신청 폼에서만 쓴다.
// 서버(save_labber_design_draft → _labber_design_parse_creators)가 값을 다시 검증하고 닉네임을 새로 조회한다.
//
// 사용: const picker = CreatorPicker.create(rootEl, { kind:'designer', required:true });
//       picker.getValue() / picker.setValue(list) / picker.setDisabled(bool) / picker.clear()
// 의존: search.js(searchUsers, debounce), main.js(escapeHtml)

(function () {
  const MAX_ITEMS = 10;   // 서버(_labber_design_parse_creators)와 동일한 상한
  const NAME_MAX = 40;
  const CONTACT_MAX = 100;

  const CFG = {
    designer: {
      label: '디자이너',
      hint: '여러 명 추가 가능 · 순서대로 표시됩니다',
      withContact: true,
      extLabel: '디자이너',
      badge: '디자이너',
    },
    artist: {
      label: '아티스트',
      hint: '개체 일러스트를 그린 사람 크레딧 · 여러 명 추가 가능',
      withContact: false,
      extLabel: '아티스트',
      badge: '아티스트',
    },
  };

  function esc(s) {
    return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
      : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function create(root, options) {
    const opts = options || {};
    const kind = opts.kind === 'artist' ? 'artist' : 'designer';
    const cfg = CFG[kind];
    const required = !!opts.required;
    // 같은 kind(디자이너/아티스트)를 한 화면에서 두 번 쓸 수 있게(개체 제작자 / SUBJECT 제작자) 표시 문구만 바꿀 수 있다.
    // 동작(사이트/외부 유저, 연락처 규칙)은 kind 로만 결정된다.
    const labelText = opts.label || cfg.label;
    const hintText = opts.hint || cfg.hint;

    let list = [];
    let disabled = false;
    let seq = 0;   // 검색 응답 순서 보장(늦게 도착한 오래된 응답 무시)

    root.classList.add('cp');
    root.innerHTML = `
      <label class="form-label cp-label">${esc(labelText)}${required ? ' <span class="required">*</span>' : ' <span class="llapp-optional">선택</span>'}</label>
      <p class="form-hint cp-hint">${esc(hintText)}</p>
      <div class="cp-tabs">
        <button type="button" class="cp-tab is-active" data-cp-tab="site">사이트 유저</button>
        <button type="button" class="cp-tab" data-cp-tab="external">사이트 밖 유저</button>
      </div>
      <div class="cp-site">
        <input type="text" class="form-input cp-search" placeholder="닉네임 또는 아이디로 검색..." autocomplete="off">
        <div class="cp-dropdown" hidden></div>
      </div>
      <div class="cp-external" hidden>
        <div class="cp-ext-row">
          <input type="text" class="form-input cp-ext-name" maxlength="${NAME_MAX}" placeholder="이름 입력">
          <button type="button" class="cp-add-ext">추가</button>
        </div>
        ${cfg.withContact ? `<input type="text" class="form-input cp-ext-contact" maxlength="${CONTACT_MAX}" placeholder="연락처 (트위터, 디스코드 등) — 선택사항">` : ''}
      </div>
      <p class="auth-error cp-error"></p>
      <div class="cp-list"></div>`;

    const q = (sel) => root.querySelector(sel);
    const searchEl = q('.cp-search');
    const dropEl = q('.cp-dropdown');
    const errEl = q('.cp-error');

    function setError(msg) { errEl.textContent = msg || ''; }

    function render() {
      const listEl = q('.cp-list');
      if (!list.length) { listEl.innerHTML = ''; return; }
      listEl.innerHTML = list.map((d, idx) => `
        <div class="cp-item">
          <span class="cp-item-txt">
            <span class="cp-item-badge">${d.type === 'site' ? '연구소' : '외부'}</span>
            ${esc(d.type === 'site' ? d.nickname : d.name)}${d.type === 'external' && d.contact ? `<span class="cp-item-contact">(${esc(d.contact)})</span>` : ''}
          </span>
          <button type="button" class="cp-item-del" data-cp-del="${idx}" aria-label="삭제"${disabled ? ' disabled' : ''}>✕</button>
        </div>`).join('');
    }

    function emit() { if (typeof opts.onChange === 'function') opts.onChange(getValue()); }

    function getValue() {
      return list.map(d => d.type === 'site'
        ? { type: 'site', userId: d.userId, nickname: d.nickname }
        : (cfg.withContact ? { type: 'external', name: d.name, contact: d.contact || '' } : { type: 'external', name: d.name }));
    }

    function setValue(arr) {
      list = [];
      (Array.isArray(arr) ? arr : []).forEach(d => {
        if (!d || list.length >= MAX_ITEMS) return;
        if (d.type === 'site' && d.userId) {
          if (!list.some(x => x.type === 'site' && x.userId === d.userId)) list.push({ type: 'site', userId: d.userId, nickname: d.nickname || '(알 수 없음)' });
        } else if (d.type === 'external' && d.name) {
          if (!list.some(x => x.type === 'external' && x.name === d.name)) list.push({ type: 'external', name: d.name, contact: d.contact || '' });
        }
      });
      setError('');
      render();
    }

    function addSite(userId, nickname) {
      if (list.length >= MAX_ITEMS) { setError(`최대 ${MAX_ITEMS}명까지 추가할 수 있어요.`); return; }
      if (list.some(d => d.type === 'site' && d.userId === userId)) return;
      list.push({ type: 'site', userId, nickname });
      searchEl.value = '';
      dropEl.hidden = true;
      dropEl.innerHTML = '';
      setError('');
      render();
      emit();
    }

    function addExternal() {
      const nameEl = q('.cp-ext-name');
      const contactEl = q('.cp-ext-contact');
      const name = nameEl.value.trim();
      const contact = contactEl ? contactEl.value.trim() : '';
      if (!name) { setError(`${cfg.extLabel} 이름을 입력해주세요.`); return; }
      if (name.length > NAME_MAX) { setError(`이름은 ${NAME_MAX}자 이하로 입력해주세요.`); return; }
      if (contact.length > CONTACT_MAX) { setError(`연락처는 ${CONTACT_MAX}자 이하로 입력해주세요.`); return; }
      if (list.length >= MAX_ITEMS) { setError(`최대 ${MAX_ITEMS}명까지 추가할 수 있어요.`); return; }
      if (list.some(d => d.type === 'external' && d.name === name)) { setError(`이미 추가된 외부 ${cfg.extLabel}예요.`); return; }
      list.push({ type: 'external', name, contact });
      nameEl.value = '';
      if (contactEl) contactEl.value = '';
      setError('');
      render();
      emit();
    }

    const runSearch = (typeof debounce === 'function' ? debounce : (fn) => fn)(async (text) => {
      const mySeq = ++seq;
      const { data } = await searchUsers(text, { limit: 15 });
      if (mySeq !== seq) return;
      const results = (data || []).filter(u => !list.some(d => d.type === 'site' && d.userId === u.id));
      if (!results.length) {
        dropEl.innerHTML = '<p class="cp-drop-empty">일치하는 유저가 없어요</p>';
      } else {
        dropEl.innerHTML = results.map(u => `<button type="button" class="cp-drop-item" data-cp-add="${esc(u.id)}" data-cp-nick="${esc(u.nickname)}">${esc(u.nickname)}</button>`).join('');
      }
      dropEl.hidden = false;
    }, 250);

    searchEl.addEventListener('input', () => {
      const text = searchEl.value.trim();
      if (!text) { seq++; dropEl.hidden = true; dropEl.innerHTML = ''; return; }
      runSearch(text);
    });

    root.addEventListener('click', (e) => {
      if (disabled) return;
      const tab = e.target.closest('[data-cp-tab]');
      if (tab) {
        const isSite = tab.dataset.cpTab === 'site';
        root.querySelectorAll('[data-cp-tab]').forEach(b => b.classList.toggle('is-active', b === tab));
        q('.cp-site').hidden = !isSite;
        q('.cp-external').hidden = isSite;
        dropEl.hidden = true;
        setError('');
        return;
      }
      const add = e.target.closest('[data-cp-add]');
      if (add) { addSite(add.dataset.cpAdd, add.dataset.cpNick); return; }
      if (e.target.closest('.cp-add-ext')) { addExternal(); return; }
      const del = e.target.closest('[data-cp-del]');
      if (del) {
        list.splice(Number(del.dataset.cpDel), 1);
        setError('');
        render();
        emit();
      }
    });

    // Enter 로 폼이 제출되지 않게 (외부 이름 입력에서 Enter = 추가)
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.classList.contains('cp-ext-name') || e.target.classList.contains('cp-ext-contact')) { e.preventDefault(); addExternal(); }
      else if (e.target.classList.contains('cp-search')) e.preventDefault();
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) dropEl.hidden = true;
    });

    function setDisabled(flag) {
      disabled = !!flag;
      root.querySelectorAll('input, button').forEach(el => { el.disabled = disabled; });
    }

    render();
    return {
      getValue,
      setValue,
      setDisabled,
      clear() { setValue([]); searchEl.value = ''; dropEl.hidden = true; },
      count() { return list.length; },
    };
  }

  window.CreatorPicker = { create };
})();
