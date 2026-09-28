// ============================================
// 문의·버그리포트 이미지 첨부 공통 모듈
// - 작성 화면: createSupportAttachPicker() 로 선택/미리보기/개별 삭제, submitSupportPost() 로 업로드 + 글 생성
// - 상세 화면: renderSupportAttachments() 로 썸네일 표시(signed URL), 클릭 시 확대 뷰어
// - 글 삭제 후: purgeSupportAttachments() 로 삭제 대기열의 Storage 파일 정리
//
// 서버 구조(supabase/support_attachments_apply_0928.sql):
//   버킷 support-attachments(private) / 경로 {inquiry|bug}/{uid}/{draft uuid}/{1-5}.jpg
//   create_support_post RPC 가 글 + 첨부 행을 한 트랜잭션으로 생성(경로/업로더/형식/용량 재검증)
//   글 삭제 → 첨부 행 cascade → support_attachment_purge_queue 기록 → 여기서 Storage remove → mark_…_purged
//
// 이미지 처리: js/utils.js compressImage 와 같은 방식(실제 디코드로 검증 → canvas 재인코딩)이지만
//   compressImage 는 2MB/2000px/GIF 처리가 고정이라 첨부용 설정(원본 10MB, 긴 변 2560px, JPEG 0.9)을 따로 둔다.
//   canvas 재인코딩으로 EXIF(위치 등 메타데이터)는 제거된다.
// ============================================

const SUPPORT_ATTACH = {
  BUCKET:          'support-attachments',
  MAX_FILES:       5,
  MAX_INPUT_BYTES: 10 * 1024 * 1024,
  MAX_EDGE:        2560,
  QUALITY:         0.9,
  TYPES:           ['image/jpeg', 'image/png', 'image/webp'],
  SIGNED_TTL:      3600,
};

function saEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function saUuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 파일 앞부분 시그니처로 실제 형식 판별 (확장자/브라우저가 준 MIME 만 믿지 않음)
async function saSniffType(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function saDecode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요. 손상된 파일인지 확인해주세요.')); };
    img.src = url;
  });
}

// 선택 시점 검증: 형식(브라우저 MIME + 실제 시그니처) / 용량 / 실제 디코드
async function saValidateFile(file) {
  if (file.type && !SUPPORT_ATTACH.TYPES.includes(file.type)) {
    throw new Error('JPG, PNG, WEBP 이미지만 첨부할 수 있어요.');
  }
  if (file.size > SUPPORT_ATTACH.MAX_INPUT_BYTES) {
    throw new Error('이미지 한 장은 10MB 이하만 첨부할 수 있어요.');
  }
  const sniffed = await saSniffType(file);
  if (!sniffed) throw new Error('JPG, PNG, WEBP 이미지만 첨부할 수 있어요.');
  await saDecode(file);
}

