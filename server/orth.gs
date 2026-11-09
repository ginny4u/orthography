/* ===== 맞춤법 교정실 추가 파일 (orth) =====
 * 내신 클리닉 트래커 Apps Script에 붙이는 파일입니다. Code.gs와 omr은 그대로 두고,
 * 이 내용을 새 스크립트 파일(이름: orth)로 추가해 주세요. 왼쪽 파일 목록에서 omr보다 아래에 있으면 됩니다.
 * (새로 만들면 자동으로 맨 아래에 생깁니다)
 *
 * 1) 붙여 넣고 저장 → 위쪽 함수 목록에서 orthCheck 고르고 ▷ 실행 → 아래 '실행 로그'에 "모두 정상"이 나오는지 확인
 * 2) 배포 → 배포 관리 → 연필(수정) → 버전: 새 버전 → 배포   (웹 앱 주소는 그대로라 사이트는 고칠 것 없음)
 *
 * 하는 일
 * - 맞춤법 교정실 사이트가 트래커 계정(이름·비밀번호)으로 로그인합니다. 비밀번호도 트래커와 같습니다.
 * - 시트에 orth 탭이 생기고, 학생마다 한 줄씩 맞춤법 연습 기록(누적·이번 주·오늘 맞힌 수, 오답)이 쌓입니다.
 * - 트래커의 다른 탭(students, sets, subs …)과 트래커 화면은 건드리지 않습니다. 학생 명단·학교·퇴원 여부만 읽습니다.
 * - 사이트에서 한 번 로그인하면 그 폰에서는 30일 동안 다시 로그인하지 않아도 됩니다(계속 쓰면 연장).
 *   비밀번호를 바꾸거나 선생님이 0000으로 초기화하면, 퇴원 처리하면 바로 풀립니다.
 */

// 순위표 이름 표시: false = 이름 그대로(김경훈), true = 가운데 가림(김○훈). 본인 이름은 늘 그대로 보입니다.
var ORTH_MASK_NAME = false;
var ORTH_TOP = 5;            // 순위표에 보여 줄 등수 줄 수(같은 등수는 한 줄)
var ORTH_NAMES = 8;          // 한 줄에 보여 줄 이름 수(넘으면 '외 n명')
var ORTH_TOKEN_DAYS = 30;    // 사이트 로그인 유지 기간(일)
var ORTH_GHOST_CODE = '여기에 코드'; // 👻 졸업생 입장 코드(기본 개념만, 기록·순위 없음). 실제 값은 Apps Script에만 넣고 저장소에는 올리지 않는다
var ORTH_DAY_CAP = 1000;     // 하루에 셀 수 있는 최대 정답 수(장난 방지)
var ORTH_ID = /^[a-z][0-9a-z]{1,23}$/;   // 문제 번호 모양
// 뒤쪽 8칸(mast ~ v)은 2026-11 '익힘' 개편 때 붙인 칸. 옛 줄은 비어 있어도 읽히고, orthMigrate나 첫 동기화 때 채워진다.
//   mast: 지금 익힌 단어 수(연속 3번 맞힌 단어) · mast0: 이번 주 시작 때 익힌 수 · fastN/fastC/tn/tsum: 2초 안에 답한 수/그중 맞힌 수/시간 기록 수/걸린 시간 합(초)
//   run: 단어별 지금 연속 정답 수(0은 안 씀) · fast: 단어별 2초 안에 답한 수 · v: 기록 판(2 = 익힘 개편 뒤)
//   rd: 단어별로 도장을 마지막으로 찍은 때(1970년부터 몇 시간째, UTC). 다음 도장은 한국 시간으로 날짜가 다르고 10시간 이상 지나야 찍힘(2026-11-09 사용자 결정)
//       옛 기록은 날짜 번호(한국 시간 1970-01-01부터 며칠째, 10만 미만)로 들어 있음 → 그날 정오로 봄(orthRdH_)
//   도장 계단: 쓱쓱(kind 's')으로는 1개까지, 고르기('p')로는 2개까지, 직접 쓰기('t')로 3개째. 틀리면 그 단어 도장이 다 지워지는데, 쓰기에서 틀린 건 안 지움(그날 도장만 못 받음)
//   kan: 지금 익힘 칸 합(단어마다 0~3칸, run의 합) · kan0: 이번 주 시작 때 칸 합. '이번 주' 순위 = kan − kan0(2026-11-09 사용자 결정: 첫날부터 숫자가 오르게)
//   rev: 이번 주 복습 도장 수. 익힌 단어(도장 3개)를 7일 넘게 지나 다시 맞히면 1개(주 시작 때 0으로). '이번 주' = (kan − kan0) + rev
var ORTH_COLS = ['studentId', 'school', 'name', 'total', 'week', 'weekN', 'day', 'dayN', 'solved', 'updatedAt', 'dayIds', 'cids', 'wrong', 'st', 'mast', 'mast0', 'fastN', 'fastC', 'tn', 'tsum', 'run', 'fast', 'v', 'rd', 'kan', 'kan0', 'rev'];
var ORTH_LIGHT = 10;         // 순위 계산 때 읽는 앞쪽 칸 수(studentId ~ updatedAt). 뒤쪽 숫자 칸(mast ~ tsum)은 따로 더 읽음
var ORTH_RANK_COLS = ['mast', 'mast0', 'fastN', 'fastC', 'tn', 'tsum'];
var ORTH_NUM = { total: 1, weekN: 1, dayN: 1, solved: 1, mast: 1, mast0: 1, fastN: 1, fastC: 1, tn: 1, tsum: 1, v: 1, kan: 1, kan0: 1, rev: 1 };
var ORTH_REV_H = 7 * 24;     // 익힌 단어를 다시 확인하는 간격(시간). 맞히면 복습 도장 1개
var ORTH_LIST = { dayIds: 1, cids: 1, wrong: 1 };
var ORTH_MAP = { st: 1, run: 1, fast: 1, rd: 1 };
var ORTH_RUN = 3;            // 도장 이만큼 모으면 '익힘'(같은 단어는 하루에 한 번만)
var ORTH_GAP_H = 10;         // 다음 도장까지 최소 간격(시간)
var ORTH_CAP = { s: 1, p: 2, t: 3 };   // 유형별로 올라갈 수 있는 도장 수
var ORTH_FAST = 2;           // 이 초 안에 답하면 '빠른 답'(찍기 의심)
var ORTH_LOG_COLS = ['studentId', 'name', 'school', 'at', 'cid', 'n', 'fastN', 'res'];   // orth_log 탭: 동기화 묶음마다 한 줄, res = 문제번호:맞힘:초 …
var ORTH_LOG_MAX = 20000;    // orth_log 탭이 이보다 길어지면 오래된 줄을 지움
// 단어 열쇠: 쓱쓱 넘기기(op…)와 바른 표기 고르기(p…)는 같은 단어
function orthKey_(id) { return /^op/.test(id) ? id.slice(1) : id; }

