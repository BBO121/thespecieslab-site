// 개체마다 보유한 성장 Step이 달라 "대표로 어떤 Step 이미지를 보여줄지"를
// 종족 전체 고정(species.main_image_step_id)이 아니라 개체별로 계산해야 하는 종족을 여기서 정의한다.
// 여기 없는 종족은 기존 방식(species.main_image_step_id 고정) 그대로 동작한다.
// 우선순위는 배열 앞쪽일수록 높다(먼저 대표로 선택됨), Step 이름으로 매칭한다(step_order와 무관).
const REPRESENTATIVE_STEP_PRIORITY = {
  172: ['성체용', '승천용', '재앙용', '수련용', '발탁용', '아기융'], // 융용 — 성체용이 최우선 대표, 아기융만 '융', 나머지는 '용' 표기가 정식 명칭
};

function hasRepresentativePriority(speciesId) {
  return Object.prototype.hasOwnProperty.call(REPRESENTATIVE_STEP_PRIORITY, Number(speciesId));
}

// candidates: [{ ...무엇이든, name }] 형태의 배열. 우선순위가 가장 높은 것을 반환하고, 없으면 null.
function pickHighestPriorityStep(speciesId, candidates) {
  const order = REPRESENTATIVE_STEP_PRIORITY[Number(speciesId)];
  if (!order || !candidates || !candidates.length) return null;
  for (const name of order) {
    const found = candidates.find(c => (c.name || '') === name);
    if (found) return found;
  }
  return null;
}
