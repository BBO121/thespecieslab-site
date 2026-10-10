// ============================================================
// 이미지 확대 뷰어 (모바일/터치용) — openImageZoomViewer(url)
//  · 외형은 문의 첨부 뷰어(.sa-viewer, css/scss/_support-attachments.scss) 그대로 재사용.
//  · 핀치 줌(1~6배) · 확대 상태 드래그 이동 · 더블탭 확대/원래대로 · 닫기 버튼/ESC/배경 탭.
//  · 뷰어가 열린 동안 body 스크롤 잠금(body.sa-viewer-open), 페이지 스크롤 위치는 건드리지 않는다.
//  · 페이지 viewport(브라우저 기본 확대) 설정은 바꾸지 않는다 — 뷰어 레이어에만 touch-action:none.
// ============================================================
(function () {
  const MIN_SCALE = 1;
  const MAX_SCALE = 6;
  const DOUBLE_TAP_SCALE = 2.5;
  const TAP_MOVE_TOLERANCE = 8;   // px — 이보다 적게 움직이면 탭으로 본다

  let v = null;   // 뷰어 상태 (최초 1회 생성)

  function build() {
    const el = document.createElement('div');
    el.className = 'sa-viewer izv-viewer is-single';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '이미지 확대 보기');
    el.innerHTML = `
      <div class="sa-viewer-stage"><img class="sa-viewer-img" alt="" draggable="false"></div>
      <span class="sa-viewer-counter">두 손가락으로 확대 · 두 번 탭</span>
      <button type="button" class="sa-viewer-close" aria-label="닫기">✕</button>`;
    document.body.appendChild(el);

    const s = {
      el,
      stage: el.querySelector('.sa-viewer-stage'),
      img: el.querySelector('.sa-viewer-img'),
      scale: 1, tx: 0, ty: 0,
      pointers: new Map(),        // pointerId → {x, y}
      gesture: null,              // 진행 중 제스처 시작값
      moved: false,
      lastTap: 0,
      lastFocused: null,
    };

    const apply = (animate) => {
      s.img.classList.toggle('is-animating', !!animate);
      s.img.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
    };

    // 확대 배율에 맞춰 이동 범위 제한: 화면보다 작으면 가운데, 크면 가장자리가 화면 안쪽으로 들어오지 않게.
    const clamp = () => {
      const view = s.el.getBoundingClientRect();
      const base = baseRect();
      const fit = (pos, size, viewSize, t) => {
        const scaled = size * s.scale;
        if (scaled <= viewSize) return (viewSize - scaled) / 2 - pos;
        return Math.min(-pos, Math.max(viewSize - scaled - pos, t));
      };
      s.tx = fit(base.left - view.left, base.width, view.width, s.tx);
      s.ty = fit(base.top - view.top, base.height, view.height, s.ty);
    };

    // transform 적용 전(배율 1) 이미지 위치 — offsetLeft/Top 은 transform 영향을 받지 않는다.
    const baseRect = () => {
      const st = s.stage.getBoundingClientRect();
      return { left: st.left + s.img.offsetLeft, top: st.top + s.img.offsetTop, width: s.img.offsetWidth, height: s.img.offsetHeight };
    };

    // 화면 좌표 (px,py) 를 고정점으로 배율 변경
    const zoomAt = (newScale, px, py, startScale, startTx, startTy) => {
      const base = baseRect();
      newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
      const qx = (px - base.left - startTx) / startScale;   // 이미지 내부 좌표(배율 1 기준)
      const qy = (py - base.top - startTy) / startScale;
      s.scale = newScale;
      s.tx = px - base.left - newScale * qx;
      s.ty = py - base.top - newScale * qy;
    };

    s.reset = () => { s.scale = 1; s.tx = 0; s.ty = 0; apply(false); };

    const mid = () => {
      const [a, b] = [...s.pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };

    const startGesture = () => {
      if (s.pointers.size >= 2) {
        const m = mid();
        s.gesture = { type: 'pinch', d: m.d, mx: m.x, my: m.y, scale: s.scale, tx: s.tx, ty: s.ty };
      } else if (s.pointers.size === 1) {
        const p = [...s.pointers.values()][0];
        s.gesture = { type: 'pan', x: p.x, y: p.y, tx: s.tx, ty: s.ty };
      } else {
        s.gesture = null;
      }
    };

    s.stage.addEventListener('pointerdown', (e) => {
      try { s.stage.setPointerCapture(e.pointerId); } catch (_) { /* 캡처 불가해도 제스처는 계속 */ }
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size === 1) { s.moved = false; s.downX = e.clientX; s.downY = e.clientY; }
      else s.moved = true;   // 두 손가락 = 탭 아님
      startGesture();
    });

    s.stage.addEventListener('pointermove', (e) => {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (Math.hypot(e.clientX - s.downX, e.clientY - s.downY) > TAP_MOVE_TOLERANCE) s.moved = true;
      const g = s.gesture;
      if (!g) return;
      if (g.type === 'pinch' && s.pointers.size >= 2) {
        const m = mid();
        // 시작 시점의 두 손가락 중점 아래 지점이 현재 중점을 따라가도록(확대 + 이동 동시)
        zoomAt(g.scale * (m.d / g.d), g.mx, g.my, g.scale, g.tx, g.ty);
        s.tx += m.x - g.mx;
        s.ty += m.y - g.my;
      } else if (g.type === 'pan' && s.scale > 1) {
        const p = s.pointers.get(e.pointerId);
        s.tx = g.tx + (p.x - g.x);
        s.ty = g.ty + (p.y - g.y);
      } else {
        return;
      }
      clamp();
      apply(false);
    });

    const endPointer = (e) => {
      if (!s.pointers.has(e.pointerId)) return;
      s.pointers.delete(e.pointerId);
      if (s.pointers.size === 0) {
        if (!s.moved) onTap(e);
        if (s.scale <= 1.01) s.reset();
        else { clamp(); apply(true); }
      }
      startGesture();   // 손가락 수가 바뀌면 남은 손가락 기준으로 다시 시작
    };
    s.stage.addEventListener('pointerup', endPointer);
    s.stage.addEventListener('pointercancel', endPointer);

    // 탭: 이미지 더블탭 = 확대/원래대로, 확대 안 된 상태에서 배경 탭 = 닫기
    const onTap = (e) => {
      const now = Date.now();
      // pointer capture 때문에 e.target 은 항상 stage — 좌표로 이미지 위인지 판정
      const r = s.img.getBoundingClientRect();
      const onImg = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (onImg && now - s.lastTap < 300) {
        s.lastTap = 0;
        if (s.scale > 1) { s.scale = 1; s.tx = 0; s.ty = 0; }
        else zoomAt(DOUBLE_TAP_SCALE, e.clientX, e.clientY, s.scale, s.tx, s.ty);
        clamp();
        apply(true);
        return;
      }
      s.lastTap = onImg ? now : 0;
      if (!onImg && s.scale <= 1) s.close();
    };

    // iOS Safari 의 페이지 핀치(gesture*) 가 뷰어 뒤 페이지를 확대하지 않도록 뷰어 레이어 안에서만 막는다.
    ['gesturestart', 'gesturechange'].forEach(t => el.addEventListener(t, (e) => e.preventDefault()));
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

    s.close = () => {
      if (!el.classList.contains('is-open')) return;
      el.classList.remove('is-open');
      document.body.classList.remove('sa-viewer-open');
      s.pointers.clear();
      s.gesture = null;
      s.reset();
      s.img.removeAttribute('src');
      if (s.lastFocused && typeof s.lastFocused.focus === 'function') {
        try { s.lastFocused.focus({ preventScroll: true }); } catch (_) { /* 포커스 복원 생략 */ }
      }
    };

    el.querySelector('.sa-viewer-close').addEventListener('click', s.close);
    el.querySelector('.sa-viewer-close').addEventListener('pointerdown', (e) => e.stopPropagation());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('is-open')) s.close();
    });
    window.addEventListener('resize', () => { if (el.classList.contains('is-open')) { clamp(); apply(false); } });

    return s;
  }

  window.openImageZoomViewer = function (url) {
    if (!url) return;
    if (!v) v = build();
    v.lastFocused = document.activeElement;
    v.reset();
    v.img.src = url;
    v.el.classList.add('is-open');
    document.body.classList.add('sa-viewer-open');
    try { v.el.querySelector('.sa-viewer-close').focus({ preventScroll: true }); } catch (_) { /* noop */ }
  };
})();