/* ---------- 날짜(한국 시간) ---------- */
function orthKst_(iso) { return new Date(Date.parse(iso) + 9 * 3600 * 1000); }
function orthDay(iso) { return orthKst_(iso).toISOString().slice(0, 10); }
// 이번 주 = 월요일 0시(한국 시간)부터
function orthWeek(iso) { var d = orthKst_(iso); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
// 날짜 번호(한국 시간 1970-01-01부터 며칠째). 화면도 같은 식으로 셈
function orthDayNo_(iso) { return Math.floor((Date.parse(iso) + 9 * 3600 * 1000) / 864e5); }
function orthHourNo_(iso) { return Math.floor(Date.parse(iso) / 36e5); }
function orthRdH_(v) { v = Number(v) || 0; return v && v < 1e5 ? v * 24 + 3 : v; }   // 옛 날짜 번호 → 그날 정오(KST)의 시간 번호
function orthDayOfH_(h) { return Math.floor((h + 9) / 24); }
// 이 단어에 지금 도장을 찍을 수 있나: 날짜가 다르고 ORTH_GAP_H 이상 지남
function orthCanStamp_(rdv, nowH) { var h = orthRdH_(rdv); return !h || (orthDayOfH_(h) !== orthDayOfH_(nowH) && nowH - h >= ORTH_GAP_H); }

function orthMask(name) {
  var a = String(name || '').split('');
  if (!ORTH_MASK_NAME || a.length < 2) return a.join('');
  if (a.length === 2) return a[0] + '○';
  return a[0] + a.slice(1, -1).map(function () { return '○'; }).join('') + a[a.length - 1];
}

/* ---------- 학생 한 줄 ---------- */
function orthBlank_(st) {
  return { studentId: st.id, school: st.school, name: st.name, total: 0, week: '', weekN: 0, day: '', dayN: 0, solved: 0,
    updatedAt: '', dayIds: [], cids: [], wrong: [], st: {}, mast: 0, mast0: 0, fastN: 0, fastC: 0, tn: 0, tsum: 0, run: {}, fast: {}, v: 3, rd: {}, kan: 0, kan0: 0, rev: 0 };
}
// 날짜가 바뀌었으면 오늘·이번 주 수를 새로. 주가 바뀌면 '이번 주 시작 때 익힌 수'도 지금 값으로
function orthRoll_(row, day, week) {
  if (row.day !== day) { row.day = day; row.dayN = 0; row.dayIds = []; }
  if (row.week !== week) { row.week = week; row.weekN = 0; row.mast0 = Number(row.mast) || 0; row.kan0 = orthKan_(row.run); row.rev = 0; }
}
function orthMastCount_(run) { var n = 0; Object.keys(run || {}).forEach(function (k) { if (run[k] >= ORTH_RUN) n++; }); return n; }
function orthRdOut_(rd) { var o = {}; Object.keys(rd || {}).forEach(function (k) { o[k] = orthRdH_(rd[k]); }); return o; }
function orthKan_(run) { var n = 0; Object.keys(run || {}).forEach(function (k) { n += Math.min(ORTH_RUN, Number(run[k]) || 0); }); return n; }
// 칸 칸(kan·kan0)이 없던 줄(v<3)에 처음 채움. 이번 주에 이미 넘어온 줄은 주 시작 때 칸을 '그때 익힌 단어 × 3'으로 봄(그때는 익히는 중인 단어가 없었음)
function orthKanSeed_(row, week) {
  if (Number(row.v) >= 3) return false;
  row.kan = orthKan_(row.run);
  row.kan0 = row.week === week ? Math.min(row.kan, ORTH_RUN * (Number(row.mast0) || 0)) : row.kan;
  row.v = 3; return true;
}
// 개편 전 줄(v<2)에 '익힘'을 처음 매김: 그때까지 3번 이상 맞히고 정답률 80% 이상이던 단어는 익힌 것으로(사용자 결정, B안). 순서 기록이 없어 연속 3번은 셀 수 없음
function orthSeed_(row) {
  if (Number(row.v) >= 2) return false;
  var agg = {};
  Object.keys(row.st || {}).forEach(function (id) {
    var k = orthKey_(id), s = row.st[id] || [0, 0], a = agg[k] || (agg[k] = [0, 0]);
    a[0] += Number(s[0]) || 0; a[1] += Number(s[1]) || 0;
  });
  var run = {};
  Object.keys(agg).forEach(function (k) { var c = agg[k][0], w = agg[k][1]; if (c >= 3 && c >= 4 * w) run[k] = ORTH_RUN; });
  row.run = run; row.fast = {}; row.rd = {}; row.mast = orthMastCount_(run); row.mast0 = row.mast;
  row.fastN = 0; row.fastC = 0; row.tn = 0; row.tsum = 0; row.v = 2;
  return true;
}
function orthMine_(row) {
  return { total: row.total, week: row.week, weekN: row.weekN, day: row.day, dayN: row.dayN, dayIds: row.dayIds.slice(), solved: row.solved,
    mast: Number(row.mast) || 0, mast0: Number(row.mast0) || 0, kan: Number(row.kan) || 0, kan0: Number(row.kan0) || 0, rev: Number(row.rev) || 0 };
}
// 시트 한 칸은 5만 자까지라, 문제별 기록이 너무 길어지면 오답 없는 문제부터 덜어 냄(오답 노트는 그대로)
function orthTrim_(row) {
  if (JSON.stringify(row.st).length <= 45000) return;
  var wrong = {}; row.wrong.forEach(function (id) { wrong[id] = 1; });
  var keys = Object.keys(row.st);
  for (var i = 0; i < keys.length && JSON.stringify(row.st).length > 40000; i++) {
    var k = keys[i]; if (!wrong[k] && row.st[k][1] === 0) delete row.st[k];
  }
}

/* ---------- 로그인 확인 ---------- */
// 트래커 로그인 토큰(6시간)과 사이트 전용 토큰(30일) 둘 다 받음
function orthAuth_(req, store, env) {
  var tok = String(req.token || ''), id = null, via = 't', rec = null;
  var peek = false;
  if (tok) { id = env.cacheGet('t:' + tok); if (id && env.cacheGet('p:' + tok)) peek = true; }   // p: 트래커의 '보기 전용'(선생님 비밀번호로 들어옴)
  if (!id && tok && env.propGet) {
    try { rec = JSON.parse(env.propGet('ot:' + tok) || 'null'); } catch (e) { rec = null; }
    if (rec && rec.e > Date.parse(env.now())) { id = rec.i; via = 'o'; peek = !!rec.k; }
  }
  if (!id) throw userErr('로그인 시간이 지났습니다. 다시 로그인해 주세요.');
  var st = store.students().filter(function (s) { return s.id === id; })[0];
  if (!st || st.status !== 'active') throw userErr('등록된 학생이 아닙니다. 선생님께 말씀 드리세요.');
  if (via === 'o') {
    // 비밀번호가 바뀌었으면(본인 변경·선생님 초기화) 사이트 토큰도 무효
    if (rec.p !== String(st.pwHash).slice(0, 12)) { env.propDel('ot:' + tok); throw userErr('로그인 시간이 지났습니다. 다시 로그인해 주세요.'); }
    var now = Date.parse(env.now());
    if (rec.e - now < ORTH_TOKEN_DAYS * 864e5 / 2) { rec.e = now + ORTH_TOKEN_DAYS * 864e5; env.propPut('ot:' + tok, JSON.stringify(rec)); }
  }
  return { st: st, via: via, peek: peek };
}
function orthIssue_(st, env, peek) {
  if (!env.propPut) return '';
  var tok = 'o' + env.uuid().replace(/-/g, '');
  var now = Date.parse(env.now());
  var rec = { i: st.id, e: now + ORTH_TOKEN_DAYS * 864e5, p: String(st.pwHash).slice(0, 12) };
  if (peek) rec.k = 1;   // 보기 전용: 기록을 올릴 수 없음
  env.propPut('ot:' + tok, JSON.stringify(rec));
  // 만료된 토큰 정리
  var all = env.propAll ? env.propAll() : {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('ot:') !== 0) return;
    var r = null; try { r = JSON.parse(all[k]); } catch (e) { }
    if (!r || !(r.e > now)) env.propDel(k);
  });
  return tok;
}

