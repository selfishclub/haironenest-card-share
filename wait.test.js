// 예약 대기(C안, 10-11 원장 승인) 규칙 테스트. 예약은 네이버에 그대로 두고, 대기는 "자리 나면 문자를 받는 줄"이다.
// 손님이 링크에서 직접 걸고(시술·날짜 범위·시간대·전화), 원장이 취소를 한 줄 적으면 시술 시간이 맞는 대기 손님에게 순서대로 문자가 간다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, WAIT_WINDOWS, WAIT_DAYS, dayKindOf, waitMonths, waitWhen, waitWindowsCol, windowOf, addWait, leaveWait, expireWaits, sweepWaits, waitQueue, waitsOf, waitPosition, matchWaiters, NOTIFY_LIMIT, markNotified, noticeText, waitConfirmText, setBookingUrl, addCancel, deserialize, serialize, sampleState, maskPhone, clockLabel } = require('./store.js');

const NOW = '2026-10-12T10:00:00';
const TODAY = '2026-10-12';
const base = { name: '대기예시', phone: '010-9999-0001', service: '열펌 매직', month: '2026-11', days: ['weekday', 'weekend'], windows: ['pm', 'eve'], code: '123456' };

test('WAIT_WINDOWS — 오전(~1시) · 오후(1~5시) · 5시 이후 (10-23 원장: 셋). windowOf는 시각이 든 시간대', () => {
  assert.deepEqual(WAIT_WINDOWS.map(w => [w.key, w.label]), [['am', '오전'], ['pm', '오후'], ['eve', '5시 이후']]);
  assert.equal(windowOf('10:00'), 'am'); assert.equal(windowOf('12:59'), 'am'); assert.equal(windowOf('13:00'), 'pm'); assert.equal(windowOf('14:30'), 'pm'); assert.equal(windowOf('17:00'), 'eve'); assert.equal(windowOf('19:30'), 'eve');
  assert.equal(windowOf(''), null); assert.equal(windowOf('09:00'), 'am', '영업 전 시각은 오전'); assert.equal(windowOf('20:00'), 'eve');
  assert.deepEqual(WAIT_DAYS.map(d => d.label), ['평일', '주말']);
  assert.equal(dayKindOf('2026-10-23'), 'weekday', '금'); assert.equal(dayKindOf('2026-10-24'), 'weekend', '토'); assert.equal(dayKindOf('2026-10-25'), 'weekend', '일'); assert.equal(dayKindOf('2026-10-26'), 'weekday', '월');
  assert.deepEqual(waitMonths('2026-10-23'), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(waitMonths('2026-12-31'), ['2026-12', '2027-01', '2027-02'], '해가 넘어가도');
});

test('addWait — 손님이 건 대기 한 줄: 희망 월 하나가 1일~말일이 되고, 평일/주말·시간대, 시술은 시간표에서 분을 가져온다', () => {
  const s0 = createState();
  const { state, wait } = addWait(s0, base, NOW);
  assert.deepEqual(wait, { id: 1, name: '대기예시', phone: '01099990001', service: '열펌 매직', minutes: 180, dateFrom: '2026-11-01', dateTo: '2026-11-30', days: ['weekday', 'weekend'], windows: ['pm', 'eve'], note: '', code: '123456', status: 'waiting', createdAt: NOW, notified: [] });
  assert.equal(state.nextId, 2);
  assert.equal(s0.waitlist.length, 0, '원래 상태는 안 바뀐다');
  const now = addWait(s0, { ...base, month: '2026-10', days: ['weekend'] }, NOW).wait;
  assert.deepEqual([now.dateFrom, now.dateTo, now.days], ['2026-10-12', '2026-10-31', ['weekend']], '이번 달이면 오늘부터 말일까지');
  assert.equal(addWait(s0, { ...base, month: '2027-02' }, '2026-12-05T10:00:00').wait.dateTo, '2027-02-28');
  assert.equal(waitWhen(wait), '11월 평일·주말 오후·5시 이후');
});

test('addWait — 막는 것: 빈 이름, 이상한 번호, 시간표에 없는 시술, 희망 월 없음·지난 달·석 달 넘음, 평일/주말 없음, 시간대 없음, 같은 번호 대기 3건', () => {
  const s = createState();
  assert.throws(() => addWait(s, { ...base, name: ' ' }, NOW), /이름/);
  assert.throws(() => addWait(s, { ...base, phone: '123' }, NOW), /전화번호/);
  assert.throws(() => addWait(s, { ...base, service: '펌' }, NOW), /시술/);
  assert.throws(() => addWait(s, { ...base, month: '' }, NOW), /희망 월/);
  assert.throws(() => addWait(s, { ...base, month: '2026-09' }, NOW), /지난 달/);
  assert.throws(() => addWait(s, { ...base, month: '2027-01' }, NOW), /12월까지/);
  assert.throws(() => addWait(s, { ...base, days: [] }, NOW), /평일·주말/);
  assert.throws(() => addWait(s, { ...base, days: ['holiday'] }, NOW), /평일·주말/);
  assert.throws(() => addWait(s, { ...base, windows: [] }, NOW), /시간대/);
  assert.throws(() => addWait(s, { ...base, windows: ['night'] }, NOW), /시간대/);
  let t = s;
  for (let i = 0; i < 3; i++) t = addWait(t, { ...base, code: String(100000 + i) }, NOW).state;
  assert.throws(() => addWait(t, base, NOW), /3건/);
});

test('leaveWait·expireWaits·waitsOf — 손님이 빼면 left, 그 달이 지나면 expired, 내 것 보기는 번호로(뺀 것은 안 보임)', () => {
  let s = addWait(createState(), base, NOW).state;
  s = addWait(s, { ...base, code: '222222', month: '2026-10' }, NOW).state;
  assert.equal(waitsOf(s, '010 9999 0001').length, 2);
  s = leaveWait(s, 1);
  assert.equal(s.waitlist[0].status, 'left');
  assert.deepEqual(waitsOf(s, '01099990001').map(w => w.id), [2]);
  s = expireWaits(s, '2026-10-31');
  assert.equal(s.waitlist[1].status, 'waiting', '말일까지는 산다');
  s = expireWaits(s, '2026-11-01');
  assert.equal(s.waitlist[1].status, 'expired');
  assert.deepEqual(waitsOf(s, '01099990001').map(w => [w.id, w.status]), [[2, 'expired']], '기간 지난 것은 보이되 상태가 다르다');
  assert.throws(() => leaveWait(s, 99), /없는/);
});

test('sweepWaits — 그 달이 끝난 대기는 상태와 상관없이 지운다 (동의 글 "대기가 끝나면 지워요")', () => {
  let s = addWait(createState(), { ...base, month: '2026-10' }, NOW).state;
  s = addWait(s, { ...base, code: '2' }, NOW).state;
  s = leaveWait(s, 2);
  assert.equal(sweepWaits(s, '2026-10-31').removed, 0, '10월 말일까지는 둔다');
  const r = sweepWaits(s, '2026-11-01');
  assert.equal(r.removed, 1);
  assert.deepEqual(r.state.waitlist.map(w => w.id), [2], '11월 대기는 뺀 것이라도 11월 끝까지');
  assert.equal(sweepWaits(r.state, '2026-12-01').state.waitlist.length, 0);
  assert.equal(sweepWaits(createState(), '2026-12-01').removed, 0);
});

test('waitPosition — 같은 시술이고 달·요일·시간대가 겹치는 대기 중 내 앞에 선 사람 수 + 1', () => {
  let s = createState();
  const add = (fields, at) => { const r = addWait(s, { ...base, ...fields }, at); s = r.state; return r.wait.id; };
  const a = add({ phone: '01000000001', code: '1' }, '2026-10-12T09:00:00');             // 열펌, 11월, 평일·주말, 오후·5시 이후
  const b = add({ phone: '01000000002', code: '2', service: '커트' }, '2026-10-12T09:10:00');   // 다른 시술
  const c = add({ phone: '01000000003', code: '3', windows: ['am'] }, '2026-10-12T09:20:00');   // 같은 시술, 시간대 안 겹침
  const d = add({ phone: '01000000004', code: '4', days: ['weekend'] }, '2026-10-12T09:30:00');   // 같은 시술, 주말만 (a와 겹침)
  const e = add({ phone: '01000000005', code: '5', month: '2026-12' }, '2026-10-12T09:40:00');   // 달이 다름
  const f = add({ phone: '01000000006', code: '6', days: ['weekday'] }, '2026-10-12T09:50:00');   // 평일만: a와 겹치고 d와는 안 겹침
  assert.equal(waitPosition(s, a), 1);
  assert.equal(waitPosition(s, b), 1, '커트는 커트끼리');
  assert.equal(waitPosition(s, c), 1, '오전만 되는 사람은 오후 사람과 안 겹친다');
  assert.equal(waitPosition(s, d), 2, 'a 뒤');
  assert.equal(waitPosition(s, e), 1, '12월은 11월과 안 겹친다');
  assert.equal(waitPosition(s, f), 2, 'a 뒤, 주말만 되는 d는 안 센다');
  s = leaveWait(s, a);
  assert.equal(waitPosition(s, d), 1, 'a가 빠지면 앞당겨진다');
});

test('matchWaiters — 취소 한 줄(날짜·시각·분)에 맞는 대기: 그 달 안, 평일/주말, 되는 시간대, 시술이 빈 시간 안에 들어감. 줄 앞부터. 시술을 모르면 아무도 안 맞는다', () => {
  let s = createState();
  const add = (fields, at) => { const r = addWait(s, { ...base, ...fields }, at); s = r.state; return r.wait.id; };
  const perm = add({ phone: '01000000001', code: '1' }, '2026-10-12T09:00:00');                      // 열펌 180분, 오후·5시 이후
  const cut = add({ phone: '01000000002', code: '2', service: '커트' }, '2026-10-12T09:10:00');      // 커트 60분
  const setting = add({ phone: '01000000003', code: '3', service: '매직세팅' }, '2026-10-12T09:20:00');   // 240분
  const morning = add({ phone: '01000000004', code: '4', service: '커트', windows: ['am'] }, '2026-10-12T09:30:00');
  const weekend = add({ phone: '01000000005', code: '5', service: '커트', days: ['weekend'] }, '2026-10-12T09:40:00');
  const dec = add({ phone: '01000000006', code: '6', service: '커트', month: '2026-12' }, '2026-10-12T09:50:00');
  const cancel = (text) => addCancel(s, { text }, '2026-10-19T11:00:00', '2026-10-19').cancel;
  // 11/12는 목요일(평일), 11/14는 토요일(주말)
  assert.deepEqual(matchWaiters(s, cancel('11월 12일 2시 열펌, 전날 취소')).map(w => w.id), [perm, cut], '180분 평일 오후: 열펌·커트(들어가면 보냄), 매직세팅(240)·오전만·주말만은 안 됨');
  assert.deepEqual(matchWaiters(s, cancel('11월 14일 2시 열펌')).map(w => w.id), [perm, cut, weekend], '토요일: 주말만 되는 사람도');
  assert.deepEqual(matchWaiters(s, cancel('11월 12일 오전 11시 커트')).map(w => w.id), [morning], '60분 오전 자리: 오전 되는 커트만');
  assert.deepEqual(matchWaiters(s, cancel('11월 12일 커트')).map(w => w.id), [cut, morning], '시각을 모르면 시간대는 안 따진다');
  assert.deepEqual(matchWaiters(s, cancel('11월 12일 6시 매직세팅')).map(w => w.id), [perm, cut, setting], '5시 이후 자리');
  assert.deepEqual(matchWaiters(s, cancel('12월 3일 2시 커트')).map(w => w.id), [dec], '12월 자리는 12월 대기만');
  assert.deepEqual(matchWaiters(s, cancel('11월 12일 2시 펌')), [], '"펌"은 시술을 몰라 분이 없다 → 아무도 안 맞는다 (문자 안 나감)');
  assert.equal(NOTIFY_LIMIT, 3);
});

test('문자 받은 사람은 줄 맨 뒤로 (10-23 원장) — 다음 취소 때는 못 받은 사람이 앞, 받은 사람끼리는 받은 순', () => {
  let s = createState();
  const add = (fields, at) => { const r = addWait(s, { ...base, service: '커트', ...fields }, at); s = r.state; return r.wait.id; };
  const ids = [1, 2, 3, 4, 5].map((i) => add({ phone: `0100000000${i}`, code: String(i) }, `2026-10-12T09:0${i}:00`));
  const c1 = addCancel(s, { text: '11월 12일 2시 커트' }, '2026-10-19T11:00:00', '2026-10-19'); s = c1.state;
  const first = matchWaiters(s, c1.cancel).slice(0, NOTIFY_LIMIT).map(w => w.id);
  assert.deepEqual(first, ids.slice(0, 3));
  s = markNotified(s, first, c1.cancel.id, '2026-10-19T11:00:05');
  assert.deepEqual(s.waitlist.map(w => waitPosition(s, w.id)), [3, 4, 5, 1, 2], '4·5번이 앞으로, 받은 1~3은 뒤로');
  assert.deepEqual(waitQueue(s).map(w => w.id), [4, 5, 1, 2, 3], '원장 화면 목록도 줄 순서');
  const c2 = addCancel(s, { text: '11월 13일 2시 커트' }, '2026-10-20T11:00:00', '2026-10-20'); s = c2.state;
  assert.deepEqual(matchWaiters(s, c2.cancel).map(w => w.id), [4, 5, 1, 2, 3]);
  const late = add({ phone: '01000000009', code: '9' }, '2026-10-19T12:00:00');
  assert.deepEqual(matchWaiters(s, c2.cancel).map(w => w.id), [4, 5, 1, 2, 3, late], '문자 뒤에 건 사람은 그 뒤');
});

test('markNotified — 문자 보낸 사람에게 취소 번호와 시각을 남기고, 같은 취소로는 다시 안 맞는다', () => {
  let s = addWait(createState(), base, NOW).state;
  const c = addCancel(s, { text: '11월 12일 2시 열펌' }, '2026-10-19T11:00:00', '2026-10-19');
  s = c.state;
  assert.deepEqual(matchWaiters(s, c.cancel).map(w => w.id), [1]);
  s = markNotified(s, [1], c.cancel.id, '2026-10-19T11:00:05');
  assert.deepEqual(s.waitlist[0].notified, [{ cancelId: c.cancel.id, at: '2026-10-19T11:00:05' }]);
  assert.equal(s.waitlist[0].status, 'waiting', '문자를 받아도 줄에는 남는다 (못 잡으면 다음 자리에 또 받는다)');
  assert.deepEqual(matchWaiters(s, c.cancel), [], '같은 취소로는 다시 안 보낸다');
});

test('noticeText·waitConfirmText — 손님에게 가는 문자. 선착순이라는 말과 바꾸기 링크가 들어간다', () => {
  let s = setBookingUrl(createState(), 'https://booking.naver.com/x');
  const w = addWait(s, base, NOW); s = w.state;
  const c = addCancel(s, { text: '11월 12일 2시 열펌' }, '2026-10-19T11:00:00', '2026-10-19').cancel;
  const t = noticeText(s, c, 'https://haironenest-card.vercel.app/wait.html?w=1&c=123456');
  assert.equal(t, '[헤어원네스트] 11/12(목) 오후 2시 열펌 매직 자리가 났어요. 네이버 예약에서 지금 잡으세요 (선착순, 원장이 따로 연락하지는 않아요): https://booking.naver.com/x\n이 문자를 받으셔서 대기 순서는 맨 뒤로 갔어요(대기는 그대로예요).\n대기 바꾸기·빼기: https://haironenest-card.vercel.app/wait.html?w=1&c=123456');
  const t2 = noticeText(createState(), { ...c, time: '' }, 'https://x/wait.html?w=1&c=1');
  assert.ok(t2.startsWith('[헤어원네스트] 11/12(목) 열펌 매직 자리가 났어요. 네이버 예약에서 지금 잡으세요'), '시각이 없으면 날짜만, 예약 주소가 없으면 주소 없이');
  assert.ok(!t2.includes('https://booking'));
  const ct = waitConfirmText(s, w.wait, 2, 'https://x/wait.html?w=1&c=123456');
  assert.equal(ct, '[헤어원네스트] 대기 접수: 열펌 매직, 11월 평일·주말 오후·5시 이후. 같은 조건 대기 2번째. 자리가 나면 줄 앞 3분께 한꺼번에 문자를 드려요 (예약은 네이버 선착순).\n바꾸기·빼기: https://x/wait.html?w=1&c=123456');
  assert.equal(clockLabel('14:00'), '오후 2시'); assert.equal(clockLabel('11:30'), '오전 11시 30분'); assert.equal(clockLabel('12:00'), '낮 12시'); assert.equal(clockLabel(''), '');
  assert.equal(setBookingUrl(s, '  ').settings.bookingUrl, '', '비우면 빈 글');
  assert.equal(maskPhone('01099990001'), '010-****-0001');
});

test('백업·옛 백업 — waitlist가 남고, 없으면 빈 목록. 이상한 줄은 버린다. 예시 손님에 대기 두 건', () => {
  const s = addWait(createState(), base, NOW).state;
  assert.deepEqual(deserialize(serialize(s)).waitlist, s.waitlist);
  assert.deepEqual(deserialize(JSON.stringify({ ...s, waitlist: undefined })).waitlist, []);
  const bad = deserialize(JSON.stringify({ ...s, waitlist: [...s.waitlist, { id: 2 }, { id: 3, name: 'x', phone: '0101', service: '커트', dateFrom: '2026-10-20', dateTo: '2026-10-21', status: '??', windows: 'pm' }] }));
  assert.deepEqual(bad.waitlist.map(w => [w.id, w.status, w.windows, w.days]), [[1, 'waiting', ['pm', 'eve'], ['weekday', 'weekend']], [3, 'waiting', ['am', 'pm', 'eve'], ['weekday', 'weekend']]], '상태 모르면 waiting, 시간대 모양이 틀리면 전부, 10-23 전 대기는 평일·주말 둘 다');
  // 표에는 요일을 windows 열에 함께 싣는다(SQL 다시 안 돌리게). 읽을 때 가른다
  const w = addWait(createState(), { ...base, days: ['weekend'], windows: ['am'] }, NOW).wait;
  assert.deepEqual(waitWindowsCol(w), ['am', 'weekend']);
  const back = deserialize(JSON.stringify({ ...createState(), waitlist: [{ ...w, days: undefined, windows: waitWindowsCol(w) }] })).waitlist[0];
  assert.deepEqual([back.windows, back.days], [['am'], ['weekend']]);
  const sample = sampleState(TODAY, NOW);
  assert.equal(sample.waitlist.length, 2);
  assert.ok(sample.waitlist.every(w => w.name.includes('예시')));
});
