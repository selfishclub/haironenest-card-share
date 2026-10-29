// 오늘 타임테이블(가로) 규칙 테스트 (10-13 원장: 핸드SOS처럼 몇 시에 누가 오는지 한눈에).
// 명단 항목에 시술(선택)을 두고, 시술 시간표의 분만큼 칸을 차지한다. 겹치면 줄(lane)이 하나 더 생긴다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, addCustomer, markToday, setTodayService, setTodayTime, todayList, timeline, TIMELINE_SLOTS, deserialize, serialize, sampleState } = require('./store.js');

const D = '2026-10-13';
function seeded() {
  let s = createState();
  const ids = [];
  for (const n of ['고객A', '고객B', '고객C', '고객D']) { const r = addCustomer(s, { name: n, phone: `0100000000${ids.length + 1}` }); s = r.state; ids.push(r.customer.id); }
  return { s, ids };
}

test('TIMELINE_SLOTS — 10:00부터 19:30까지 30분 칸 스무 개', () => {
  assert.equal(TIMELINE_SLOTS.length, 20);
  assert.equal(TIMELINE_SLOTS[0], '10:00'); assert.equal(TIMELINE_SLOTS[19], '19:30');
});

test('markToday에 시술을 함께 올리고, setTodayService로 바꾼다. 시간표에 없는 이름은 빈 것으로', () => {
  const { s, ids } = seeded();
  let t = markToday(s, ids[0], D, '10:00', '열펌 매직').state;
  assert.equal(t.today.entries[0].service, '열펌 매직');
  assert.deepEqual([todayList(t, D)[0].service, todayList(t, D)[0].minutes], ['열펌 매직', 180]);
  t = setTodayService(t, ids[0], D, '커트');
  assert.deepEqual([todayList(t, D)[0].service, todayList(t, D)[0].minutes], ['커트', 60]);
  t = setTodayService(t, ids[0], D, '');
  assert.deepEqual([todayList(t, D)[0].service, todayList(t, D)[0].minutes], ['', null]);
  t = markToday(t, ids[0], D, '', '뿌리염색').state;
  assert.equal(t.today.entries[0].service, '뿌리염색', '이미 있으면 시술만 채운다');
  assert.equal(t.today.entries[0].at, '10:00', '시간은 그대로');
  assert.equal(markToday(s, ids[1], D, '11:00').state.today.entries[0].service, '', '안 고르면 빈 글');
  const back = deserialize(serialize(t));
  assert.equal(back.today.entries[0].service, '뿌리염색', '백업을 거쳐도 남는다');
  assert.equal(deserialize(JSON.stringify({ ...t, today: { date: D, entries: [{ customerId: ids[0], at: '10:00', date: D }] } })).today.entries[0].service, '', '옛 백업(시술 없음)도 열린다');
});

test('timeline — 시간 있는 사람은 칸(col)과 폭(span)을 갖고, 겹치면 다음 줄로. 시술 없으면 한 칸. 시간 없는 사람은 untimed', () => {
  const { s, ids } = seeded();
  let t = markToday(s, ids[0], D, '10:00', '열펌 매직').state;   // 10:00~13:00 → 6칸
  t = markToday(t, ids[1], D, '11:30', '커트').state;           // 11:30~12:30 → 2칸, A와 겹침 → 둘째 줄
  t = markToday(t, ids[2], D, '13:00').state;                   // 시술 없음 → 1칸, 첫 줄
  t = markToday(t, ids[3], D, '').state;                        // 시간 없음
  const tl = timeline(t, D);
  assert.equal(tl.lanes.length, 2);
  assert.deepEqual(tl.lanes[0].map(b => [b.customer.name, b.col, b.span]), [['고객A', 0, 6], ['고객C', 6, 1]]);
  assert.deepEqual(tl.lanes[1].map(b => [b.customer.name, b.col, b.span]), [['고객B', 3, 2]]);
  assert.deepEqual(tl.untimed.map(b => b.customer.name), ['고객D']);
  assert.deepEqual([tl.total, tl.recorded], [4, 0], '그날 몇 명 중 몇 명 기록했는지');
  assert.equal(tl.lanes[0][0].recorded, false);
  assert.equal(tl.lanes[0][0].end, '13:00');
});

