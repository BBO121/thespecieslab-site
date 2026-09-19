/* ── 공통 검색 모듈 ────────────────────────────
   개체/종족/유저 검색 조건과 정규화 로직을 한 곳에서 관리한다.
   헤더 통합 검색(searchAll)과 목록 페이지(searchCharacters/searchSpecies)가
   서로 다른 쿼리를 쓰지 않도록 반드시 이 모듈의 함수를 통해서만 검색한다.
   사용처: sb(js/auth.js)가 먼저 로드되어 있어야 한다. */

const SEARCH_MIN_LENGTH = 1; // 이보다 짧으면(공백/빈 문자열) 서버 요청을 보내지 않음

// 검색어 정규화: 앞뒤 공백 제거 + 한글 NFC 정규화
// 신규 등록/수정 시 이름을 저장하기 전에도 동일하게 사용한다.
function normalizeSearchQuery(q) {
  return (q || '').trim().normalize('NFC');
}

// ILIKE 와일드카드(%, _, \)를 리터럴로 취급하기 위한 이스케이프
function escapeIlike(q) {
  return q.replace(/[%_\\]/g, '\\$&');
}

// PostgREST or() 필터 DSL에서 값을 큰따옴표로 묶어 쉼표/괄호를 리터럴로
// 취급하기 위한 이스케이프(escapeIlike로 이미 넣은 백슬래시도 여기서 함께
// 이스케이프해야 한다). 반드시 escapeIlike 이후, 값 조립 직전에만 사용한다.
function escapeOrValue(v) {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// 입력 디바운스 (기본 300ms)
function debounce(fn, wait = 300) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// LABBER 종족명 캐시 — characters 테이블은 species_id가 아니라 species_name(텍스트)으로
// 종족과 연결되므로, 개체 목록에서 LABBER를 제외하려면 이름이 필요하다. ID(utils.js
// LABBER_SPECIES_ID)만 하드코딩하고 이름은 species 테이블에서 조회해 캐싱한다.
let _labberSpeciesNamePromise = null;
async function getLabberSpeciesName() {
  if (typeof LABBER_SPECIES_ID === 'undefined') return null;
  if (!_labberSpeciesNamePromise) {
    _labberSpeciesNamePromise = sb
      .from('species')
      .select('name')
      .eq('id', LABBER_SPECIES_ID)
      .maybeSingle()
      .then(({ data }) => data?.name || null);
  }
  return _labberSpeciesNamePromise;
}

/**
 * 개체 검색
 * @param {string} query
 * @param {{ speciesName?, ownerUserId?, ownerNickname?, sort?: 'recent'|'name',
 *           limit?, offset?, signal?, minLength? }} options
 */
async function searchCharacters(query, options = {}) {
  const {
    speciesName = null,
    ownerUserId = null,
    ownerNickname = null,
    sort = 'recent',
    limit = 30,
    offset = 0,
    signal,
    minLength = SEARCH_MIN_LENGTH,
  } = options;

  const q = normalizeSearchQuery(query);

  try {
    let builder = sb.from('characters').select(
      'id, name, species_name, owner_nickname, owner_user_id, image_url, thumbnail_url, default_image_index, created_at, is_sensitive, sensitive_note',
      { count: 'exact' }
    );

    // LABBER 종족 개체는 일반 개체 목록/통합검색에 노출하지 않는다 (개체기록실 전용).
    // speciesName으로 LABBER를 직접 지정해서 조회하는 경우(개체기록실 등)는 예외로 둔다.
    const labberName = await getLabberSpeciesName();
    if (labberName && speciesName !== labberName) {
      builder = builder.neq('species_name', labberName);
    }

    if (q.length >= minLength) {
      const pattern = escapeOrValue(`%${escapeIlike(q)}%`);
      builder = builder.or(
        `name.ilike."${pattern}",owner_nickname.ilike."${pattern}",species_name.ilike."${pattern}"`
      );
    }
    if (speciesName)                    builder = builder.eq('species_name', speciesName);
    if (ownerUserId)                     builder = builder.eq('owner_user_id', ownerUserId);
    else if (ownerNickname)              builder = builder.eq('owner_nickname', ownerNickname);

    builder = sort === 'name'
      ? builder.order('name', { ascending: true })
      : builder.order('created_at', { ascending: false });

    builder = builder.range(offset, offset + limit - 1);
    if (signal) builder = builder.abortSignal(signal);

    const { data, error, count } = await builder;
    if (error) throw error;
    return { data: data || [], error: null, count: count ?? (data ? data.length : 0) };
  } catch (err) {
    if (err.name === 'AbortError') return { data: [], error: null, count: 0, aborted: true };
    console.error('[검색] 개체 검색 실패:', err);
    return { data: [], error: err, count: 0 };
  }
}

/**
 * 종족 검색
 * @param {string} query
 * @param {{ openType?: 'all'|'open'|'closed', ageFilter?: 'all'|'none'|'restricted',
 *           sort?: 'recent'|'name', limit?, offset?, signal?, minLength? }} options
 */
async function searchSpecies(query, options = {}) {
  const {
    openType = 'all',
    ageFilter = 'all',
    sort = 'recent',
    limit = 30,
    offset = 0,
    signal,
    minLength = SEARCH_MIN_LENGTH,
  } = options;

  const q = normalizeSearchQuery(query);

  try {
    let builder = sb.from('species').select(
      'id, name, image_url, thumbnail_url, default_image_index, created_at, is_sensitive, sensitive_note, open_type, age_limit, owner_nickname',
      { count: 'exact' }
    );

    // LABBER 종족은 일반 종족 목록/통합검색에 노출하지 않는다 (개체기록실 전용). utils.js 참고.
    if (typeof LABBER_SPECIES_ID !== 'undefined') builder = builder.neq('id', LABBER_SPECIES_ID);

    if (q.length >= minLength) builder = builder.ilike('name', `%${escapeIlike(q)}%`);
    if (openType === 'open')   builder = builder.eq('open_type', 'open');
    if (openType === 'closed') builder = builder.eq('open_type', 'closed');
    if (ageFilter === 'none')       builder = builder.or('age_limit.is.null,age_limit.eq.0');
    else if (ageFilter === 'restricted') builder = builder.gt('age_limit', 0);

    builder = sort === 'name'
      ? builder.order('name', { ascending: true })
      : builder.order('created_at', { ascending: false });

    builder = builder.range(offset, offset + limit - 1);
    if (signal) builder = builder.abortSignal(signal);

    const { data, error, count } = await builder;
    if (error) throw error;
    return { data: data || [], error: null, count: count ?? (data ? data.length : 0) };
  } catch (err) {
    if (err.name === 'AbortError') return { data: [], error: null, count: 0, aborted: true };
    console.error('[검색] 종족 검색 실패:', err);
    return { data: [], error: err, count: 0 };
  }
}

/**
 * 유저 검색 (닉네임 + 아이디/login_id)
 * 이메일 원문은 절대 반환하지 않음 — supabase/search_setup.sql의 search_users RPC 참고.
 * @param {string} query
 * @param {{ limit?, signal?, minLength? }} options
 */
async function searchUsers(query, options = {}) {
  const { limit = 10, signal, minLength = SEARCH_MIN_LENGTH } = options;
  const q = normalizeSearchQuery(query);
  if (q.length < minLength) return { data: [], error: null, count: 0 };

  try {
    let builder = sb.rpc('search_users', { p_query: q, p_limit: limit });
    if (signal) builder = builder.abortSignal(signal);
    const { data, error } = await builder;
    if (error) throw error;
    const rows = data || [];
    const count = rows.length ? Number(rows[0].total_count) || rows.length : 0;
    return { data: rows, error: null, count };
  } catch (err) {
    if (err.name === 'AbortError') return { data: [], error: null, count: 0, aborted: true };
    console.error('[검색] 유저 검색 실패:', err);
    return { data: [], error: err, count: 0 };
  }
}

/**
 * 헤더 통합 검색 — 개체/종족/유저를 한 번에 조회한다.
 * 세 검색 중 하나가 실패해도 나머지 결과는 그대로 반환한다(부분 실패 허용).
 * @param {string} query
 * @param {{ charLimit?, speciesLimit?, userLimit?, signal?, minLength? }} options
 */
async function searchAll(query, options = {}) {
  const {
    charLimit = 6,
    speciesLimit = 4,
    userLimit = 5,
    signal,
    minLength = SEARCH_MIN_LENGTH,
  } = options;

  const q = normalizeSearchQuery(query);
  if (q.length < minLength) {
    return { characters: [], species: [], users: [], charCount: 0, speciesCount: 0, userCount: 0, error: null };
  }

  const [charsRes, speciesRes, usersRes] = await Promise.all([
    searchCharacters(q, { limit: charLimit, signal, minLength }),
    searchSpecies(q, { limit: speciesLimit, signal, minLength }),
    searchUsers(q, { limit: userLimit, signal, minLength }),
  ]);

  return {
    characters: charsRes.data,
    species: speciesRes.data,
    users: usersRes.data,
    charCount: charsRes.count,
    speciesCount: speciesRes.count,
    userCount: usersRes.count,
    aborted: charsRes.aborted || speciesRes.aborted || usersRes.aborted || false,
    error: charsRes.error || speciesRes.error || usersRes.error || null,
  };
}
