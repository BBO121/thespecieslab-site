// ============================================
// LABBER 종족 노출 규칙
// LABBER(수상한 연구실/관리소 계열) 종족은 일반 종족 목록/상세에 노출하지 않고
// "개체기록실"(labber-records.html)에서만 확인한다.
// species row / 개체 / 신청 / 특성 / 탐험 데이터는 그대로 유지되며, 여기서 하는 건
// 목록 쿼리에서 이 id를 제외하고, species.html 직접 접근 시 개체기록실로 리다이렉트하는 것뿐.
// ============================================
const LABBER_SPECIES_ID = 204;

// ============================================
// 유저 검색/매칭 공용 헬퍼
// 검색어로 유저를 찾는 기능은 js/search.js의 searchUsers(query, options)/debounce()를
// 그대로 쓴다(중복 구현 금지 — js/search.js 상단 주석 참고). 여기 있는 건 "검색"이
// 아니라 "이미 알고 있는 식별자(uuid/닉네임/아이디) 목록을 한 번에 매칭"이 필요한
// 화면 전용 헬퍼다. login_id는 매칭에만 쓰고 응답에는 포함되지 않는다.
// ============================================

// 이미 알고 있는 UUID 목록 → {id, nickname} 목록 (캐릭터에 저장된 designer_user_ids 등 표시용)
async function resolveUsersByIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const { data, error } = await sb.rpc('resolve_users_by_ids', { p_ids: list });
  if (error) { console.warn('[resolveUsersByIds] 오류:', error); return []; }
  return data || [];
}

// 닉네임/login_id 문자열 목록(붙여넣은 대량이전 목록 등) → 입력값별 매칭 유저 맵
// admin/staff 전용 RPC. 반환: Map<원본identifier, [{id,nickname}, ...]>
async function resolveUsersByIdentifiers(identifiers) {
  const list = [...new Set((identifiers || []).map(s => (s || '').trim()).filter(Boolean))];
  const map = new Map();
  if (!list.length) return map;
  const { data, error } = await sb.rpc('resolve_users_by_identifiers', { p_identifiers: list });
  if (error) { console.warn('[resolveUsersByIdentifiers] 오류:', error); return map; }
  (data || []).forEach(row => {
    if (!map.has(row.matched_identifier)) map.set(row.matched_identifier, []);
    map.get(row.matched_identifier).push({ id: row.id, nickname: row.nickname });
  });
  return map;
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/gif', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_DIMENSION  = 2000;
const MAX_BLOB_BYTES       = 2 * 1024 * 1024;

function compressImage(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      reject(new Error('PNG, GIF, JPG, WebP 형식의 이미지만 업로드할 수 있어요.'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지 파일을 읽을 수 없습니다. 파일 용량·색상 프로파일·손상 여부를 확인해주세요.'));
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // GIF: 애니메이션 보존을 위해 Canvas 변환 없이 원본 반환 (해상도가 커도 리사이징 불가하므로 여기서만 상한 적용)
      if (file.type === 'image/gif') {
        if (img.width > MAX_IMAGE_DIMENSION || img.height > MAX_IMAGE_DIMENSION) {
          reject(new Error(`이미지 해상도가 너무 커요. 최대 ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION}px까지 업로드할 수 있어요. (현재: ${img.width}×${img.height}px)`));
          return;
        }
        if (file.size > MAX_BLOB_BYTES) {
          reject(new Error('GIF 파일은 2MB 이하만 업로드할 수 있어요.'));
          return;
        }
        resolve(file);
        return;
      }

      // 해상도가 너무 크면 거부하지 않고 상한(MAX_IMAGE_DIMENSION) 안으로 먼저 축소한다.
      let { width, height } = img;
      const cap = Math.min(maxSize, MAX_IMAGE_DIMENSION);
      if (width > cap || height > cap) {
        if (width > height) { height = Math.round(height * cap / width); width  = cap; }
        else                { width  = Math.round(width  * cap / height); height = cap; }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('이미지 압축에 실패했어요.')); return; }
        if (blob.size <= MAX_BLOB_BYTES) { resolve(blob); return; }

        // 2MB 초과 시 품질 낮춰 재시도
        canvas.toBlob((blob2) => {
          if (!blob2) { reject(new Error('이미지 압축에 실패했어요.')); return; }
          if (blob2.size > MAX_BLOB_BYTES) {
            reject(new Error('압축 후에도 용량이 2MB를 초과해요. 더 작은 이미지를 사용해주세요.'));
            return;
          }
          resolve(blob2);
        }, 'image/jpeg', 0.65);
      }, 'image/jpeg', quality);
    };

    img.src = objectUrl;
  });
}