/* ---------- 순위 ---------- */
// 같은 맞힌 수는 같은 등수, 한 줄에 묶음. 상위 ORTH_TOP줄 + (그 밖이면) 내 줄
function orthRank_(people, key, meId, withSchool) {
  var xs = people.filter(function (p) { return p[key] > 0; }).sort(function (a, b) {
    return b[key] - a[key] || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0);
  });
  var groups = [];
  xs.forEach(function (p, i) {
    var g = groups[groups.length - 1];
    if (!g || g.d !== p[key]) { g = { r: i + 1, d: p[key], list: [] }; groups.push(g); }
    g.list.push(p);
  });
  var gi = -1;
  groups.forEach(function (g, k) { if (g.list.some(function (p) { return p.id === meId; })) gi = k; });
  function show(g) {
    var mine = g.list.filter(function (p) { return p.id === meId; });
    var rest = g.list.filter(function (p) { return p.id !== meId; });
    var names = mine.concat(rest).slice(0, ORTH_NAMES).map(function (p) {
      return [p.id === meId ? p.n : orthMask(p.n), withSchool ? p.s : ''];
    });
    return { r: g.r, d: g.d, n: names, more: Math.max(0, g.list.length - ORTH_NAMES), me: mine.length ? 1 : 0 };
  }
  var out = { of: xs.length, top: groups.slice(0, ORTH_TOP).map(show) };
  if (gi >= ORTH_TOP) out.mine = show(groups[gi]);
  if (gi >= 0) {
    var g = groups[gi];
    out.me = { r: g.r, d: g.d, tied: g.list.length };
    if (gi > 0) out.me.up = { r: groups[gi - 1].r, gap: groups[gi - 1].d - g.d };
    else if (groups[1]) out.me.lead = g.d - groups[1].d;
  }
  return out;
}
function orthSchoolKey_(s) { return String(s || '').replace(/\s+/g, '').replace(/(여자고등학교|고등학교|여고|고)$/, ''); }
function orthBoard_(me, store, env, myRow) {
  var week = orthWeek(env.now());
  var active = {};
  store.students().forEach(function (s) { if (s.status === 'active') active[s.id] = s; });
  var best = {};
  store.orthRows().forEach(function (r) {
    if (!active[r.studentId]) return;
    var b = best[r.studentId];
    if (!b || r.total > b.total) best[r.studentId] = r;
  });
  if (myRow) best[me.id] = myRow;
  // 순위는 도장 수. 누적 = 지금 도장 합(kan), 이번 주 = 이번 주에 모은 도장(지금 합 − 주 시작 때 합, 0 아래로는 안 내려감)
  var people = Object.keys(best).filter(function (id) { return active[id]; }).map(function (id) {
    var r = best[id], s = active[id], m = Number(r.mast) || 0;
    return { id: id, n: s.name, s: s.school, w: r.week === week ? Math.max(0, (Number(r.kan) || 0) - (Number(r.kan0) || 0)) + (Number(r.rev) || 0) : 0, t: Number(r.kan) || 0 };
  });
  // 학교 이름은 트래커 표기('동양')와 화면 표기('동양고')가 다를 수 있어 '고·여고·고등학교'를 떼고 비교
  var mates = people.filter(function (p) { return orthSchoolKey_(p.s) === orthSchoolKey_(me.school); });
  // 학교 대항: 학교마다 재원생 수(n), 맞힌 사람 수(p), 맞힌 문제 합(d). 화면에서 1인당 평균으로 줄 세움
  var sch = {};
  Object.keys(active).forEach(function (id) {
    var k = active[id].school; if (!k) return;
    if (!sch[k]) sch[k] = { s: k, n: 0, pw: 0, pt: 0, w: 0, t: 0 };
    sch[k].n++;
  });
  people.forEach(function (p) {
    var g = sch[p.s]; if (!g) return;
    if (p.w > 0) { g.pw++; g.w += p.w; }
    if (p.t > 0) { g.pt++; g.t += p.t; }
  });
  var schools = Object.keys(sch).map(function (k) { return sch[k]; });
  return {
    week: week,
    school: { week: orthRank_(mates, 'w', me.id, false), total: orthRank_(mates, 't', me.id, false) },
    all: { week: orthRank_(people, 'w', me.id, true), total: orthRank_(people, 't', me.id, true) },
    sch: schools
  };
}
function orthHomeData_(st, store, env) {
  var row = store.orthGet(st.id) || orthBlank_(st);
  var now = env.now();
  orthSeed_(row); orthKanSeed_(row, orthWeek(now));
  orthRoll_(row, orthDay(now), orthWeek(now));
  return { mine: orthMine_(row), st: row.st, wrong: row.wrong, run: row.run || {}, rd: orthRdOut_(row.rd), board: orthBoard_(st, store, env, row) };
}

/* ---------- 요청 ---------- */
if (typeof CORE_ACTIONS !== 'undefined') {
  // 로그인: 트래커 로그인과 같고, 트래커 홈 대신 맞춤법 기록·순위를 돌려줌
  // 이름 찾기: 트래커 lookup과 같고, 처음 로그인(비밀번호 0000)인지(mc)를 같이 돌려줌
  CORE_ACTIONS.orthLookup = function (req, store, env) {
    var r = CORE_ACTIONS.lookup(req, store, env);
    if (!r.ok) return r;
    var byId = {};
    store.students().forEach(function (s) { byId[s.id] = s; });
    r.matches.forEach(function (m) { m.mc = !!(byId[m.id] && byId[m.id].mustChange); });
    return r;
  };
  // 👻 졸업생 입장: 코드만 확인(계정·기록 없음)
  CORE_ACTIONS.orthGhost = function (req, store, env) {
    if (/^여기에/.test(String(ORTH_GHOST_CODE)) || String(req.code || '') !== ORTH_GHOST_CODE) throw userErr('코드가 맞지 않아요.');   // 코드를 안 정했으면 아무도 못 들어옴
    return { ok: true };
  };
  CORE_ACTIONS.orthLogin = function (req, store, env) {
    var r = CORE_ACTIONS.login(req, store, env);
    if (!r.ok || r.me.mustChange) return r;
    var st = store.students().filter(function (s) { return s.id === r.me.id; })[0];
    r.otoken = orthIssue_(st, env, !!r.peek);   // 선생님 비밀번호로 들어온 '보기 전용'은 보기 전용 토큰
    r.orth = orthHomeData_(st, store, env);
    return r;
  };
  // 첫 로그인 비밀번호 변경(트래커 비밀번호가 바뀌는 것과 같음)
  CORE_ACTIONS.orthChangePw = function (req, store, env) {
    var r = CORE_ACTIONS.changePw(req, store, env);
    if (!r.ok) return r;
    var st = store.students().filter(function (s) { return s.id === r.me.id; })[0];
    r.otoken = orthIssue_(st, env);
    r.orth = orthHomeData_(st, store, env);
    return r;
  };
  CORE_ACTIONS.orthHome = function (req, store, env) {
    var a = orthAuth_(req, store, env);
    var res = { ok: true, me: publicStudent(a.st), orth: orthHomeData_(a.st, store, env) };
    if (a.via === 't') res.otoken = orthIssue_(a.st, env, a.peek);   // 트래커 토큰으로 들어오면 사이트 토큰을 새로 줌
    if (a.peek) res.peek = true;
    return res;
  };
  // 푼 결과 올리기. res = [[문제번호, 1(맞힘)|0(틀림), 걸린 초(없을 수 있음)], …], cid = 묶음 번호(같은 묶음이 두 번 와도 한 번만 반영)
  CORE_ACTIONS.orthSync = function (req, store, env) {
    var a = orthAuth_(req, store, env), st = a.st;
    if (a.peek) return { ok: true, dup: true, peek: true, mine: orthMine_(store.orthGet(st.id) || orthBlank_(st)), board: orthBoard_(st, store, env, store.orthGet(st.id) || orthBlank_(st)) };   // 보기 전용은 기록 안 함
    var list = Array.isArray(req.res) ? req.res.slice(0, 300) : [];
    var cid = String(req.cid || '').slice(0, 40);
    var now = env.now();
    var row = store.orthGet(st.id) || orthBlank_(st);
    row.school = st.school; row.name = st.name;
    orthSeed_(row); orthKanSeed_(row, orthWeek(now));
    orthRoll_(row, orthDay(now), orthWeek(now));
    var dup = !!cid && row.cids.indexOf(cid) >= 0;
    if (!dup) {
      var seen = {}, wrong = {}, run = row.run || {}, fast = row.fast || {}, rd = row.rd || {}, nowH = orthHourNo_(now), logRes = [], logFast = 0;
      row.dayIds.forEach(function (id) { seen[id] = 1; });
      row.wrong.forEach(function (id) { wrong[id] = 1; });
      list.forEach(function (x) {
        if (!Array.isArray(x)) return;
        var id = String(x[0]), ok = x[1] === 1 || x[1] === true;
        if (!ORTH_ID.test(id)) return;
        var sec = Number(x[2]);
        if (!(sec >= 0 && sec < 3600)) sec = -1;   // 시간이 없거나 이상하면 안 셈
        var kind = ORTH_CAP[x[3]] ? x[3] : 'p';   // 유형이 없는 옛 기록은 고르기로
        var s = row.st[id], k = orthKey_(id);
        if (!Array.isArray(s)) s = row.st[id] = [0, 0];
        row.solved++;
        if (ok) {
          s[0]++; delete wrong[id];
          // 도장: 날짜가 다르고 10시간 지났을 때, 그 유형으로 올라갈 수 있는 수까지만
          var lv = Number(run[k]) || 0;
          if (lv < ORTH_CAP[kind] && orthCanStamp_(rd[k], nowH)) { run[k] = lv + 1; rd[k] = nowH; }
          else if (lv >= ORTH_RUN && kind !== 's' && nowH - orthRdH_(rd[k]) >= ORTH_REV_H) { rd[k] = nowH; row.rev = (Number(row.rev) || 0) + 1; }   // 익힌 단어 복습 도장(7일마다, 쓱쓱 빼고)
          // 같은 문제는 하루에 한 번만 셈
          if (!seen[id] && row.dayN < ORTH_DAY_CAP) { seen[id] = 1; row.dayIds.push(id); row.dayN++; row.weekN++; row.total++; }
        } else { s[1]++; wrong[id] = 1; if (kind !== 't') { delete run[k]; delete rd[k]; } }   // 틀리면 도장이 다 지워짐(쓰기에서 틀린 건 빼고)
        if (sec >= 0) {
          row.tn = (Number(row.tn) || 0) + 1; row.tsum = Math.round(((Number(row.tsum) || 0) + sec) * 10) / 10;
          if (sec < ORTH_FAST) { row.fastN = (Number(row.fastN) || 0) + 1; if (ok) row.fastC = (Number(row.fastC) || 0) + 1; fast[k] = (Number(fast[k]) || 0) + 1; logFast++; }
        }
        logRes.push(id + ':' + (ok ? 1 : 0) + (sec >= 0 ? ':' + sec : '') + (kind !== 'p' ? ':' + kind : ''));
      });
      row.wrong = Object.keys(wrong);
      row.run = run; row.fast = fast; row.rd = rd; row.mast = orthMastCount_(run); row.kan = orthKan_(run);
      if (cid) { row.cids.push(cid); if (row.cids.length > 30) row.cids = row.cids.slice(-30); }
      row.updatedAt = now;
      orthTrim_(row);
      store.orthPut(row);
      if (store.orthLog && logRes.length) { try { store.orthLog([st.id, st.name, st.school, now, cid, logRes.length, logFast, logRes.join(' ')]); } catch (e) { } }
    }
    return { ok: true, dup: dup, mine: orthMine_(row), board: orthBoard_(st, store, env, row) };
  };
  // 선생님 페이지: 고른 학교의 순위표(학생 화면과 같은 모양)
  // 선생님 페이지 로그인: 트래커 선생님 비밀번호 확인 뒤 30일짜리 토큰('a'로 시작)을 따로 줌(트래커 토큰은 6시간이라)
  CORE_ACTIONS.orthTeachLogin = function (req, store, env) {
    var r = CORE_ACTIONS.adminLogin(req, store, env);
    if (!r.ok) return r;
    if (!env.propPut) return r;
    var tok = 'a' + env.uuid().replace(/-/g, '');
    env.propPut('ot:' + tok, JSON.stringify({ i: '*admin*', e: Date.parse(env.now()) + ORTH_TOKEN_DAYS * 864e5, p: '' }));
    return { ok: true, token: tok };
  };
  function orthRequireAdmin_(req, store, env) {
    var t = String(req.token || '');
    if (t.charAt(0) === 'a' && env.propGet) {
      var r = null; try { r = JSON.parse(env.propGet('ot:' + t) || 'null'); } catch (e) { }
      if (r && r.i === '*admin*' && r.e > Date.parse(env.now())) {
        if (r.e - Date.parse(env.now()) < (ORTH_TOKEN_DAYS - 1) * 864e5) { r.e = Date.parse(env.now()) + ORTH_TOKEN_DAYS * 864e5; env.propPut('ot:' + t, JSON.stringify(r)); }
        return true;
      }
      throw userErr('선생님 로그인이 필요해요. 다시 로그인해 주세요.');
    }
    return requireAdmin(req, store, env);
  }
  CORE_ACTIONS.orthBoard = function (req, store, env) {
    orthRequireAdmin_(req, store, env);
    return { ok: true, board: orthBoard_({ id: '', school: String(req.school || '') }, store, env, null) };
  };
  // 선생님 페이지: 고른 학교 학생별 표(익힌 단어 수, 푼 수, 2초 안에 답한 비율, 마지막 활동). 기록 없는 재원생도 0으로 넣음
  CORE_ACTIONS.orthStats = function (req, store, env) {
    orthRequireAdmin_(req, store, env);
    var school = String(req.school || ''), week = orthWeek(env.now());
    var rows = {};
    store.orthRows().forEach(function (r) { var b = rows[r.studentId]; if (!b || r.total > b.total) rows[r.studentId] = r; });
    var list = store.students().filter(function (s) { return s.status === 'active' && orthSchoolKey_(s.school) === orthSchoolKey_(school); }).map(function (s) {
      var r = rows[s.id] || {}, m = Number(r.mast) || 0, tn = Number(r.tn) || 0;
      return { id: s.id, n: s.name, mast: m, kan: Number(r.kan) || 0, wk: r.week === week ? Math.max(0, (Number(r.kan) || 0) - (Number(r.kan0) || 0)) + (Number(r.rev) || 0) : 0, total: Number(r.total) || 0, solved: Number(r.solved) || 0,
        tn: tn, fastN: Number(r.fastN) || 0, fastC: Number(r.fastC) || 0, avg: tn ? Math.round((Number(r.tsum) || 0) / tn * 10) / 10 : 0, at: r.updatedAt || '', old: !!r.studentId && Number(r.v || 0) < 2 };
    });
    list.sort(function (a, b) { return b.kan - a.kan || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0); });
    return { ok: true, week: week, list: list };
  };
  CORE_ACTIONS.orthLogout = function (req, store, env) {
    var t = String(req.token || '');
    if (t && (t.charAt(0) === 'o' || t.charAt(0) === 'a') && env.propDel) env.propDel('ot:' + t);
    return { ok: true };
  };
}
// 학생 명단(students 탭)에 쓰는 요청이라 트래커 저장과 같은 잠금 안에서 처리
if (typeof WRITE_ACTIONS !== 'undefined') WRITE_ACTIONS.orthChangePw = 1;

