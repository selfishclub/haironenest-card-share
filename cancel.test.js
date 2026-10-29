// 예약 취소 기록과 시술 시간표 규칙 테스트 (V4 첫 걸음, 10-11).
// 열흘 동안 "취소가 나면 그 자리가 채워지는지"를 세기 위한 것. 원장은 말하듯 한 줄 적고, 카드가 네 가지(언제·시술·며칠 전·채워짐)를 읽는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, DEFAULT_SERVICES, serviceList, setServices, serviceMinutes, parseCancelText, addCancel, editCancel, setCancelFilled, deleteCancel, cancelList, cancelSummary, deserialize, serialize, sampleState } = require('./store.js');

const NOW = '2026-10-11T18:00:00';
const TODAY = '2026-10-11';

// ---- 시술 시간표 ----
test('serviceList — 설정이 없으면 원장이 10-11에 준 기본 시간표', () => {
  const s = createState();
  assert.deepEqual(serviceList(s), DEFAULT_SERVICES);
  assert.deepEqual(DEFAULT_SERVICES.map(x => [x.name, x.minutes]), [['커트', 60], ['일반 콜드펌', 120], ['열펌 매직', 180], ['매직세팅', 240], ['클리닉', 60], ['뿌리염색', 90], ['전체 염색', 120]]);
  assert.equal(serviceMinutes(s, '열펌 매직'), 180);
  assert.equal(serviceMinutes(s, '없는 시술'), null);
});

test('setServices — 이름·분을 바꿔 저장한다. 빈 이름·0분·같은 이름은 막고, 순서는 적은 대로', () => {
  const s = createState();
  const next = setServices(s, [{ name: ' 커트 ', minutes: '45' }, { name: '열펌', minutes: 200 }]);
  assert.deepEqual(serviceList(next), [{ name: '커트', minutes: 45 }, { name: '열펌', minutes: 200 }]);
  assert.deepEqual(serviceList(s), DEFAULT_SERVICES, '원래 상태는 안 바뀐다');
  assert.throws(() => setServices(s, [{ name: '', minutes: 60 }]), /이름/);
  assert.throws(() => setServices(s, [{ name: '커트', minutes: 0 }]), /분/);
  assert.throws(() => setServices(s, [{ name: '커트', minutes: 60 }, { name: '커 트', minutes: 90 }]), /같은 이름/);
  assert.throws(() => setServices(s, []), /하나는/);
  const back = deserialize(serialize(next));
  assert.deepEqual(serviceList(back), serviceList(next), '백업을 거쳐도 남는다');
  assert.deepEqual(serviceList(deserialize(JSON.stringify({ ...s, settings: { ...s.settings, serviceTimes: [{ name: 'x', minutes: -1 }, 'bad'] } }))), DEFAULT_SERVICES, '망가진 시간표는 기본값으로');
});

// ---- 말하듯 적은 취소 한 줄 읽기 ----
test('parseCancelText — "10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐"을 네 가지로 읽는다', () => {
  const r = parseCancelText('10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐', createState(), TODAY);
  assert.deepEqual(r, { date: '2026-10-15', time: '14:00', service: '열펌 매직', minutes: 180, daysBefore: 3, filled: 'yes', filledIn: '다음 날' });
});

test('parseCancelText — 날짜 꼴: 10/15, 15일(이번 달), 오늘·내일·모레·어제. 12월에 "1월 3일"은 다음 해', () => {
  const s = createState();
  assert.equal(parseCancelText('10/15 커트', s, TODAY).date, '2026-10-15');
  assert.equal(parseCancelText('15일 커트', s, TODAY).date, '2026-10-15');
  assert.equal(parseCancelText('오늘 커트 당일 취소', s, TODAY).date, TODAY);
  assert.equal(parseCancelText('내일 커트', s, TODAY).date, '2026-10-12');
  assert.equal(parseCancelText('모레 펌', s, TODAY).date, '2026-10-13');
  assert.equal(parseCancelText('어제 커트', s, TODAY).date, '2026-10-10');
  assert.equal(parseCancelText('1월 3일 커트', s, '2026-12-20').date, '2027-01-03');
  assert.equal(parseCancelText('커트 3일 전 취소', s, TODAY).date, null, '날짜 없으면 null. "3일 전"의 3일을 날짜로 읽지 않는다');
});

test('parseCancelText — 시간 꼴: 2시, 오후 2시, 14시, 2시 반, 2시 30분, 오전 11시. 없으면 빈 글', () => {
  const s = createState();
  const t = (x) => parseCancelText(x, s, TODAY).time;
  assert.equal(t('15일 2시 커트'), '14:00', '1~7시는 영업시간상 오후');
  assert.equal(t('15일 오후 2시 커트'), '14:00');
  assert.equal(t('15일 14시 커트'), '14:00');
  assert.equal(t('15일 2시 반 커트'), '14:30');
  assert.equal(t('15일 2시 30분 커트'), '14:30');
  assert.equal(t('15일 오전 11시 커트'), '11:00');
  assert.equal(t('15일 10시 커트'), '10:00');
  assert.equal(t('15일 커트'), '');
});

