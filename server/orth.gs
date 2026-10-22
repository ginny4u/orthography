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
var ORTH_DAY_CAP = 1000;     // 하루에 셀 수 있는 최대 정답 수(장난 방지)
var ORTH_ID = /^[a-z][0-9a-z]{1,23}$/;   // 문제 번호 모양
var ORTH_COLS = ['studentId', 'school', 'name', 'total', 'week', 'weekN', 'day', 'dayN', 'solved', 'updatedAt', 'dayIds', 'cids', 'wrong', 'st'];
var ORTH_LIGHT = 10;         // 순위 계산 때 읽는 앞쪽 칸 수(studentId ~ updatedAt)
var ORTH_NUM = { total: 1, weekN: 1, dayN: 1, solved: 1 };
var ORTH_LIST = { dayIds: 1, cids: 1, wrong: 1 };

/* ---------- 날짜(한국 시간) ---------- */
function orthKst_(iso) { return new Date(Date.parse(iso) + 9 * 3600 * 1000); }
function orthDay(iso) { return orthKst_(iso).toISOString().slice(0, 10); }
// 이번 주 = 월요일 0시(한국 시간)부터
function orthWeek(iso) { var d = orthKst_(iso); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }

function orthMask(name) {
  var a = String(name || '').split('');
  if (!ORTH_MASK_NAME || a.length < 2) return a.join('');
  if (a.length === 2) return a[0] + '○';
  return a[0] + a.slice(1, -1).map(function () { return '○'; }).join('') + a[a.length - 1];
}

/* ---------- 학생 한 줄 ---------- */
function orthBlank_(st) {
  return { studentId: st.id, school: st.school, name: st.name, total: 0, week: '', weekN: 0, day: '', dayN: 0, solved: 0,
    updatedAt: '', dayIds: [], cids: [], wrong: [], st: {} };
}
// 날짜가 바뀌었으면 오늘·이번 주 수를 새로
function orthRoll_(row, day, week) {
  if (row.day !== day) { row.day = day; row.dayN = 0; row.dayIds = []; }
  if (row.week !== week) { row.week = week; row.weekN = 0; }
}
function orthMine_(row) {
  return { total: row.total, week: row.week, weekN: row.weekN, day: row.day, dayN: row.dayN, dayIds: row.dayIds.slice(), solved: row.solved };
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
  if (tok) id = env.cacheGet('t:' + tok);
  if (!id && tok && env.propGet) {
    try { rec = JSON.parse(env.propGet('ot:' + tok) || 'null'); } catch (e) { rec = null; }
    if (rec && rec.e > Date.parse(env.now())) { id = rec.i; via = 'o'; }
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
  return { st: st, via: via };
}
function orthIssue_(st, env) {
  if (!env.propPut) return '';
  var tok = 'o' + env.uuid().replace(/-/g, '');
  var now = Date.parse(env.now());
  env.propPut('ot:' + tok, JSON.stringify({ i: st.id, e: now + ORTH_TOKEN_DAYS * 864e5, p: String(st.pwHash).slice(0, 12) }));
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
  var people = Object.keys(best).filter(function (id) { return active[id]; }).map(function (id) {
    var r = best[id], s = active[id];
    return { id: id, n: s.name, s: s.school, w: r.week === week ? Number(r.weekN) || 0 : 0, t: Number(r.total) || 0 };
  });
  var mates = people.filter(function (p) { return p.s === me.school; });
  return {
    week: week,
    school: { week: orthRank_(mates, 'w', me.id, false), total: orthRank_(mates, 't', me.id, false) },
    all: { week: orthRank_(people, 'w', me.id, true), total: orthRank_(people, 't', me.id, true) }
  };
}
function orthHomeData_(st, store, env) {
  var row = store.orthGet(st.id) || orthBlank_(st);
  var now = env.now();
  orthRoll_(row, orthDay(now), orthWeek(now));
  return { mine: orthMine_(row), st: row.st, wrong: row.wrong, board: orthBoard_(st, store, env, row) };
}

/* ---------- 요청 ---------- */
if (typeof CORE_ACTIONS !== 'undefined') {
  // 로그인: 트래커 로그인과 같고, 트래커 홈 대신 맞춤법 기록·순위를 돌려줌
  CORE_ACTIONS.orthLogin = function (req, store, env) {
    var r = CORE_ACTIONS.login(req, store, env);
    if (!r.ok || r.me.mustChange) return r;
    var st = store.students().filter(function (s) { return s.id === r.me.id; })[0];
    r.otoken = orthIssue_(st, env);
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
    if (a.via === 't') res.otoken = orthIssue_(a.st, env);   // 트래커 토큰으로 들어오면 사이트 토큰을 새로 줌
    return res;
  };
  // 푼 결과 올리기. res = [[문제번호, 1(맞힘)|0(틀림)], …], cid = 묶음 번호(같은 묶음이 두 번 와도 한 번만 반영)
  CORE_ACTIONS.orthSync = function (req, store, env) {
    var st = orthAuth_(req, store, env).st;
    var list = Array.isArray(req.res) ? req.res.slice(0, 300) : [];
    var cid = String(req.cid || '').slice(0, 40);
    var now = env.now();
    var row = store.orthGet(st.id) || orthBlank_(st);
    row.school = st.school; row.name = st.name;
    orthRoll_(row, orthDay(now), orthWeek(now));
    var dup = !!cid && row.cids.indexOf(cid) >= 0;
    if (!dup) {
      var seen = {}, wrong = {};
      row.dayIds.forEach(function (id) { seen[id] = 1; });
      row.wrong.forEach(function (id) { wrong[id] = 1; });
      list.forEach(function (x) {
        if (!Array.isArray(x)) return;
        var id = String(x[0]), ok = x[1] === 1 || x[1] === true;
        if (!ORTH_ID.test(id)) return;
        var s = row.st[id];
        if (!Array.isArray(s)) s = row.st[id] = [0, 0];
        row.solved++;
        if (ok) {
          s[0]++; delete wrong[id];
          // 같은 문제는 하루에 한 번만 셈
          if (!seen[id] && row.dayN < ORTH_DAY_CAP) { seen[id] = 1; row.dayIds.push(id); row.dayN++; row.weekN++; row.total++; }
        } else { s[1]++; wrong[id] = 1; }
      });
      row.wrong = Object.keys(wrong);
      if (cid) { row.cids.push(cid); if (row.cids.length > 30) row.cids = row.cids.slice(-30); }
      row.updatedAt = now;
      orthTrim_(row);
      store.orthPut(row);
    }
    return { ok: true, dup: dup, mine: orthMine_(row), board: orthBoard_(st, store, env, row) };
  };
  CORE_ACTIONS.orthLogout = function (req, store, env) {
    var t = String(req.token || '');
    if (t && t.charAt(0) === 'o' && env.propDel) env.propDel('ot:' + t);
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
  }
  return sh;
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
    else if (c === 'st') { try { v = v ? JSON.parse(v) : {}; } catch (e) { v = {}; } if (!v || typeof v !== 'object') v = {}; }
    else v = String(v);
    o[c] = v;
  });
  return o;
}
function orthOut_(o) {
  return ORTH_COLS.map(function (c) {
    var v = o[c];
    if (ORTH_LIST[c]) return (v || []).join(',');
    if (c === 'st') return JSON.stringify(v || {});
    return v === undefined || v === null ? '' : String(v);
  });
}
function orthSheetRows_() {
  var sh = orthSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ORTH_LIGHT).getValues()
    .filter(function (r) { return String(r[0]) !== ''; }).map(orthParse_);
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
    if (!s.orthRows) { s.orthRows = orthSheetRows_; s.orthGet = orthSheetGet_; s.orthPut = orthSheetPut_; }
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