function saToBlob(canvas, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// 업로드용 재인코딩: 긴 변 2560px 이하 JPEG. 투명 영역은 흰색으로 합성.
async function saEncode(file) {
  const img = await saDecode(file);
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, SUPPORT_ATTACH.MAX_EDGE / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  let blob = await saToBlob(canvas, SUPPORT_ATTACH.QUALITY);
  if (blob && blob.size > SUPPORT_ATTACH.MAX_INPUT_BYTES) blob = await saToBlob(canvas, 0.8);
  if (!blob) throw new Error('이미지 변환에 실패했어요.');
  if (blob.size > SUPPORT_ATTACH.MAX_INPUT_BYTES) throw new Error('변환 후에도 10MB를 넘는 이미지예요. 더 작은 이미지를 사용해주세요.');
  return blob;
}

// ── 작성 화면: 선택/미리보기/개별 삭제 ─────────────────────
function createSupportAttachPicker(rootEl) {
  const items = [];   // { file, url }
  let disabled = false;

  rootEl.classList.add('sa-picker');
  rootEl.innerHTML = `
    <div class="sa-picker-head">
      <span class="form-label" style="margin:0;">이미지 첨부</span>
      <span class="sa-count"></span>
    </div>
    <div class="sa-grid"></div>
    <p class="sa-hint">JPG·PNG·WEBP / 한 장당 10MB 이하 / 최대 ${SUPPORT_ATTACH.MAX_FILES}장</p>
    <p class="sa-error"></p>
    <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>`;

  const grid    = rootEl.querySelector('.sa-grid');
  const countEl = rootEl.querySelector('.sa-count');
  const errorEl = rootEl.querySelector('.sa-error');
  const input   = rootEl.querySelector('input[type=file]');

  function render() {
    countEl.textContent = `${items.length}/${SUPPORT_ATTACH.MAX_FILES}`;
    countEl.classList.toggle('is-full', items.length >= SUPPORT_ATTACH.MAX_FILES);
    grid.innerHTML = items.map((it, i) => `
      <div class="sa-thumb">
        <img src="${saEsc(it.url)}" alt="첨부 이미지 ${i + 1}" data-view="${i}">
        <button type="button" class="sa-thumb-remove" data-remove="${i}" aria-label="이미지 ${i + 1} 삭제">×</button>
      </div>`).join('')
      + (items.length < SUPPORT_ATTACH.MAX_FILES
        ? `<button type="button" class="sa-add"><span class="sa-add-plus">+</span><span>이미지 추가</span></button>`
        : '');
  }

  grid.addEventListener('click', (e) => {
    if (disabled) return;
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const [removed] = items.splice(+rm.dataset.remove, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      errorEl.textContent = '';
      render();
      return;
    }
    const view = e.target.closest('[data-view]');
    if (view) { openSupportImageViewer(items.map(it => it.url), +view.dataset.view); return; }
    if (e.target.closest('.sa-add')) input.click();
  });

  input.addEventListener('change', async () => {
    const picked = [...input.files];
    input.value = '';   // 같은 파일 다시 선택 가능
    errorEl.textContent = '';
    const room = SUPPORT_ATTACH.MAX_FILES - items.length;
    const errors = [];
    if (picked.length > room) errors.push(`이미지는 최대 ${SUPPORT_ATTACH.MAX_FILES}장까지 첨부할 수 있어요.`);
    for (const file of picked.slice(0, Math.max(0, room))) {
      try {
        await saValidateFile(file);
        items.push({ file, url: URL.createObjectURL(file) });
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }
    errorEl.textContent = errors.join(' ');
    render();
  });

  render();

  return {
    getFiles: () => items.map(it => it.file),
    setDisabled(v) { disabled = !!v; rootEl.classList.toggle('is-disabled', disabled); },
  };
}

// ── 작성 제출: 업로드 → create_support_post → 실패 시 이번에 올린 파일 즉시 remove ─────
// kind: 'inquiry' | 'bug'. 반환 { id, error }
async function submitSupportPost({ kind, title, content, picker, onProgress }) {
  const uploaded = [];
  try {
    const user = await getUser();
    if (!user) throw new Error('로그인이 필요해요.');
    const files = picker ? picker.getFiles() : [];
    const draft = saUuid();

    for (let i = 0; i < files.length; i++) {
      onProgress?.(`이미지 업로드 중 (${i + 1}/${files.length})`);
      const blob = await saEncode(files[i]);
      const path = `${kind}/${user.id}/${draft}/${i + 1}.jpg`;
      const { error } = await sb.storage.from(SUPPORT_ATTACH.BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error(`이미지 업로드에 실패했어요. (${error.message})`);
      uploaded.push(path);
    }

    onProgress?.('제출 중...');
    const { data, error } = await sb.rpc('create_support_post', {
      p_kind: kind, p_title: title, p_content: content, p_paths: uploaded,
    });
    if (error) throw error;
    return { id: data, error: null };
  } catch (err) {
    if (uploaded.length) {
      try { await sb.storage.from(SUPPORT_ATTACH.BUCKET).remove(uploaded); }
      catch (e) { console.warn('[첨부] 실패 후 업로드 파일 정리 실패(고아 파일 가능):', e); }
    }
    return { id: null, error: err };
  }
}

// ── 상세 화면: 첨부 썸네일 ─────────────────────────────
async function renderSupportAttachments(containerEl, kind, postId) {
  if (!containerEl) return;
  const col = kind === 'inquiry' ? 'inquiry_id' : 'bug_report_id';
  const { data, error } = await sb.from('support_attachments')
    .select('id, bucket_id, storage_path, sort_order')
    .eq(col, postId)
    .order('sort_order');
  if (error) console.warn('[첨부] 조회 실패:', error);
  if (error || !data?.length) { containerEl.hidden = true; return; }

  const { data: signed, error: signErr } = await sb.storage.from(SUPPORT_ATTACH.BUCKET)
    .createSignedUrls(data.map(a => a.storage_path), SUPPORT_ATTACH.SIGNED_TTL);
  if (signErr) console.warn('[첨부] 서명 URL 발급 실패:', signErr);
  const urlByPath = new Map((signed || []).filter(s => s.signedUrl && !s.error).map(s => [s.path, s.signedUrl]));
  const urls = data.map(a => urlByPath.get(a.storage_path) || null);
  const viewable = urls.filter(Boolean);

  containerEl.hidden = false;
  containerEl.classList.add('sa-detail');
  containerEl.innerHTML = `
    <p class="sa-detail-title">첨부 이미지 <span class="sa-detail-count">${data.length}</span></p>
    <div class="sa-grid sa-grid--detail">
      ${urls.map((u, i) => u
        ? `<button type="button" class="sa-thumb sa-thumb--view" data-view="${viewable.indexOf(u)}" aria-label="첨부 이미지 ${i + 1} 크게 보기">
             <img src="${saEsc(u)}" alt="첨부 이미지 ${i + 1}" loading="lazy">
           </button>`
        : `<div class="sa-thumb"><span class="sa-thumb-failed">이미지를 불러올 수 없어요</span></div>`).join('')}
    </div>`;

  containerEl.querySelector('.sa-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) openSupportImageViewer(viewable, +btn.dataset.view);
  });
}

// ── 글 삭제 후: 삭제 대기열의 Storage 파일 정리 (실패해도 글 삭제 결과에는 영향 없음) ─────
async function purgeSupportAttachments(postId) {
  try {
    const { data, error } = await sb.from('support_attachment_purge_queue')
      .select('bucket_id, storage_path')
      .eq('source_id', postId)
      .is('purged_at', null);
    if (error) throw error;
    if (!data?.length) return;

    const byBucket = new Map();
    data.forEach(r => {
      if (!byBucket.has(r.bucket_id)) byBucket.set(r.bucket_id, []);
      byBucket.get(r.bucket_id).push(r.storage_path);
    });
    for (const [bucket, paths] of byBucket) {
      const { error: rmErr } = await sb.storage.from(bucket).remove(paths);
      if (rmErr) { console.warn('[첨부] Storage 정리 실패(대기열에 남음):', rmErr); continue; }
      const { error: markErr } = await sb.rpc('mark_support_attachments_purged', { p_bucket_id: bucket, p_paths: paths });
      if (markErr) console.warn('[첨부] 정리 완료 표시 실패:', markErr);
    }
  } catch (e) {
    console.warn('[첨부] 삭제 대기열 처리 실패(대기열에 남음):', e);
  }
}

// ── 확대 뷰어 (여러 장 좌우 이동, ESC/방향키/스와이프, 이미지 탭 시 원본 크기 토글) ─────
let _saViewer = null;

function openSupportImageViewer(urls, index = 0) {
  if (!urls?.length) return;
  if (!_saViewer) {
    const el = document.createElement('div');
    el.className = 'sa-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="sa-viewer-stage"><img class="sa-viewer-img" alt=""></div>
      <span class="sa-viewer-counter"></span>
      <button type="button" class="sa-viewer-close" aria-label="닫기">✕</button>
      <button type="button" class="sa-viewer-nav sa-viewer-nav--prev" aria-label="이전 이미지">‹</button>
      <button type="button" class="sa-viewer-nav sa-viewer-nav--next" aria-label="다음 이미지">›</button>`;
    document.body.appendChild(el);

    const state = { el, urls: [], index: 0, touchX: null };
    const img = el.querySelector('.sa-viewer-img');
    state.show = (i) => {
      state.index = (i + state.urls.length) % state.urls.length;
      el.classList.remove('is-zoomed');
      img.src = state.urls[state.index];
      el.querySelector('.sa-viewer-counter').textContent = state.urls.length > 1 ? `${state.index + 1} / ${state.urls.length}` : '';
      el.classList.toggle('is-single', state.urls.length <= 1);
    };
    state.close = () => {
      el.classList.remove('is-open');
      document.body.classList.remove('sa-viewer-open');
      img.removeAttribute('src');
    };

    el.querySelector('.sa-viewer-close').addEventListener('click', state.close);
    el.querySelector('.sa-viewer-nav--prev').addEventListener('click', () => state.show(state.index - 1));
    el.querySelector('.sa-viewer-nav--next').addEventListener('click', () => state.show(state.index + 1));
    el.addEventListener('click', (e) => {
      if (e.target === img) { el.classList.toggle('is-zoomed'); return; }
      if (e.target === el || e.target.classList.contains('sa-viewer-stage')) state.close();
    });
    el.addEventListener('touchstart', (e) => { state.touchX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (state.touchX == null || state.urls.length <= 1 || el.classList.contains('is-zoomed')) return;
      const dx = e.changedTouches[0].clientX - state.touchX;
      state.touchX = null;
      if (Math.abs(dx) > 50) state.show(state.index + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('keydown', (e) => {
      if (!el.classList.contains('is-open')) return;
      if (e.key === 'Escape') state.close();
      else if (e.key === 'ArrowLeft'  && state.urls.length > 1) state.show(state.index - 1);
      else if (e.key === 'ArrowRight' && state.urls.length > 1) state.show(state.index + 1);
    });
    _saViewer = state;
  }
  _saViewer.urls = urls;
  _saViewer.show(index);
  _saViewer.el.classList.add('is-open');
  document.body.classList.add('sa-viewer-open');
}