test('parseCancelText — 시술은 시간표 이름과 줄임말(콜드펌·열펌·매직·세팅·뿌리·전체염색·클리닉·커트)로 찾고, 긴 이름이 이긴다', () => {
  const s = createState();
  const sv = (x) => { const r = parseCancelText(x, s, TODAY); return [r.service, r.minutes]; };
  assert.deepEqual(sv('15일 커트'), ['커트', 60]);
  assert.deepEqual(sv('15일 콜드펌'), ['일반 콜드펌', 120]);
  assert.deepEqual(sv('15일 매직 세팅'), ['매직세팅', 240], '띄어쓰기 무시');
  assert.deepEqual(sv('15일 매직'), ['열펌 매직', 180]);
  assert.deepEqual(sv('15일 뿌리'), ['뿌리염색', 90]);
  assert.deepEqual(sv('15일 전체 염색'), ['전체 염색', 120]);
  assert.deepEqual(sv('15일 클리닉'), ['클리닉', 60]);
  assert.deepEqual(sv('15일 펌'), ['', null], '"펌"만으로는 어느 펌인지 몰라 짐작하지 않는다');
  const mine = setServices(s, [{ name: '디지털펌', minutes: 150 }]);
  assert.deepEqual(parseCancelText('15일 디지털펌', mine, TODAY).service, '디지털펌', '원장이 바꾼 시간표의 이름도 찾는다');
});

test('parseCancelText — 며칠 전: 3일 전, 사흘 전, 전날·하루 전, 당일, 일주일 전, 2주 전. 없으면 null', () => {
  const s = createState();
  const d = (x) => parseCancelText(x, s, TODAY).daysBefore;
  assert.equal(d('15일 커트 3일 전 취소'), 3);
  assert.equal(d('15일 커트 사흘 전'), 3);
  assert.equal(d('15일 커트 이틀 전'), 2);
  assert.equal(d('15일 커트 전날 취소'), 1);
  assert.equal(d('15일 커트 하루 전'), 1);
  assert.equal(d('15일 커트 당일 취소'), 0);
  assert.equal(d('15일 커트 일주일 전'), 7);
  assert.equal(d('15일 커트 2주 전'), 14);
  assert.equal(d('15일 커트 한 달 전'), 30);
  assert.equal(d('15일 커트'), null);
});

test('parseCancelText — 채워졌나: 채워짐·채움·찼다·잡힘·들어옴은 yes, 비었음·빈·안 채워짐·못 채움·아무도는 no, 모르면 unknown. 얼마 만에도 읽는다', () => {
  const s = createState();
  const f = (x) => { const r = parseCancelText(x, s, TODAY); return [r.filled, r.filledIn]; };
  assert.deepEqual(f('15일 커트 다음 날 채워짐'), ['yes', '다음 날']);
  assert.deepEqual(f('15일 커트 바로 채웠어'), ['yes', '바로']);
  assert.deepEqual(f('15일 커트 한 시간 만에 찼다'), ['yes', '한 시간 만에']);
  assert.deepEqual(f('15일 커트 2시간 뒤에 다른 손님이 잡았어'), ['yes', '2시간 뒤']);
  assert.deepEqual(f('15일 커트 당일에 들어옴'), ['yes', '당일']);
  assert.deepEqual(f('15일 커트 아직 비어 있음'), ['no', '']);
  assert.deepEqual(f('15일 커트 안 채워짐'), ['no', ''], '"안 채워짐"은 채워짐이 아니다');
  assert.deepEqual(f('15일 커트 못 채웠어'), ['no', '']);
  assert.deepEqual(f('15일 커트 아무도 안 잡음'), ['no', '']);
  assert.deepEqual(f('15일 커트 3일 전 취소'), ['unknown', '']);
});