test('timeline — 영업시간 밖은 가장자리 칸에 붙이고 끝을 넘는 폭은 잘린다. 45분·90분은 올림', () => {
  const { s, ids } = seeded();
  let t = markToday(s, ids[0], D, '09:30', '커트').state;       // 10시 전 → col 0
  t = markToday(t, ids[1], D, '19:00', '매직세팅').state;       // 240분이지만 19:00부터는 2칸만
  t = markToday(t, ids[2], D, '15:00', '뿌리염색').state;       // 90분 → 3칸
  const tl = timeline(t, D);
  const by = (n) => tl.lanes.flat().find(b => b.customer.name === n);
  assert.deepEqual([by('고객A').col, by('고객A').span], [0, 2]);
  assert.deepEqual([by('고객B').col, by('고객B').span], [18, 2]);
  assert.deepEqual([by('고객C').col, by('고객C').span], [10, 3]);
});

test('timeline — 시간을 바꾸면 자리가 옮겨지고, 예시 손님에도 시술이 들어 있다', () => {
  const { s, ids } = seeded();
  let t = markToday(s, ids[0], D, '10:00', '커트').state;
  t = setTodayTime(t, ids[0], D, '14:00').state;
  assert.equal(timeline(t, D).lanes[0][0].col, 8);
  const sample = sampleState(D, D + 'T09:00:00');
  assert.ok(sample.today.entries.some(e => e.service), '예시 손님 중 시술이 있는 사람이 있다');
});

// ---- 손님 올릴 때 시술항목 [+ 추가] (10-13 원장): 이름과 걸리는 시간을 정해 시간표 맨 끝에 더한다 ----
const { addServiceTime, serviceList: svcList } = require('./store.js');

test('addServiceTime — 시술항목을 이름·걸리는 시간(분)으로 시간표 끝에 더한다. 같은 이름·빈 이름·0분은 막는다', () => {
  let s = createState();
  const before = svcList(s).length;
  const r = addServiceTime(s, { name: ' 두피 스파 ', minutes: '90' });
  s = r.state;
  assert.deepEqual(r.service, { name: '두피 스파', minutes: 90 });
  assert.equal(svcList(s).length, before + 1);
  assert.deepEqual(svcList(s).at(-1), { name: '두피 스파', minutes: 90 }, '맨 끝에');
  assert.equal(svcList(s)[0].name, '커트', '기본 시간표는 그대로 남는다');
  assert.throws(() => addServiceTime(s, { name: '두피스파', minutes: 60 }), /이미 있는 시술/);
  assert.throws(() => addServiceTime(s, { name: '  ', minutes: 60 }), /시술 이름/);
  assert.throws(() => addServiceTime(s, { name: '드라이', minutes: '' }), /걸리는 시간/);
  assert.deepEqual(svcList(deserialize(serialize(s))).at(-1), { name: '두피 스파', minutes: 90 }, '백업·복원 뒤에도 남는다');
});

// ---- 시술항목 분류 (10-13 원장: 커트를 누르면 남성 컷·여성 컷·아이 컷처럼) ----
const { serviceGroups, servicesInGroup, serviceGroupOf, setServices: setSvc } = require('./store.js');