// Cropper.js 인스턴스 → 3:4 JPEG blob
function cropToBlob(cropper, maxSize = 600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const outH    = Math.round(maxSize * 4 / 3);
    const cropped = cropper.getCroppedCanvas({
      width: maxSize, height: outH,
      imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    });
    if (!cropped) { reject(new Error('크롭에 실패했어요.')); return; }

    // PNG 투명 배경 → 흰색으로 합성 후 JPEG 변환
    const canvas = document.createElement('canvas');
    canvas.width  = cropped.width;
    canvas.height = cropped.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cropped, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('썸네일 생성에 실패했어요.')); return; }
      resolve(blob);
    }, 'image/jpeg', quality);
  });
}

// 워터마크 원본 종횡비를 유지한 채, 대상 이미지 중앙에 최대 크기로 들어가는 사각형 계산 (contain 방식)
// - 가로형 이미지는 좌우 기준, 세로형 이미지는 상하 기준으로 맞춰짐
// - 정사각형 워터마크를 canvas 크기에 맞춰 강제로 늘리면 종횡비가 찌그러지므로 사용
function calculateWatermarkRect(canvasWidth, canvasHeight, watermarkWidth, watermarkHeight) {
  if (!canvasWidth || !canvasHeight || !watermarkWidth || !watermarkHeight) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const scale  = Math.min(canvasWidth / watermarkWidth, canvasHeight / watermarkHeight);
  const width  = watermarkWidth  * scale;
  const height = watermarkHeight * scale;

  return {
    x: (canvasWidth  - width)  / 2,
    y: (canvasHeight - height) / 2,
    width,
    height
  };
}

// 이미지 blob + 워터마크 URL → 워터마크 합성 JPEG blob
function applyWatermark(imageBlob, watermarkUrl) {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(imageBlob);
    const img = new Image();
    let wm = new Image();
    let imgReady = false, wmReady = false;

    function tryCompose() {
      if (!imgReady || !wmReady) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        if (wm.naturalWidth > 0) {
          const rect = calculateWatermarkRect(canvas.width, canvas.height, wm.naturalWidth, wm.naturalHeight);
          ctx.drawImage(wm, rect.x, rect.y, rect.width, rect.height);
        }
        canvas.toBlob(blob => {
          URL.revokeObjectURL(blobUrl);
          if (!blob) { reject(new Error('워터마크 합성에 실패했어요. (canvas tainted 또는 메모리 부족)')); return; }
          resolve(blob);
        }, 'image/jpeg', 0.90);
      } catch (e) {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('워터마크 합성 오류: ' + e.message));
      }
    }

    img.onload  = () => { imgReady = true; tryCompose(); };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('이미지 로드에 실패했어요.')); };
    img.src = blobUrl;

    function loadWatermark(src) {
      wm = new Image();
      wm.crossOrigin = 'anonymous';
      wm.onload = () => { wmReady = true; tryCompose(); };
      wm.onerror = () => {
        // 커스텀 워터마크 실패 시 기본 워터마크로 대체, 기본도 실패하면 워터마크 없이 진행
        if (src !== '../images/watermark.png') {
          loadWatermark('../images/watermark.png');
        } else {
          wmReady = true;
          tryCompose();
        }
      };
      wm.src = src + (src.includes('?') ? '&' : '?') + '_wm=' + Date.now();
    }
    loadWatermark(watermarkUrl);
  });
}

// Storage 공개 URL → 버킷 내 파일 경로 (images 버킷, .storage.from('images').remove()에 사용)
function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = '/object/public/images/';
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

// ============================================
// 대표/메인 이미지가 없을 때 쓰는 연구소 기본 이미지
// (species: 1:1 text_species_01~05.png, characters: 3:4 text_species_character_01~05.png)
//
// 우선순위: 사용자가 지정한 default_image_index(연구소 기본 이미지) > 실제 이미지
//          (image_url/thumbnail_url) > id 기반 자동 fallback(같은 id는 항상 같은 번호
//          — 렌더링마다 바뀌지 않음)
//
// default_image_index를 지정하면 실제 이미지가 있어도 연구소 기본 이미지가 우선 표시된다
// (실제 이미지는 DB에서 지워지지 않고 그대로 남아있음 — "선택 해제"하면 다시 실제 이미지가 보임).
//
// 나이제한(age_limit>0) 숨김, 민감요소(is_sensitive) 블러 등 화면별 특수 처리는
// "실제 이미지가 지금 화면에 쓰이고 있는지" 기준으로 적용해야 하므로 speciesHasVisibleRealImage /
// characterHasVisibleRealImage로 판단한다 — 연구소 기본 이미지는 실제 콘텐츠가 아니므로
// 블러/숨김/워터마크 대상이 되지 않는다.
// ============================================

