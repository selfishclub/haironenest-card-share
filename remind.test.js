// 전날 예약 알림톡(10-21 원장: 발송킹, 전날 오후 6시). 규칙만 본다 — 누구에게 무슨 값으로 가는지. 보내기는 api.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, addCustomer, markToday, deleteCustomer, reminderList, reminderText, REMIND_TEMPLATE, REMIND_SMS_TEMPLATE, timeKo, setRemindOff, serialize, deserialize } = require('./store.js');

function seeded() {
  let s = createState(), a, b, c, d;
  ({ state: s, customer: a } = addCustomer(s, { name: '고객 A', phone: '010-1111-2222' }));
  ({ state: s, customer: b } = addCustomer(s, { name: '고객 B', phone: '' }));
  ({ state: s, customer: c } = addCustomer(s, { name: '고객 C', phone: '01033334444' }));
  ({ state: s, customer: d } = addCustomer(s, { name: '고객 D', phone: '01055556666' }));
  ({ state: s } = markToday(s, a.id, '2026-10-22', '14:30', '커트', '2026-10-21'));
  ({ state: s } = markToday(s, b.id, '2026-10-22', '11:00', '', '2026-10-21'));
  ({ state: s } = markToday(s, c.id, '2026-10-22', '', '', '2026-10-21'));
  ({ state: s } = markToday(s, d.id, '2026-10-22', '10:00', '', '2026-10-21'));
  return { s, a, b, c, d };
}

test('reminderList — 그날 명단에서 번호와 시간이 있는 손님에게만, 시간순으로. 못 보내는 사람은 이유와 함께', () => {
  const { s, a, b, c, d } = seeded();
  const r = reminderList(s, '2026-10-22');
  assert.deepEqual(r.send.map((x) => [x.customerId, x.phone]), [[d.id, '01055556666'], [a.id, '01011112222']], '10시 고객 D, 14시 30분 고객 A');
  assert.deepEqual(r.send[1].vars, { '#{이름}': '고객 A', '#{날짜}': '10월 22일(목)', '#{시간}': '오후 2시 30분', '#{시술}': '커트' });
  assert.equal(r.send[0].vars['#{시술}'], '예약하신 시술', '시술을 안 고르면 빈칸 대신');
  assert.deepEqual(r.skip.map((x) => [x.customerId, x.reason]), [[b.id, '번호 없음'], [c.id, '시간 없음']]);
  assert.deepEqual(reminderList(s, '2026-10-23'), { send: [], skip: [] });
  // 지운 고객은 빠진다
  const gone = deleteCustomer(s, a.id, '2026-10-21T12:00:00').state;
  assert.deepEqual(reminderList(gone, '2026-10-22').send.map((x) => x.customerId), [d.id]);
});

test('timeKo — 오전·오후 말로', () => {
  assert.equal(timeKo('10:00'), '오전 10시');
  assert.equal(timeKo('12:00'), '오후 12시');
  assert.equal(timeKo('12:30'), '오후 12시 30분');
  assert.equal(timeKo('19:30'), '오후 7시 30분');
});

