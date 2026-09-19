// ── LABBER 개체기록실 (labber-records.html) ───────────────────────────
// species.html?id=204 의 "소속 개체" 영역을 LABBER 전용 페이지로 옮긴 것.
// 목록/정렬/분류필터/관리(선택삭제) 로직은 공통 모듈(js/species-character-list.js)을
// species.html 과 그대로 공유한다. 이 파일은 "종족 204 정보 조회 + 권한 판정 + mount" 만 담당.
//
// 개체 수정 / 소유권 이전 은 카드 클릭 → character.html?id=X 이동 후 그 페이지에서 처리되므로
// 여기서 따로 구현하지 않는다(기존과 완전히 동일하게 동작).

// LABBER_SPECIES_ID(=204) 는 js/utils.js 에 정의됨. 개체는 species_name 으로 연결되므로
// (개체 ID 하드코딩 아님) 여기서 종족명을 조회해 그 이름의 개체 전부를 자동으로 불러온다.

async function initLabberRecords() {
  const loadingEl = document.getElementById('pageLoading');
  const contentEl = document.getElementById('pageContent');
  const errEl     = document.getElementById('recordsError');

  try {
    const user = await getUser();

    // LABBER 종족 정보 (이름 + 소유주)
    const { data: species, error: spErr } = await sb
      .from('species')
      .select('id, name, owner_user_id')
      .eq('id', LABBER_SPECIES_ID)
      .single();

    if (spErr || !species) {
      throw new Error('LABBER 종족 정보를 불러오지 못했어요.');
    }

    // 닉네임 최신화 맵 (species.html 과 동일하게 get_all_users 사용)
    const idToNick = {};
    const { data: userList } = await sb.rpc('get_all_users');
    (userList || []).forEach(u => {
      if (u.id && u.nickname) idToNick[u.id] = u.nickname;
    });

    // 관리(선택삭제) 권한 — species.html 과 동일 기준: 종족 소유주 또는 슈퍼관리자 계정
    const isOwner = !!(user?.id && species.owner_user_id && user.id === species.owner_user_id);
    const isSuperAdmin = user?.id === window.SpeciesCharList.SUPER_ADMIN_USER_ID;

    // 콘텐츠를 먼저 노출한 뒤 mount — 분류 필터 "더보기" 높이 계산이
    // 숨겨진 컨테이너(display:none) 안에서는 0으로 잡히기 때문.
    loadingEl.style.display = 'none';
    contentEl.style.display = '';

    await window.SpeciesCharList.mount({
      speciesName: species.name,
      canManage:   isOwner || isSuperAdmin,
      idToNick,
    });
  } catch (e) {
    console.error('[labber-records] init 오류:', e);
    loadingEl.style.display = 'none';
    contentEl.style.display = '';
    if (errEl) {
      errEl.textContent = '개체 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
      errEl.style.display = '';
    }
  }
}

initLabberRecords();