const DEFAULT_IMAGE_COUNT = 5;

function speciesDefaultImageUrl(index) {
  return `../images/text_species_${String(index).padStart(2, '0')}.png`;
}

function characterDefaultImageUrl(index) {
  return `../images/text_species_character_${String(index).padStart(2, '0')}.png`;
}

function autoDefaultImageIndex(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return 1;
  return (Math.abs(n) % DEFAULT_IMAGE_COUNT) + 1;
}

// 종족 대표 이미지 URL (지정 기본 이미지 > 실제 이미지 > id 기반 자동 fallback). 항상 값을 반환한다.
function resolveSpeciesImage(sp, { thumb = true } = {}) {
  if (!sp) return null;
  if (sp.default_image_index) return speciesDefaultImageUrl(sp.default_image_index);
  const real = thumb ? (sp.thumbnail_url || sp.image_url) : sp.image_url;
  if (real) return real;
  return speciesDefaultImageUrl(autoDefaultImageIndex(sp.id));
}

// 개체 메인 이미지 URL (지정 기본 이미지 > 실제 이미지 > id 기반 자동 fallback). 항상 값을 반환한다.
function resolveCharacterImage(c, { thumb = true } = {}) {
  if (!c) return null;
  if (c.default_image_index) return characterDefaultImageUrl(c.default_image_index);
  const real = thumb ? (c.thumbnail_url || c.image_url) : c.image_url;
  if (real) return real;
  return characterDefaultImageUrl(autoDefaultImageIndex(c.id));
}

// 대표 캐릭터 이름 — 개인 설정(user_settings.character_name_display_mode)과 무관하게
// 항상 owner_custom_name(소유주 설정 개체명) 우선, 없거나 공백뿐이면 등록명(name)으로 폴백.
function representativeCharacterName(c) {
  if (!c) return '';
  return c.owner_custom_name?.trim() || c.name || '';
}

// 지금 화면에 "실제 이미지"가 쓰이고 있는지 (연구소 기본 이미지를 지정했다면 false).
// 블러/나이제한 숨김처럼 실제 콘텐츠에만 적용해야 하는 처리의 조건으로 사용한다.
function speciesHasVisibleRealImage(sp, { thumb = true } = {}) {
  if (!sp || sp.default_image_index) return false;
  return !!(thumb ? (sp.thumbnail_url || sp.image_url) : sp.image_url);
}

function characterHasVisibleRealImage(c, { thumb = true } = {}) {
  if (!c || c.default_image_index) return false;
  return !!(thumb ? (c.thumbnail_url || c.image_url) : c.image_url);
}

// 중앙 자동 크롭 (팝업 없이) → JPEG blob
function autoCenterCropToBlob(file, aspectRatio = 3/4, maxSize = 600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지 파일을 읽을 수 없습니다. 파일 용량·색상 프로파일·손상 여부를 확인해주세요.'));
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const iw = img.width, ih = img.height;
      let cw, ch;
      if (iw / ih > aspectRatio) { ch = ih; cw = ih * aspectRatio; }
      else                       { cw = iw; ch = iw / aspectRatio; }
      const cx   = (iw - cw) / 2, cy = (ih - ch) / 2;
      const outH = Math.round(maxSize / aspectRatio);
      const canvas = document.createElement('canvas');
      canvas.width = maxSize; canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, maxSize, outH);
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, maxSize, outH);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('썸네일 생성에 실패했어요.')); return; }
        resolve(blob);
      }, 'image/jpeg', quality);
    };
    img.src = objectUrl;
  });
}

// ============================================
// 개인 환경설정 (user_settings) 공용 헬퍼
// MY > 설정 페이지, 상점, 프로필 프레임 렌더링에서 공유해서 쓴다.
// row가 없는 사용자(기존/신규 전부, 한 번도 설정을 바꾼 적 없는 사용자)는
// hide_sensitive_content=false(민감요소 표시)로 간주한다. — 2026-08-28 기본 정책 변경.
// ============================================
// character_name_display_mode: 내 캐릭터 목록에서 우선 표시할 이름.
// 'registered' = 등록명(characters.name), 'owner' = 소유주 설정 개체명(characters.owner_custom_name).
const DEFAULT_USER_SETTINGS = { hide_sensitive_content: false, character_name_display_mode: 'registered' };