test('reminderText — 발송킹에 등록한 문구에 값을 채운 글 (미리 보기·문자 전환과 같은 글)', () => {
  const { s } = seeded();
  const t = reminderText(reminderList(s, '2026-10-22').send[1].vars);
  assert.match(t, /^\[헤어원네스트\] 예약 안내/);
  assert.match(t, /고객 A님, 내일 예약을 알려드립니다\./);
  assert.match(t, /■ 일시: 10월 22일\(목\) 오후 2시 30분/);
  assert.match(t, /■ 시술: 커트/);
  assert.ok(!/#\{/.test(t), '채우지 못한 변수가 없다');
  assert.ok(REMIND_TEMPLATE.includes('#{이름}') && REMIND_TEMPLATE.includes('#{시술}'));
});

test('setRemindOff — 쉬는 동안 끄기, 백업에도 남는다', () => {
  const { s } = seeded();
  const off = setRemindOff(s, true);
  assert.equal(off.settings.remindOff, true);
  assert.equal(deserialize(serialize(off)).settings.remindOff, true);
  assert.equal(setRemindOff(off, false).settings.remindOff, undefined);
});

test('승인된 문구 그대로 — 끝의 (아잉)까지 (10-22 원장 승인본). 문자로 갈 때는 (아잉)을 뺀 글', () => {
  assert.equal(REMIND_TEMPLATE, '[헤어원네스트] 예약 안내\n\n#{이름}님, 내일 예약을 알려드립니다.\n\n■ 일시: #{날짜} #{시간}\n■ 시술: #{시술}\n\n변경이나 취소가 필요하시면 이 채널로 미리 말씀해 주세요.(아잉)');
  assert.ok(!REMIND_SMS_TEMPLATE.includes('(아잉)'), '문자에서는 이모티콘이 글자로 보이니 뺀다');
  assert.ok(REMIND_SMS_TEMPLATE.endsWith('미리 말씀해 주세요.'));
});

test('가족 알림톡 (10-24 원장 1번): 번호 있는 사람은 늘 자기 알림, 번호 없는 가족만 대표에게 — 대표와 같은 시간이면 대표 한 통에 같이', () => {
  const { joinFamily, setFamilyRep, unmarkToday } = require('./store.js');
  let s = createState(), mom, dad, kid, solo;
  ({ state: s, customer: mom } = addCustomer(s, { name: '예시 엄마', phone: '01011110001' }));
  ({ state: s, customer: dad } = addCustomer(s, { name: '예시 아빠', phone: '01011110002' }));
  ({ state: s, customer: kid } = addCustomer(s, { name: '예시 딸', phone: '' }));
  ({ state: s, customer: solo } = addCustomer(s, { name: '고객 S', phone: '01099990000' }));
  ({ state: s } = joinFamily(s, dad.id, mom.id));   // 엄마가 대표(먼저 있던 사람 번호)
  ({ state: s } = joinFamily(s, kid.id, mom.id));
  ({ state: s } = markToday(s, mom.id, '2026-10-25', '14:00', '뿌리염색', '2026-10-24'));
  ({ state: s } = markToday(s, kid.id, '2026-10-25', '14:00', '커트', '2026-10-24'));
  ({ state: s } = markToday(s, dad.id, '2026-10-25', '16:00', '커트', '2026-10-24'));
  ({ state: s } = markToday(s, solo.id, '2026-10-25', '10:00', '', '2026-10-24'));
  let r = reminderList(s, '2026-10-25');
  assert.deepEqual(r.send.map((x) => [x.name, x.at, x.vars['#{시술}']]), [['고객 S', '10:00', '예약하신 시술'], ['예시 엄마', '14:00', '가족 2명 (뿌리염색·커트)'], ['예시 아빠', '16:00', '커트']],
    '따로 오는 아빠는 자기 알림, 번호 없는 딸은 같은 시간에 오는 대표(엄마) 한 통에');
  assert.deepEqual(r.send[1].family.map((x) => x.name), ['예시 엄마', '예시 딸']);
  assert.equal(r.send[2].family, undefined, '혼자 받는 알림에는 가족 목록이 없다');
  assert.deepEqual(r.skip, []);
  // 대표를 아빠로 바꾸면: 딸(14시)은 아빠 번호로 따로 한 통, 엄마는 자기 알림
  s = setFamilyRep(s, dad.id);
  r = reminderList(s, '2026-10-25');
  assert.deepEqual(r.send.map((x) => [x.name, x.phone, x.at, x.vars['#{시술}']]), [['고객 S', '01099990000', '10:00', '예약하신 시술'], ['예시 엄마', '01011110001', '14:00', '뿌리염색'], ['예시 아빠', '01011110002', '14:00', '예시 딸 커트'], ['예시 아빠', '01011110002', '16:00', '커트']]);
  // 대표(아빠)가 그날 안 와도 딸 알림은 대표에게
  ({ state: s } = unmarkToday(s, dad.id, '2026-10-25'));
  r = reminderList(s, '2026-10-25');
  assert.deepEqual(r.send.filter((x) => x.name === '예시 아빠').map((x) => [x.at, x.vars['#{시술}']]), [['14:00', '예시 딸 커트']]);
  // 가족이 아닌 번호 없는 손님은 그대로 "번호 없음"
  let t = createState(), n;
  ({ state: t, customer: n } = addCustomer(t, { name: '고객 N', phone: '' }));
  ({ state: t } = markToday(t, n.id, '2026-10-25', '11:00', '', '2026-10-24'));
  assert.deepEqual(reminderList(t, '2026-10-25').skip.map((x) => x.reason), ['번호 없음']);
});

test('remindStatusOf — 고객 카드에서 그 예약의 알림톡이 갔는지 (10-26 원장): 보낼 예정·보냄·실패→문자·안 감·멈춤', () => {
  const { remindStatusOf, joinFamily, setRemindOff: off } = require('./store.js');
  let s = createState(), mom, kid, late;
  ({ state: s, customer: mom } = addCustomer(s, { name: '예시 엄마', phone: '010-1111-0001' }));
  ({ state: s, customer: kid } = addCustomer(s, { name: '예시 딸', phone: '' }));
  ({ state: s, customer: late } = addCustomer(s, { name: '고객 L', phone: '01022220002' }));
  ({ state: s } = joinFamily(s, kid.id, mom.id));
  ({ state: s } = markToday(s, mom.id, '2026-10-27', '14:00', '커트', '2026-10-26'));
  ({ state: s } = markToday(s, kid.id, '2026-10-27', '15:00', '커트', '2026-10-26'));
  ({ state: s } = markToday(s, late.id, '2026-10-27', '11:00', '', '2026-10-26'));
  const NOW = '2026-10-26T15:00:00';
  // 발송 전(내일 예약, 아직 발송킹 기록 없음)
  assert.deepEqual(remindStatusOf(s, mom.id, '2026-10-27', null, NOW), { state: 'pending', text: '오늘 오후 6시에 보낼 예정' });
  assert.deepEqual(remindStatusOf(s, kid.id, '2026-10-27', null, NOW), { state: 'pending', text: '오늘 오후 6시에 보낼 예정 · 예시 엄마님 번호로' });
  assert.equal(remindStatusOf(s, mom.id, '2026-10-28', null, NOW), null, '그날 예약이 없으면 null');
  // 발송킹 기록: 엄마 성공, 딸 몫(엄마 번호 · 오후 3시) 카톡 실패→문자 성공. 고객 L은 기록에 없음(오후 5시 뒤에 올림)
  const report = { sendDate: '2026-10-26 18:00', list: [
    { phone: '01011110001', status: '성공', detail: '성공', mobile: '', text: '예시 엄마님, 내일 … 오후 2시 …' },
    { phone: '01011110001', status: '실패', detail: '카카오톡 미사용자', mobile: '성공', text: '예시 엄마님, 내일 … 오후 3시 …' },
  ] };
  assert.deepEqual(remindStatusOf(s, mom.id, '2026-10-27', report, NOW), { state: 'ok', text: '알림톡 보냄 · 성공 (2026-10-26 18:00)' });
  assert.deepEqual(remindStatusOf(s, kid.id, '2026-10-27', report, NOW), { state: 'ok', text: '카톡이 안 돼 문자로 보냄 · 성공 (2026-10-26 18:00) · 예시 엄마님 번호로' });
  assert.deepEqual(remindStatusOf(s, late.id, '2026-10-27', report, NOW), { state: 'warn', text: '이번 알림에 안 들어감 (보낸 뒤에 올린 예약) · 직접 연락하세요' });
  const failed = { sendDate: '2026-10-26 18:00', list: [{ phone: '01011110001', status: '실패', detail: '번호 오류', mobile: '실패', text: '오후 2시' }] };
  assert.deepEqual(remindStatusOf(s, mom.id, '2026-10-27', failed, NOW), { state: 'bad', text: '알림톡 실패 · 번호 오류 · 직접 연락하세요' });
  const waiting = { sendDate: '2026-10-26 18:00', list: [{ phone: '01011110001', status: '대기', detail: '', mobile: '', text: '오후 2시' }] };
  assert.deepEqual(remindStatusOf(s, mom.id, '2026-10-27', waiting, NOW), { state: 'pending', text: '발송 맡김 · 2026-10-26 18:00에 나감' });
  // 번호도 대표도 없는 손님, 멈춤
  let t = createState(), n;
  ({ state: t, customer: n } = addCustomer(t, { name: '고객 N', phone: '' }));
  ({ state: t } = markToday(t, n.id, '2026-10-27', '11:00', '', '2026-10-26'));
  assert.deepEqual(remindStatusOf(t, n.id, '2026-10-27', null, NOW), { state: 'bad', text: '알림톡 안 감 · 번호 없음' });
  assert.deepEqual(remindStatusOf(off(s, true), mom.id, '2026-10-27', null, NOW), { state: 'warn', text: '알림 멈춤 중이라 안 감' });
  // 오늘 예약인데 어제 보낸 기록이 없으면
  assert.deepEqual(remindStatusOf(s, mom.id, '2026-10-27', null, '2026-10-27T09:00:00'), { state: 'warn', text: '보낸 기록 없음' });
  // 모레 이후
  assert.deepEqual(remindStatusOf(s, mom.id, '2026-10-27', null, '2026-10-25T09:00:00'), { state: 'pending', text: '전날(10월 26일) 오후 6시에 보냄' });
});

test('remindReport — 그날 예약 손님마다 알림 결과 한 줄과 합계 (10-26 원장: 3명만 뜨고 실제로 갔는지 모르겠다)', () => {
  const { remindReport } = require('./store.js');
  let s = createState(), a, b, c;
  ({ state: s, customer: a } = addCustomer(s, { name: '고객 A', phone: '01011110001' }));
  ({ state: s, customer: b } = addCustomer(s, { name: '고객 B', phone: '01011110002' }));
  ({ state: s, customer: c } = addCustomer(s, { name: '고객 C', phone: '' }));
  for (const [id, at] of [[a.id, '10:00'], [b.id, '14:00'], [c.id, '15:00']]) ({ state: s } = markToday(s, id, '2026-10-27', at, '', '2026-10-26'));
  const report = { sendDate: '2026-10-26 18:00', list: [
    { phone: '01011110001', status: '성공', text: '오전 10시' },
    { phone: '01011110002', status: '실패', detail: '카카오톡 미사용', mobile: '성공', text: '오후 2시' },
  ] };
  const r = remindReport(s, '2026-10-27', report, '2026-10-26T19:00:00');
  assert.deepEqual(r.rows.map((x) => [x.customer.name, x.at, x.status.state]), [['고객 A', '10:00', 'ok'], ['고객 B', '14:00', 'ok'], ['고객 C', '15:00', 'bad']]);
  assert.deepEqual(r.count, { ok: 2, bad: 1, pending: 0, warn: 0 });
  assert.equal(r.sent, true, '발송킹에 그날 발송 기록이 있다');
  const before = remindReport(s, '2026-10-27', null, '2026-10-26T15:00:00');
  assert.deepEqual([before.sent, before.count.pending, before.count.bad], [false, 2, 1]);
  const missed = remindReport(s, '2026-10-27', null, '2026-10-26T19:00:00');
  assert.equal(missed.overdue, true, '오후 6시가 지났는데 발송 기록이 없으면 알려 준다');
  assert.equal(remindReport(s, '2026-10-28', null, '2026-10-26T19:00:00').rows.length, 0);
});