test('serviceGroups — 시술항목을 분류로 묶는다. 분류를 안 정한 것은 이름으로 짐작(컷→커트, 펌·매직·세팅→펌, 염색·뿌리→염색, 클리닉→클리닉, 그 밖→기타)', () => {
  let s = createState();
  assert.deepEqual(serviceGroups(s), ['커트', '펌', '클리닉', '염색'], '기본 시간표: 나오는 순서대로');
  assert.deepEqual(servicesInGroup(s, '펌').map((x) => x.name), ['일반 콜드펌', '열펌 매직', '매직세팅']);
  s = addServiceTime(s, { name: '남성 컷', minutes: 30 }).state;
  s = addServiceTime(s, { name: '아이 컷', minutes: 30, group: '커트' }).state;
  s = addServiceTime(s, { name: '드라이', minutes: 30, group: ' 스타일링 ' }).state;
  s = addServiceTime(s, { name: '붙임머리', minutes: 120 }).state;
  assert.deepEqual(servicesInGroup(s, '커트').map((x) => x.name), ['커트', '남성 컷', '아이 컷']);
  assert.deepEqual(serviceGroups(s), ['커트', '펌', '클리닉', '염색', '스타일링', '기타']);
  assert.equal(serviceGroupOf({ name: '붙임머리', minutes: 120 }), '기타');
  assert.deepEqual(svcList(deserialize(serialize(s))).find((x) => x.name === '드라이'), { name: '드라이', minutes: 30, group: '스타일링' }, '정한 분류는 저장된다');
  // 시간표 표에서 분류를 바꿀 수 있다
  const t = setSvc(s, svcList(s).map((x) => (x.name === '붙임머리' ? { ...x, group: '스타일링' } : x)));
  assert.deepEqual(servicesInGroup(t, '스타일링').map((x) => x.name), ['드라이', '붙임머리']);
  assert.ok(!serviceGroups(t).includes('기타'), '빈 분류는 안 보인다');
});

// 10-14 원장: 내일 예약을 미리 올려 둔다(나중에 알림톡이 이 명단을 보고 나간다).
// 앞날에 올려도 명단의 기준 날짜(today.date)는 오늘에 머물러야 한다. 내일로 넘어가면 서버가 오늘 다시 읽을 때 그 줄을 못 찾는다.
const { bookingSummary, splitNamePhone, rollToday } = require('./store.js');
test('내일 예약을 미리 올려도 명단 날짜는 오늘에 머문다', () => {
  let { state: s, customer: a } = addCustomer(createState(), { name: '고객 A', phone: '01011112222' });
  let b; ({ state: s, customer: b } = addCustomer(s, { name: '고객 B', phone: '' }));
  s = rollToday(s, '2026-10-14').state;
  ({ state: s } = markToday(s, a.id, '2026-10-15', '11:00', '커트', '2026-10-14'));
  ({ state: s } = markToday(s, b.id, '2026-10-15', '14:00', '', '2026-10-14'));
  assert.equal(s.today.date, '2026-10-14', '오늘을 주면 내일 것을 올려도 오늘 그대로');
  assert.deepEqual(todayList(s, '2026-10-15').map((t) => [t.customer.name, t.at]), [['고객 A', '11:00'], ['고객 B', '14:00']]);
  assert.deepEqual(todayList(s, '2026-10-14'), [], '오늘 명단에는 안 섞인다');
  // 다음 날 열면 그대로 오늘 명단이 된다
  const next = rollToday(s, '2026-10-15').state;
  assert.deepEqual(todayList(next, '2026-10-15').map((t) => t.customer.name), ['고객 A', '고객 B']);
  // 예약 요약: 몇 명, 번호 없는 손님(알림톡이 못 가는 사람)
  const sum = bookingSummary(s, '2026-10-15');
  assert.equal(sum.total, 2);
  assert.deepEqual(sum.noPhone.map((c) => c.name), ['고객 B']);
  assert.deepEqual(bookingSummary(s, '2026-10-16'), { total: 0, noPhone: [] });
});

test('올리는 칸에 이름과 번호를 함께 치면 나눠 읽는다', () => {
  assert.deepEqual(splitNamePhone('고객 A 010-1234-5678'), { name: '고객 A', phone: '01012345678' });
  assert.deepEqual(splitNamePhone('고객A01012345678'), { name: '고객A', phone: '01012345678' });
  assert.deepEqual(splitNamePhone('고객 A'), { name: '고객 A', phone: '' });
  assert.deepEqual(splitNamePhone('고객 A 1234'), { name: '고객 A 1234', phone: '' }, '10~11자리가 아니면 번호로 안 본다');
});