// 현재 로그인 사용자의 설정 조회. row가 없는 경우(.maybeSingle()이 error 없이 data:null을
// 반환하는 경우)에만 기본값을 반환한다. RLS/네트워크/DB 오류 등 실제 오류는 절대 기본값으로
// 위장하지 않고 그대로 throw한다 — 호출부에서 페이지 관례에 맞게 오류 처리해야 한다.
async function getUserSettings(userId) {
  if (!userId) return { ...DEFAULT_USER_SETTINGS };
  const { data, error } = await sb.from('user_settings')
    .select('hide_sensitive_content, character_name_display_mode')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || { ...DEFAULT_USER_SETTINGS };
}

// 설정 변경 — row가 없으면 새로 생성(upsert)한다.
async function updateUserSettings(userId, patch) {
  if (!userId) return { data: null, error: new Error('NOT_AUTHENTICATED') };
  const { data, error } = await sb.from('user_settings')
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('hide_sensitive_content, character_name_display_mode')
    .single();
  if (error) console.warn('[updateUserSettings] 오류:', error);
  return { data, error };
}

// ============================================
// 검색엔진(SEO) 공용 헬퍼
// 종족/개체 상세처럼 <head>가 고정된 페이지에서 "실제 조회된 데이터" 기준으로
// title/description/canonical/og 를 동적으로 채우거나, 없는 데이터일 때 noindex 를 건다.
// 숨김 텍스트/클로킹 용도가 아니다 — 사용자가 화면에서 보는 것과 같은 공개 정보만 사용한다.
// ============================================
const SEO_SITE_ORIGIN = 'https://thespecieslab.com';
const SEO_DEFAULT_IMAGE = `${SEO_SITE_ORIGIN}/images/og-thumbnail.jpg`;

// 리치텍스트/HTML → 공백 정리된 순수 텍스트 (태그·엔티티 제거) 후 maxLen 초과 시 말줄임.
// DOMParser는 스크립트를 실행하지 않고, 이미지도 로드하지 않는다.
function seoPlainText(html, maxLen = 150) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const text = (doc.body.textContent || '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '') // 보이지 않는 방향/서식 제어문자
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + '…';
}

// <head>의 meta/link 하나를 찾아 값을 설정 (없으면 생성)
function seoSetHeadTag(selector, tagName, attrs, valueAttr, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement(tagName);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  }
  el.setAttribute(valueAttr, value);
}

// 상세 페이지 SEO 메타 일괄 설정. canonicalPath 는 '/pages/species.html?id=1' 처럼 origin 뒤 경로.
function applySeoMeta({ title, description, canonicalPath, image }) {
  const url = SEO_SITE_ORIGIN + canonicalPath;
  if (title) document.title = title;
  if (description) seoSetHeadTag('meta[name="description"]', 'meta', { name: 'description' }, 'content', description);
  seoSetHeadTag('link[rel="canonical"]', 'link', { rel: 'canonical' }, 'href', url);
  const og = (prop, val) => val && seoSetHeadTag(`meta[property="${prop}"]`, 'meta', { property: prop }, 'content', val);
  og('og:title', title);
  og('og:description', description);
  og('og:image', image || SEO_DEFAULT_IMAGE);
  og('og:url', url);
}

// 존재하지 않는 상세 페이지 — GitHub Pages는 404 상태코드를 줄 수 없으므로 noindex 로 대신한다.
function applySeoNoIndex() {
  seoSetHeadTag('meta[name="robots"]', 'meta', { name: 'robots' }, 'content', 'noindex, nofollow');
}

// Supabase .single() 결과가 "해당 행 없음"인지 판정 (네트워크/일시 오류와 구분).
// 일시 오류에는 noindex 를 걸지 않기 위한 것 — PGRST116 = 0 rows.
function isSeoRowNotFound(error, row) {
  if (error) return error.code === 'PGRST116';
  return !row;
}

// 실제 콘텐츠가 렌더된 뒤에만 AdSense Auto ads 스크립트를 로드한다.
// (콘텐츠 없음/로딩 실패 화면에 광고만 남는 문제 방지 — 여러 번 호출해도 한 번만 로드)
function loadAdSense() {
  if (document.querySelector('script[data-adsense-loader]')) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1578944209330245';
  script.crossOrigin = 'anonymous';
  script.dataset.adsenseLoader = 'true';

  document.head.appendChild(script);
}