/* ===== 점검 도구: 함수 목록에서 orthCheck를 고르고 ▷ 실행 → '실행 로그' 확인 =====
 * 실제 시트에는 orth 탭(없으면)만 만들고, 학생 기록은 쓰지 않습니다. 채점·순위는 메모리 안에서 가짜 학생으로 시험합니다.
 */
function orthCheck() {
  var out = [], bad = 0;
  function ok(m) { out.push('✔ ' + m); }
  function ng(m) { out.push('✘ ' + m); bad++; }
  function log() { Logger.log(out.join('\n') + '\n\n' + (bad ? '문제 ' + bad + '개 — 이 로그를 그대로 복사해서 Claude에게 보내 주세요.' : '모두 정상입니다. 이제 배포 → 배포 관리 → 새 버전으로 배포하면 됩니다.')); }

  if (typeof CORE_ACTIONS === 'undefined' || typeof coreHandle !== 'function') { ng('Code.gs의 공통 로직을 찾지 못했습니다. orth 파일이 Code.gs보다 아래에 있는지 확인해 주세요.'); return log(); }
  var need = ['orthLogin', 'orthChangePw', 'orthHome', 'orthSync', 'orthLogout'];
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
    if (real.orthRows && real.orthGet && real.orthPut) { real.orthRows(); ok('orth 탭 읽기 정상'); }
    else ng('저장소에 orth 읽기·쓰기가 붙지 않았습니다.');
    if (real.deleteSub) ok('무한선지(omr) 기능도 그대로'); else out.push('· omr 파일이 없거나 orth보다 아래에 있음(트래커에 영향 없으면 괜찮음)');
    var en = makeEnv_();
    if (en.propGet && en.propPut) ok('로그인 유지(30일) 저장소 준비됨'); else ng('스크립트 속성을 쓸 수 없습니다.');
  } catch (e) { ng('시트 확인 중 오류: ' + (e && e.message ? e.message : e)); }

  try { orthSelfTest_(); ok('메모리 시험 통과 (로그인·첫 비밀번호 변경 · 30일 유지·연장·만료 · 비밀번호 바뀌면 풀림 · 하루 한 번만 셈 · 같은 묶음 두 번 막기 · 오답 노트 · 학교·전체 순위 · 주가 바뀌면 이번 주 새로 · 퇴원생 빠짐)'); }
  catch (e) { ng('메모리 시험 중 오류: ' + (e && e.message ? e.message : e)); }
  log();
}

