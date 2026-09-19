const STAMP_IMG = '../images/attendance_stamp.png';

let _user          = null;
let _year          = 0;
let _month         = 0;
let _attendedDates = new Set(); // 전체 출석 날짜 (streak 계산용)
let _wallet        = null;
let _streak        = 0;         // 현재 연속 출석일

// ── 초기화 ──────────────────────────────────────────────
async function initPage() {
  try {
    _user = await getUser();
    if (!_user) { window.location.href = 'login.html'; return; }

    await loadData();
    renderAll();

    document.getElementById('pageLoading').style.display = 'none';
    document.getElementById('pageContent').style.display = '';
  } catch (e) {
    console.error('[attendance] initPage 오류:', e);
    document.getElementById('pageLoading').textContent = '불러오기 실패. 새로고침 해주세요.';
  }
}

async function loadData() {
  const now = new Date(new Date().getTime() + 9 * 60 * 60 * 1000); // KST 기준
  _year     = now.getUTCFullYear();
  _month    = now.getUTCMonth();

  // 연속 출석 계산을 위해 충분한 기간 로드 (최대 400일)
  const [logsRes, walletRes] = await Promise.all([
    sb.from('attendance_logs')
      .select('attendance_date')
      .eq('user_id', _user.id)
      .order('attendance_date', { ascending: false })
      .limit(400),
    getMyWallet(_user.id),
  ]);

  _attendedDates = new Set((logsRes.data || []).map(l => l.attendance_date));
  _wallet        = walletRes.data;
  _streak        = calcStreak(_attendedDates);
}

// 연속 출석일 계산: KST 오늘부터 하루씩 뒤로 가며 count
function calcStreak(dates) {
  let streak = 0;
  // KST 기준 오늘을 UTC ms로 계산
  let kstMs  = new Date().getTime() + 9 * 60 * 60 * 1000;

  while (true) {
    const dateStr = new Date(kstMs).toISOString().slice(0, 10);
    if (!dates.has(dateStr)) break;
    streak++;
    kstMs -= 24 * 60 * 60 * 1000; // 하루 전
  }
  return streak;
}

// ── 전체 렌더 ────────────────────────────────────────────
function renderAll() {
  renderSummary();
  renderCheckinArea();
  renderCalendar();
  renderBonusGuide();
}

// ── 요약 영역 ────────────────────────────────────────────
function renderSummary() {
  document.getElementById('summaryCount').textContent = _streak;

  const nextEl = document.getElementById('summaryNextBonus');
  const unitEl = document.getElementById('summaryNextBonusUnit');

  if (_streak > 0 && _streak % 7 === 0) {
    nextEl.textContent = '보너스 달성!';
    unitEl.textContent = '';
  } else {
    const daysLeft = 7 - (_streak % 7);
    nextEl.textContent = daysLeft;
    unitEl.textContent = '일 남음';
  }
}

// ── 출석 버튼 영역 ───────────────────────────────────────
function renderCheckinArea() {
  const attended = _attendedDates.has(todayStr());
  const btn  = document.getElementById('checkinBtn');
  const done = document.getElementById('checkinDone');

  if (attended) {
    btn.style.display  = 'none';
    done.style.display = '';
  } else {
    btn.style.display  = '';
    done.style.display = 'none';
    btn.disabled       = false;
    btn.textContent    = '출석 체크';
  }
}