/* ---------- 구글 시트: orth 탭 ---------- */
function orthSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('orth');
  if (!sh) {
    sh = ss.insertSheet('orth');
    sh.getRange(1, 1, 1, ORTH_COLS.length).setValues([ORTH_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), ORTH_COLS.length).setNumberFormat('@'); // 날짜·숫자 자동 변환 막기
  } else if (sh.getLastColumn() < ORTH_COLS.length || String(sh.getRange(1, ORTH_COLS.length).getValue()) !== ORTH_COLS[ORTH_COLS.length - 1]) {
    // 개편으로 늘어난 칸의 제목을 붙임(옛 줄의 그 칸은 빈 채로 두고, 읽을 때 0·{}로 봄)
    var from = 1;
    while (from <= ORTH_COLS.length && String(sh.getRange(1, from).getValue()) === ORTH_COLS[from - 1]) from++;
    if (from <= ORTH_COLS.length) {
      sh.getRange(1, from, 1, ORTH_COLS.length - from + 1).setValues([ORTH_COLS.slice(from - 1)]).setFontWeight('bold');
      sh.getRange(1, from, sh.getMaxRows(), ORTH_COLS.length - from + 1).setNumberFormat('@');
    }
  }
  return sh;
}
// 동기화 묶음 기록 탭(분석용). 없으면 만들고, 너무 길어지면 앞쪽을 지움
function orthLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName('orth_log');
  if (!sh) {
    sh = ss.insertSheet('orth_log');
    sh.getRange(1, 1, 1, ORTH_LOG_COLS.length).setValues([ORTH_LOG_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), ORTH_LOG_COLS.length).setNumberFormat('@');
  }
  return sh;
}
function orthLogPut_(row) {
  var sh = orthLogSheet_();
  sh.appendRow(row.map(function (v) { return v === undefined || v === null ? '' : String(v); }));
  var last = sh.getLastRow();
  if (last - 1 > ORTH_LOG_MAX) sh.deleteRows(2, Math.min(2000, last - 1 - ORTH_LOG_MAX));
}
function orthParse_(r) {
  var o = {};
  ORTH_COLS.forEach(function (c, j) {
    if (j >= r.length) return;
    var v = r[j];
    if (Object.prototype.toString.call(v) === '[object Date]') v = c === 'updatedAt' ? v.toISOString() : Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
    if (v === null || v === undefined) v = '';
    if (ORTH_NUM[c]) v = Number(v) || 0;
    else if (ORTH_LIST[c]) v = String(v) ? String(v).split(',') : [];
    else if (ORTH_MAP[c]) { try { v = v ? JSON.parse(v) : {}; } catch (e) { v = {}; } if (!v || typeof v !== 'object') v = {}; }
    else v = String(v);
    o[c] = v;
  });
  return o;
}
function orthOut_(o) {
  return ORTH_COLS.map(function (c) {
    var v = o[c];
    if (ORTH_LIST[c]) return (v || []).join(',');
    if (ORTH_MAP[c]) return JSON.stringify(v || {});
    return v === undefined || v === null ? '' : String(v);
  });
}
// 순위·선생님 표용 가벼운 읽기: 앞쪽 칸(studentId ~ updatedAt)과 뒤쪽 숫자 칸(mast ~ tsum)만. 문제별 기록(st·run·fast)은 안 읽음
function orthSheetRows_() {
  var sh = orthSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  var a = sh.getRange(2, 1, last - 1, ORTH_LIGHT).getValues();
  var c0 = ORTH_COLS.indexOf(ORTH_RANK_COLS[0]) + 1, cn = ORTH_RANK_COLS.length;
  var b = sh.getLastColumn() >= c0 ? sh.getRange(2, c0, last - 1, cn).getValues() : a.map(function () { return []; });
  var vcol = ORTH_COLS.indexOf('v') + 1;
  var vv = sh.getLastColumn() >= vcol ? sh.getRange(2, vcol, last - 1, 1).getValues() : a.map(function () { return ['']; });
  var kcol = ORTH_COLS.indexOf('kan') + 1;
  var kk = sh.getLastColumn() >= kcol + 2 ? sh.getRange(2, kcol, last - 1, 3).getValues() : a.map(function () { return ['', '', '']; });
  var out = [];
  for (var i = 0; i < a.length; i++) {
    if (String(a[i][0]) === '') continue;
    var r = a[i].slice();
    while (r.length < c0 - 1) r.push('');
    for (var j = 0; j < cn; j++) r.push(b[i] && b[i][j] !== undefined ? b[i][j] : '');
    while (r.length < vcol - 1) r.push('');
    r.push(vv[i] ? vv[i][0] : '');
    while (r.length < kcol - 1) r.push('');
    r.push(kk[i] ? kk[i][0] : '', kk[i] ? kk[i][1] : '', kk[i] ? kk[i][2] : '');
    out.push(orthParse_(r));
  }
  return out;
}
function orthSheetGet_(id) {
  var sh = orthSheet_(), last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues(), best = null;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) !== id) continue;
    var o = orthParse_(sh.getRange(i + 2, 1, 1, ORTH_COLS.length).getValues()[0]);
    o._row = i + 2;
    if (!best || o.total > best.total) best = o;   // 같은 학생 줄이 둘이면(처음 저장이 동시에 온 경우) 누적이 큰 쪽
  }
  return best;
}
// 한 학생은 자기 줄만 고치고, 새 줄은 appendRow(한 번에 붙음)라 트래커 잠금을 기다리지 않음
function orthSheetPut_(o) {
  var sh = orthSheet_(), row = orthOut_(o);
  if (o._row) sh.getRange(o._row, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  else sh.appendRow(row);
}
if (typeof makeStore_ === 'function' && !makeStore_.orthWrapped) {
  var orthBaseStore_ = makeStore_;
  makeStore_ = function () {
    var s = orthBaseStore_();
    if (!s.orthRows) { s.orthRows = orthSheetRows_; s.orthGet = orthSheetGet_; s.orthPut = orthSheetPut_; s.orthLog = orthLogPut_; }
    return s;
  };
  makeStore_.orthWrapped = true;
}
// 사이트 토큰은 스크립트 속성에 둠(캐시는 6시간까지만 버팀)
if (typeof makeEnv_ === 'function' && !makeEnv_.orthWrapped) {
  var orthBaseEnv_ = makeEnv_;
  makeEnv_ = function () {
    var e = orthBaseEnv_(), p = PropertiesService.getScriptProperties();
    e.propGet = function (k) { return p.getProperty(k); };
    e.propPut = function (k, v) { p.setProperty(k, v); };
    e.propDel = function (k) { p.deleteProperty(k); };
    e.propAll = function () { return p.getProperties(); };
    return e;
  };
  makeEnv_.orthWrapped = true;
}

/* ===== 개편 적용: 함수 목록에서 orthMigrate를 고르고 ▷ 실행(한 번만) =====
 * 옛 줄(v가 2가 아닌 줄)마다 '익힘'을 처음 매겨 저장합니다(3번 이상 맞히고 정답률 80% 이상인 단어). 다시 실행해도 이미 매긴 줄은 건드리지 않습니다.
 * 안 돌려도 학생이 다음에 문제를 풀면 그때 자기 줄이 매겨지지만, 그 전까지 순위표에는 0으로 보입니다.
 */
function orthMigrate() {
  var sh = orthSheet_(), last = sh.getLastRow(), done = 0, skip = 0;
  for (var i = 2; i <= last; i++) {
    var o = orthParse_(sh.getRange(i, 1, 1, ORTH_COLS.length).getValues()[0]);
    if (!o.studentId) continue;
    o._row = i;
    var a = orthSeed_(o), b = orthKanSeed_(o, orthWeek(new Date().toISOString()));
    if (a || b) { orthSheetPut_(o); done++; } else skip++;
  }
  Logger.log('익힘 처음 매김: ' + done + '줄 적용, ' + skip + '줄은 이미 되어 있음. 이제 orthCheck를 실행해 보세요.');
  return done;
}

/* ===== 점검 도구: 함수 목록에서 orthCheck를 고르고 ▷ 실행 → '실행 로그' 확인 =====
 * 실제 시트에는 orth 탭(없으면)만 만들고, 학생 기록은 쓰지 않습니다. 채점·순위는 메모리 안에서 가짜 학생으로 시험합니다.
 */
function orthCheck() {
  var out = [], bad = 0;
  function ok(m) { out.push('✔ ' + m); }
  function ng(m) { out.push('✘ ' + m); bad++; }
  function log() { Logger.log(out.join('\n') + '\n\n' + (bad ? '문제 ' + bad + '개 — 이 로그를 그대로 복사해서 Claude에게 보내 주세요.' : '모두 정상입니다. 이제 배포 → 배포 관리 → 새 버전으로 배포하면 됩니다.')); }

  if (typeof CORE_ACTIONS === 'undefined' || typeof coreHandle !== 'function') { ng('Code.gs의 공통 로직을 찾지 못했습니다. orth 파일이 Code.gs보다 아래에 있는지 확인해 주세요.'); return log(); }
  var need = ['orthLookup', 'orthGhost', 'orthTeachLogin', 'orthLogin', 'orthChangePw', 'orthHome', 'orthSync', 'orthBoard', 'orthStats', 'orthLogout'];
  var miss = need.filter(function (a) { return typeof CORE_ACTIONS[a] !== 'function'; });
  if (miss.length) ng('맞춤법 요청이 없습니다: ' + miss.join(', ')); else ok('맞춤법 요청 ' + need.length + '개 추가됨');
  if (typeof CORE_VERSION !== 'undefined') ok('트래커 버전 그대로 (version ' + CORE_VERSION + ')');
  var base = ['lookup', 'login', 'changePw', 'home', 'getSet', 'submit'].filter(function (a) { return typeof CORE_ACTIONS[a] !== 'function'; });
  if (base.length) ng('트래커 요청이 빠짐: ' + base.join(', ')); else ok('트래커 요청은 그대로');

  try {
    var sh = orthSheet_();
    var head = sh.getRange(1, 1, 1, ORTH_COLS.length).getValues()[0].map(String);
    if (head.join() === ORTH_COLS.join()) ok('시트 orth 탭 준비됨 (지금 ' + Math.max(0, sh.getLastRow() - 1) + '명 기록)');
    else ng('orth 탭 첫 줄이 다릅니다: ' + head.join(', '));
    var real = makeStore_();
    if (real.orthRows && real.orthGet && real.orthPut) {
      var rr = real.orthRows(), oldN = rr.filter(function (r) { return Number(r.v || 0) < 3; }).length;
      ok('orth 탭 읽기 정상');
      if (oldN) ng('익힘·칸을 아직 안 매긴 줄이 ' + oldN + '개 있습니다. 함수 목록에서 orthMigrate를 한 번 실행해 주세요.'); else ok('익힘·칸 매김 완료(모든 줄 v=3)');
      if (real.orthLog) { orthLogSheet_(); ok('orth_log 탭 준비됨'); }
    }
    else ng('저장소에 orth 읽기·쓰기가 붙지 않았습니다.');
    if (real.deleteSub) ok('무한선지(omr) 기능도 그대로'); else out.push('· omr 파일이 없거나 orth보다 아래에 있음(트래커에 영향 없으면 괜찮음)');
    var en = makeEnv_();
    if (en.propGet && en.propPut) ok('로그인 유지(30일) 저장소 준비됨'); else ng('스크립트 속성을 쓸 수 없습니다.');
  } catch (e) { ng('시트 확인 중 오류: ' + (e && e.message ? e.message : e)); }

  try { orthSelfTest_(); ok('메모리 시험 통과 (선생님 순위표 · 로그인·첫 비밀번호 변경 · 30일 유지·연장·만료 · 비밀번호 바뀌면 풀림 · 하루 한 번만 셈 · 같은 단어는 하루에 한 번만 익힘으로 셈 · 도장 계단(쓱쓱 1·고르기 2·쓰기 3) · 10시간 간격 · 이번 주 도장 · 복습 도장(7일) · 같은 묶음 두 번 막기 · 오답 노트 · 학교·전체 순위 · 선생님 30일 토큰 · 학교 대항 합계 · 주가 바뀌면 이번 주 새로 · 퇴원생 빠짐)'); }
  catch (e) { ng('메모리 시험 중 오류: ' + (e && e.message ? e.message : e)); }
  log();
}

// 시트를 쓰지 않는 가짜 저장소로 처음부터 끝까지 시험
function orthSelfTest_() {
  var dc = function (x) { return JSON.parse(JSON.stringify(x)); };
  var db = { students: [], sets: [], items: [], subs: [], checks: [], orth: [], log: [] }, cache = {}, props = {}, n = 0;
  var T = Date.UTC(2026, 0, 6, 15, 0, 0);   // 2026-01-07(수) 0시, 한국 시간
  var up = function (list, o, f) { for (var i = 0; i < list.length; i++) if (f(list[i])) { list[i] = dc(o); return; } list.push(dc(o)); };
  var mem = {
    students: function () { return dc(db.students); }, putStudent: function (s) { up(db.students, s, function (r) { return r.id === s.id; }); },
    insertStudents: function (l) { l.forEach(function (s) { db.students.push(dc(s)); }); },
    sets: function () { return dc(db.sets); }, putSet: function (s) { up(db.sets, s, function (r) { return r.id === s.id; }); },
    deleteSet: function () { }, allItems: function () { return dc(db.items); },
    putItems: function (id, items) { up(db.items, { setId: id, items: items }, function (r) { return r.setId === id; }); },
    subs: function () { return dc(db.subs); }, putSub: function (s) { up(db.subs, s, function (r) { return r.setId === s.setId && r.studentId === s.studentId; }); },
    checks: function () { return dc(db.checks); }, putCheck: function (c) { up(db.checks, c, function (r) { return r.setId === c.setId && r.studentId === c.studentId; }); },
    deleteSub: function (a, b) { db.subs = db.subs.filter(function (r) { return !(r.setId === a && r.studentId === b); }); },
    orthRows: function () { return db.orth.map(function (r) { var o = {}; ORTH_COLS.slice(0, ORTH_LIGHT).concat(ORTH_RANK_COLS, ['v', 'kan', 'kan0', 'rev']).forEach(function (c) { o[c] = r[c]; }); return dc(o); }); },
    orthLog: function (row) { db.log.push(row); },
    orthGet: function (id) { var r = db.orth.filter(function (x) { return x.studentId === id; })[0]; return r ? dc(r) : null; },
    orthPut: function (o) { up(db.orth, o, function (r) { return r.studentId === o.studentId; }); }
  };
  var env = { adminPassword: 'orth-check',
    hash: function (s) {   // 시험용 간단 해시(비밀번호가 바뀌면 앞자리가 달라지게)
      var x = 5381, y = 52711;
      for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); x = ((x * 33) ^ c) >>> 0; y = (y * 31 + c) >>> 0; }
      return ('0000000' + x.toString(16)).slice(-8) + ('0000000' + y.toString(16)).slice(-8);
    },
    uuid: function () { n++; return 'orthcheck-' + n + '-abcdef'; },
    now: function () { return new Date(T).toISOString(); },
    cacheGet: function (k) { return cache[k] || null; }, cachePut: function (k, v) { cache[k] = v; }, cacheRemove: function (k) { delete cache[k]; },
    propGet: function (k) { return props.hasOwnProperty(k) ? props[k] : null; }, propPut: function (k, v) { props[k] = v; },
    propDel: function (k) { delete props[k]; }, propAll: function () { return dc(props); } };
  var P = function (r) { return dc(coreHandle(dc(r), mem, env)); };
  var must = function (c, m) { if (!c) throw new Error(m); };
  var day = 864e5;

  must(orthWeek('2026-01-11T14:59:59.000Z') === '2026-01-05' && orthWeek('2026-01-11T15:00:00.000Z') === '2026-01-12', '주 경계(월요일 0시)');
  must(orthDay('2026-01-06T15:00:00.000Z') === '2026-01-07', '날짜 경계(한국 시간 0시)');

  var at = P({ action: 'adminLogin', pw: 'orth-check' }).token;
  must(P({ action: 'addStudents', token: at, list: [{ school: '가고', name: '가가가' }, { school: '가고', name: '나나나' }, { school: '나고', name: '다다다' }, { school: '가고', name: '라라라' }] }).ok, '학생 추가');
  var id = function (nm) { return P({ action: 'lookup', name: nm }).matches[0].id; };

  // 첫 로그인: 0000 → 비밀번호 바꾸기 → 사이트 토큰
  var l0 = P({ action: 'orthLogin', id: id('가가가'), pw: '0000' });
  must(l0.ok && l0.me.mustChange && !l0.otoken, '첫 로그인');
  var c0 = P({ action: 'orthChangePw', token: l0.token, newPw: '1234' });
  must(c0.ok && c0.otoken && c0.orth && c0.orth.board && !c0.me.mustChange, '첫 비밀번호 변경: ' + c0.error);
  var bad = P({ action: 'orthLogin', id: id('가가가'), pw: '9999' });
  must(!bad.ok, '틀린 비밀번호가 통과됨');
  var l1 = P({ action: 'orthLogin', id: id('가가가'), pw: '1234' });
  must(l1.ok && l1.otoken && l1.orth && l1.orth.mine.total === 0, '로그인: ' + l1.error);
  var tg = l1.otoken;

  // 하루 한 번만 셈, 이상한 번호는 무시, 오답 노트
  var T0 = T; T = T0 - 2 * day;   // 월요일부터 사흘에 걸쳐 풂(같은 단어는 하루에 한 번만 익힘으로 셈)
  var s1 = P({ action: 'orthSync', token: tg, cid: 'c1', res: [['pa1', 1], ['pa2', 1], ['pa1', 1], ['pa3', 0], ['나쁜 번호', 1]] });
  must(s1.ok && s1.mine.dayN === 2 && s1.mine.total === 2 && s1.mine.weekN === 2 && s1.mine.solved === 4, '하루 한 번만 셈: ' + JSON.stringify(s1.mine || s1.error));
  var s1b = P({ action: 'orthSync', token: tg, cid: 'c1', res: [['pa1', 1], ['pa2', 1], ['pa1', 1], ['pa3', 0]] });
  must(s1b.ok && s1b.dup && s1b.mine.solved === 4, '같은 묶음이 두 번 반영됨');
  var h1 = P({ action: 'orthHome', token: tg });
  must(h1.ok && h1.orth.st.pa1.join() === '2,0' && h1.orth.wrong.join() === 'pa3', '문제별 기록·오답: ' + JSON.stringify(h1.orth && [h1.orth.st, h1.orth.wrong]));
  var s2 = P({ action: 'orthSync', token: tg, cid: 'c2', res: [['pa3', 1]] });
  must(s2.ok && s2.mine.dayN === 3, '오답을 맞힘');
  must(P({ action: 'orthHome', token: tg }).orth.wrong.length === 0, '맞힌 문제가 오답 노트에 남음');
  must(P({ action: 'orthHome', token: tg }).orth.run.pa1 === 1, '같은 날 두 번 맞혀도 연속 정답은 1');
  T = T0 - day; P({ action: 'orthSync', token: tg, cid: 'c2a', res: [['pa1', 1], ['pa2', 1], ['pa3', 1]] });
  T = T0;

  // 익힘(연속 3번)과 걸린 시간: pa1 3번째 정답 → 익힘, pa2·pa3도 2번씩 더 → 셋 다 익힘. 쓱쓱(opa2)도 같은 단어로 셈. 2초 안 답은 fast로
  var s2b = P({ action: 'orthSync', token: tg, cid: 'c2b', res: [['pa1', 1, 4.2, 't'], ['opa2', 1, 1.1, 's'], ['pa2', 1, 3, 't'], ['pa3', 1, 0.9], ['pa3', 1, 7], ['pa9', 0, 1.5], ['pa9', 1]] });   // 3개째 도장은 쓰기('t')로만
  must(s2b.ok && s2b.mine.mast === 2 && s2b.mine.kan === 9 && s2b.mine.solved === 15, '익힘 수(사흘, 3개째는 쓰기로만): ' + JSON.stringify(s2b.mine));
  var hr = P({ action: 'orthHome', token: tg }).orth;
  must(hr.run && hr.run.pa1 === 3 && hr.run.pa2 === 3 && hr.run.pa3 === 2 && hr.run.pa9 === 1 && hr.rd.pa1 > 400000 && hr.st.opa2.join() === '1,0', '단어별 연속 정답: ' + JSON.stringify(hr.run));
  must(db.orth[0].tn === 6 && db.orth[0].fastN === 3 && db.orth[0].fastC === 2 && Math.abs(db.orth[0].tsum - 17.7) < 0.01 && db.orth[0].fast.pa2 === 1 && db.orth[0].fast.pa3 === 1 && db.orth[0].fast.pa9 === 1, '걸린 시간 기록: ' + JSON.stringify([db.orth[0].tn, db.orth[0].fastN, db.orth[0].tsum, db.orth[0].fast]));
  must(db.log.length === 4 && db.log[3][4] === 'c2b' && db.log[3][5] === 7 && db.log[3][6] === 3 && /^pa1:1:4\.2:t opa2:1:1\.1:s /.test(db.log[3][7]) && / pa9:1$/.test(db.log[3][7]), '동기화 기록(orth_log): ' + JSON.stringify(db.log[3]));
  // 틀리면 그 단어만 다시 '익히는 중'
  var s2c = P({ action: 'orthSync', token: tg, cid: 'c2c', res: [['opa1', 0, 2.5]] });
  must(s2c.mine.mast === 1 && s2c.mine.kan === 6 && !P({ action: 'orthHome', token: tg }).orth.run.pa1, '틀리면 도장이 다 지워짐: ' + JSON.stringify(s2c.mine));
  var s2d = P({ action: 'orthSync', token: tg, cid: 'c2d', res: [['pa1', 1], ['pa1', 1], ['pa1', 1]] });
  must(s2d.mine.mast === 1 && P({ action: 'orthHome', token: tg }).orth.run.pa1 === 1, '같은 날 3번 맞혀도 한 번만 셈: ' + JSON.stringify(s2d.mine));

  // 트래커 토큰으로 들어오면 사이트 토큰을 새로 줌
  var nt =P({ action: 'login', id: id('나나나'), pw: '0000' }).token;
  must(P({ action: 'changePw', token: nt, newPw: '5678' }).ok, '나나나 비밀번호 변경');
  var hn = P({ action: 'orthHome', token: nt });
  must(hn.ok && hn.otoken, '트래커 토큰으로 입장: ' + hn.error);
  var tn = hn.otoken;
  // 사흘(월·화·수)에 걸쳐 한 번씩 맞힘 → 익힘
  var on3 = function (tok, cid, ids) { [2, 1, 0].forEach(function (k) { T = T0 - k * day; P({ action: 'orthSync', token: tok, cid: cid + k, res: ids.map(function (i) { return [i, 1, 3, k ? 'p' : 't']; }) }); }); T = T0; };
  on3(tn, 'n', ['pa1', 'pa2', 'pa3', 'pa4', 'pa5']);

  var td = P({ action: 'orthLogin', id: id('다다다'), pw: '0000' }).token;
  var td2 = P({ action: 'orthChangePw', token: td, newPw: '4321' }).otoken;
  on3(td2, 'd', ['pa1', 'pa2', 'pa3', 'pa4', 'pa5', 'pa6', 'pa7']);
  // 개편 전 줄(v 없음): 라라라에게 옛 기록을 심어 두면 홈에서 B안대로 익힘이 매겨짐(3번 이상 맞히고 80% 이상)
  db.orth.push({ studentId: id('라라라'), school: '가고', name: '라라라', total: 9, week: '', weekN: 0, day: '', dayN: 0, solved: 20, updatedAt: '', dayIds: [], cids: [],
    wrong: ['pb3'], st: { pb1: [5, 0], pb2: [4, 1], opb2: [2, 0], pb3: [3, 3], pb4: [2, 0] } });
  var lr = P({ action: 'orthLogin', id: id('라라라'), pw: '0000' });
  var lr2 = P({ action: 'orthChangePw', token: lr.token, newPw: '1111' });
  must(lr2.ok && lr2.orth.mine.mast === 2 && lr2.orth.run.pb1 === 3 && lr2.orth.run.pb2 === 3 && !lr2.orth.run.pb3 && !lr2.orth.run.pb4, '옛 기록 익힘 매김: ' + JSON.stringify(lr2.orth && [lr2.orth.mine, lr2.orth.run]));
  must(db.orth.filter(function (r) { return r.name === '라라라'; })[0].v === undefined, '홈만 봤을 때는 시트를 안 고침');
  T = T0 - 2 * day; P({ action: 'orthSync', token: lr2.otoken, cid: 'r1', res: [['pb4', 1, 2]] });   // 지금부터 사흘 연속 → 익힘
  T = T0 - day; P({ action: 'orthSync', token: lr2.otoken, cid: 'r2', res: [['pb4', 1, 2]] });
  T = T0; P({ action: 'orthSync', token: lr2.otoken, cid: 'r3', res: [['pb4', 1, 2, 't']] });
  var lrow = db.orth.filter(function (r) { return r.name === '라라라'; })[0];
  must(lrow.v === 3 && lrow.kan === 9 && lrow.kan0 === 6 && lrow.mast === 3 && lrow.mast0 === 2 && lrow.run.pb4 === 3 && lrow.st.pb4.join() === '5,0', '옛 기록 매김 뒤 저장: ' + JSON.stringify([lrow.v, lrow.mast, lrow.mast0, lrow.run]));

  var b = P({ action: 'orthHome', token: tg }).orth.board;
  must(b.school.week.top.length === 3 && b.school.week.top[0].n[0][0] === '나나나' && b.school.week.top[0].d === 15, '학교 순위 1위(이번 주에 오른 익힘 칸): ' + JSON.stringify(b.school.week.top));
  must(b.school.week.me.r === 2 && b.school.week.me.up.r === 1 && b.school.week.me.up.gap === 8, '학교 순위 내 자리(나나나 15, 가가가 7, 라라라 3): ' + JSON.stringify(b.school.week.me));
  must(b.school.total.top[0].n[0][0] === '나나나' && b.school.total.top[0].d === 15 && b.school.total.top[1].d === 9 && b.school.total.top[1].n[0][0] === '라라라' && b.school.total.top[2].d === 7, '누적 도장 순위(나나나 15, 라라라 9, 가가가 7): ' + JSON.stringify(b.school.total.top));
  must(b.all.week.top[0].n[0].join() === '다다다,나고' && b.all.week.me.r === 3 && b.all.week.of === 4, '전체 순위: ' + JSON.stringify(b.all.week));
  must(b.school.week.top.every(function (g) { return g.n.every(function (x) { return x[0] !== '다다다'; }); }), '다른 학교가 학교 순위에 섞임');
  var ga = b.sch.filter(function (x) { return x.s === '가고'; })[0], na = b.sch.filter(function (x) { return x.s === '나고'; })[0];
  must(ga && ga.n === 3 && ga.pw === 3 && ga.w === 25 && ga.t === 31 && na && na.n === 1 && na.w === 21 && na.t === 21, '학교 대항 합계(이번 주 도장 15+7+3, 누적 도장 15+9+7): ' + JSON.stringify(b.sch));
  // 선생님 표
  var ts = P({ action: 'orthStats', token: P({ action: 'adminLogin', pw: 'orth-check' }).token, school: '가고' });
  must(ts.ok && ts.list.length === 3 && ts.list[0].n === '나나나' && ts.list[0].mast === 5 && ts.list[0].tn === 15 && ts.list[0].fastN === 0, '선생님 표: ' + JSON.stringify(ts.list));
  var tsg = ts.list.filter(function (x) { return x.n === '가가가'; })[0];
  must(tsg.mast === 1 && tsg.kan === 7 && tsg.wk === 7 && tsg.solved === 19 && tsg.tn === 7 && tsg.fastN === 3 && tsg.avg === 2.9 && !tsg.old, '선생님 표 가가가: ' + JSON.stringify(tsg));
  must(!P({ action: 'orthStats', token: tg, school: '가고' }).ok, '학생 토큰으로 선생님 표가 열림');
  // 선생님 페이지 순위표: 선생님 비밀번호로만
  var tb = P({ action: 'orthBoard', token: P({ action: 'adminLogin', pw: 'orth-check' }).token, school: '가고' });
  must(tb.ok && tb.board.school.week.top[0].n[0][0] === '나나나' && tb.board.school.week.of === 3 && !tb.board.school.week.me && tb.board.all.week.of === 4, '선생님 순위표: ' + JSON.stringify(tb.board || tb.error));
  must(!P({ action: 'orthBoard', token: tg, school: '가고' }).ok, '학생 토큰으로 선생님 순위표가 열림');
  must(P({ action: 'orthGhost', code: ORTH_GHOST_CODE }).ok && !P({ action: 'orthGhost', code: 'x' }).ok, '졸업생 코드(맨 위 ORTH_GHOST_CODE를 정해 주세요)');
  var tl = P({ action: 'orthTeachLogin', pw: 'orth-check' });
  must(tl.ok && tl.token && tl.token.charAt(0) === 'a' && P({ action: 'orthBoard', token: tl.token, school: '가고' }).ok, '선생님 30일 토큰');
  must(!P({ action: 'orthTeachLogin', pw: 'nope' }).ok && !P({ action: 'orthBoard', token: 'a0000', school: '가고' }).ok, '선생님 토큰 검사');
  P({ action: 'orthLogout', token: tl.token });
  must(!P({ action: 'orthBoard', token: tl.token, school: '가고' }).ok, '선생님 토큰 로그아웃');

  // 다음 날: 같은 문제를 다시 맞히면 또 셈
  T += day;
  var s3 = P({ action: 'orthSync', token: tg, cid: 'c3', res: [['pa1', 1], ['pa2', 1], ['pa3', 1], ['pa5', 1], ['pa5', 1], ['pa5', 1], ['pa6', 1], ['pa6', 1], ['pa6', 1], ['pa7', 1], ['pa7', 1], ['pa7', 1]] });
  must(s3.mine.dayN === 6 && s3.mine.total === 17 && s3.mine.weekN === 17 && s3.mine.mast === 1 && s3.mine.kan === 11, '다음 날 다시 셈(같은 날 세 번은 한 번, pa3은 고르기라 2개에서 멈춤): ' + JSON.stringify(s3.mine));
  T += day; var s4 = P({ action: 'orthSync', token: tg, cid: 'c4', res: [['pa1', 1], ['pa5', 1], ['pa6', 1], ['pa7', 1]] });   // pa1은 지금 2개라 고르기로는 안 오름
  must(s4.mine.mast === 1 && s4.mine.kan === 14, '금요일: pa1은 고르기라 안 오르고 pa5~7만 2개째: ' + JSON.stringify(s4.mine));
  T += day; var s5 = P({ action: 'orthSync', token: tg, cid: 'c5', res: [['pa5', 1, 2, 't'], ['pa6', 1, 2, 't'], ['pa7', 1, 2, 's'], ['pa1', 0, 2, 't']] });   // pa7은 쓱쓱이라 2개에서 멈춤, pa1 쓰기 틀림은 도장 안 지움
  must(s5.mine.mast === 3 && s5.mine.kan === 16 && s5.mine.total === 24 && P({ action: 'orthHome', token: tg }).orth.run.pa1 === 2, '토요일: 쓰기로 pa5·6 익힘, 쓱쓱 pa7은 2개, 쓰기 틀린 pa1은 그대로 2개: ' + JSON.stringify(s5.mine));
  var b2 = s5.board.school.week;
  must(b2.me.r === 1 && b2.me.lead === 1, '1위 앞선 도장(16 − 15): ' + JSON.stringify([b2.me, s5.mine.kan]));

  // 다음 주 월요일: 이번 주는 0부터, 누적은 그대로
  T = Date.UTC(2026, 0, 11, 15, 30, 0);
  var h2 = P({ action: 'orthHome', token: tg });
  must(h2.orth.mine.weekN === 0 && h2.orth.mine.total === 24 && h2.orth.mine.dayN === 0 && h2.orth.mine.mast === 3 && h2.orth.mine.mast0 === 3 && h2.orth.mine.kan0 === 16, '주가 바뀜: ' + JSON.stringify(h2.orth.mine));
  must(h2.orth.board.school.week.top.length === 0 && h2.orth.board.school.total.top[0].d === 16, '주가 바뀐 순위: ' + JSON.stringify(h2.orth.board.school));
  // 자정 넘기기: 23:50에 찍고 00:10에 또 풀면 안 찍힘(10시간 간격), 10시간 뒤엔 찍힘
  T = Date.UTC(2026, 0, 12, 14, 50, 0); P({ action: 'orthSync', token: tg, cid: 'g1', res: [['pa8', 1]] });
  T = Date.UTC(2026, 0, 12, 15, 10, 0); var g2 = P({ action: 'orthSync', token: tg, cid: 'g2', res: [['pa8', 1]] });
  must(P({ action: 'orthHome', token: tg }).orth.run.pa8 === 1, '자정 넘겨 20분 뒤엔 도장 안 찍힘');
  T = Date.UTC(2026, 0, 13, 1, 0, 0); P({ action: 'orthSync', token: tg, cid: 'g3', res: [['pa8', 1]] });
  must(P({ action: 'orthHome', token: tg }).orth.run.pa8 === 2, '10시간 뒤엔 찍힘');
  // 복습 도장: 익힌 pa2를 7일 안에 맞히면 아무것도 없고, 7일 지나 맞히면 이번 주 +1(쓱쓱은 안 됨)
  T = Date.UTC(2026, 0, 13, 2, 0, 0); P({ action: 'orthSync', token: tg, cid: 'v1', res: [['pa2', 1]] });
  must(P({ action: 'orthHome', token: tg }).orth.mine.rev === 0, '7일 안 복습은 도장 없음');
  T = Date.UTC(2026, 0, 18, 2, 0, 0); P({ action: 'orthSync', token: tg, cid: 'v2', res: [['opa2', 1, 2, 's']] });
  must(P({ action: 'orthHome', token: tg }).orth.mine.rev === 0, '쓱쓱으로는 복습 도장 없음');
  var v3 = P({ action: 'orthSync', token: tg, cid: 'v3', res: [['pa2', 1], ['pa2', 1]] });
  must(v3.mine.rev === 1 && v3.board.school.week.me.d === 3, '7일 지나 맞히면 복습 도장 1(같은 날 두 번은 한 번, 이번 주 = pa8 2 + 복습 1): ' + JSON.stringify([v3.mine.rev, v3.board.school.week.me]));
  T = Date.UTC(2026, 0, 13, 1, 0, 0);

  // 퇴원하면 순위에서 빠지고 로그인도 막힘
  must(P({ action: 'updateStudent', token: P({ action: 'adminLogin', pw: 'orth-check' }).token, id: id('나나나'), op: 'leave' }).ok, '퇴원 처리');
  var h3 = P({ action: 'orthHome', token: tg });
  must(h3.orth.board.school.total.top.every(function (g) { return g.n.every(function (x) { return x[0] !== '나나나'; }); }), '퇴원생이 순위에 남음');
  must(!P({ action: 'orthHome', token: tn }).ok, '퇴원생 토큰이 통과됨');

  // 30일 유지: 20일 뒤에 쓰면 연장, 안 쓰고 31일 지나면 만료
  T += 20 * day;
  must(P({ action: 'orthHome', token: tg }).ok, '20일 뒤 로그인 유지');
  T += 25 * day;
  must(P({ action: 'orthHome', token: tg }).ok, '쓰는 동안 연장이 안 됨');
  T += 31 * day;
  var ex = P({ action: 'orthHome', token: tg });
  must(!ex.ok && /로그인/.test(ex.error), '31일 지나도 만료 안 됨');

  // 선생님이 0000으로 초기화하면 사이트 토큰이 풀림
  var tg2 = P({ action: 'orthLogin', id: id('가가가'), pw: '1234' }).otoken;
  must(P({ action: 'orthHome', token: tg2 }).ok, '다시 로그인');
  must(P({ action: 'updateStudent', token: P({ action: 'adminLogin', pw: 'orth-check' }).token, id: id('가가가'), op: 'reset' }).ok, '비밀번호 초기화');
  must(!P({ action: 'orthHome', token: tg2 }).ok, '초기화한 뒤에도 사이트 토큰이 통과됨');

  // 로그아웃
  var tg3 = P({ action: 'orthChangePw', token: P({ action: 'orthLogin', id: id('가가가'), pw: '0000' }).token, newPw: '2468' }).otoken;
  must(P({ action: 'orthLogout', token: tg3 }).ok && !P({ action: 'orthHome', token: tg3 }).ok, '로그아웃');
  must(Object.keys(props).every(function (k) { var r = JSON.parse(props[k]); return r.e > T; }), '만료된 토큰이 정리되지 않음');
  return true;
}