// 10-16 원장: 시술항목을 한곳에서 더하고 고치고 지운다. 이름을 바꾸면 명단에 올린 예약의 시술도 따라 바뀐다.
const { editServices, serviceList: svcList2 } = require('./store.js');
test('editServices — 고치기·지우기·더하기를 한 번에, 바뀐 이름은 명단 예약에도 따라간다', () => {
  let { state: s, customer: a } = addCustomer(createState(), { name: '고객 A', phone: '' });
  let b; ({ state: s, customer: b } = addCustomer(s, { name: '고객 B', phone: '' }));
  ({ state: s } = markToday(s, a.id, '2026-10-17', '11:00', '커트'));
  ({ state: s } = markToday(s, b.id, '2026-10-17', '14:00', '클리닉'));
  const rows = svcList2(s).map((x) => ({ from: x.name, name: x.name, minutes: x.minutes, group: x.group }))
    .filter((x) => x.from !== '클리닉')                                            // 지움
    .map((x) => (x.from === '커트' ? { ...x, name: '여성 컷', minutes: 90, group: '커트' } : x));   // 이름·시간 고침
  rows.push({ name: '남성 컷', minutes: '30', group: '커트' });                      // 더함
  rows.push({ name: '  ', minutes: '', group: '커트' });                             // 비워 둔 새 줄은 버림
  const r = editServices(s, rows);
  const names = svcList2(r.state).map((x) => x.name);
  assert.ok(names.includes('여성 컷') && names.includes('남성 컷') && !names.includes('커트') && !names.includes('클리닉'));
  assert.equal(svcList2(r.state).find((x) => x.name === '여성 컷').minutes, 90);
  assert.deepEqual(r.state.today.entries.map((e) => [e.customerId, e.service]), [[a.id, '여성 컷'], [b.id, '클리닉']], '바꾼 이름은 따라가고, 지운 시술은 이름만 남는다');
  assert.deepEqual(r.orphans.map((e) => e.customerId), [b.id], '지운 시술을 쓰는 예약을 알려 준다');
  assert.equal(timeline(r.state, '2026-10-17').lanes.flat().find((x) => x.customer.id === a.id).span, 3, '90분 = 세 칸');
  assert.throws(() => editServices(s, rows.map((x) => (x.name === '남성 컷' ? { ...x, name: '여성컷' } : x))), /같은 이름/);
  assert.throws(() => editServices(s, [{ from: '커트', name: '', minutes: 60 }]), /시술 이름/);
});

test('editServices — 원장이 바꾼 순서(분류 순서·분류 안 순서) 그대로 고르는 칸에 나온다', () => {
  const s0 = createState();
  const rows = svcList2(s0).map((x) => ({ from: x.name, name: x.name, minutes: x.minutes, group: serviceGroupOf(x) }));
  const by = (g) => rows.filter((x) => x.group === g);
  const reordered = [...by('염색').reverse(), ...by('커트'), ...by('펌'), ...by('클리닉')];
  const s = editServices(s0, reordered).state;
  assert.deepEqual(serviceGroups(s), ['염색', '커트', '펌', '클리닉']);
  assert.deepEqual(servicesInGroup(s, '염색').map((x) => x.name), ['전체 염색', '뿌리염색']);
});

test('bookingSummary — 번호 없는 가족이라도 같은 날 대표가 대신 받으면 "번호 없음"으로 세지 않는다 (10-24)', () => {
  const { createState, addCustomer, markToday, addFamilyMember, bookingSummary: bs } = require('./store.js');
  let s = createState(), mom, kid, alone;
  ({ state: s, customer: mom } = addCustomer(s, { name: '예시 엄마', phone: '01011110001' }));
  ({ state: s, customer: kid } = addFamilyMember(s, mom.id, { name: '예시 딸', role: '딸' }));
  ({ state: s, customer: alone } = addCustomer(s, { name: '고객 N', phone: '' }));
  for (const id of [mom.id, kid.id, alone.id]) ({ state: s } = markToday(s, id, '2026-10-25', '14:00', '', '2026-10-24'));
  assert.deepEqual(bs(s, '2026-10-25').noPhone.map((c) => c.name), ['고객 N']);
});