// ── 달력 (이번 달 표시) ──────────────────────────────────
function renderCalendar() {
  const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  document.getElementById('calMonthTitle').textContent = `${_year}년 ${monthNames[_month]}`;

  const daysInMonth  = new Date(_year, _month + 1, 0).getDate();
  const firstWeekday = new Date(_year, _month, 1).getDay();
  const today        = todayStr();
  const grid         = document.getElementById('calGrid');
  grid.innerHTML     = '';

  for (let i = 0; i < firstWeekday; i++) {
    const el = document.createElement('div');
    el.className = 'attn-day attn-day--empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = `${_year}-${pad(_month + 1)}-${pad(d)}`;
    const isToday  = dateStr === today;
    const attended = _attendedDates.has(dateStr);

    const cell = document.createElement('div');
    cell.className = 'attn-day'
      + (isToday  ? ' attn-day--today'    : '')
      + (attended ? ' attn-day--attended' : '');

    const num = document.createElement('span');
    num.className   = 'attn-day-num';
    num.textContent = d;
    cell.appendChild(num);

    if (attended) {
      const stamp = document.createElement('div');
      stamp.className = 'attendance-stamp';
      stamp.innerHTML = `<img src="${STAMP_IMG}" alt="출석">`;
      cell.appendChild(stamp);
    }

    grid.appendChild(cell);
  }
}

// ── 보너스 가이드 (7일 주기 내 진행 표시) ──────────────────
function renderBonusGuide() {
  // 현재 28일 주기 내 위치 (0이면 방금 28일 달성)
  const cyclePos = _streak % 28 === 0 && _streak > 0 ? 28 : _streak % 28;
  const steps    = [7, 14, 21, 28];

  steps.forEach((step, i) => {
    const stepEl = document.getElementById(`bonusStep${step}`);
    if (!stepEl) return;

    const achieved = cyclePos >= step;
    stepEl.classList.toggle('attn-bonus-step--done', achieved);
    stepEl.classList.remove('attn-bonus-step--current');

    const lineEl = document.getElementById(`bonusLine${steps[i - 1]}`);
    if (lineEl) lineEl.classList.toggle('attn-bonus-line--done', cyclePos >= step);
  });
}

// ── 출석 체크인 ──────────────────────────────────────────
async function checkIn() {
  const btn = document.getElementById('checkinBtn');
  btn.disabled    = true;
  btn.textContent = '처리 중...';
  hideResultMsg();

  try {
    const { data, error } = await sb.rpc('record_attendance');

    if (error || !data?.success) {
      showResultMsg(
        data?.error === 'ALREADY_ATTENDED'
          ? '이미 오늘 출석하셨습니다.'
          : '출석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        'error'
      );
      return;
    }

    // 상태 갱신
    _attendedDates.add(todayStr());
    _streak = data.streak;
    if (data.new_research != null) {
      _wallet = { ...(_wallet || {}), research_records: data.new_research, keys: data.new_keys };
    }

    if (typeof updateHeaderCurrencyDisplay === 'function') {
      updateHeaderCurrencyDisplay({ research_records: data.new_research, keys: data.new_keys });
    }

    renderAll();

    let msg = `출석 완료! 연구기록 +${data.research_earned}`;
    if (data.keys_earned  > 0) msg += `, 열쇠 +${data.keys_earned}`;
    if (data.bonus)            msg += ` · ${data.streak}일 연속 달성 보너스 지급!`;
    showResultMsg(msg, 'success');

  } catch (e) {
    console.error('[attendance] checkIn 오류:', e);
    showResultMsg('출석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error');
  } finally {
    if (!_attendedDates.has(todayStr())) {
      btn.disabled    = false;
      btn.textContent = '출석 체크';
    }
  }
}

// ── 유틸 ─────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

// KST 기준 날짜 문자열 반환 (UTC+9 고정)
// .getTime()은 항상 UTC ms, .toISOString()은 항상 UTC 포맷이므로
// +9시간 더한 뒤 ISO slice하면 정확히 KST 날짜를 얻음
function getKSTDateString(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function todayStr() {
  return getKSTDateString();
}

function showResultMsg(text, type) {
  const el = document.getElementById('resultMsg');
  if (!el) return;
  el.textContent   = text;
  el.className     = `attn-result-msg attn-result-msg--${type}`;
  el.style.display = '';
}

function hideResultMsg() {
  const el = document.getElementById('resultMsg');
  if (el) el.style.display = 'none';
}

initPage();