// 시트를 쓰지 않는 가짜 저장소로 처음부터 끝까지 시험
function orthSelfTest_() {
  var dc = function (x) { return JSON.parse(JSON.stringify(x)); };
  var db = { students: [], sets: [], items: [], subs: [], checks: [], orth: [] }, cache = {}, props = {}, n = 0;
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
    orthRows: function () { return db.orth.map(function (r) { var o = {}; ORTH_COLS.slice(0, ORTH_LIGHT).forEach(function (c) { o[c] = r[c]; }); return dc(o); }); },
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
  var s1 = P({ action: 'orthSync', token: tg, cid: 'c1', res: [['pa1', 1], ['pa2', 1], ['pa1', 1], ['pa3', 0], ['나쁜 번호', 1]] });
  must(s1.ok && s1.mine.dayN === 2 && s1.mine.total === 2 && s1.mine.weekN === 2 && s1.mine.solved === 4, '하루 한 번만 셈: ' + JSON.stringify(s1.mine || s1.error));
  var s1b = P({ action: 'orthSync', token: tg, cid: 'c1', res: [['pa1', 1], ['pa2', 1], ['pa1', 1], ['pa3', 0]] });
  must(s1b.ok && s1b.dup && s1b.mine.solved === 4, '같은 묶음이 두 번 반영됨');
  var h1 = P({ action: 'orthHome', token: tg });
  must(h1.ok && h1.orth.st.pa1.join() === '2,0' && h1.orth.wrong.join() === 'pa3', '문제별 기록·오답: ' + JSON.stringify(h1.orth && [h1.orth.st, h1.orth.wrong]));
  var s2 = P({ action: 'orthSync', token: tg, cid: 'c2', res: [['pa3', 1]] });
  must(s2.ok && s2.mine.dayN === 3, '오답을 맞힘');
  must(P({ action: 'orthHome', token: tg }).orth.wrong.length === 0, '맞힌 문제가 오답 노트에 남음');

  // 트래커 토큰으로 들어오면 사이트 토큰을 새로 줌
  var nt =P({ action: 'login', id: id('나나나'), pw: '0000' }).token;
  must(P({ action: 'changePw', token: nt, newPw: '5678' }).ok, '나나나 비밀번호 변경');
  var hn = P({ action: 'orthHome', token: nt });
  must(hn.ok && hn.otoken, '트래커 토큰으로 입장: ' + hn.error);
  var tn = hn.otoken;
  P({ action: 'orthSync', token: tn, cid: 'n1', res: [['pa1', 1], ['pa2', 1], ['pa3', 1], ['pa4', 1], ['pa5', 1]] });

  var td = P({ action: 'orthLogin', id: id('다다다'), pw: '0000' }).token;
  var td2 = P({ action: 'orthChangePw', token: td, newPw: '4321' }).otoken;
  P({ action: 'orthSync', token: td2, cid: 'd1', res: [['pa1', 1], ['pa2', 1], ['pa3', 1], ['pa4', 1], ['pa5', 1], ['pa6', 1], ['pa7', 1]] });

  var b = P({ action: 'orthHome', token: tg }).orth.board;
  must(b.school.week.top.length === 2 && b.school.week.top[0].n[0][0] === '나나나' && b.school.week.top[0].d === 5, '학교 순위 1위');
  must(b.school.week.me.r === 2 && b.school.week.me.up.r === 1 && b.school.week.me.up.gap === 2, '학교 순위 내 자리: ' + JSON.stringify(b.school.week.me));
  must(b.all.week.top[0].n[0].join() === '다다다,나고' && b.all.week.me.r === 3 && b.all.week.of === 3, '전체 순위: ' + JSON.stringify(b.all.week));
  must(b.school.week.top.every(function (g) { return g.n.every(function (x) { return x[0] !== '다다다'; }); }), '다른 학교가 학교 순위에 섞임');

  // 다음 날: 같은 문제를 다시 맞히면 또 셈
  T += day;
  var s3 = P({ action: 'orthSync', token: tg, cid: 'c3', res: [['pa1', 1], ['pa2', 1], ['pa3', 1]] });
  must(s3.mine.dayN === 3 && s3.mine.total === 6 && s3.mine.weekN === 6, '다음 날 다시 셈: ' + JSON.stringify(s3.mine));
  var b2 = s3.board.school.week;
  must(b2.me.r === 1 && b2.me.lead === 1, '1위 앞선 개수: ' + JSON.stringify(b2.me));

  // 다음 주 월요일: 이번 주는 0부터, 누적은 그대로
  T = Date.UTC(2026, 0, 11, 15, 30, 0);
  var h2 = P({ action: 'orthHome', token: tg });
  must(h2.orth.mine.weekN === 0 && h2.orth.mine.total === 6 && h2.orth.mine.dayN === 0, '주가 바뀜: ' + JSON.stringify(h2.orth.mine));
  must(h2.orth.board.school.week.top.length === 0 && h2.orth.board.school.total.top[0].d === 6, '주가 바뀐 순위');

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