// ---- 기록 ----
test('addCancel — 읽은 것을 한 줄로 남긴다. 원글은 note에 그대로. 날짜 없으면 막는다', () => {
  const s0 = createState();
  const r = addCancel(s0, { text: '10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐' }, NOW, TODAY);
  assert.deepEqual(r.cancel, { id: 1, date: '2026-10-15', time: '14:00', service: '열펌 매직', minutes: 180, daysBefore: 3, filled: 'yes', filledIn: '다음 날', note: '10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐', at: NOW });
  assert.equal(r.state.nextId, 2);
  assert.equal(s0.cancels.length, 0, '원래 상태는 안 바뀐다');
  assert.throws(() => addCancel(s0, { text: '커트 3일 전 취소' }, NOW, TODAY), /날짜/);
  assert.throws(() => addCancel(s0, { text: '   ' }, NOW, TODAY), /적으세요/);
  // 읽은 값을 원장이 고쳐서 넘기면 그 값이 이긴다
  const fixed = addCancel(s0, { text: '15일 펌', filled: 'no', service: '일반 콜드펌', daysBefore: 1 }, NOW, TODAY).cancel;
  assert.equal(fixed.service, '일반 콜드펌'); assert.equal(fixed.minutes, 120); assert.equal(fixed.filled, 'no'); assert.equal(fixed.daysBefore, 1);
});

test('setCancelFilled·editCancel·deleteCancel — 나중에 채워졌는지 바꾸고, 글을 고치고, 지운다(바로 지움)', () => {
  let s = addCancel(createState(), { text: '15일 커트 3일 전 취소' }, NOW, TODAY).state;
  assert.equal(s.cancels[0].filled, 'unknown');
  s = setCancelFilled(s, 1, 'yes', '다음 날');
  assert.deepEqual([s.cancels[0].filled, s.cancels[0].filledIn], ['yes', '다음 날']);
  s = setCancelFilled(s, 1, 'no');
  assert.deepEqual([s.cancels[0].filled, s.cancels[0].filledIn], ['no', '']);
  assert.throws(() => setCancelFilled(s, 1, 'maybe'), /채워짐/);
  s = editCancel(s, 1, { text: '16일 오후 3시 커트, 전날 취소, 비었음' }, TODAY).state;
  assert.deepEqual([s.cancels[0].date, s.cancels[0].time, s.cancels[0].daysBefore, s.cancels[0].filled, s.cancels[0].note], ['2026-10-16', '15:00', 1, 'no', '16일 오후 3시 커트, 전날 취소, 비었음']);
  assert.throws(() => editCancel(s, 99, { text: '16일 커트' }, TODAY), /없는/);
  s = deleteCancel(s, 1);
  assert.equal(s.cancels.length, 0);
});

test('cancelList·cancelSummary — 예약 날짜 늦은 것부터. 기간 안 취소 수·채워짐·비었음·모름을 센다', () => {
  let s = createState();
  const add = (text, at) => { s = addCancel(s, { text }, at, at.slice(0, 10)).state; };
  add('10월 3일 커트 전날 취소 바로 채워짐', '2026-10-03T09:00:00');
  add('10월 15일 열펌 3일 전 취소 비었음', '2026-10-12T09:00:00');
  add('10월 9일 뿌리 당일 취소', '2026-10-09T09:00:00');
  add('9월 28일 커트 이틀 전 취소 채워짐', '2026-09-26T09:00:00');
  assert.deepEqual(cancelList(s).map(c => c.date), ['2026-10-15', '2026-10-09', '2026-10-03', '2026-09-28']);
  assert.deepEqual(cancelSummary(s, '2026-10-01', '2026-10-31'), { total: 3, filled: 1, empty: 1, unknown: 1 }, '적은 날(at) 기준으로 기간을 본다');
  assert.deepEqual(cancelSummary(s, '2026-10-11', '2026-10-21'), { total: 1, filled: 0, empty: 1, unknown: 0 });
  assert.deepEqual(cancelSummary(s), { total: 4, filled: 2, empty: 1, unknown: 1 }, '기간 없으면 전부');
});

test('백업을 거쳐도 취소 기록은 남고, 모양이 안 맞는 줄은 버린다. 옛 백업(cancels 없음)도 열린다', () => {
  const s = addCancel(createState(), { text: '15일 커트 3일 전 취소' }, NOW, TODAY).state;
  const back = deserialize(serialize(s));
  assert.deepEqual(back.cancels, s.cancels);
  const old = deserialize(JSON.stringify({ ...s, cancels: undefined }));
  assert.deepEqual(old.cancels, []);
  const bad = deserialize(JSON.stringify({ ...s, cancels: [...s.cancels, { id: 'x' }, { id: 5, date: '2026-13-40' }, { id: 6, date: '2026-10-20', filled: 'what' }] }));
  assert.deepEqual(bad.cancels.map(c => [c.id, c.filled]), [[1, 'unknown'], [6, 'unknown']], '이상한 채워짐 값은 모름으로, 날짜 없는 줄은 버림');
});

test('sampleState — 예시 손님에 취소 기록 두 건이 들어 있어 시험 모드에서 바로 보인다', () => {
  const s = sampleState(TODAY, NOW);
  assert.equal(s.cancels.length, 2);
  assert.ok(s.cancels.every(c => c.note.includes('예시')));
});
