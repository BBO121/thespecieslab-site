// ============================================================
// 자유갤러리 · 연구갤러리 공용 모듈 (2026-11-06)
//   - 서버 구조: supabase/gallery_research_apply_1106.sql (RPC 전용, 테이블 직접 접근 없음)
//   - 이미지 저장: Edge Function gallery-image (실제 바이트 검증 후 저장, 브라우저는 업로드 요청만)
//   - 이 파일은 sb(js/auth.js), representativeCharacterName/characterHasVisibleRealImage/resolveCharacterImage(js/utils.js)
//     뒤에 로드한다.
// 사용자 입력은 전부 glEsc() 로 이스케이프해서 출력한다(innerHTML 에 원문을 넣지 않는다).
// ============================================================

// 제한값 — SQL _gallery_limits(), Edge Function LIMITS 와 같은 값으로 유지
const GALLERY_LIMITS = {
  MAX_IMAGES: 5,               // 게시글당 이미지 수 (변경 시 SQL _gallery_limits 의 max_images 도 함께)
  MAX_BYTES: 2 * 1024 * 1024,  // 최적화 후 저장 파일 최대
  MAX_EDGE: 2000,              // 가로·세로 각각 최대
  INPUT_MAX_BYTES: 30 * 1024 * 1024, // 고르는 원본 파일 상한(브라우저 메모리 보호용, 저장되지 않음)
  THUMB_EDGE: 480,
  THUMB_MAX_BYTES: 380 * 1024,
  TITLE_MAX: 100,
  CONTENT_MAX: 5000,
  COMMENT_MAX: 1000,
  MAX_CHARS: 20,
  PAGE_SIZE: 20,
};

const GALLERY_BOARDS = {
  free:     { label: '자유갤러리', list: 'gallery-free.html' },
  research: { label: '연구 자료 보관소', list: 'gallery-research.html' },
};

function glEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CSS url('…') 안에 넣는 값 — 따옴표/괄호/역슬래시/개행 제거
function glCssUrl(u) {
  return String(u || '').replace(/["'()\\\n\r]/g, encodeURIComponent);
}

function glUuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// gallery 버킷 공개 URL (경로는 서버가 만든 uuid 경로 — 그래도 세그먼트 단위로 인코딩)
function glImgUrl(path) {
  if (!path) return '';
  return `${SUPABASE_URL}/storage/v1/object/public/gallery/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}

function glFmtDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const opt = { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' };
  if (withTime) Object.assign(opt, { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleString('ko-KR', opt).replace(/\. /g, '.').replace(/\.$/, '').replace(/\.(\d{2}):/, '. $1:');
}

function glRpcError(error, fallback = '처리 중 오류가 발생했어요.') {
  const msg = error?.message || '';
  if (!msg) return fallback;
  const code = error?.code || '';
  // 원인 추적용 원본 — 화면 문구로 뭉개지는 code/details/hint 를 콘솔에 남긴다
  if (code) console.error('[gallery rpc]', { code, message: msg, details: error?.details, hint: error?.hint });
  if (/JWT|not authenticated|로그인/.test(msg)) return '로그인이 필요해요.';
  if (/Failed to fetch|NetworkError/.test(msg)) return '네트워크 연결을 확인해주세요.';
  // PGRST202 하나로는 함수 없음·인자 불일치·스키마 캐시 지연을 구분할 수 없다 — 어느 하나로 단정하지 않는다
  if (code === 'PGRST202') return `서버에서 이 기능을 찾지 못했어요. 운영진에게 알려주세요. (${code})`;
  if (code === 'PGRST203') return `서버 기능 정의가 중복되어 실행하지 못했어요. 운영진에게 알려주세요. (${code})`;
  if (/^PGRST2/.test(code) || /schema cache/i.test(msg)) return `서버 구조 정보를 확인하지 못했어요. 잠시 후 다시 시도해주세요. (${code || 'schema cache'})`;
  if (code === '42501' && /permission denied/i.test(msg)) return `이 기능을 사용할 권한이 없어요. (${code})`;
  if (['42883', '42P01', '42703'].includes(code)) return `서버 기능 내부에서 오류가 발생했어요. 운영진에게 알려주세요. (${code})`;
  return msg.replace(/^.*?ERROR:\s*/, '');
}

// 알림으로 들어온 제출 행을 화면 중앙에 잠깐 강조
function glFlashRow(el) {
  el.scrollIntoView({ block: 'center' });
  el.style.outline = '2px solid var(--sky-deep)';
  el.style.outlineOffset = '2px';
  setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 3000);
}

// ── 개체 표시 ──────────────────────────────────────────────
// 개체명 = 소유주가 정한 이름 우선(사이트 대표 규칙 representativeCharacterName 과 동일)
function glCharName(c) {
  if (typeof representativeCharacterName === 'function') return representativeCharacterName(c) || '(이름 없음)';
  return (c?.owner_custom_name || '').trim() || c?.name || '(이름 없음)';
}

// 썸네일 — 민감 요소 개체는 기존 정책대로 가림(설정에서 '바로 표시' 켠 사용자는 html.show-sensitive 로 풀림)
function glCharThumbHtml(c) {
  const sensitive = !!c.is_sensitive && (typeof characterHasVisibleRealImage === 'function' ? characterHasVisibleRealImage(c) : true);
  const src = typeof resolveCharacterImage === 'function' ? resolveCharacterImage(c) : (c.thumbnail_url || c.image_url || '');
  return `<span class="gl-char-thumb${sensitive ? ' blurred' : ''}" style="background-image:url('${glCssUrl(src)}')"></span>`
       + (sensitive ? '<span class="gl-char-sens">민감</span>' : '');
}

// 관련 개체 카드 — 썸네일 · 개체명 · 종족명 · 소유주명(개체 정보의 소유주명)
function glCharCardHtml(c, { removable = false, link = true } = {}) {
  const tag = link ? 'a' : 'div';
  const href = link ? ` href="character.html?id=${encodeURIComponent(c.id)}"` : '';
  const owner = c.owner_nickname || c.owner_user_nick || '';
  return `<${tag} class="gl-char-card${c.is_research_target ? ' is-target' : ''}"${href} data-id="${glEsc(c.id)}">
    ${glCharThumbHtml(c)}
    <span class="gl-char-info">
      ${c.is_research_target ? '<span class="gl-char-badge">이번 주의 연구대상</span>' : ''}
      <span class="gl-char-name">${glEsc(glCharName(c))}</span>
      <span class="gl-char-line">${glEsc(c.species_name || '')}</span>
      <span class="gl-char-line">소유주 ${glEsc(owner || '—')}</span>
    </span>
    ${removable ? `<button type="button" class="gl-char-remove" data-remove="${glEsc(c.id)}" aria-label="${glEsc(glCharName(c))} 연결 해제">×</button>` : ''}
  </${tag}>`;
}

// ── 서버 페이지 목록용 페이지 버튼 (main.js createPager 와 같은 마크업) ──
function glRenderPager(wrap, total, page, perPage, onGo) {
  if (!wrap) return;
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) { wrap.innerHTML = ''; return; }
  const set = new Set([1, pages]);
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) set.add(i);
  const nums = [...set].sort((a, b) => a - b);
  let html = `<nav class="pagination"><button class="pg-btn" data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>`;
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) html += '<span class="pg-gap">…</span>';
    html += `<button class="pg-btn${n === page ? ' active' : ''}" data-p="${n}">${n}</button>`;
    prev = n;
  }
  html += `<button class="pg-btn" data-p="${page + 1}" ${page === pages ? 'disabled' : ''}>›</button></nav>`;
  wrap.innerHTML = html;
  wrap.querySelectorAll('.pg-btn:not([disabled])').forEach(b => b.addEventListener('click', () => onGo(+b.dataset.p)));
}

// ============================================================
// 민감한 요소 (연구 자료 보관소, 2026-11-11) — supabase/research_post_sensitive_apply_1111.sql
//   개체·종족과 같은 마크업(.blurred + .sensitive-overlay)·같은 문구·같은 '바로 표시' 설정(html.show-sensitive)을 쓴다.
//   가림 범위(개체·종족 기준): 제목·작성자·날짜·관련 개체는 그대로, 이미지와 본문(글 연구의 글)만 가린다.
//   가림 해제는 화면에서만 일어난다(서버 호출 없음) — 원래 열람 가능한 자료만 보이고 권한은 바뀌지 않는다.
// ============================================================
const GL_SENS_NOTE_MAX = 100;   // SQL gallery_posts_sensitive_chk 와 같은 값
const GL_SENS_ICON = '<svg width="28" height="26" viewBox="0 0 28 26" fill="none" aria-hidden="true"><path d="M14 2L26 24H2L14 2Z" stroke="#b91c1c" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><line x1="14" y1="9" x2="14" y2="16" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="20" r="1.2" fill="#b91c1c"/></svg>';

// 오버레이 안쪽(경고 아이콘 · 민감한 요소 · 설명 · 안내) — 개체·종족 오버레이와 같은 구성
function glSensInnerHtml(note, hint = '누르면 이미지가 보여요') {
  return `<div class="sensitive-overlay-inner">${GL_SENS_ICON}<span class="sensitive-overlay-title">민감한 요소</span>`
       + `${note ? `<span class="sensitive-overlay-note">${glEsc(note)}</span>` : ''}<span class="sensitive-overlay-hint">${glEsc(hint)}</span></div>`;
}
// 카드·썸네일용 덮개(.blurred 형제 위에 올라감) — html.show-sensitive 면 공통 CSS 가 덮개를 치운다
function glSensOverlayHtml(note, hint) {
  return `<div class="sensitive-overlay" data-gl-reveal>${glSensInnerHtml(note, hint)}</div>`;
}

// 게시물 ID 목록의 민감 설정 조회 → Map(id → { on, note })
//   SQL 미적용(함수 없음) = 아무 글도 민감 설정을 가질 수 없음 → 전부 일반으로.
//   그 밖의 실패(네트워크·서버 오류) = 안전하게 전부 가림(설명 없이). 개체 갤러리 담기 조회와 같은 판정.
function glIsSensRpcMissing(error) {
  const msg = String(error?.message || '');
  const named = /gallery_post_sensitivity/.test(msg);
  return (error?.code === 'PGRST202' && (named || !msg)) || (error?.code === '42883' && named);
}
//   · 200개(서버 1회 상한)씩 나눠서 모두 조회한다.
//   · 응답에 없는 요청 ID(삭제·조회 누락·빈 응답)는 가림. is_sensitive 가 명시적으로 false 인 것만 '가림 없음'.
//   · 조회하지 않은 ID 를 glSensOf 로 물어도 가림(기본값 = 가림).
const GL_SENS_CHUNK = 200;   // SQL gallery_post_sensitivity 의 1회 상한과 같은 값
const GL_SENS_HIDE = Object.freeze({ on: true, note: '' });
const GL_SENS_OFF  = Object.freeze({ on: false, note: '' });
async function glFetchPostSensitivity(ids) {
  const list = [...new Set((ids || []).map(Number).filter(n => Number.isFinite(n) && n > 0))];
  const map = new Map();
  if (!list.length) return map;
  const chunks = [];
  for (let i = 0; i < list.length; i += GL_SENS_CHUNK) chunks.push(list.slice(i, i + GL_SENS_CHUNK));
  const results = await Promise.all(chunks.map(async chunk => {
    try { return { chunk, res: await sb.rpc('gallery_post_sensitivity', { p_post_ids: chunk }) }; }
    catch (e) { return { chunk, res: { error: e } }; }
  }));
  // SQL 미적용(함수 없음) = 아무 글도 민감 설정을 가질 수 없음 → 요청한 전부 '가림 없음'
  if (results.some(({ res }) => res?.error && glIsSensRpcMissing(res.error))) {
    list.forEach(id => map.set(id, GL_SENS_OFF));
    return map;
  }
  for (const { chunk, res } of results) {
    const { data, error } = res || {};
    if (error || !Array.isArray(data)) {
      console.warn('[gallery] 민감 설정 조회 실패 — 안전하게 가림:', error || data);
      continue;   // 이 묶음의 ID 는 아래에서 '가림'으로 채워진다
    }
    const want = new Set(chunk);
    data.forEach(r => {
      const id = Number(r?.id);
      if (!want.has(id)) return;   // 요청하지 않은 ID 는 무시
      map.set(id, r.is_sensitive === false ? GL_SENS_OFF : { on: true, note: r.is_sensitive === true ? (r.sensitive_note || '') : '' });
    });
  }
  const missing = list.filter(id => !map.has(id));
  if (missing.length) console.warn('[gallery] 민감 설정 응답에 없는 게시물 — 가림:', missing);
  missing.forEach(id => map.set(id, GL_SENS_HIDE));
  return map;
}
function glSensOf(map, id) { return map?.get(Number(id)) || GL_SENS_HIDE; }

// 덮개 클릭 → 그 칸만 가림 해제(카드 링크 이동은 막음). 상세 화면의 큰 덮개는 각 페이지가 따로 처리.
document.addEventListener('click', e => {
  const ov = e.target.closest?.('[data-gl-reveal]');
  if (!ov) return;
  if (document.documentElement.classList.contains('show-sensitive')) return;   // 바로 표시 사용자: 덮개 없음 취급
  e.preventDefault();
  e.stopPropagation();
  const wrap = ov.parentElement;
  wrap.querySelectorAll('.blurred').forEach(el => { el.classList.remove('blurred'); });
  wrap.classList.remove('gl-sens-wrap');
  ov.remove();
}, true);

// 게시물 카드 (목록) — 작은 썸네일만 lazy 로딩
//   sens: { on, note } — 민감 자료면 썸네일·본문 미리보기를 가리고 덮개 표시(제목·작성자는 그대로)
function glPostCardHtml(p, board, sens) {
  const hide = !!sens?.on;
  const blur = hide ? ' class="blurred"' : '';
  // 글만 있는 연구: 썸네일 자리에 '글' 표시 + 본문 미리보기(제목은 아래 카드 본문에)
  const thumb = p.cover_thumb_path
    ? `<img src="${glEsc(glImgUrl(p.cover_thumb_path))}" alt="" loading="lazy" decoding="async"${blur}>`
    : `<span class="gl-card-thumb-label">글</span><span class="gl-card-thumb-text${hide ? ' blurred' : ''}">${glEsc(p.excerpt || '')}</span>`;
  const cover = hide ? glSensOverlayHtml(sens.note, p.cover_thumb_path ? '누르면 이미지가 보여요' : '누르면 내용이 보여요') : '';
  // b= 는 사이드바 하위 메뉴 강조용 힌트일 뿐(상세 화면은 서버가 준 board 로 다시 맞춘다)
  return `<a class="gl-card" href="gallery-post.html?id=${encodeURIComponent(p.id)}&b=${board === 'research' ? 'research' : 'free'}">
    <span class="gl-card-thumb${p.cover_thumb_path ? '' : ' is-text'}${hide ? ' gl-sens-wrap' : ''}">${thumb}${cover}${p.image_count > 1 ? `<span class="gl-card-count">${p.image_count}장</span>` : ''}</span>
    <span class="gl-card-body">
      <span class="gl-card-title">${glEsc(p.title)}</span>
      <span class="gl-card-meta"><span>${glEsc(p.nickname || '(탈퇴한 회원)')}</span><span>${glFmtDate(p.created_at)}</span>${p.comment_count ? `<span>댓글 ${p.comment_count}</span>` : ''}</span>
    </span>
  </a>`;
}

// ============================================================
// 이미지 처리 — 업로드 전 브라우저에서 축소·압축(유료 변환 API 없음)
//   · 실제 파일 시그니처 확인(JPG/PNG/WebP 만, GIF·SVG·기타 거부)
//   · 비율 유지, 2000×2000 안으로 축소(작은 이미지는 확대하지 않음)
//   · 투명 픽셀이 있으면 투명도 보존(PNG → 2MB 넘으면 WebP 고화질)
//   · 선화·글씨 보호: PNG 원본은 무손실 PNG 우선, 넘칠 때만 고화질 손실 압축 단계적으로
//   · 캔버스 재인코딩으로 EXIF(위치 등)와 움직임(애니메이션 프레임)은 제거된다 → 정적 이미지
//   · 최적화 후에도 2MB 를 넘으면 업로드 거부
// 최종 검증은 서버(Edge Function)가 다시 한다.
// ============================================================
async function glSniffType(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return null;
}

function glDecode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요. 손상된 파일인지 확인해주세요.')); };
    img.src = url;
  });
}

function glCanvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b && b.type === type ? b : null), type, quality));
}

function glCanvasHasAlpha(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 400000)));   // 최대 약 40만 픽셀만 샘플
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] < 255) return true;
    }
  }
  return false;
}

function glDrawScaled(img, maxEdge) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.min(maxEdge, Math.round(w0 * scale)));
  const h = Math.max(1, Math.min(maxEdge, Math.round(h0 * scale)));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

async function glEncodeUnder(canvas, candidates, maxBytes) {
  for (const [type, q] of candidates) {
    const blob = await glCanvasToBlob(canvas, type, q);
    if (blob && blob.size <= maxBytes) return blob;
  }
  return null;
}

async function glProcessImage(file) {
  if (!file) throw new Error('파일이 없어요.');
  if (file.size > GALLERY_LIMITS.INPUT_MAX_BYTES) throw new Error('원본 파일이 너무 커요(30MB 이하로 골라주세요).');
  const type = await glSniffType(file);
  if (type === 'image/gif') throw new Error('움짤(GIF)은 아직 올릴 수 없어요. JPG·PNG·WebP 를 골라주세요.');
  if (!type) throw new Error('JPG·PNG·WebP 이미지만 올릴 수 있어요.');

  const img = await glDecode(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('이미지 크기를 읽을 수 없어요.');

  const canvas = glDrawScaled(img, GALLERY_LIMITS.MAX_EDGE);
  const alpha = type !== 'image/jpeg' && glCanvasHasAlpha(canvas);

  let blob;
  if (alpha) {
    blob = await glEncodeUnder(canvas, [['image/png'], ['image/webp', 0.95], ['image/webp', 0.9], ['image/webp', 0.85], ['image/webp', 0.8]], GALLERY_LIMITS.MAX_BYTES);
  } else if (type === 'image/png') {
    blob = await glEncodeUnder(canvas, [['image/png'], ['image/webp', 0.95], ['image/jpeg', 0.93], ['image/webp', 0.88], ['image/jpeg', 0.86], ['image/jpeg', 0.8]], GALLERY_LIMITS.MAX_BYTES);
  } else {
    blob = await glEncodeUnder(canvas, [['image/jpeg', 0.92], ['image/webp', 0.92], ['image/jpeg', 0.86], ['image/jpeg', 0.8], ['image/jpeg', 0.74]], GALLERY_LIMITS.MAX_BYTES);
  }
  if (!blob) throw new Error('최적화해도 2MB를 넘는 이미지예요. 크기를 줄이거나 다른 형식으로 저장해서 다시 올려주세요.');

  // 작성 화면 미리보기용 작은 이미지(브라우저 안에서만 사용, 서버로 보내지 않음)
  const tcanvas = glDrawScaled(img, GALLERY_LIMITS.THUMB_EDGE);
  const thumb = alpha
    ? await glEncodeUnder(tcanvas, [['image/webp', 0.85], ['image/png'], ['image/webp', 0.7]], GALLERY_LIMITS.THUMB_MAX_BYTES)
    : await glEncodeUnder(tcanvas, [['image/jpeg', 0.82], ['image/jpeg', 0.7], ['image/webp', 0.7]], GALLERY_LIMITS.THUMB_MAX_BYTES);
  if (!thumb) throw new Error('미리보기 이미지를 만들지 못했어요.');

  return { blob, thumb, width: canvas.width, height: canvas.height, previewUrl: URL.createObjectURL(thumb) };
}

// Edge Function 호출 — 실패 시 서버가 준 안내 문구를 그대로 보여준다
async function glInvokeImageFn(body) {
  const { data, error } = await sb.functions.invoke('gallery-image', { body });
  if (error) {
    let msg = '';
    try { msg = (await error.context?.json?.())?.error || ''; } catch (e) { /* 본문 없음 */ }
    throw new Error(msg || '이미지 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
  }
  return data;
}

async function glUploadProcessed(p) {
  const fd = new FormData();
  fd.append('action', 'upload');
  fd.append('image', p.blob, 'image');
  // 썸네일은 보내지 않는다 — 서버(Edge Function)가 본문 이미지로 직접 만든다
  return glInvokeImageFn(fd);   // { upload_id, path, thumb_path, width, height, size }
}

// 게시 전 취소/실패한 업로드 정리(내 업로드만 서버에서 삭제). 실패해도 24시간 뒤 자동 정리된다.
function glDiscardUploads(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return Promise.resolve();
  return glInvokeImageFn({ action: 'discard', upload_ids: list }).catch(e => console.warn('[gallery] 업로드 정리 실패(자동 정리 대기):', e.message));
}

// ============================================================
// 관련 개체 선택기 — 서버 검색(디바운스·개수 제한·더 보기), 고유 ID 로 연결
//   opts.selected: 처음 선택된 개체 brief 배열 / opts.locked: 제거 불가 개체 brief(연구대상)
//   opts.single: 1개만 선택(다시 고르면 바뀜) / opts.scope: 검색 범위('mine'·'mine_labber' — 과제 제출 참여 개체용)
//   opts.extraChoices: 검색과 무관하게 맨 위에 항상 보이는 선택지(예: 래버 NPC) / opts.onChange(ids, items)
// ============================================================
function createCharacterPicker(root, opts = {}) {
  const MODES = [
    { key: 'all',     label: '전체',     ph: '개체명·소유주명·종족명·유저명으로 함께 검색' },
    { key: 'name',    label: '개체명',   ph: '개체 이름으로 검색' },
    { key: 'owner',   label: '소유주명', ph: '개체 정보에 적힌 소유주명으로 검색' },
    { key: 'species', label: '종족명',   ph: '종족 이름으로 검색' },
    { key: 'user',    label: '유저명',   ph: '유저 닉네임 → 지금 그 유저가 가진 개체' },
  ];
  const state = {
    mode: 'all', q: '', offset: 0, items: [], hasMore: false, seq: 0, loading: false,
    selected: new Map((opts.selected || []).map(c => [String(c.id), c])),
    locked: opts.locked ? { ...opts.locked, is_research_target: true } : null,
  };
  if (state.locked) state.selected.delete(String(state.locked.id));

  root.innerHTML = `
    <div class="gl-picker">
      <div class="gl-picker-modes" role="tablist">
        ${MODES.map(m => `<button type="button" class="gl-picker-mode${m.key === 'all' ? ' active' : ''}" data-mode="${m.key}" role="tab">${m.label}</button>`).join('')}
      </div>
      <input type="search" class="form-input gl-picker-input" maxlength="50" placeholder="${MODES[0].ph}" autocomplete="off">
      <p class="gl-sub gl-picker-hint" style="margin-top:6px;">${opts.single ? '검색 결과에서 1체를 눌러 고르세요. 다른 개체를 누르면 바뀌어요.' : `검색 결과에서 눌러 추가하고, 다시 누르면 빠져요. 최대 ${GALLERY_LIMITS.MAX_CHARS}개.`}</p>
      <div class="gl-picker-results" aria-live="polite"></div>
      <button type="button" class="btn-ghost gl-picker-more gl-hidden">결과 더 보기</button>
      <div class="gl-picker-selected">
        <p class="form-label" style="margin-bottom:6px;">${opts.single ? '선택한 참여 개체' : '선택한 개체'} <span class="gl-muted gl-picker-count"></span></p>
        <div class="gl-chars gl-picker-chosen"></div>
      </div>
    </div>`;
  const $ = s => root.querySelector(s);
  const input = $('.gl-picker-input');

  function renderChosen() {
    const list = [...(state.locked ? [state.locked] : []), ...state.selected.values()];
    $('.gl-picker-count').textContent = list.length ? `${list.length}개` : '';
    $('.gl-picker-chosen').innerHTML = list.length
      ? list.map(c => c.is_extra
          ? `<div class="gl-char-card is-extra" data-id="${glEsc(c.id)}"><span class="gl-char-info"><span class="gl-char-name">${glEsc(c.name)}</span>${c.note ? `<span class="gl-char-line">${glEsc(c.note)}</span>` : ''}</span><button type="button" class="gl-char-remove" data-remove="${glEsc(c.id)}" aria-label="${glEsc(c.name)} 선택 해제">×</button></div>`
          : glCharCardHtml(c, { removable: !c.is_research_target, link: false })).join('')
      : '<p class="gl-sub gl-muted">아직 선택한 개체가 없어요.</p>';
    opts.onChange?.(getIds(), [...state.selected.values()]);
  }

  function rowHtml(c) {
    const sel = state.selected.has(String(c.id)) || (state.locked && String(state.locked.id) === String(c.id));
    if (c.is_extra) return `<button type="button" class="gl-pick-row is-extra${sel ? ' is-selected' : ''}" data-pick="${glEsc(c.id)}">
      <span class="gl-char-info"><span class="gl-char-name">${glEsc(c.name)}</span>${c.note ? `<span class="gl-char-line">${glEsc(c.note)}</span>` : ''}</span>
      <span class="gl-pick-state">${sel ? '선택됨' : '선택'}</span></button>`;
    const userNick = c.owner_user_nick ? `유저 ${glEsc(c.owner_user_nick)}` : '사이트 밖 소유';
    return `<button type="button" class="gl-pick-row${sel ? ' is-selected' : ''}" data-pick="${glEsc(c.id)}">
      ${glCharThumbHtml(c)}
      <span class="gl-char-info">
        <span class="gl-char-name">${glEsc(glCharName(c))}${c.char_number ? ` <span class="gl-muted">#${glEsc(c.char_number)}</span>` : ''}</span>
        <span class="gl-char-line">${glEsc(c.species_name || '')}${c.owner_custom_name && c.name && c.owner_custom_name.trim() !== c.name ? ` · 등록명 ${glEsc(c.name)}` : ''}</span>
        <span class="gl-char-line">소유주명 ${glEsc(c.owner_nickname || '—')} · ${userNick}</span>
      </span>
      <span class="gl-pick-state">${sel ? '선택됨' : '추가'}</span>
    </button>`;
  }

  function renderResults() {
    const box = $('.gl-picker-results');
    const extra = (opts.extraChoices || []).map(rowHtml).join('');
    if (!state.q) { box.innerHTML = extra; $('.gl-picker-more').classList.add('gl-hidden'); return; }
    if (!state.items.length && !state.loading) {
      box.innerHTML = extra + '<p class="gl-sub gl-muted" style="padding:8px 2px;">검색 결과가 없어요.</p>';
    } else {
      box.innerHTML = extra + state.items.map(rowHtml).join('') + (state.loading ? '<p class="gl-sub gl-muted" style="padding:6px 2px;">검색 중…</p>' : '');
    }
    $('.gl-picker-more').classList.toggle('gl-hidden', !state.hasMore || state.loading);
  }

  async function search(append = false) {
    const mySeq = ++state.seq;
    state.loading = true;
    if (!append) { state.offset = 0; state.items = []; }
    renderResults();
    const { data, error } = await sb.rpc('gallery_search_characters', {
      p_mode: state.mode, p_query: state.q, p_limit: 20, p_offset: state.offset,
      ...(opts.scope ? { p_scope: opts.scope } : {}),   // 과제 제출 참여 개체: 내 개체만(기본 검색엔 보내지 않음)
    });
    if (mySeq !== state.seq) return;   // 더 최근 요청이 있으면 버림
    state.loading = false;
    if (error) {
      $('.gl-picker-results').innerHTML = `<p class="gl-sub" style="color:#b91c1c;padding:8px 2px;">${glEsc(glRpcError(error, '검색하지 못했어요.'))}</p>`;
      return;
    }
    state.items = state.items.concat(data?.items || []);
    state.hasMore = !!data?.has_more;
    state.offset += (data?.items || []).length;
    renderResults();
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim().normalize('NFC');
      if (q === state.q) return;
      state.q = q;
      if (!q) { state.seq++; state.items = []; renderResults(); return; }
      search(false);
    }, 350);
  });
  root.querySelectorAll('.gl-picker-mode').forEach(btn => btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    root.querySelectorAll('.gl-picker-mode').forEach(b => b.classList.toggle('active', b === btn));
    input.placeholder = MODES.find(m => m.key === state.mode).ph;
    if (state.q) search(false);
    input.focus();
  }));
  $('.gl-picker-more').addEventListener('click', () => search(true));
  $('.gl-picker-results').addEventListener('click', e => {
    const row = e.target.closest('[data-pick]');
    if (!row) return;
    const id = row.dataset.pick;
    if (state.locked && String(state.locked.id) === id) return;   // 연구대상은 항상 연결
    if (state.selected.has(id)) state.selected.delete(id);
    else if (opts.single) {
      const c = state.items.find(x => String(x.id) === id) || (opts.extraChoices || []).find(x => String(x.id) === id);
      state.selected.clear(); if (c) state.selected.set(id, c);
    } else {
      const total = state.selected.size + (state.locked ? 1 : 0);
      if (total >= GALLERY_LIMITS.MAX_CHARS) { alert(`관련 개체는 최대 ${GALLERY_LIMITS.MAX_CHARS}개까지 추가할 수 있어요.`); return; }
      const c = state.items.find(x => String(x.id) === id);
      if (c) state.selected.set(id, c);
    }
    renderResults();
    renderChosen();
  });
  $('.gl-picker-chosen').addEventListener('click', e => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    state.selected.delete(b.dataset.remove);
    renderResults();
    renderChosen();
  });

  function getIds() { return [...state.selected.keys()].filter(k => /^\d+$/.test(k)).map(Number); }   // 실제 개체 ID 만(래버 NPC 같은 선택지 제외)
  // 바깥에서 고르기(예: '이 글의 관련 개체 중 내 개체' 바로 선택) — single 은 교체, 아니면 추가
  function select(c) {
    if (!c || c.id == null) return;
    if (opts.single) state.selected.clear();
    state.selected.set(String(c.id), c);
    renderResults();
    renderChosen();
  }
  renderChosen();
  renderResults();
  return { getIds, getSelected: () => [...state.selected.values()], select, focus: () => input.focus(), input };
}

// ============================================================
// 댓글 (자유/연구 공용) — 페이지 단위 더 보기, 답글 1단계
// ============================================================
function mountGalleryComments(root, postId, user) {
  const PAGE = 30;
  let offset = 0, total = 0, busy = false;

  root.innerHTML = `
    <h2 class="gl-section-title">댓글 <span class="gl-muted gl-cm-total"></span></h2>
    <div class="gl-cm-list"></div>
    <button type="button" class="btn-ghost gl-cm-more gl-hidden" style="width:100%;margin-top:8px;">댓글 더 보기</button>
    ${user ? formHtml(null) : '<p class="gl-sub" style="margin-top:12px;"><a href="login.html" style="color:var(--sky-deep);font-weight:700;">로그인</a>하면 댓글을 쓸 수 있어요.</p>'}`;
  const list = root.querySelector('.gl-cm-list');

  function formHtml(parentId) {
    return `<form class="gl-cm-form" data-parent="${parentId || ''}">
      <textarea class="form-input" maxlength="${GALLERY_LIMITS.COMMENT_MAX}" placeholder="${parentId ? '답글을 입력해주세요' : '댓글을 입력해주세요'}" required></textarea>
      <div class="gl-cm-form-row"><span class="gl-counter">0 / ${GALLERY_LIMITS.COMMENT_MAX}</span>
        <span>${parentId ? '<button type="button" class="btn-ghost rs-btn-sm" data-cancel-reply>취소</button> ' : ''}<button type="submit" class="btn-secondary rs-btn-sm">${parentId ? '답글 등록' : '댓글 등록'}</button></span></div>
    </form>`;
  }

  function itemHtml(c, isReply) {
    const head = c.is_deleted
      ? '<span class="gl-cm-nick gl-muted">—</span>'
      : `<a class="gl-cm-nick" href="profile.html?user=${encodeURIComponent(c.user_id || '')}">${glEsc(c.nickname || '(탈퇴한 회원)')}</a>`;
    const tools = [
      !isReply && !c.is_deleted && user ? '<button type="button" data-act="reply">답글</button>' : '',
      c.can_edit ? '<button type="button" data-act="edit">수정</button>' : '',
      c.can_delete ? '<button type="button" data-act="delete">삭제</button>' : '',
    ].join('');
    return `<div class="gl-cm" data-cid="${c.id}">
      <div class="gl-cm-head">${head}<span class="gl-cm-date">${glFmtDate(c.created_at, true)}${c.updated_at && !c.is_deleted ? ' (수정됨)' : ''}</span><span class="gl-cm-tools">${tools}</span></div>
      <div class="gl-cm-body${c.is_deleted ? ' is-deleted' : ''}">${c.is_deleted ? '삭제된 댓글입니다' : glEsc(c.content)}</div>
      ${isReply ? '' : `<div class="gl-cm-replies${(c.replies || []).length ? '' : ' gl-hidden'}">${(c.replies || []).map(r => itemHtml(r, true)).join('')}</div><div class="gl-cm-reply-slot"></div>`}
    </div>`;
  }

  async function load(reset) {
    if (busy) return;
    busy = true;
    if (reset) { offset = 0; list.innerHTML = ''; }
    const { data, error } = await sb.rpc('gallery_list_comments', { p_post_id: postId, p_limit: PAGE, p_offset: offset });
    busy = false;
    if (error) { list.insertAdjacentHTML('beforeend', `<p class="gl-sub" style="color:#b91c1c;">${glEsc(glRpcError(error, '댓글을 불러오지 못했어요.'))}</p>`); return; }
    total = data?.total || 0;
    const items = data?.items || [];
    list.insertAdjacentHTML('beforeend', items.map(c => itemHtml(c, false)).join(''));
    offset += items.length;
    root.querySelector('.gl-cm-total').textContent = total ? String(total) : '';
    root.querySelector('.gl-cm-more').classList.toggle('gl-hidden', offset >= total);
    if (!total) list.innerHTML = '<p class="gl-sub gl-muted" style="padding:10px 0;">첫 댓글을 남겨보세요.</p>';
  }

  root.addEventListener('input', e => {
    if (e.target.matches('.gl-cm-form textarea, .gl-cm-edit textarea')) {
      const c = e.target.closest('form')?.querySelector('.gl-counter');
      if (c) c.textContent = `${e.target.value.length} / ${GALLERY_LIMITS.COMMENT_MAX}`;
    }
  });

  root.addEventListener('submit', async e => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const ta = form.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) { alert('내용을 입력해주세요.'); return; }
    if (text.length > GALLERY_LIMITS.COMMENT_MAX) { alert(`${GALLERY_LIMITS.COMMENT_MAX}자까지 쓸 수 있어요.`); return; }
    const btn = form.querySelector('[type=submit]');
    if (btn.disabled) return;
    btn.disabled = true;
    let error;
    if (form.classList.contains('gl-cm-edit')) {
      ({ error } = await sb.rpc('gallery_update_comment', { p_comment_id: Number(form.dataset.cid), p_content: text }));
    } else {
      form.dataset.key = form.dataset.key || glUuid();   // 같은 폼의 재전송 = 같은 댓글
      ({ error } = await sb.rpc('gallery_add_comment', {
        p_post_id: postId, p_parent_id: form.dataset.parent ? Number(form.dataset.parent) : null,
        p_content: text, p_client_key: form.dataset.key,
      }));
    }
    btn.disabled = false;
    if (error) { alert(glRpcError(error)); return; }
    await load(true);
    const top = root.querySelector('.gl-cm-form[data-parent=""]');
    if (top && form === top) { ta.value = ''; delete form.dataset.key; top.querySelector('.gl-counter').textContent = `0 / ${GALLERY_LIMITS.COMMENT_MAX}`; }
  });

  root.addEventListener('click', async e => {
    if (e.target.matches('[data-cancel-reply]')) { e.target.closest('form').remove(); return; }
    if (e.target.matches('[data-cancel-edit]')) { load(true); return; }
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const item = btn.closest('.gl-cm');
      const cid = Number(item.dataset.cid);
      if (btn.dataset.act === 'reply') {
        const slot = item.querySelector(':scope > .gl-cm-reply-slot');
        if (!slot.innerHTML) { slot.innerHTML = formHtml(cid); slot.querySelector('textarea').focus(); }
        return;
      }
      if (btn.dataset.act === 'edit') {
        const body = item.querySelector(':scope > .gl-cm-body');
        const old = body.textContent;
        body.outerHTML = `<form class="gl-cm-form gl-cm-edit" data-cid="${cid}">
          <textarea class="form-input" maxlength="${GALLERY_LIMITS.COMMENT_MAX}">${glEsc(old)}</textarea>
          <div class="gl-cm-form-row"><span class="gl-counter">${old.length} / ${GALLERY_LIMITS.COMMENT_MAX}</span>
          <span><button type="button" class="btn-ghost rs-btn-sm" data-cancel-edit>취소</button> <button type="submit" class="btn-secondary rs-btn-sm">저장</button></span></div></form>`;
        return;
      }
      if (btn.dataset.act === 'delete') {
        if (!confirm('댓글을 삭제할까요?')) return;
        btn.disabled = true;
        const { error } = await sb.rpc('gallery_delete_comment', { p_comment_id: cid });
        if (error) { btn.disabled = false; alert(glRpcError(error)); return; }
        load(true);
      }
      return;
    }
    if (e.target.matches('.gl-cm-more')) load(false);
  });

  load(true);
}

// ============================================================
// 연구과제 공용 (2026-11-07)
// ============================================================
const RT_STATUS = {
  pending:   { label: '승인 대기', cls: 'rt-st--pending' },
  approved:  { label: '승인',      cls: 'rt-st--approved' },
  rejected:  { label: '반려',      cls: 'rt-st--rejected' },
  withdrawn: { label: '제출 취소', cls: 'rt-st--withdrawn' },
};
const RT_LIMIT = {
  once_per_user:      '1인 1회',
  once_per_user_week: '매주 1인 1회',
  unlimited:          '제한 없음(연구마다)',
};
// 기간 표시 YY.MM.DD HH:mm (KST). 끝 시각은 "그 시각 직전까지"라 1분 빼서 표시(11/16 00:00 → 26.11.15 23:59)
function rtKst(iso, minusMinute = false) {
  const d = new Date(new Date(iso).getTime() - (minusMinute ? 60000 : 0) + 9 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCFullYear() % 100)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function rtRangeText(startsAt, endsAt) {
  if (!startsAt && !endsAt) return '상시';
  return `${startsAt ? rtKst(startsAt) : ''} ~ ${endsAt ? rtKst(endsAt, true) : ''}`.trim();
}
// 제출 제한 안내 문장(목록·상세 공통)
const RT_LIMIT_NOTE = {
  once_per_user:      '한 사람당 한 번 승인·보상돼요. 반려되면 수정해서 다시 제출할 수 있어요.',
  once_per_user_week: '주차마다 한 사람당 한 번 승인·보상돼요. 반려되면 수정해서 다시 제출할 수 있어요.',
  unlimited:          '연구마다 따로 제출할 수 있어요. 같은 연구는 한 번만 승인돼요.',
};

// 끝 시각은 "그 시각 직전까지" → 화면에는 마지막 날짜로 표시 (예: 11/16 00:00 KST → '11월 15일까지')
function rtUntilText(endsAt) {
  if (!endsAt) return '상시';
  const k = new Date(new Date(endsAt).getTime() - 1 + 9 * 3600000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일까지`;
}
function rtPeriodText(startsAt, endsAt) {
  if (!startsAt && !endsAt) return '상시';
  const s = startsAt ? glFmtDate(startsAt) : '';
  return `${s}${s ? ' ~ ' : ''}${rtUntilText(endsAt)}`;
}
function rtStatusBadge(st) {
  const s = RT_STATUS[st] || { label: st, cls: '' };
  return `<span class="rt-st ${s.cls}">${s.label}</span>`;
}
function rtRewardText(t) {
  const rows = rtRewardRows(t.reward_amount, t.rewards);
  if (!rows.length) return '보상 없음';
  return rows.map(([n, q, rnd]) => rnd ? n : `${n} ${q}`).join(' + ') + (t.rewards_enabled === false ? ' (지급 준비 중)' : '');
}
// 보상 표: 보상 / 수량
function rtRewardTableHtml(t) {
  const rows = rtRewardRows(t.reward_amount, t.rewards);
  return `<table class="rt-reward-table"><thead><tr><th>보상</th><th>수량</th></tr></thead><tbody>
    ${rows.length ? rows.map(([n, q]) => `<tr><td>${glEsc(n)}</td><td>${glEsc(q)}</td></tr>`).join('')
                  : '<tr><td colspan="2" class="gl-muted">보상 없음</td></tr>'}
  </tbody></table>`;
}
// 보상 행: [이름, 수량] — 연구기록 / 고정 아이템 / 무작위 아이템(후보 중 1개)
function rtRewardRows(amount, rewards) {
  const rows = [];
  if (amount) rows.push(['연구기록', Number(amount).toLocaleString()]);
  (rewards?.items || []).forEach(i => rows.push([i.name || '(아이템)', String(i.qty || 1)]));
  const opts = rewards?.random?.options || [];
  // 표: 'A 또는 B 중 랜덤 1개' | 1 — 한 줄 문구에서는 이름만(‘1개 1’ 중복 방지)
  if (opts.length) rows.push([`${opts.map(o => o.name || '(아이템)').join(' 또는 ')} 중 랜덤 1개`, '1', true]);
  return rows;
}
// 제출 제한 문구(아이콘·부연 없음): 1인 1회 / 매주 1인 N회 / 매월 1인 N회 …
function rtLimitText(t) {
  if (t.kind === 'weekly' || t.submit_limit === 'once_per_user_week') return '매주 1인 1회';
  if (t.submit_limit === 'per_user_week') return `매주 1인 ${t.limit_count || 1}회`;
  if (t.submit_limit === 'per_user_month') return `매월 1인 ${t.limit_count || 1}회`;
  return RT_LIMIT[t.submit_limit] || '';
}
// 분류 배지: '월간,래버' → [월간] [래버]
function rtCatBadges(cat) {
  return String(cat || '').split(',').map(x => x.trim()).filter(Boolean).map(x => `<span class="rt-cat">${glEsc(x)}</span>`).join('');
}
// 제출 1건의 보상 처리 상태 문구(연구기록·아이템·무작위 결과)
function rtSubRewardText(s) {
  const rows = rtRewardRows(s.reward_amount, s.rewards);
  if (!rows.length) return '보상 없음';
  const r = s.reward_result;
  const got = r ? [r.records ? `연구기록 ${r.records}` : '', ...(r.items || []).map(i => `${i.name || '아이템'} ${i.qty || 1}`), r.random ? `${r.random.name || '아이템'} 1(무작위)` : '']
    .filter(Boolean).join(' + ') : rows.map(([n, q, rnd]) => rnd ? n : `${n} ${q}`).join(' + ');
  if (s.reward_status === 'paid') return `${got} 지급 완료`;
  if (s.reward_status === 'test' || s.is_test) return `테스트 제출 — ${got} 미지급(소급 없음)`;
  if (s.reward_status === 'disabled') return `${got} — 지급 꺼짐`;
  return `${got} (승인 시 지급)`;
}
// 프롬프트 조건 강조: 이스케이프한 뒤 **…** 만 <strong> 으로(핵심 대상·수량·분량만 굵게)
function rtEmph(s) {
  return glEsc(s || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
// 프롬프트 조건(구조화) 렌더링 — prompt_spec: {common, image:{lead, lines:[{t, sub}]}, text:{…}, notes:[…], either}
//   없으면 예전 그림/글 한 줄(prompt_image/prompt_text)을 같은 모양으로. 의미·심사 로직은 바꾸지 않는다(표시만).
function rtPromptHtml(t) {
  const sp = t.prompt_spec && typeof t.prompt_spec === 'object' ? t.prompt_spec
    : (t.prompt_image || t.prompt_text) ? { image: t.prompt_image ? { lines: [{ t: t.prompt_image }] } : null,
                                            text: t.prompt_text ? { lines: [{ t: t.prompt_text }] } : null,
                                            either: !!(t.prompt_image && t.prompt_text) } : null;
  if (!sp) return '';
  const col = (label, part) => {
    if (!part || !(part.lines || []).length) return '';
    const lines = (part.lines || []).map(l => `<li><span class="rt-pl-t">${rtEmph(l.t)}</span>${l.sub ? `<span class="rt-pl-sub">${rtEmph(l.sub)}</span>` : ''}</li>`).join('');
    return `<div class="rt-prompt-col">
      <div class="rt-prompt-k">${glEsc(label)}${part.lead ? ` <span class="rt-prompt-lead">— ${glEsc(part.lead)}</span>` : ''}</div>
      <ul class="rt-prompt-lines${part.lead ? ' is-choice' : ''}">${lines}</ul>
    </div>`;
  };
  const cols = [col('그림', sp.image), col('글', sp.text)].filter(Boolean);
  const notes = (sp.notes || []).map(n => `<p class="rt-prompt-notice">${rtEmph(n)}</p>`).join('');
  return `${sp.common ? `<div class="rt-prompt-common"><span class="rt-prompt-k2">공통 대상</span>${rtEmph(sp.common)}</div>` : ''}
    <div class="rt-prompt-grid${cols.length > 1 ? ' is-two' : ''}">${cols.join('')}</div>
    ${notes}
    ${sp.either || cols.length > 1 ? '<p class="rt-prompt-note">그림 또는 글 중 하나로 참여할 수 있어요.</p>' : ''}`;
}
// 제출 당시 참여 개체·관계 검증 기록
function rtEntryText(e) {
  if (!e) return '';
  if (e.npc) return '참여: 래버 NPC';
  const c = e.character ? `${e.character.name}${e.character.species_name ? ` (${e.character.species_name})` : ''}` : '';
  if (e.partner) return `참여: ${c} ↔ ${e.partner.name}${e.relation?.label ? ` · ${e.relation.label}` : ''} (관계란 등록 확인${e.relation?.registered_on === 'partner' ? ' — 상대 쪽' : ''})`;
  return `참여: ${c} (본인 소유 확인)`;
}
// 제출·심사 당시 내용(스냅샷) — 승인 뒤 원래 글이 바뀌어도 이 내용으로 확인
//   sens: { on, note } — 지금 민감 설정된 연구면 본문·이미지를 덮개 아래에 둔다(제목·관련 개체는 그대로)
function rtSnapshotHtml(snap, sens) {
  if (!snap) return '<p class="gl-sub gl-muted">제출 당시 내용 기록 없음</p>';
  const hide = !!sens?.on;
  const imgs = (snap.images || []).map(i => `<a href="${glEsc(glImgUrl(i.path))}" target="_blank" rel="noopener"><img src="${glEsc(glImgUrl(i.thumb_path || i.path))}" alt="" loading="lazy"></a>`).join('');
  const chars = (snap.characters || []).map(c => `<span class="rt-snap-char${c.is_research_target ? ' is-target' : ''}">${glEsc(glCharName(c))}${c.species_name ? ` · ${glEsc(c.species_name)}` : ''}</span>`).join('');
  const body = `${snap.content ? `<div class="rt-snap-content">${glEsc(snap.content)}</div>` : ''}
    ${imgs ? `<div class="rt-snap-imgs">${imgs}</div>` : '<div class="gl-sub gl-muted" style="font-size:12px;">이미지 없음(글 연구)</div>'}`;
  return `<div class="rt-snap">
    <div class="rt-snap-title">${glEsc(snap.title || '')}</div>
    ${hide ? `<div class="gl-sens-wrap gl-sens-block"><div class="blurred">${body}</div>${glSensOverlayHtml(sens.note, '누르면 내용이 보여요')}</div>` : body}
    ${chars ? `<div class="rt-snap-chars">관련 개체 ${chars}</div>` : ''}
    <div class="gl-sub gl-muted" style="font-size:11px;">기록 시각 ${glFmtDate(snap.captured_at, true)}</div>
  </div>`;
}
// 주간 과제는 그 주 연구대상 이미지를 대표 이미지로(민감 요소 개체는 이미지 없이)
function rtTaskImage(t, week) {
  if (t.kind === 'weekly') {
    const c = week && week.status === 'selected' ? week.character : null;
    if (!c || (c.is_sensitive && characterHasVisibleRealImage(c))) return '';
    return resolveCharacterImage(c, { thumb: true });
  }
  return t.image_url || '';
}

// ============================================================
// 내 개체 갤러리에 담기 (2026-11-07) — supabase/character_gallery_post_links_apply_1107.sql
//   게시물에 직접 업로드된 이미지만 대상(외부 URL 입력 없음). 파일 복제 없이 (개체, 원본 이미지) 연결만 저장.
//   개체 1체를 고르고, 그 개체에 담을 이미지를 여러 장 고른다. 이미 담긴 이미지는 '담김'으로 표시·선택 불가.
//   권한(로그인·현재 소유주)·원본 유효성은 전부 서버가 다시 확인한다 — 여기서는 화면만.
// ============================================================
async function mountGalleryLinkButton(root, post, user) {
  if (!root || !post || !(post.images || []).length || !user) return;   // 이미지 없는 글·비로그인 → 버튼 없음
  // 이 글에 연결된 개체 중 지금 내 소유 개체가 있을 때만 버튼 표시(판정은 서버 _gallery_post_link_targets 기준)
  const { data, error } = await sb.rpc('gallery_link_state', { p_post_id: post.id, p_character_id: null });
  if (error || !(data?.related_mine || []).length) return;
  root.innerHTML = '<button type="button" class="btn-ghost gl-link-open">내 개체 갤러리에 담기</button>';
  root.classList.remove('gl-hidden');
  root.querySelector('.gl-link-open').addEventListener('click', () => openGalleryLinkModal(post));
}

// 담기 전용 오류 문구 — 함수 미적용(PGRST202)은 '담기 SQL 미적용'으로, 나머지는 공통 glRpcError
function glLinkError(error, fallback) {
  if (error?.code === 'PGRST202' || /Could not find the function/i.test(error?.message || '')) return '아직 서버에 적용되지 않은 기능이에요. (갤러리 담기 SQL 미적용)';
  return glRpcError(error, fallback);
}

function openGalleryLinkModal(post) {
  const ov = document.createElement('div');
  ov.className = 'rs-pop-overlay';
  ov.innerHTML = `<div class="rs-pop-card gl-link-card" role="dialog" aria-modal="true" aria-labelledby="glLinkTitle">
    <div class="rs-pop-head">
      <p class="rs-pop-title" id="glLinkTitle">내 개체 갤러리에 담기</p>
      <p class="rs-pop-desc">이 글에 연결된 내 개체 1체를 고르고, 그 개체 갤러리에 담을 그림을 골라주세요.
파일을 새로 올리지 않고 이 게시물의 원본 그림을 연결해요. 원본이 삭제되면 갤러리에서도 함께 사라져요.</p>
    </div>
    <div class="rs-pop-body gl-link-body"><p class="gl-sub gl-muted">불러오는 중…</p></div>
    <div class="rs-pop-foot">
      <button type="button" class="btn-ghost" data-act="close">닫기</button>
      <button type="button" class="btn-secondary gl-hidden" data-act="save" disabled>담기</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const body = ov.querySelector('.gl-link-body');
  const saveBtn = ov.querySelector('[data-act="save"]');
  const st = { char: null, images: [], picked: new Set(), busy: false, seq: 0 };

  function markQuick() {
    body.querySelectorAll('[data-quick]').forEach(b => {
      const on = !!st.char && b.dataset.quick === String(st.char.id);
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function close() {
    if (st.busy) return;
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    ov.remove();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('[data-act="close"]').addEventListener('click', close);

  function updateSave() {
    const n = st.picked.size;
    saveBtn.classList.toggle('gl-hidden', !st.char);
    saveBtn.disabled = st.busy || !st.char || n === 0;
    saveBtn.textContent = st.busy ? '담는 중…' : (n ? `${n}장 담기` : '담기');
  }

  function renderImages() {
    const box = body.querySelector('.gl-link-images');
    if (!box) return;
    if (!st.char) { box.innerHTML = '<p class="gl-sub gl-muted">먼저 담을 개체를 골라주세요.</p>'; updateSave(); return; }
    const left = st.images.filter(i => !i.linked).length;
    box.innerHTML = `
      <p class="form-label" style="margin-bottom:6px;">담을 그림 <span class="gl-muted">${st.images.length > 1 ? '여러 장 고를 수 있어요' : ''}</span></p>
      ${left ? '' : '<p class="gl-sub" style="margin-bottom:8px;">이 게시물의 그림이 모두 이 개체 갤러리에 담겨 있어요.</p>'}
      <div class="gl-link-grid">${st.images.map(img => {
        const on = st.picked.has(Number(img.id));
        return `<button type="button" class="gl-link-tile${img.linked ? ' is-linked' : ''}${on ? ' is-picked' : ''}" data-img="${glEsc(img.id)}"
                  ${img.linked ? 'disabled aria-disabled="true"' : `aria-pressed="${on}"`}>
          <img src="${glEsc(glImgUrl(img.thumb_path || img.path))}" alt="" loading="lazy" decoding="async">
          <span class="gl-link-state">${img.linked ? '담김' : (on ? '✓ 선택됨' : '선택')}</span>
        </button>`;
      }).join('')}</div>`;
    updateSave();
  }

  async function loadFor(charBrief) {
    const mySeq = ++st.seq;
    st.char = charBrief || null;
    st.picked.clear();
    const box = body.querySelector('.gl-link-images');
    if (box) box.innerHTML = '<p class="gl-sub gl-muted">불러오는 중…</p>';
    updateSave();
    const { data, error } = await sb.rpc('gallery_link_state', { p_post_id: post.id, p_character_id: st.char ? st.char.id : null });
    if (mySeq !== st.seq) return;   // 더 최근에 고른 개체가 있으면 버림
    if (error) {
      if (box) box.innerHTML = `<p class="gl-sub" style="color:#b91c1c;">${glEsc(glLinkError(error, '불러오지 못했어요.'))}</p>`;
      st.char = null; markQuick(); updateSave(); return;
    }
    st.images = data.images || [];
    if (st.char && data.character) st.char = data.character;
    markQuick();
    const free = st.images.filter(i => !i.linked);
    if (st.char && free.length === 1) st.picked.add(Number(free[0].id));   // 담을 수 있는 그림이 1장이면 미리 선택
    renderImages();
  }

  async function init() {
    const { data, error } = await sb.rpc('gallery_link_state', { p_post_id: post.id, p_character_id: null });
    if (error) { body.innerHTML = `<p class="gl-sub" style="color:#b91c1c;">${glEsc(glLinkError(error, '불러오지 못했어요.'))}</p>`; return; }
    st.images = data.images || [];
    if (!st.images.length) { body.innerHTML = '<p class="gl-sub">이 게시물에는 담을 수 있는 그림이 없어요.</p>'; return; }
    const related = data.related_mine || [];
    if (!related.length) { body.innerHTML = '<p class="gl-sub">이 글에 연결된 내 개체가 없어요.</p>'; return; }
    body.innerHTML = `
      <div class="gl-link-related">
        <p class="form-label" style="margin-bottom:6px;">담을 개체 <span class="gl-muted">이 글에 연결된 내 개체만 고를 수 있어요</span></p>
        <div class="gl-chars">${related.map(c => `<button type="button" class="gl-link-quick" data-quick="${glEsc(c.id)}" aria-pressed="false">${glCharCardHtml(c, { link: false })}</button>`).join('')}</div>
      </div>
      <div class="gl-link-images" style="margin-top:14px;"></div>
      <p class="gl-link-msg gl-sub" role="status" aria-live="polite"></p>`;
    body.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => {
      const c = related.find(x => String(x.id) === b.dataset.quick);
      if (!c || st.busy || (st.char && String(st.char.id) === b.dataset.quick)) return;
      body.querySelector('.gl-link-msg').textContent = '';
      loadFor(c);
    }));
    body.addEventListener('click', e => {
      const t = e.target.closest('.gl-link-tile');
      if (!t || t.disabled || st.busy) return;
      const id = Number(t.dataset.img);
      if (st.picked.has(id)) st.picked.delete(id); else st.picked.add(id);
      renderImages();
    });
    renderImages();
    if (related.length === 1) loadFor(related[0]);   // 고를 수 있는 개체가 1체면 바로 선택
  }

  saveBtn.addEventListener('click', async () => {
    if (st.busy || !st.char || !st.picked.size) return;
    st.busy = true; updateSave();
    const msg = body.querySelector('.gl-link-msg');
    let res;
    try {
      res = await sb.rpc('gallery_link_images', { p_post_id: post.id, p_character_id: st.char.id, p_image_ids: [...st.picked] });
    } catch (e) { res = { error: e }; }
    st.busy = false;
    const { data, error } = res || {};
    if (error || !data || typeof data.added !== 'number' || !Array.isArray(data.linked_image_ids)) {
      // 실패·응답 불명은 성공으로 표시하지 않는다. 응답만 유실됐을 수 있으니 서버의 실제 담김 상태를 다시 읽어 맞춘다.
      msg.style.color = '#b91c1c';
      msg.textContent = error ? glLinkError(error, '담지 못했어요.') : '담기 결과를 확인하지 못했어요. 아래 담김 상태를 확인해 주세요.';
      const keep = msg.textContent;
      await loadFor(st.char);
      msg.textContent = keep;
      return;
    }
    const linked = new Set((data.linked_image_ids || []).map(Number));
    st.images.forEach(i => { if (linked.has(Number(i.id))) i.linked = true; });
    st.picked.clear();
    renderImages();
    msg.style.color = '';
    msg.innerHTML = `${glEsc(glCharName(st.char))} 갤러리에 ${Number(data.added) || 0}장을 담았어요.${data.already ? ` (이미 담겨 있던 ${Number(data.already)}장 제외)` : ''}
      <a href="character.html?id=${encodeURIComponent(st.char.id)}#gallerySectionWrap" style="color:var(--sky-deep);font-weight:700;">개체 갤러리 보기</a>`;
  });

  init();
}
