const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, cleanDate, noteLines, noteOutline, noteInline, noteNumbered, noteLabel, noteTidy, NOTE_LABELS, timeSlots, formatWon, comma, buildNotice, noticeRemain, noticeUsed, setSettings, rememberProduct, findProduct, cleanAmount, chargePass, usePass, deletePass, passEntriesOf, passBalance, passSummary, visitsWithGaps, visitCycle, addCustomer, editCustomer, deleteCustomer, restoreCustomer, purgeCustomer, deletedCustomers, maskPhone, findCustomers, setProfile, addVisit, editVisit, deleteVisit, restoreVisit, purgeVisit, deletedVisitsOf, sweepDeletedVisits, daysLeftInTrash, visitsOf, markToday, setTodayTime, unmarkToday, todayList, pendingList, rollToday, setPhotoConsent, addPhoto, removePhoto, photosOf, PHOTO_LIMIT, splitSections, joinSections, SECTIONS, cycleSpan, cycleDue, recommendedCycle, familyOf, joinFamily, leaveFamily, totalPassBalance, serialize, deserialize } = require('./store.js');

test('이름과 전화번호로 고객을 만든다', () => {
  const s0 = createState();
  const { state, customer } = addCustomer(s0, { name: '김OO', phone: '01012341234' });
  assert.equal(customer.name, '김OO');
  assert.equal(customer.phone, '01012341234');
  assert.equal(state.customers.length, 1);
  assert.equal(s0.customers.length, 0, '원래 상태는 바뀌지 않는다');
});

test('이름이 비어 있으면 고객을 만들지 않는다', () => {
  assert.throws(() => addCustomer(createState(), { name: '  ', phone: '01012341234' }), /이름/);
});

test('이름 일부로 고객을 찾고, 없는 이름이면 빈 목록', () => {
  let { state } = addCustomer(createState(), { name: '김OO', phone: '01011111234' });
  ({ state } = addCustomer(state, { name: '김OO', phone: '01022225678' }));
  ({ state } = addCustomer(state, { name: '이OO', phone: '01033339999' }));
  assert.deepEqual(findCustomers(state, '김').map(c => c.phone.slice(-4)), ['1234', '5678']);
  assert.deepEqual(findCustomers(state, '5678').map(c => c.name), ['김OO'], '뒤 4자리로도 찾는다');
  assert.deepEqual(findCustomers(state, '박'), []);
});


test('저장했다가 꺼내면 같은 상태가 돌아온다', () => {
  const { state } = addCustomer(createState(), { name: '김OO', phone: '01012341234' });
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored, state);
});

test('저장된 것이 없거나 깨져 있으면 빈 상태로 시작한다', () => {
  assert.deepEqual(deserialize(null), createState());
  assert.deepEqual(deserialize(''), createState());
  assert.deepEqual(deserialize('{not json'), createState());
});

function twoCustomers() {
  let { state, customer: kim } = addCustomer(createState(), { name: '김OO', phone: '01011111234' });
  let lee;
  ({ state, customer: lee } = addCustomer(state, { name: '이OO', phone: '01022225678' }));
  return { state, kim, lee };
}

test('새 고객의 고정 정보 두 칸은 비어 있다', () => {
  const { kim } = twoCustomers();
  assert.deepEqual(kim.profile, { talk: '', hair: '' });
});

test('고정 정보를 적고, 고치면 이전 내용이 이력에 남는다', () => {
  let { state, kim } = twoCustomers();
  ({ state } = setProfile(state, kim.id, { talk: '아침에 5분밖에 못 씀', hair: '가는 모질' }, '2026-09-11T09:00:00'));
  ({ state } = setProfile(state, kim.id, { talk: '아침에 5분밖에 못 씀. 직장 옮김', hair: '가는 모질' }, '2026-09-12T09:00:00'));
  const c = state.customers.find(x => x.id === kim.id);
  assert.equal(c.profile.talk, '아침에 5분밖에 못 씀. 직장 옮김');
  assert.deepEqual(c.profileHistory, [{ talk: '아침에 5분밖에 못 씀', hair: '가는 모질', replacedAt: '2026-09-12T09:00:00' }]);
});

test('고정 정보를 처음 적을 때(빈 상태에서)는 이력을 남기지 않는다', () => {
  let { state, kim } = twoCustomers();
  ({ state } = setProfile(state, kim.id, { talk: 'a', hair: '' }, '2026-09-11T09:00:00'));
  assert.deepEqual(state.customers.find(x => x.id === kim.id).profileHistory, []);
});

test('방문 기록은 시술 내용이 필수이고 다음 방향은 비워도 된다', () => {
  let { state, kim } = twoCustomers();
  let visit;
  ({ state, visit } = addVisit(state, kim.id, { done: '탑 볼륨, 언더 무게 뺌', next: '' }, '2026-09-11T10:00:00'));
  assert.equal(visit.next, '');
  assert.throws(() => addVisit(state, kim.id, { done: ' ', next: '길이 유지' }, '2026-09-11T10:00:00'), /시술/);
});

test('방문 기록은 고객별로 최신순', () => {
  let { state, kim, lee } = twoCustomers();
  ({ state } = addVisit(state, kim.id, { done: '첫째', next: '' }, '2026-09-11T10:00:00'));
  ({ state } = addVisit(state, kim.id, { done: '둘째', next: '길이 유지' }, '2026-09-12T10:00:00'));
  ({ state } = addVisit(state, lee.id, { done: '단발', next: '' }, '2026-09-12T11:00:00'));
  assert.deepEqual(visitsOf(state, kim.id).map(v => v.done), ['둘째', '첫째']);
  assert.deepEqual(visitsOf(state, lee.id).map(v => v.done), ['단발']);
});

test('방문 기록을 고치면 이전 두 칸이 이력에 남는다', () => {
  let { state, kim } = twoCustomers();
  let visit;
  ({ state, visit } = addVisit(state, kim.id, { done: '탑 볼륨', next: '' }, '2026-09-11T10:00:00'));
  ({ state } = editVisit(state, visit.id, { done: '탑 볼륨, 언더 무게 뺌', next: '길이 유지' }, '2026-09-11T20:00:00'));
  const [v] = visitsOf(state, kim.id);
  assert.equal(v.done, '탑 볼륨, 언더 무게 뺌');
  assert.equal(v.next, '길이 유지');
  assert.deepEqual(v.history, [{ done: '탑 볼륨', next: '', replacedAt: '2026-09-11T20:00:00' }]);
});

test('못 적고 지나간 날 것은 그 날짜로 적는다 — 시각은 지금 것, 오늘 명단에는 안 센다', () => {
  let { state, kim } = twoCustomers();
  ({ state } = markToday(state, kim.id, '2026-09-20'));
  let visit;
  ({ state, visit } = addVisit(state, kim.id, { done: '지난 화요일 컷', next: '', date: '2026-09-15' }, '2026-09-20T17:42:00'));
  assert.equal(visit.createdAt, '2026-09-15T17:42:00');
  assert.equal(todayList(state, '2026-09-20')[0].recorded, false, '지난날 기록이니 오늘은 아직 안 적음');
  assert.equal(visitCycle(state, kim.id, '2026-09-20').sinceLast, 5, '주기는 그 날짜로 센다');
  ({ state, visit } = addVisit(state, kim.id, { done: '오늘 컷', next: '', date: '' }, '2026-09-20T18:00:00'));
  assert.equal(visit.createdAt, '2026-09-20T18:00:00', '날짜를 비우면 지금');
  ({ state, visit } = addVisit(state, kim.id, { done: '오늘 컷', next: '', date: '2026-09-20' }, '2026-09-20T18:10:00'));
  assert.equal(visit.createdAt, '2026-09-20T18:10:00', '오늘 날짜를 고르면 지금과 같다');
});

test('방문 기록 날짜를 옮기면 시각은 그대로, 이전 날짜가 이력에 남고, 오늘 명단은 [아직 안 적음]으로 돌아간다', () => {
  let { state, kim } = twoCustomers();
  ({ state } = markToday(state, kim.id, '2026-09-20'));
  let visit;
  ({ state, visit } = addVisit(state, kim.id, { done: '컷', next: '볼륨펌' }, '2026-09-20T10:00:00'));
  assert.equal(todayList(state, '2026-09-20')[0].recorded, true);
  ({ state, visit } = editVisit(state, visit.id, { done: '컷', next: '볼륨펌', date: '2026-09-15' }, '2026-09-20T11:00:00'));
  assert.equal(visit.createdAt, '2026-09-15T10:00:00', '날짜만 바뀌고 시각은 그대로');
  assert.deepEqual(visit.history, [{ done: '컷', next: '볼륨펌', replacedAt: '2026-09-20T11:00:00', createdAt: '2026-09-20T10:00:00' }]);
  assert.equal(todayList(state, '2026-09-20')[0].recorded, false);
  assert.equal(visitCycle(state, kim.id, '2026-09-20').sinceLast, 5);
  // 같은 날짜로 저장하거나 날짜를 비우면 안 옮긴 것: 이력에 날짜가 안 붙는다
  ({ state, visit } = editVisit(state, visit.id, { done: '컷 (레이어)', next: '볼륨펌', date: '2026-09-15' }, '2026-09-20T12:00:00'));
  assert.equal(visit.createdAt, '2026-09-15T10:00:00');
  assert.equal('createdAt' in visit.history[1], false);
  ({ state, visit } = editVisit(state, visit.id, { done: '컷 (레이어)', next: '' }, '2026-09-20T12:30:00'));
  assert.equal(visit.createdAt, '2026-09-15T10:00:00');
  // 옮긴 날짜대로 줄이 선다
  ({ state } = addVisit(state, kim.id, { done: '그 사이 방문' }, '2026-09-18T10:00:00'));
  assert.deepEqual(visitsOf(state, kim.id).map(v => v.done), ['그 사이 방문', '컷 (레이어)']);
});

test('오늘보다 뒤 날짜나 말이 안 되는 날짜에는 기록을 못 남긴다', () => {
  let { state, kim } = twoCustomers();
  const now = '2026-09-20T10:00:00';
  assert.throws(() => addVisit(state, kim.id, { done: '컷', date: '2026-09-21' }, now), /뒤 날짜/);
  assert.throws(() => addVisit(state, kim.id, { done: '컷', date: '2026-02-30' }, now), /날짜는/);
  assert.throws(() => addVisit(state, kim.id, { done: '컷', date: '20260915' }, now), /날짜는/);
  let visit;
  ({ state, visit } = addVisit(state, kim.id, { done: '컷' }, now));
  assert.throws(() => editVisit(state, visit.id, { done: '컷', date: '2026-09-21' }, now), /뒤 날짜/);
  assert.equal(state.visits[0].createdAt, now, '거절되면 아무것도 안 바뀐다');
});

test('noteLines — "/"로 끊어 적은 기록은 그 자리에서 나뉜다', () => {
  assert.deepEqual(noteLines('가슴윗기장 포워드레이어드 / 매직 후 / 파랑 한바퀴반 / 120도 5분 / C컬로 펴주고 중화'),
    ['가슴윗기장 포워드레이어드', '매직 후', '파랑 한바퀴반', '120도 5분', 'C컬로 펴주고 중화']);
  assert.deepEqual(noteLines('여성컷/앞머리 정돈'), ['여성컷', '앞머리 정돈'], '띄어쓰기 없이도');
  assert.deepEqual(noteLines('1/2바퀴 더 감음'), ['1/2바퀴 더 감음'], '숫자 사이 /는 분수라 안 나눈다');
});

test('noteLines — 말로 받아쓴 글은 문장 끝에서 나뉘고, 숫자 속 점은 안 건드린다', () => {
  const said = '가슴 윗기장 포워드 레이어드로 잘랐습니다. 매직 후에 파랑 롤로 한 바퀴 반 감았고 120도 5분 두었어요. 뿌리 쪽은 1.5바퀴 더 감음. C컬로 펴주고 중화했습니다. 옆 라인은 얼굴 따라 짧게 정돈했음.';
  assert.deepEqual(noteLines(said), [
    '가슴 윗기장 포워드 레이어드로 잘랐습니다',
    '매직 후에 파랑 롤로 한 바퀴 반 감았고 120도 5분 두었어요',
    '뿌리 쪽은 1.5바퀴 더 감음',
    'C컬로 펴주고 중화했습니다',
    '옆 라인은 얼굴 따라 짧게 정돈했음',
  ]);
  assert.deepEqual(noteLines('탑 볼륨 부족해서 언더에서 무게 뺌.다음엔 볼륨펌'), ['탑 볼륨 부족해서 언더에서 무게 뺌', '다음엔 볼륨펌'], '점 뒤에 띄어쓰기가 없어도');
  assert.deepEqual(noteLines('길이 유지, 볼륨펌 상담'), ['길이 유지, 볼륨펌 상담'], '쉼표에서는 안 나눈다');
});

test('noteLines — "~고," 뒤에 쉼표가 오면 거기서도 나뉜다. 쉼표만으로는 안 나눈다', () => {
  assert.deepEqual(noteLines('뒷머리는 상고로 라인 올려서 다듬었고, 다음번 복직하기 전에는 롤스트레이트를 권했어'),
    ['뒷머리는 상고로 라인 올려서 다듬었고', '다음번 복직하기 전에는 롤스트레이트를 권했어']);
  assert.deepEqual(noteLines('파랑 롤 한 바퀴 반 감고요, 120도 5분'), ['파랑 롤 한 바퀴 반 감고', '120도 5분'], '"고요,"도 (군말 요는 떨어진다)');
  assert.deepEqual(noteLines('파랑 롤 한 바퀴 반, 120도 5분'), ['파랑 롤 한 바퀴 반, 120도 5분']);
  assert.deepEqual(noteLines('C컬로 펴주고 중화'), ['C컬로 펴주고 중화'], '쉼표 없는 "~고 "는 그대로');
});

const STRUCTURED = [
  '오늘 시술 내용:',
  '1. 커트 및 형태',
  '• 길이를 살린 상태로 라인만 살짝 정돈',
  '• 관자놀이가 많이 가라앉은 편이라 볼륨이 관자놀이에 집중되도록 사이드뱅은 입술선에 맞춤',
  '2. 질감 처리',
  '• 라인이 날리지 않으면서도 머리가 가볍게 뜰 수 있도록 전체 슬라이싱 진행',
  '고객 반응 및 다음 시술 참고 사항:',
  '볼륨을 위해 오버존에 층을 내드렸는데 귀에 안 꽂히고 흘러내릴까 봐 조금 걱정하심',
  '다음번에는 사이드뱅을 입술선에 반드시 맞춰서 귀 뒤로 넘겨 꽂아질 수 있도록 진행할 것',
].join('\n');

test('noteOutline — 글에 제목·번호·• 표시가 이미 있으면 그 구조를 살리고 줄바꿈에서만 나눈다', () => {
  assert.deepEqual(noteOutline(STRUCTURED), [
    { kind: 'heading', level: 0, text: '오늘 시술 내용' },
    { kind: 'sub', level: 1, text: '1. 커트 및 형태' },
    { kind: 'item', level: 2, text: '길이를 살린 상태로 라인만 살짝 정돈' },
    { kind: 'item', level: 2, text: '관자놀이가 많이 가라앉은 편이라 볼륨이 관자놀이에 집중되도록 사이드뱅은 입술선에 맞춤' },
    { kind: 'sub', level: 1, text: '2. 질감 처리' },
    { kind: 'item', level: 2, text: '라인이 날리지 않으면서도 머리가 가볍게 뜰 수 있도록 전체 슬라이싱 진행' },
    { kind: 'heading', level: 0, text: '고객 반응 및 다음 시술 참고 사항' },
    { kind: 'item', level: 1, text: '볼륨을 위해 오버존에 층을 내드렸는데 귀에 안 꽂히고 흘러내릴까 봐 조금 걱정하심' },
    { kind: 'item', level: 1, text: '다음번에는 사이드뱅을 입술선에 반드시 맞춰서 귀 뒤로 넘겨 꽂아질 수 있도록 진행할 것' },
  ]);
  assert.deepEqual(noteLines(STRUCTURED).length, 5, '항목만 다섯 개, 제목은 빠진다');
  assert.equal(noteLines(STRUCTURED)[0], '길이를 살린 상태로 라인만 살짝 정돈', '• 표시는 떨어진다');
});

test('noteOutline — 표시 종류가 달라도, 제목 없이 •만 있어도 알아본다', () => {
  assert.deepEqual(noteOutline('- 여성컷\n* 앞머리 정돈\n· 드라이'), [
    { kind: 'item', level: 0, text: '여성컷' }, { kind: 'item', level: 0, text: '앞머리 정돈' }, { kind: 'item', level: 0, text: '드라이' },
  ]);
  assert.deepEqual(noteOutline('시술:\n여성컷. 앞머리 정돈'), [
    { kind: 'heading', level: 0, text: '시술' }, { kind: 'item', level: 1, text: '여성컷. 앞머리 정돈' },
  ], '구조가 있으면 문장 끝 점에서는 안 자른다');
});

test('noteOutline — 번호 줄은 뒤에 항목이 따라올 때만 작은 제목이다', () => {
  assert.deepEqual(noteOutline('시술:\n1. 여성컷\n2. 염색'), [
    { kind: 'heading', level: 0, text: '시술' }, { kind: 'item', level: 1, text: '1. 여성컷' }, { kind: 'item', level: 1, text: '2. 염색' },
  ], '번호 줄만 이어지면 항목');
  assert.deepEqual(noteOutline('1. 커트\n• 라인 정돈\n2. 펌\n• 뿌리 볼륨'), [
    { kind: 'sub', level: 0, text: '1. 커트' }, { kind: 'item', level: 1, text: '라인 정돈' },
    { kind: 'sub', level: 0, text: '2. 펌' }, { kind: 'item', level: 1, text: '뿌리 볼륨' },
  ], '제목 없이 번호 줄과 항목이면 번호 줄이 작은 제목');
});

const TYPELESS = ['예시 아이 머리 스타일 기록:', '', '1. 옆머리: 투블럭', '(a) 옆머리: 13mm', '(b) 구레나룻: 6mm', '2. 뒷머리: 6mm', '(a) 상고 스타일로 올려 치는 것을 선호함', '3. 앞머리: 집에서 잘라 온 앞머리 길이에 맞춰서 투블럭으로 다듬음', '', '• 특이사항: 다음번 머리할 때 펌 추천'].join('\n');

test('noteOutline — 받아쓰기 앱이 만든 번호·(a)(b) 구조: 쌍점 있는 번호 줄은 항목, 붙임 글자는 떼고 그 밑에, 빈 줄은 덩어리 경계', () => {
  assert.deepEqual(noteOutline(TYPELESS), [
    { kind: 'heading', level: 0, text: '예시 아이 머리 스타일 기록' },
    { kind: 'item', level: 1, text: '1. 옆머리: 투블럭' },
    { kind: 'item', level: 2, text: '옆머리: 13mm' },
    { kind: 'item', level: 2, text: '구레나룻: 6mm' },
    { kind: 'item', level: 1, text: '2. 뒷머리: 6mm' },
    { kind: 'item', level: 2, text: '상고 스타일로 올려 치는 것을 선호함' },
    { kind: 'item', level: 1, text: '3. 앞머리: 집에서 잘라 온 앞머리 길이에 맞춰서 투블럭으로 다듬음' },
    { kind: 'item', level: 1, text: '특이사항: 다음번 머리할 때 펌 추천' },
  ]);
  assert.deepEqual(noteOutline('1. 옆머리: 투블럭\n(a) 13mm\nb. 6mm\n가. 상고'), [
    { kind: 'item', level: 0, text: '1. 옆머리: 투블럭' }, { kind: 'item', level: 1, text: '13mm' }, { kind: 'item', level: 1, text: '6mm' }, { kind: 'item', level: 1, text: '상고' },
  ], '제목·표시가 없어도 (a) b. 가. 가 있으면 구조로 본다');
  assert.deepEqual(noteOutline('1. 옆머리: 투블럭\n• 13mm\n\n• 특이사항'), [
    { kind: 'item', level: 0, text: '1. 옆머리: 투블럭' }, { kind: 'item', level: 1, text: '13mm' }, { kind: 'item', level: 0, text: '특이사항' },
  ], '빈 줄 없이 이어진 •는 번호 항목 밑에, 빈 줄 뒤의 •는 제자리로');
  assert.deepEqual(noteOutline('1. 컷. 앞머리 정돈\n• 라인'), [
    { kind: 'sub', level: 0, text: '1. 컷. 앞머리 정돈' }, { kind: 'item', level: 1, text: '라인' },
  ], '"컷."처럼 한 글자 뒤 점은 붙임 글자가 아니다');
});

test('noteNumbered — 번호로 시작하는 조각은 점을 따로 찍지 않는다', () => {
  assert.equal(noteNumbered('1. 세미 투블럭'), true);
  assert.equal(noteNumbered('12) 앞머리 정돈'), true);
  assert.equal(noteNumbered('세미 투블럭'), false);
  assert.equal(noteNumbered('120도 5분'), false, '숫자로 시작해도 번호 표시가 아니면 아니다');
  assert.equal(noteNumbered('1.5바퀴'), false);
  assert.equal(noteNumbered(''), false);
  // 번호 줄만 이어진 글은 구조로 안 보고 줄마다 항목이 된다 (점 대신 번호가 표시 역할)
  assert.deepEqual(noteOutline('아기 둘째 태어나고 조리원에서 나옴\n1. 세미 투블럭\n2. 앞머리는 눈썹에 걸치게\n3. 옆머리가 뜨지 않도록').map(o => o.text),
    ['아기 둘째 태어나고 조리원에서 나옴', '1. 세미 투블럭', '2. 앞머리는 눈썹에 걸치게', '3. 옆머리가 뜨지 않도록']);
});

test('noteInline — 항목 안의 "짧은말: 내용"을 이름과 내용으로 나눈다', () => {
  assert.deepEqual(noteInline('옆머리: 13mm'), { key: '옆머리', text: '13mm' });
  assert.deepEqual(noteInline('1. 옆머리: 투블럭'), { key: '1. 옆머리', text: '투블럭' });
  assert.deepEqual(noteInline('특이사항 : 다음번 머리할 때 펌 추천'), { key: '특이사항', text: '다음번 머리할 때 펌 추천' });
  assert.deepEqual(noteInline('상고 스타일로 올려 치는 것을 선호함'), { key: null, text: '상고 스타일로 올려 치는 것을 선호함' });
  assert.deepEqual(noteInline('고객 반응 및 다음 시술 참고 사항: 볼륨'), { key: null, text: '고객 반응 및 다음 시술 참고 사항: 볼륨' }, '여덟 자를 넘으면 이름이 아니다');
  assert.deepEqual(noteInline('옆머리:'), { key: null, text: '옆머리:' }, '내용이 없으면 그대로');
});

test('noteOutline — [대괄호] 줄은 제목이고 점이 안 찍힌다', () => {
  assert.deepEqual(noteOutline('[고객 정보 및 모발 상태]\n• 예전에 머리가 타서 왔음\n• 평소 새치 염색을 월 1회 함'), [
    { kind: 'heading', level: 0, text: '고객 정보 및 모발 상태' }, { kind: 'item', level: 1, text: '예전에 머리가 타서 왔음' }, { kind: 'item', level: 1, text: '평소 새치 염색을 월 1회 함' },
  ]);
  assert.deepEqual(noteOutline('[시술]\n커트 라인 정리. 숱 조금\n펌 볼륨'), [
    { kind: 'heading', level: 0, text: '시술' }, { kind: 'item', level: 1, text: '커트 라인 정리. 숱 조금' }, { kind: 'item', level: 1, text: '펌 볼륨' },
  ], '대괄호 제목만 있어도 구조가 있는 글이라 문장 끝 점에서는 안 자른다');
  assert.deepEqual(noteLines('[시술]\n커트\n펌'), ['커트', '펌'], 'noteLines는 항목만');
});

test('noteOutline — "• 커트:"처럼 표시 뒤 쌍점으로 끝나는 줄은 작은 제목(점 없음, 표시도 뗀다)', () => {
  const t = '[오늘 시술 내용]\n• 커트:\n  • 사이드뱅: 코끝부터 시작\n  • 아래 기장: 라인만 정리\n• 펌 (볼륨매직):\n  • 언더존: 큰 J컬';
  assert.deepEqual(noteOutline(t), [
    { kind: 'heading', level: 0, text: '오늘 시술 내용' },
    { kind: 'sub', level: 1, text: '커트' }, { kind: 'item', level: 2, text: '사이드뱅: 코끝부터 시작' }, { kind: 'item', level: 2, text: '아래 기장: 라인만 정리' },
    { kind: 'sub', level: 1, text: '펌 (볼륨매직)' }, { kind: 'item', level: 2, text: '언더존: 큰 J컬' },
  ]);
  assert.deepEqual(noteOutline('• 커트:\n  • 사이드뱅: 코끝부터'), [
    { kind: 'sub', level: 0, text: '커트' }, { kind: 'item', level: 1, text: '사이드뱅: 코끝부터' },
  ], '제목 없이 시작해도');
});

test('noteOutline — 밑에 더 들여쓴 표시 줄을 거느린 표시 줄은 쌍점이 없어도 작은 제목이다', () => {
  assert.deepEqual(noteOutline('- 커트\n  - 사이드뱅: 코끝부터\n  - 아래 기장: 라인만\n- 펌\n  - 언더존: J컬'), [
    { kind: 'sub', level: 0, text: '커트' }, { kind: 'item', level: 1, text: '사이드뱅: 코끝부터' }, { kind: 'item', level: 1, text: '아래 기장: 라인만' },
    { kind: 'sub', level: 0, text: '펌' }, { kind: 'item', level: 1, text: '언더존: J컬' },
  ]);
  assert.deepEqual(noteOutline('- 커트\n  - 사이드뱅: 코끝부터\n- 드라이 없이 마무리'), [
    { kind: 'sub', level: 0, text: '커트' }, { kind: 'item', level: 1, text: '사이드뱅: 코끝부터' }, { kind: 'item', level: 0, text: '드라이 없이 마무리' },
  ], '들여쓰기가 돌아오면 작은 제목 밖으로 나온다');
  assert.deepEqual(noteOutline('- 여성컷\n- 앞머리 정돈\n- 드라이'), [
    { kind: 'item', level: 0, text: '여성컷' }, { kind: 'item', level: 0, text: '앞머리 정돈' }, { kind: 'item', level: 0, text: '드라이' },
  ], '거느린 줄이 없으면 그냥 항목');
});

test('noteOutline — 구조가 없는 글은 지금처럼 나눠 전부 항목이다', () => {
  assert.deepEqual(noteOutline('여성컷 / 앞머리 정돈했음. 다음엔 볼륨펌'), [
    { kind: 'item', level: 0, text: '여성컷' }, { kind: 'item', level: 0, text: '앞머리 정돈했음' }, { kind: 'item', level: 0, text: '다음엔 볼륨펌' },
  ]);
  assert.deepEqual(noteOutline('1. 여성컷\n2. 염색'), [{ kind: 'item', level: 0, text: '1. 여성컷' }, { kind: 'item', level: 0, text: '2. 염색' }], '번호만 있고 표시·제목이 없으면 구조로 안 본다');
  assert.deepEqual(noteOutline(''), []);
});

test('noteLabel — 조각 앞의 이름표(시술·고민·원인·다음…)를 알아본다', () => {
  assert.deepEqual(NOTE_LABELS, ['시술', '레시피', '고민', '원인', '진단', '다음', '요청', '상태', '주의']);
  assert.deepEqual(noteLabel('시술, 세미 투블럭, 전체 다듬기'), { label: '시술', text: '세미 투블럭, 전체 다듬기' });
  assert.deepEqual(noteLabel('다음: 복직 전 롤스트레이트 권함'), { label: '다음', text: '복직 전 롤스트레이트 권함' });
  assert.deepEqual(noteLabel('고민 가라앉음'), { label: '고민', text: '가라앉음' }, '띄어쓰기만 있어도');
  assert.deepEqual(noteLabel('원인 수영 후 덜 말려 꼬불거림'), { label: '원인', text: '수영 후 덜 말려 꼬불거림' });
  // 이름표가 아닌 것들
  assert.deepEqual(noteLabel('시술 후 두피 따가움'), { label: null, text: '시술 후 두피 따가움' }, '"시술 후"는 이름표가 아니다');
  assert.deepEqual(noteLabel('다음번 복직 전'), { label: null, text: '다음번 복직 전' });
  assert.deepEqual(noteLabel('다음에 볼륨펌 상담'), { label: null, text: '다음에 볼륨펌 상담' });
  assert.deepEqual(noteLabel('상태는 좋음'), { label: null, text: '상태는 좋음' });
  assert.deepEqual(noteLabel('원인'), { label: null, text: '원인' }, '내용이 없으면 이름표도 없다');
  assert.deepEqual(noteLabel('세미 투블럭'), { label: null, text: '세미 투블럭' });
});

test('noteTidy — 말하는 끝맺음을 차트 말투로 (보여줄 때만)', () => {
  const t = noteTidy;
  assert.equal(t('세미 투블럭 커트를 했고 전체적으로 머리를 좀 다듬었어'), '세미 투블럭 커트를 했고 전체적으로 머리를 좀 다듬었음');
  assert.equal(t('롤스트레이트를 권했어'), '롤스트레이트를 권했음');
  assert.equal(t('힘이 없어서 걱정하고 있어'), '힘이 없어서 걱정하고 있음');
  assert.equal(t('덜 말려서 생기는 현상인 듯해'), '덜 말려서 생기는 현상인 듯');
  assert.equal(t('생기는 것 같아요'), '생기는 듯');
  assert.equal(t('가슴 윗기장 포워드 레이어드로 잘랐습니다'), '가슴 윗기장 포워드 레이어드로 잘랐음');
  assert.equal(t('120도 5분 두었어요.'), '120도 5분 두었음', '끝의 점도 떼고');
  assert.equal(t('C컬로 펴주고 중화했습니다'), 'C컬로 펴주고 중화했음');
  assert.equal(t('볼륨펌을 권해'), '볼륨펌을 권함');
  assert.equal(t('볼륨펌을 권해요'), '볼륨펌을 권함');
  assert.equal(t('다듬었고'), '다듬었음', '"~고,"에서 잘린 조각');
  assert.equal(t('드라이하고'), '드라이함');
  assert.equal(t('감고요'), '감음');
  assert.equal(t('힘이 없네요'), '힘이 없음');
  assert.equal(t('권할 거예요'), '권할 것');
  assert.equal(t('수영 때문이에요'), '수영 때문임');
  assert.equal(t('양이 많아요'), '양이 많음');
  assert.equal(t('그렇게 됐어'), '그렇게 됐음');
  assert.equal(t('다음번에 파마하는 것을 권유했지'), '다음번에 파마하는 것을 권유했음', '"~했지"도');
  assert.equal(t('권유했지요'), '권유했음');
  assert.equal(t('두 가지'), '두 가지', '과거형이 아닌 "지"는 그대로');
  // 건드리면 안 되는 것
  assert.equal(t('C컬로 펴주고 중화'), 'C컬로 펴주고 중화');
  assert.equal(t('120도 5분'), '120도 5분');
  assert.equal(t('세미 투블럭'), '세미 투블럭');
  assert.equal(t('드라이 필요'), '드라이 필요', '"필요"의 요는 말투가 아니다');
  assert.equal(t('복직 전 롤스트레이트 권함'), '복직 전 롤스트레이트 권함');
  assert.equal(t('  앞머리만 정돈  '), '앞머리만 정돈');
  assert.equal(t(''), '');
});

test('noteLines — 줄바꿈에서도 나뉘고, 빈 조각은 버리고, 한 조각이면 그대로', () => {
  assert.deepEqual(noteLines('여성컷\n앞머리 정돈\n\n'), ['여성컷', '앞머리 정돈']);
  assert.deepEqual(noteLines('여성컷 / 앞머리 정돈했음. 다음엔 볼륨펌'), ['여성컷', '앞머리 정돈했음', '다음엔 볼륨펌'], '규칙이 섞여도');
  assert.deepEqual(noteLines('탑 볼륨 부족해서 언더에서 무게 뺌'), ['탑 볼륨 부족해서 언더에서 무게 뺌']);
  assert.deepEqual(noteLines(''), []);
  assert.deepEqual(noteLines(null), []);
});

// ---- 사진 ------------------------------------------------------------------
function withVisit() {
  let { state, kim, lee } = twoCustomers();
  let visit;
  ({ state, visit } = addVisit(state, kim.id, { done: '볼륨펌' }, '2026-09-29T14:00:00'));
  return { state, kim, lee, visit };
}

test('사진은 동의를 받은 고객의 방문 기록에만 붙는다', () => {
  let { state, kim, visit } = withVisit();
  assert.throws(() => addPhoto(state, visit.id, { w: 1600, h: 1200, bytes: 300000 }, '2026-09-29T14:05:00'), /사진 동의/);
  ({ state } = setPhotoConsent(state, kim.id, true, '2026-09-29'));
  assert.deepEqual(state.customers.find(c => c.id === kim.id).photoConsent, { at: '2026-09-29' });
  let photo;
  ({ state, photo } = addPhoto(state, visit.id, { w: 1600, h: 1200, bytes: 300000 }, '2026-09-29T14:05:00'));
  assert.equal(photo.path, `${kim.id}/${visit.id}/${photo.id}.jpg`, '파일 자리는 고객/방문/사진 번호');
  assert.equal(photo.customerId, kim.id); assert.equal(photo.visitId, visit.id);
  assert.deepEqual(photosOf(state, visit.id).map(p => p.id), [photo.id]);
  ({ state } = setPhotoConsent(state, kim.id, false));
  assert.equal(state.customers.find(c => c.id === kim.id).photoConsent, null);
  assert.throws(() => addPhoto(state, visit.id, { w: 1, h: 1, bytes: 1 }, '2026-09-29T14:06:00'), /사진 동의/, '동의를 거두면 다시 못 붙인다');
  assert.deepEqual(photosOf(state, visit.id).length, 1, '이미 붙은 사진은 그대로');
});

test('한 방문에 사진은 네 장까지, 지운 기록에는 못 붙인다', () => {
  let { state, kim, visit } = withVisit();
  ({ state } = setPhotoConsent(state, kim.id, true, '2026-09-29'));
  for (let i = 0; i < PHOTO_LIMIT; i++) ({ state } = addPhoto(state, visit.id, { w: 1, h: 1, bytes: 1 }, `2026-09-29T14:0${i}:00`));
  assert.equal(PHOTO_LIMIT, 4);
  assert.throws(() => addPhoto(state, visit.id, { w: 1, h: 1, bytes: 1 }, '2026-09-29T14:09:00'), /4장/);
  assert.deepEqual(photosOf(state, visit.id).map(p => p.createdAt.slice(14, 16)), ['00', '01', '02', '03'], '찍은 순서대로');
  ({ state } = deleteVisit(state, visit.id, '2026-09-29T15:00:00'));
  assert.throws(() => addPhoto(state, visit.id, { w: 1, h: 1, bytes: 1 }, '2026-09-29T15:01:00'), /지운 기록/);
  assert.throws(() => addPhoto(state, 999, { w: 1, h: 1, bytes: 1 }, '2026-09-29T15:01:00'), /찾을 수 없/);
});

test('사진은 한 장씩 지우고, 기록이나 고객을 완전히 지우면 함께 사라진다. 감추기만 하면 남는다', () => {
  let { state, kim, lee, visit } = withVisit();
  ({ state } = setPhotoConsent(state, kim.id, true, '2026-09-29'));
  let a, b;
  ({ state, photo: a } = addPhoto(state, visit.id, { w: 1, h: 1, bytes: 1 }, '2026-09-29T14:01:00'));
  ({ state, photo: b } = addPhoto(state, visit.id, { w: 1, h: 1, bytes: 1 }, '2026-09-29T14:02:00'));
  ({ state } = removePhoto(state, a.id));
  assert.deepEqual(photosOf(state, visit.id).map(p => p.id), [b.id]);
  assert.throws(() => removePhoto(state, a.id), /찾을 수 없/);
  // 고객 지우기(감추기)는 사진을 남긴다
  ({ state } = deleteCustomer(state, kim.id, '2026-09-29T15:00:00'));
  assert.equal(state.photos.length, 1);
  ({ state } = restoreCustomer(state, kim.id));
  // 기록을 완전히 지우면 그 기록의 사진만
  let visit2;
  ({ state, visit: visit2 } = addVisit(state, kim.id, { done: '컷' }, '2026-09-29T16:00:00'));
  ({ state } = addPhoto(state, visit2.id, { w: 1, h: 1, bytes: 1 }, '2026-09-29T16:01:00'));
  ({ state } = deleteVisit(state, visit2.id, '2026-09-29T16:05:00'));
  ({ state } = purgeVisit(state, visit2.id));
  assert.deepEqual(state.photos.map(p => p.visitId), [visit.id]);
  // 고객을 완전히 지우면 전부
  ({ state } = deleteCustomer(state, kim.id, '2026-09-29T17:00:00'));
  ({ state } = purgeCustomer(state, kim.id));
  assert.deepEqual(state.photos, []);
  assert.equal(lee.id > 0, true);
});

test('옛 백업에는 사진과 동의가 없다 — 빈 값으로 읽고, 저장했다 꺼내도 그대로', () => {
  const old = JSON.stringify({ nextId: 3, customers: [{ id: 1, name: '김OO', phone: '01011112222', profile: { talk: '', hair: '' }, profileHistory: [] }], visits: [], today: { date: '', entries: [] } });
  const s = deserialize(old);
  assert.deepEqual(s.photos, []);
  assert.equal(s.customers[0].photoConsent, null);
  let { state, kim, visit } = withVisit();
  ({ state } = setPhotoConsent(state, kim.id, true, '2026-09-29'));
  ({ state } = addPhoto(state, visit.id, { w: 1600, h: 1200, bytes: 300000 }, '2026-09-29T14:05:00'));
  assert.deepEqual(deserialize(serialize(state)), state);
  const junk = deserialize(JSON.stringify({ ...JSON.parse(serialize(state)), photos: [{ id: 'x' }, null, { id: 9, customerId: 1, visitId: 999, path: 'a', w: 1, h: 1, bytes: 1, createdAt: 'x' }] }));
  assert.deepEqual(junk.photos.map(p => p.id), [9], '모양이 안 맞는 사진 줄은 버린다');
});

test('오늘 명단에 올리면 한 번만 들어가고, 날짜가 바뀌면 오늘 명단은 새로 시작되지만 안 적은 사람은 지난 명단에 남는다', () => {
  let { state, kim, lee } = twoCustomers();
  ({ state } = markToday(state, kim.id, '2026-09-11'));
  ({ state } = markToday(state, kim.id, '2026-09-11'));
  ({ state } = markToday(state, lee.id, '2026-09-11'));
  assert.deepEqual(todayList(state, '2026-09-11').map(t => t.customer.id), [kim.id, lee.id]);
  ({ state } = markToday(state, lee.id, '2026-09-12'));
  assert.deepEqual(todayList(state, '2026-09-12').map(t => t.customer.id), [lee.id], '오늘 명단은 오늘 것만');
  assert.deepEqual(pendingList(state, '2026-09-12').map(p => [p.date, p.customer.id]), [['2026-09-11', kim.id], ['2026-09-11', lee.id]], '어제 안 적은 둘은 지난 명단에');
  assert.equal(state.today.date, '2026-09-12');
});

test('안 적은 사람은 다음 날에도 남고, 적은 사람도 60일 동안은 남는다(그날 타임테이블을 다시 보려고). 지난 명단에는 안 적은 사람만', () => {
  let { state, kim, lee } = twoCustomers();
  ({ state } = markToday(state, kim.id, '2026-09-27', '10:00'));
  ({ state } = markToday(state, lee.id, '2026-09-27', '11:30'));
  ({ state } = addVisit(state, kim.id, { done: '김 컷' }, '2026-09-27T10:40:00'));   // 김은 적었고 이는 안 적었다
  // 다음 날 아침에 연다
  const rolled = rollToday(state, '2026-09-28');
  assert.equal(rolled.dropped, 0, '적은 김OO 항목도 60일 안이라 남는다 (10-13)');
  state = rolled.state;
  assert.equal(state.today.date, '2026-09-28');
  assert.deepEqual(state.today.entries.map(e => [e.customerId, e.date]), [[kim.id, '2026-09-27'], [lee.id, '2026-09-27']], '둘 다 27일 항목 그대로');
  assert.deepEqual(todayList(state, '2026-09-28'), [], '오늘 명단은 비어 있다');
  assert.deepEqual(todayList(state, '2026-09-27').map(t => [t.customer.name, t.recorded]), [['김OO', true], ['이OO', false]], '27일 타임테이블은 입력 여부와 함께 보인다');
  assert.deepEqual(pendingList(state, '2026-09-28').map(p => `${p.date} ${p.at} ${p.customer.name}`), ['2026-09-27 11:30 이OO'], '지난 명단에는 안 적은 사람만');
  // 바뀔 게 없으면 같은 상태를 그대로 돌려준다
  const same = rollToday(state, '2026-09-28');
  assert.equal(same.state, state); assert.equal(same.dropped, 0);
  // 그날 날짜로 적으면 지난 명단에서 사라진다. 항목은 60일 동안 남고, 60일이 지나면 적은 것만 빠진다
  ({ state } = addVisit(state, lee.id, { done: '이 컷', date: '2026-09-27' }, '2026-09-28T09:00:00'));
  assert.deepEqual(pendingList(state, '2026-09-28'), []);
  assert.equal(rollToday(state, '2026-09-29').state.today.entries.length, 2);
  assert.equal(rollToday(state, '2026-11-27').state.today.entries.length, 0, '60일 뒤엔 적은 항목은 빠진다');
  ({ state } = markToday(state, kim.id, '2026-09-28', '10:00'));   // 28일에 올리고 안 적음
  const old = rollToday(state, '2026-12-31');
  assert.deepEqual(old.state.today.entries.map(e => e.date), ['2026-09-28'], '안 적은 사람은 몇 달이 지나도 남는다');
});

test('지난 명단은 오늘 날짜로 적은 것으로는 안 지워지고, 며칠이 지나도 날짜순으로 남는다', () => {
  let { state, kim, lee } = twoCustomers();
  ({ state } = markToday(state, lee.id, '2026-09-25', ''));
  ({ state } = markToday(state, kim.id, '2026-09-26', '15:00'));
  ({ state } = addVisit(state, kim.id, { done: '오늘 날짜로 잘못 적음' }, '2026-09-28T10:00:00'));
  assert.deepEqual(pendingList(state, '2026-09-28').map(p => `${p.date} ${p.customer.name}`), ['2026-09-25 이OO', '2026-09-26 김OO'], '26일 것은 26일 기록이 있어야 지워진다');
  // 지운 고객은 지난 명단에서도 빠진다
  ({ state } = deleteCustomer(state, lee.id, '2026-09-28T11:00:00'));
  assert.deepEqual(pendingList(state, '2026-09-28').map(p => p.customer.name), ['김OO']);
});

test('지난 명단의 [빼기]는 그 날짜 항목만 뺀다', () => {
  let { state, kim } = twoCustomers();
  ({ state } = markToday(state, kim.id, '2026-09-27', '10:00'));
  ({ state } = markToday(state, kim.id, '2026-09-28', '14:00'));
  ({ state } = unmarkToday(state, kim.id, '2026-09-27'));
  assert.deepEqual(pendingList(state, '2026-09-28'), []);
  assert.deepEqual(todayList(state, '2026-09-28').map(t => t.at), ['14:00'], '오늘 항목은 그대로');
  ({ state } = setTodayTime(state, kim.id, '2026-09-28', '15:00'));
  assert.deepEqual(state.today.entries, [{ customerId: kim.id, at: '15:00', date: '2026-09-28', service: '' }]);
});

test('옛 백업의 명단 항목에는 날짜가 없다 — 그 명단의 날짜를 붙여 읽는다', () => {
  const old = JSON.stringify({ nextId: 3, customers: [{ id: 1, name: '김OO', phone: '01011112222', profile: { talk: '', hair: '' }, profileHistory: [], createdAt: '2026-09-01T10:00:00' }], visits: [], today: { date: '2026-09-27', entries: [{ customerId: 1, at: '10:00' }] } });
  const state = deserialize(old);
  assert.deepEqual(state.today.entries, [{ customerId: 1, at: '10:00', date: '2026-09-27', service: '' }]);
  assert.deepEqual(deserialize(serialize(state)).today, state.today, '저장했다 꺼내도 그대로');
});

test('오늘 명단은 오늘 방문 기록을 남겼는지와 지난번 다음 방향을 함께 준다', () => {
  let { state, kim, lee } = twoCustomers();
  ({ state } = addVisit(state, kim.id, { done: '지난번', next: '다음엔 볼륨펌' }, '2026-05-01T10:00:00'));
  ({ state } = markToday(state, kim.id, '2026-09-11'));
  ({ state } = markToday(state, lee.id, '2026-09-11'));
  ({ state } = addVisit(state, kim.id, { done: '오늘 볼륨펌', next: '' }, '2026-09-11T14:00:00'));
  const list = todayList(state, '2026-09-11');
  assert.equal(list[0].recorded, true);
  assert.equal(list[0].lastNext, '다음엔 볼륨펌', '오늘 것 말고 지난번 다음 방향');
  assert.equal(list[1].recorded, false);
  assert.equal(list[1].lastNext, '');
});

test('이전 버전(자유 메모 한 칸) 저장 데이터를 열면 방문 기록으로 옮겨진다', () => {
  const old = JSON.stringify({ nextId: 4, customers: [{ id: 1, name: '김OO', last4: '1234' }],
    memos: [{ id: 2, customerId: 1, text: '옛 메모', createdAt: '2026-09-10T10:00:00', history: [{ text: '더 옛', replacedAt: '2026-09-10T11:00:00' }] }] });
  const state = deserialize(old);
  const [v] = visitsOf(state, 1);
  assert.equal(v.done, '옛 메모');
  assert.deepEqual(v.history, [{ done: '더 옛', next: '', replacedAt: '2026-09-10T11:00:00' }]);
  assert.deepEqual(state.customers[0].profile, { talk: '', hair: '' });
  assert.deepEqual(deserialize(serialize(state)), state);
});

test('전화번호는 전체를 저장하고, 숫자만 남긴다', () => {
  const { customer } = addCustomer(createState(), { name: '김OO', phone: '010-1234-5678' });
  assert.equal(customer.phone, '01012345678');
});

test('전화번호를 적으면 10~11자리 숫자여야 하고, 비워도 된다', () => {
  assert.throws(() => addCustomer(createState(), { name: '김OO', phone: '1234' }), /전화번호/);
  assert.equal(addCustomer(createState(), { name: '김OO', phone: '' }).customer.phone, '');
});

test('같은 전화번호로 두 명을 만들 수 없다', () => {
  const { state } = addCustomer(createState(), { name: '김OO', phone: '01012345678' });
  assert.throws(() => addCustomer(state, { name: '박OO', phone: '010-1234-5678' }), /이미/);
});

test('이름과 전화번호를 고칠 수 있고, 다른 고객 번호와 겹치면 거부한다', () => {
  let { state, customer: kim } = addCustomer(createState(), { name: '김OO', phone: '01012345678' });
  ({ state } = addCustomer(state, { name: '이OO', phone: '01099998888' }));
  ({ state } = editCustomer(state, kim.id, { name: '김OO(교사)', phone: '010-1111-2222' }));
  const c = state.customers.find(x => x.id === kim.id);
  assert.equal(c.name, '김OO(교사)');
  assert.equal(c.phone, '01011112222');
  assert.throws(() => editCustomer(state, kim.id, { name: '김OO', phone: '01099998888' }), /이미/);
});

test('번호 일부(뒤 4자리든 앞자리든)로 찾는다', () => {
  let { state } = addCustomer(createState(), { name: '김OO', phone: '01012345678' });
  ({ state } = addCustomer(state, { name: '이OO', phone: '01099995678' }));
  assert.equal(findCustomers(state, '5678').length, 2);
  assert.deepEqual(findCustomers(state, '9999').map(c => c.name), ['이OO']);
  assert.deepEqual(findCustomers(state, '010-1234').map(c => c.name), ['김OO']);
});

test('가린 번호는 앞 3자리와 뒤 4자리만 보인다', () => {
  assert.equal(maskPhone('01012345678'), '010-****-5678');
  assert.equal(maskPhone('0212345678'), '021-***-5678');
  assert.equal(maskPhone('1234'), '****-1234', '옛 뒤 4자리 데이터');
  assert.equal(maskPhone(''), '');
});

test('옛 데이터의 뒤 4자리(last4)는 phone으로 옮겨져 그대로 보인다', () => {
  const old = JSON.stringify({ nextId: 2, customers: [{ id: 1, name: '김OO', last4: '1234' }], memos: [] });
  const state = deserialize(old);
  assert.equal(state.customers[0].phone, '1234');
  assert.equal(state.customers[0].last4, undefined);
  assert.deepEqual(findCustomers(state, '1234').map(c => c.name), ['김OO']);
});

test('소개해 준 분을 적을 수 있고, 비워도 된다', () => {
  const { customer } = addCustomer(createState(), { name: '김OO', phone: '01012345678', referrer: ' 박OO 언니 ' });
  assert.equal(customer.referrer, '박OO 언니');
  assert.equal(addCustomer(createState(), { name: '이OO', phone: '' }).customer.referrer, '');
});

test('소개해 준 분을 나중에 고칠 수 있다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01012345678' });
  ({ state } = editCustomer(state, customer.id, { name: '김OO', phone: '01012345678', referrer: '블로그 보고' }));
  assert.equal(state.customers[0].referrer, '블로그 보고');
});

test('옛 데이터에는 소개 칸이 빈 값으로 생긴다', () => {
  const state = deserialize(JSON.stringify({ nextId: 2, customers: [{ id: 1, name: '김OO', phone: '01012345678' }], visits: [] }));
  assert.equal(state.customers[0].referrer, '');
});

// ---- 고객 지우기 ---------------------------------------------------------

// 방문 기록 1건과 오늘 명단까지 올라간 고객 한 명을 만들어 둔다.
function oneWithVisit() {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = addVisit(state, customer.id, { done: '레이어드 컷' }, '2026-09-11T10:00:00'));
  ({ state } = markToday(state, customer.id, '2026-09-11'));
  return { state, id: customer.id };
}

test('지운 고객은 목록·검색·오늘 명단에서 모두 빠진다', () => {
  const { state: s0, id } = oneWithVisit();
  assert.equal(todayList(s0, '2026-09-11').length, 1);
  const { state } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  assert.deepEqual(findCustomers(state, ''), []);
  assert.deepEqual(findCustomers(state, '김'), []);
  assert.deepEqual(todayList(state, '2026-09-11'), []);
  assert.equal(s0.customers[0].deletedAt, null, '원래 상태는 바뀌지 않는다');
});

test('지워도 기록은 남아 있어서 되살리면 방문 기록까지 그대로 돌아온다', () => {
  const { state: s0, id } = oneWithVisit();
  const { state: gone } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  assert.deepEqual(deletedCustomers(gone).map(c => c.name), ['김OO']);
  const { state } = restoreCustomer(gone, id);
  assert.deepEqual(findCustomers(state, '').map(c => c.name), ['김OO']);
  assert.deepEqual(deletedCustomers(state), []);
  assert.equal(visitsOf(state, id).length, 1);
});

test('지운 고객에게는 방문 기록이나 고정 정보를 남길 수 없다', () => {
  const { state: s0, id } = oneWithVisit();
  const { state } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  assert.throws(() => addVisit(state, id, { done: '컷' }, '2026-09-12T10:00:00'), /지운 고객/);
  assert.throws(() => setProfile(state, id, { talk: 'ㄱ', hair: 'ㄴ' }, '2026-09-12T10:00:00'), /지운 고객/);
  assert.throws(() => markToday(state, id, '2026-09-12'), /지운 고객/);
});

test('지운 고객이 쓰던 번호로 새 고객을 만들 수 있다', () => {
  const { state: s0, id } = oneWithVisit();
  const { state } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  const { customer } = addCustomer(state, { name: '이OO', phone: '01011112222' });
  assert.equal(customer.name, '이OO');
});

test('같은 번호를 쓰는 고객이 있으면 되살리지 못하고 이유를 알려준다', () => {
  const { state: s0, id } = oneWithVisit();
  let { state } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  ({ state } = addCustomer(state, { name: '이OO', phone: '01011112222' }));
  assert.throws(() => restoreCustomer(state, id), /이OO.*되살릴 수 없습니다/);
});

test('완전히 지우면 고객도 방문 기록도 사라진다', () => {
  const { state: s0, id } = oneWithVisit();
  const { state: gone } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  const { state } = purgeCustomer(gone, id);
  assert.deepEqual(state.customers, []);
  assert.deepEqual(state.visits, [], '그 고객의 방문 기록도 함께 사라진다');
  assert.deepEqual(deletedCustomers(state), []);
  assert.deepEqual(state.today.entries, []);
});

test('완전히 지워도 다른 고객의 방문 기록은 건드리지 않는다', () => {
  let { state, customer: a } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  let b;
  ({ state, customer: b } = addCustomer(state, { name: '이OO', phone: '01033334444' }));
  ({ state } = addVisit(state, a.id, { done: 'A 시술' }, '2026-09-11T10:00:00'));
  ({ state } = addVisit(state, b.id, { done: 'B 시술' }, '2026-09-11T11:00:00'));
  ({ state } = purgeCustomer(state, a.id));
  assert.deepEqual(state.customers.map(c => c.name), ['이OO']);
  assert.deepEqual(state.visits.map(v => v.done), ['B 시술']);
});

test('저장했다 꺼내도 지운 상태가 그대로 유지된다', () => {
  const { state: s0, id } = oneWithVisit();
  const { state } = deleteCustomer(s0, id, '2026-09-11T20:00:00');
  const restored = deserialize(serialize(state));
  assert.deepEqual(restored, state);
  assert.deepEqual(findCustomers(restored, ''), []);
});

test('지우기 칸이 없던 옛 백업을 불러오면 모두 살아 있는 고객이 된다', () => {
  const old = JSON.stringify({ nextId: 2, customers: [{ id: 1, name: '김OO', last4: '1234' }], memos: [], today: { date: '', customerIds: [] } });
  const state = deserialize(old);
  assert.equal(state.customers[0].deletedAt, null);
  assert.deepEqual(findCustomers(state, '').map(c => c.name), ['김OO']);
});

// ---- 오늘 명단: 예약 시간과 순서 -------------------------------------------

function threeCustomers() {
  let { state, customer: kim } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  let lee, park;
  ({ state, customer: lee } = addCustomer(state, { name: '이OO', phone: '01033334444' }));
  ({ state, customer: park } = addCustomer(state, { name: '박OO', phone: '01055556666' }));
  return { state, kim: kim.id, lee: lee.id, park: park.id };
}
const D = '2026-09-11';
const shown = (state) => todayList(state, D).map(t => `${t.order} ${t.at || '시간없음'} ${t.customer.name}`);

test('예약 시간을 적으면 올린 순서와 상관없이 시간순으로 줄을 세운다', () => {
  let { state, kim, lee, park } = threeCustomers();
  ({ state } = markToday(state, kim, D, '14:00'));
  ({ state } = markToday(state, lee, D, '10:00'));
  ({ state } = markToday(state, park, D, '11:30'));
  assert.deepEqual(shown(state), ['1 10:00 이OO', '2 11:30 박OO', '3 14:00 김OO']);
});

test('시간을 안 적은 사람은 적은 사람 뒤에, 올린 순서대로 붙는다', () => {
  let { state, kim, lee, park } = threeCustomers();
  ({ state } = markToday(state, kim, D, ''));
  ({ state } = markToday(state, lee, D, '10:00'));
  ({ state } = markToday(state, park, D));
  assert.deepEqual(shown(state), ['1 10:00 이OO', '2 시간없음 김OO', '3 시간없음 박OO']);
});

test('시간은 930, 1030, 9:30 처럼 적어도 HH:MM으로 맞춰 준다', () => {
  let { state, kim, lee, park } = threeCustomers();
  ({ state } = markToday(state, kim, D, '930'));
  ({ state } = markToday(state, lee, D, '1030'));
  ({ state } = markToday(state, park, D, '9:05'));
  assert.deepEqual(shown(state), ['1 09:05 박OO', '2 09:30 김OO', '3 10:30 이OO']);
});

test('시간이 말이 안 되면 막고 알려준다', () => {
  const { state, kim } = threeCustomers();
  assert.throws(() => markToday(state, kim, D, '25:00'), /10:00 처럼/);
  assert.throws(() => markToday(state, kim, D, '10:99'), /10:00 처럼/);
  assert.throws(() => markToday(state, kim, D, '아무거나'), /10:00 처럼/);
});

test('명단에 올린 뒤에 시간을 고치면 줄 순서도 따라 바뀐다', () => {
  let { state, kim, lee } = threeCustomers();
  ({ state } = markToday(state, kim, D, '10:00'));
  ({ state } = markToday(state, lee, D, '11:00'));
  ({ state } = setTodayTime(state, lee, D, '09:00'));
  assert.deepEqual(shown(state), ['1 09:00 이OO', '2 10:00 김OO']);
  ({ state } = setTodayTime(state, lee, D, ''));
  assert.deepEqual(shown(state), ['1 10:00 김OO', '2 시간없음 이OO'], '시간을 지우면 뒤로 간다');
});

test('카드를 열어 명단에 다시 올라가도 적어둔 시간은 지워지지 않는다', () => {
  let { state, kim } = threeCustomers();
  ({ state } = markToday(state, kim, D, '10:00'));
  ({ state } = markToday(state, kim, D));
  assert.deepEqual(shown(state), ['1 10:00 김OO'], '한 번만 들어가고 시간도 그대로');
});

test('예약이 취소되면 명단에서만 빼고 고객과 기록은 남는다', () => {
  let { state, kim, lee } = threeCustomers();
  ({ state } = markToday(state, kim, D, '10:00'));
  ({ state } = markToday(state, lee, D, '11:00'));
  ({ state } = addVisit(state, kim, { done: '지난 시술' }, '2026-09-01T10:00:00'));
  ({ state } = unmarkToday(state, kim, D));
  assert.deepEqual(shown(state), ['1 11:00 이OO']);
  assert.equal(findCustomers(state, '김').length, 1, '고객은 그대로 있다');
  assert.equal(visitsOf(state, kim).length, 1, '방문 기록도 그대로 있다');
});

test('명단에 없는 사람을 빼거나 시간을 고쳐도 아무 일도 안 생긴다', () => {
  let { state, kim, lee } = threeCustomers();
  ({ state } = markToday(state, kim, D, '10:00'));
  const before = shown(state);
  ({ state } = unmarkToday(state, lee, D));
  ({ state } = setTodayTime(state, lee, D, '09:00'));
  assert.deepEqual(shown(state), before);
});

test('날짜가 바뀌면 새 명단이 시작되고, 어제 안 적은 사람은 지난 명단으로 넘어온다', () => {
  let { state, kim, lee } = threeCustomers();
  ({ state } = markToday(state, kim, D, '10:00'));
  ({ state } = markToday(state, lee, '2026-09-12', '11:00'));
  assert.deepEqual(shown_on(state, '2026-09-12'), ['1 11:00 이OO'], '새 날의 오늘 명단은 그날 것만');
  assert.deepEqual(pendingList(state, '2026-09-12').map(p => `${p.date} ${p.at} ${p.customer.name}`), [`${D} 10:00 김OO`], '어제 안 적은 김OO는 지난 명단에');
  assert.deepEqual(shown_on(state, D), ['1 10:00 김OO'], '어제 날짜로 물으면 어제 명단이 그대로 있다');
  function shown_on(st, d) { return todayList(st, d).map(t => `${t.order} ${t.at || '시간없음'} ${t.customer.name}`); }
});

test('시간 칸이 없던 옛 백업의 오늘 명단도 그대로 읽는다', () => {
  const old = JSON.stringify({
    nextId: 3,
    customers: [{ id: 1, name: '김OO', phone: '01011112222' }, { id: 2, name: '이OO', phone: '01033334444' }],
    visits: [], today: { date: D, customerIds: [2, 1] },
  });
  const state = deserialize(old);
  assert.deepEqual(shown(state), ['1 시간없음 이OO', '2 시간없음 김OO'], '올린 순서 그대로');
});

test('오늘 명단도 저장했다 꺼내면 그대로다', () => {
  let { state, kim, lee } = threeCustomers();
  ({ state } = markToday(state, kim, D, '10:00'));
  ({ state } = markToday(state, lee, D, ''));
  assert.deepEqual(deserialize(serialize(state)), state);
});

// ---- 예약 시간 후보 --------------------------------------------------------

test('예약 시간 후보는 10시부터 30분 간격으로 19시까지 19개다', () => {
  const slots = timeSlots();
  assert.equal(slots.length, 19);
  assert.equal(slots[0], '10:00');
  assert.equal(slots[1], '10:30');
  assert.equal(slots[slots.length - 1], '19:00');
  assert.equal(slots.includes('12:30'), true);
  assert.equal(slots.includes('09:30'), false, '영업 전 시간은 없다');
  assert.equal(slots.includes('19:30'), false, '마지막 예약 뒤 시간은 없다');
});

// ---- 방문 주기 -------------------------------------------------------------

// 준 날짜들에 방문 기록을 남긴 고객 하나를 만든다.
function visitedOn(...dates) {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  for (const d of dates) ({ state } = addVisit(state, customer.id, { done: `${d} 시술` }, `${d}T14:00:00`));
  return { state, id: customer.id };
}

test('방문 기록마다 이전 방문에서 며칠 만인지 붙는다. 첫 방문은 비어 있다', () => {
  const { state, id } = visitedOn('2026-05-01', '2026-06-26', '2026-09-04');
  const got = visitsWithGaps(state, id);
  assert.deepEqual(got.map(v => v.createdAt.slice(0, 10)), ['2026-09-04', '2026-06-26', '2026-05-01'], '최신순 그대로');
  assert.deepEqual(got.map(v => v.sincePrev), [70, 56, null]);
});

test('오늘 기준으로 마지막 방문이 며칠 전인지, 보통 며칠 만에 오는지 알려준다', () => {
  const { state, id } = visitedOn('2026-05-01', '2026-06-26', '2026-09-04');
  const c = visitCycle(state, id, '2026-09-15');
  assert.equal(c.count, 3);
  assert.equal(c.lastDate, '2026-09-04');
  assert.equal(c.sinceLast, 11);
  assert.equal(c.average, 63, '56일과 70일의 평균');
});

test('오늘 기록을 남겨도 마지막 방문은 지난번을 가리킨다', () => {
  let { state, id } = visitedOn('2026-06-26', '2026-09-04');
  const before = visitCycle(state, id, '2026-09-15');
  ({ state } = addVisit(state, id, { done: '오늘 시술' }, '2026-09-15T11:00:00'));
  const after = visitCycle(state, id, '2026-09-15');
  assert.equal(after.lastDate, before.lastDate, '오늘 적었다고 마지막 방문 날짜가 오늘로 바뀌지 않는다');
  assert.equal(after.sinceLast, 11, '며칠 만에 왔는지도 그대로');
  assert.equal(after.count, 3, '방문 건수는 늘어난다');
});

test('처음 오는 고객은 며칠 만인지도 평균도 없다', () => {
  let { state, customer } = addCustomer(createState(), { name: '새손님', phone: '01099998888' });
  const c = visitCycle(state, customer.id, '2026-09-15');
  assert.equal(c.count, 0);
  assert.equal(c.sinceLast, null);
  assert.equal(c.average, null);
  assert.equal(c.lastDate, '');
  assert.deepEqual(visitsWithGaps(state, customer.id), []);
});

test('방문이 한 번뿐이면 며칠 만인지는 나오고 평균은 아직 없다', () => {
  const { state, id } = visitedOn('2026-08-01');
  const c = visitCycle(state, id, '2026-09-15');
  assert.equal(c.sinceLast, 45);
  assert.equal(c.average, null, '사이가 하나도 없으면 평균을 내지 않는다');
});

test('달을 넘고 해를 넘어도 날짜를 제대로 센다', () => {
  const { state, id } = visitedOn('2025-12-24');
  assert.equal(visitCycle(state, id, '2026-01-07').sinceLast, 14, '해를 넘는 2주');
  const feb = visitedOn('2024-02-27');
  assert.equal(visitCycle(feb.state, feb.id, '2024-03-01').sinceLast, 3, '윤년 2월 29일을 센다');
});

test('같은 날 두 번 오면 사이는 0일이다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = addVisit(state, customer.id, { done: '아침 컷' }, '2026-09-04T10:00:00'));
  ({ state } = addVisit(state, customer.id, { done: '저녁 손질' }, '2026-09-04T18:00:00'));
  assert.deepEqual(visitsWithGaps(state, customer.id).map(v => v.sincePrev), [0, null]);
});

test('오늘 명단 줄에도 며칠 만인지와 평균이 함께 온다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = addVisit(state, customer.id, { done: '5월', next: '다음엔 볼륨펌' }, '2026-05-01T14:00:00'));
  ({ state } = addVisit(state, customer.id, { done: '6월', next: '' }, '2026-06-26T14:00:00'));
  ({ state } = markToday(state, customer.id, '2026-09-15', '10:30'));
  const row = todayList(state, '2026-09-15')[0];
  assert.equal(row.at, '10:30');
  assert.equal(row.sinceLast, 81);
  assert.equal(row.lastDate, '2026-06-26');
  assert.equal(row.average, 56);
  assert.equal(row.count, 2);
  assert.equal(row.recorded, false);
});

// ---- 방문 기록 지우기 ------------------------------------------------------

// 같은 날 같은 내용을 두 번 적은 상황(실수로 두 번 저장)
function doubleEntry() {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  let first, second;
  ({ state, visit: first } = addVisit(state, customer.id, { done: '가슴윗기장 포워드레이어드 / 매직 후', next: '중화' }, '2026-09-15T15:26:00'));
  ({ state, visit: second } = addVisit(state, customer.id, { done: '가슴윗기장 스퀘어 포워드레이어', next: '' }, '2026-09-15T17:31:00'));
  return { state, id: customer.id, first: first.id, second: second.id };
}

test('방문 기록을 지우면 목록에서 빠지고, 지운 기록으로 옮겨진다', () => {
  const { state: s0, id, second } = doubleEntry();
  assert.equal(visitsOf(s0, id).length, 2);
  const { state } = deleteVisit(s0, second, '2026-09-15T17:40:00');
  assert.deepEqual(visitsOf(state, id).map(v => v.createdAt), ['2026-09-15T15:26:00'], '남은 한 건만 보인다');
  assert.deepEqual(deletedVisitsOf(state, id).map(v => v.id), [second]);
  assert.equal(s0.visits.find(v => v.id === second).deletedAt, null, '원래 상태는 바뀌지 않는다');
});

test('지운 기록을 되살리면 내용 그대로 목록으로 돌아온다', () => {
  const { state: s0, id, second } = doubleEntry();
  const { state: gone } = deleteVisit(s0, second, '2026-09-15T17:40:00');
  const { state } = restoreVisit(gone, second);
  assert.equal(visitsOf(state, id).length, 2);
  assert.deepEqual(deletedVisitsOf(state, id), []);
  assert.equal(visitsOf(state, id)[0].done, '가슴윗기장 스퀘어 포워드레이어');
});

test('지운 기록은 고칠 수 없다', () => {
  const { state: s0, second } = doubleEntry();
  const { state } = deleteVisit(s0, second, '2026-09-15T17:40:00');
  assert.throws(() => editVisit(state, second, { done: '고쳐보기' }, '2026-09-15T18:00:00'), /지운 기록/);
});

test('완전히 지우면 되살릴 수 없게 사라진다', () => {
  const { state: s0, id, second } = doubleEntry();
  const { state: gone } = deleteVisit(s0, second, '2026-09-15T17:40:00');
  const { state } = purgeVisit(gone, second);
  assert.equal(state.visits.length, 1);
  assert.deepEqual(deletedVisitsOf(state, id), []);
  assert.throws(() => restoreVisit(state, second), /찾을 수 없습니다/);
});

test('중복을 지우면 방문 건수와 주기가 곧바로 바로잡힌다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = addVisit(state, customer.id, { done: '5월' }, '2026-05-01T14:00:00'));
  ({ state } = addVisit(state, customer.id, { done: '9월' }, '2026-09-04T14:00:00'));
  let dup;
  ({ state, visit: dup } = addVisit(state, customer.id, { done: '9월 또 적음' }, '2026-09-04T17:00:00'));

  const before = visitCycle(state, customer.id, '2026-09-15');
  assert.equal(before.count, 3);
  assert.equal(before.average, 63, '0일짜리 중복이 평균을 끌어내린다 (126과 0의 평균)');

  ({ state } = deleteVisit(state, dup.id, '2026-09-15T18:00:00'));
  const after = visitCycle(state, customer.id, '2026-09-15');
  assert.equal(after.count, 2);
  assert.equal(after.average, 126, '중복을 지우면 평균이 제자리로');
  assert.deepEqual(visitsWithGaps(state, customer.id).map(v => v.sincePrev), [126, null]);
});

test('오늘 기록을 지우면 오늘 명단이 다시 [아직 안 적음]으로 돌아간다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = markToday(state, customer.id, '2026-09-15', '10:00'));
  let v;
  ({ state, visit: v } = addVisit(state, customer.id, { done: '오늘 시술' }, '2026-09-15T11:00:00'));
  assert.equal(todayList(state, '2026-09-15')[0].recorded, true);
  ({ state } = deleteVisit(state, v.id, '2026-09-15T12:00:00'));
  assert.equal(todayList(state, '2026-09-15')[0].recorded, false);
});

test('고객을 완전히 지우면 지운 기록까지 함께 사라진다', () => {
  const { state: s0, id, second } = doubleEntry();
  let { state } = deleteVisit(s0, second, '2026-09-15T17:40:00');
  ({ state } = purgeCustomer(state, id));
  assert.deepEqual(state.visits, []);
});

test('지운 기록도 저장했다 꺼내면 그대로다', () => {
  const { state: s0, second } = doubleEntry();
  const { state } = deleteVisit(s0, second, '2026-09-15T17:40:00');
  assert.deepEqual(deserialize(serialize(state)), state);
});

test('지움 칸이 없던 옛 백업의 방문 기록은 모두 살아 있는 것으로 읽는다', () => {
  const old = JSON.stringify({
    nextId: 3,
    customers: [{ id: 1, name: '김OO', phone: '01011112222' }],
    visits: [{ id: 2, customerId: 1, done: '옛 기록', next: '', createdAt: '2026-05-01T14:00:00', history: [] }],
    today: { date: '', customerIds: [] },
  });
  const state = deserialize(old);
  assert.equal(state.visits[0].deletedAt, null);
  assert.equal(visitsOf(state, 1).length, 1);
});

// ---- 지운 기록이 일주일 뒤 저절로 사라진다 ---------------------------------

// 지운 지 days일 지난 방문 기록 하나를 가진 상태를 만든다.
function trashedDaysAgo(days) {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  let v;
  ({ state, visit: v } = addVisit(state, customer.id, { done: '두 번 적은 기록' }, '2026-09-15T17:31:00'));
  ({ state } = addVisit(state, customer.id, { done: '남겨둘 기록' }, '2026-09-15T15:26:00'));
  ({ state } = deleteVisit(state, v.id, '2026-09-15T17:40:00'));
  const [y, m, d] = [2026, 9, 15 + days];
  const now = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) + 'T09:00:00';
  return { state, id: customer.id, visitId: v.id, now };
}

test('지운 지 엿새까지는 남아 있다', () => {
  for (const days of [0, 1, 6]) {
    const { state, id, now } = trashedDaysAgo(days);
    const { state: after, removed } = sweepDeletedVisits(state, now);
    assert.equal(removed, 0, `${days}일째에는 안 없앤다`);
    assert.equal(deletedVisitsOf(after, id).length, 1);
  }
});

test('이레째부터는 저절로 없어진다', () => {
  for (const days of [7, 8, 30]) {
    const { state, id, now } = trashedDaysAgo(days);
    const { state: after, removed } = sweepDeletedVisits(state, now);
    assert.equal(removed, 1, `${days}일째에는 없앤다`);
    assert.deepEqual(deletedVisitsOf(after, id), []);
    assert.equal(visitsOf(after, id).length, 1, '안 지운 기록은 그대로 남는다');
  }
});

test('지우지 않은 기록은 아무리 오래돼도 안 건드린다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = addVisit(state, customer.id, { done: '5년 전 시술' }, '2021-05-01T14:00:00'));
  const { state: after, removed } = sweepDeletedVisits(state, '2026-09-15T09:00:00');
  assert.equal(removed, 0);
  assert.equal(visitsOf(after, customer.id).length, 1);
});

test('되살린 기록은 저절로 사라지지 않는다', () => {
  let { state, id, visitId, now } = trashedDaysAgo(30);
  ({ state } = restoreVisit(state, visitId));
  const { state: after, removed } = sweepDeletedVisits(state, now);
  assert.equal(removed, 0, '되살렸으니 없애지 않는다');
  assert.equal(visitsOf(after, id).length, 2);
});

test('사라지기까지 며칠 남았는지 알려준다', () => {
  const cases = [[0, 7], [1, 6], [6, 1], [7, 0], [20, 0]];
  for (const [days, left] of cases) {
    const { state, id, now } = trashedDaysAgo(days);
    assert.equal(daysLeftInTrash(deletedVisitsOf(state, id)[0], now), left, `${days}일째에는 ${left}일 남음`);
  }
});

test('안 지운 기록에는 남은 날이 없다', () => {
  const { state, id } = trashedDaysAgo(0);
  assert.equal(daysLeftInTrash(visitsOf(state, id)[0], '2026-09-15T09:00:00'), null);
  assert.equal(daysLeftInTrash(null, '2026-09-15T09:00:00'), null);
});

test('여러 건이 섞여 있어도 기한이 지난 것만 골라 없앤다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  const mk = (done, at) => { let v; ({ state, visit: v } = addVisit(state, customer.id, { done }, at)); return v.id; };
  const old1 = mk('열흘 전에 지움', '2026-08-01T10:00:00');
  const old2 = mk('여드레 전에 지움', '2026-08-02T10:00:00');
  const fresh = mk('어제 지움', '2026-08-03T10:00:00');
  mk('안 지운 것', '2026-08-04T10:00:00');
  ({ state } = deleteVisit(state, old1, '2026-09-05T10:00:00'));
  ({ state } = deleteVisit(state, old2, '2026-09-07T10:00:00'));
  ({ state } = deleteVisit(state, fresh, '2026-09-14T10:00:00'));

  const { state: after, removed } = sweepDeletedVisits(state, '2026-09-15T09:00:00');
  assert.equal(removed, 2);
  assert.deepEqual(deletedVisitsOf(after, customer.id).map(v => v.id), [fresh], '어제 지운 것만 남는다');
  assert.equal(visitsOf(after, customer.id).length, 1);
});

test('저절로 없어진 뒤에도 주기 계산은 멀쩡하다', () => {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  ({ state } = addVisit(state, customer.id, { done: '5월' }, '2026-05-01T14:00:00'));
  ({ state } = addVisit(state, customer.id, { done: '9월' }, '2026-09-04T14:00:00'));
  let dup;
  ({ state, visit: dup } = addVisit(state, customer.id, { done: '9월 또 적음' }, '2026-09-04T17:00:00'));
  ({ state } = deleteVisit(state, dup.id, '2026-09-04T18:00:00'));
  const { state: after } = sweepDeletedVisits(state, '2026-09-15T09:00:00');
  const c = visitCycle(after, customer.id, '2026-09-15');
  assert.equal(c.count, 2);
  assert.equal(c.average, 126);
  assert.equal(c.sinceLast, 11);
});

// ---- 정액권 (금액권) -------------------------------------------------------

function withPass() {
  let { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  return { state, id: customer.id };
}
const T = (n) => `2026-09-${String(n).padStart(2, '0')}T14:00:00`;

test('금액은 150000 · 150,000 · 15만 · 150000원을 모두 같은 값으로 읽는다', () => {
  for (const v of ['150000', '150,000', '15만', '150000원', ' 150,000 원 ']) assert.equal(cleanAmount(v), 150000);
  assert.equal(cleanAmount('3만'), 30000);
});

test('금액이 말이 안 되면 막고 알려준다', () => {
  for (const v of ['', '   ', '영만원', '-5000', '0', '1.5만', '만']) {
    assert.throws(() => cleanAmount(v), /금액/, `${JSON.stringify(v)}는 막아야 한다`);
  }
});

test('금액은 세 자리마다 쉼표를 찍어 보여준다', () => {
  assert.equal(formatWon(0), '0원');
  assert.equal(formatWon(5000), '5,000원');
  assert.equal(formatWon(150000), '150,000원');
  assert.equal(formatWon(1234567), '1,234,567원');
});

test('충전하면 잔액이 늘고 사용하면 준다', () => {
  let { state, id } = withPass();
  assert.equal(passBalance(state, id), 0, '아직 아무것도 없으면 0원');
  ({ state } = chargePass(state, id, { amount: '30만', note: '3월 충전' }, T(1)));
  assert.equal(passBalance(state, id), 300000);
  ({ state } = usePass(state, id, { amount: '50000' }, T(4)));
  assert.equal(passBalance(state, id), 250000);
  ({ state } = usePass(state, id, { amount: '50000' }, T(20)));
  assert.equal(passBalance(state, id), 200000);
});

test('잔액보다 많이 쓰려 하면 막고 남은 돈을 알려준다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '150000' }, T(1)));
  assert.throws(() => usePass(state, id, { amount: '150001' }, T(4)), /150,000원.*많습니다/);
  assert.equal(passBalance(state, id), 150000, '막혔으니 잔액은 그대로');
  const ok = usePass(state, id, { amount: '150000' }, T(4));
  assert.equal(passBalance(ok.state, id), 0, '딱 맞게 쓰는 것은 된다');
});

test('내역은 최신순으로, 충전인지 사용인지와 메모를 함께 준다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000', note: '3월 충전' }, T(1)));
  ({ state } = usePass(state, id, { amount: '50000', note: '컷' }, T(4)));
  ({ state } = usePass(state, id, { amount: '80000', note: '펌' }, T(20)));
  const list = passEntriesOf(state, id);
  assert.deepEqual(list.map(p => `${p.kind} ${p.amount} ${p.note}`), ['use 80000 펌', 'use 50000 컷', 'charge 300000 3월 충전']);
});

test('요약은 잔액과 지금까지 넣은 돈·쓴 돈을 함께 준다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000' }, T(1)));
  ({ state } = usePass(state, id, { amount: '50000' }, T(4)));
  ({ state } = chargePass(state, id, { amount: '100000' }, T(10)));
  const sum = passSummary(state, id);
  assert.equal(sum.balance, 350000);
  assert.equal(sum.charged, 400000);
  assert.equal(sum.used, 50000);
  assert.equal(sum.count, 3);
  assert.equal(sum.lastAt, T(10));
});

test('내역 한 줄을 지우면 잔액이 곧바로 따라온다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000' }, T(1)));
  let wrong;
  ({ state, entry: wrong } = usePass(state, id, { amount: '50000' }, T(4)));
  assert.equal(passBalance(state, id), 250000);
  ({ state } = deletePass(state, wrong.id));
  assert.equal(passBalance(state, id), 300000);
  assert.equal(passEntriesOf(state, id).length, 1);
  assert.throws(() => deletePass(state, wrong.id), /찾을 수 없습니다/);
});

test('방문 기록과 함께 넣은 차감은 그 방문 번호를 달고 있다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000' }, T(1)));
  let v;
  ({ state, visit: v } = addVisit(state, id, { done: '볼륨펌' }, T(4)));
  let entry;
  ({ state, entry } = usePass(state, id, { amount: '80000', note: '볼륨펌', visitId: v.id }, T(4)));
  assert.equal(entry.visitId, v.id);
  assert.equal(passEntriesOf(state, id)[0].visitId, v.id);
});

test('지운 고객에게는 충전도 사용도 할 수 없다', () => {
  let { state, id } = withPass();
  ({ state } = deleteCustomer(state, id, T(5)));
  assert.throws(() => chargePass(state, id, { amount: '10000' }, T(5)), /지운 고객/);
  assert.throws(() => usePass(state, id, { amount: '10000' }, T(5)), /지운 고객/);
});

test('고객을 완전히 지우면 정액권 내역도 함께 사라진다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000' }, T(1)));
  ({ state } = deleteCustomer(state, id, T(5)));
  ({ state } = purgeCustomer(state, id));
  assert.deepEqual(state.passes, []);
});

test('고객마다 잔액이 따로 센다', () => {
  let { state, customer: a } = addCustomer(createState(), { name: '김OO', phone: '01011112222' });
  let b;
  ({ state, customer: b } = addCustomer(state, { name: '이OO', phone: '01033334444' }));
  ({ state } = chargePass(state, a.id, { amount: '300000' }, T(1)));
  ({ state } = chargePass(state, b.id, { amount: '100000' }, T(1)));
  ({ state } = usePass(state, a.id, { amount: '50000' }, T(4)));
  assert.equal(passBalance(state, a.id), 250000);
  assert.equal(passBalance(state, b.id), 100000);
});

test('오늘 명단 줄에도 잔액이 함께 온다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000' }, T(1)));
  ({ state } = usePass(state, id, { amount: '50000' }, T(4)));
  ({ state } = markToday(state, id, '2026-09-16', '10:30'));
  assert.equal(todayList(state, '2026-09-16')[0].balance, 250000);
});

test('정액권도 저장했다 꺼내면 그대로다', () => {
  let { state, id } = withPass();
  ({ state } = chargePass(state, id, { amount: '300000', note: '3월 충전' }, T(1)));
  ({ state } = usePass(state, id, { amount: '50000', note: '컷' }, T(4)));
  assert.deepEqual(deserialize(serialize(state)), state);
});

test('정액권 칸이 없던 옛 백업은 잔액 0원으로 시작한다', () => {
  const old = JSON.stringify({
    nextId: 3, customers: [{ id: 1, name: '김OO', phone: '01011112222' }],
    visits: [], today: { date: '', customerIds: [] },
  });
  const state = deserialize(old);
  assert.deepEqual(state.passes, []);
  assert.equal(passBalance(state, 1), 0);
});

// ---- 정액권 안내문 ---------------------------------------------------------
// 손님이 받는 문자다. 아티팩트에서 쓰던 문장과 글자 하나까지 같아야 한다.

const TPL = { head: '정액권 안내드려요', tail: '입니다 : D' };

test('충전과 시술 한 건이 있는 안내문이 쓰던 문장 그대로 나온다', () => {
  const got = buildNotice({
    ...TPL, prev: 194400,
    items: [{ name: '매직C컬', amount: 230000 }],
    topup: { name: 'Gold 예약권', amount: 2500000, terms: '사용기한:~18개월 / 우선예약권:소진시까지', gift: '1000ml 프로틴트리트먼트 & 750ml 두피트리트먼트' },
  });
  assert.equal(got, [
    '* 정액권 안내드려요 *',
    '',
    '- 잔여 정액금 194,400원',
    '- Gold 예약권 2,500,000원',
    '(사용기한:~18개월 / 우선예약권:소진시까지)',
    '- 1000ml 프로틴트리트먼트 & 750ml 두피트리트먼트 선물',
    '',
    '* 시술내역 *',
    '매직C컬 230,000 원 사용하셔서',
    '',
    '남은 정액권은 2,464,400원입니다 : D',
  ].join('\n'));
});

test('날짜를 주면 시술내역 제목에 그 날짜가 붙는다 — 언제 시술받고 언제 정액권을 썼는지', () => {
  const got = buildNotice({
    ...TPL, prev: 194400, date: '2026-09-22',
    items: [{ name: '매직C컬', amount: 230000 }],
    topup: { name: 'Gold 예약권', amount: 2500000, terms: '사용기한:~18개월 / 우선예약권:소진시까지', gift: '1000ml 프로틴트리트먼트 & 750ml 두피트리트먼트' },
  });
  assert.equal(got, [
    '* 정액권 안내드려요 *',
    '',
    '- 잔여 정액금 194,400원',
    '- Gold 예약권 2,500,000원',
    '(사용기한:~18개월 / 우선예약권:소진시까지)',
    '- 1000ml 프로틴트리트먼트 & 750ml 두피트리트먼트 선물',
    '',
    '* 시술내역 (2026.09.22) *',
    '매직C컬 230,000 원 사용하셔서',
    '',
    '남은 정액권은 2,464,400원입니다 : D',
  ].join('\n'));
  const multi = buildNotice({ ...TPL, prev: 300000, date: '2026-09-15', items: [{ name: '여성컷', amount: 30000 }, { name: '염색', amount: 80000 }], topup: null });
  assert.equal(multi.split('\n')[4], '* 시술내역 (2026.09.15) *', '여러 건이어도 제목 한 곳에만');
  const none = buildNotice({ ...TPL, prev: 300000, date: '', items: [{ name: '여성컷', amount: 30000 }], topup: null });
  assert.equal(none.split('\n')[4], '* 시술내역 *', '날짜를 비우면 예전 그대로');
});

test('cleanDate — 안내문·방문 기록이 같은 규칙으로 날짜를 본다', () => {
  const now = '2026-09-22T15:00:00';
  assert.equal(cleanDate('2026-09-15', now), '2026-09-15');
  assert.equal(cleanDate('', now), null, '비우면 null (그대로 둔다)');
  assert.throws(() => cleanDate('2026-09-23', now), /뒤 날짜/);
  assert.throws(() => cleanDate('2026-13-01', now), /날짜는/);
});

test('충전 없이 시술만 있으면 충전 줄이 빠진다', () => {
  const got = buildNotice({ ...TPL, prev: 300000, items: [{ name: '여성컷', amount: 30000 }], topup: null });
  assert.equal(got, [
    '* 정액권 안내드려요 *', '',
    '- 잔여 정액금 300,000원', '',
    '* 시술내역 *',
    '여성컷 30,000 원 사용하셔서', '',
    '남은 정액권은 270,000원입니다 : D',
  ].join('\n'));
});

test('시술이 여러 건이면 줄줄이 적고 합계 줄이 붙는다', () => {
  const got = buildNotice({
    ...TPL, prev: 300000,
    items: [{ name: '여성컷', amount: 30000 }, { name: '염색', amount: 80000 }, { name: '모발클리닉', amount: 50000 }],
    topup: null,
  });
  assert.deepEqual(got.split('\n').slice(4), [
    '* 시술내역 *',
    '여성컷 30,000 원',
    '염색 80,000 원',
    '모발클리닉 50,000 원',
    '합계 160,000 원 사용하셔서',
    '',
    '남은 정액권은 140,000원입니다 : D',
  ]);
});

test('조건이나 선물이 비어 있으면 그 줄은 아예 안 나온다', () => {
  const got = buildNotice({ ...TPL, prev: 0, items: [{ name: '여성컷', amount: 30000 }], topup: { name: '실버권', amount: 500000, terms: '', gift: '' } });
  assert.deepEqual(got.split('\n'), [
    '* 정액권 안내드려요 *', '',
    '- 잔여 정액금 0원',
    '- 실버권 500,000원', '',
    '* 시술내역 *',
    '여성컷 30,000 원 사용하셔서', '',
    '남은 정액권은 470,000원입니다 : D',
  ], '조건 줄과 선물 줄이 통째로 빠진다');
});

test('시술을 아직 안 적었으면 적으라고 안내한다', () => {
  const got = buildNotice({ ...TPL, prev: 100000, items: [], topup: null });
  assert.equal(got.includes('(시술 항목을 적어 주세요)'), true);
  assert.equal(got.includes('남은 정액권은 100,000원입니다 : D'), true);
});

test('이름이나 금액이 빈 줄은 문자에 안 들어간다', () => {
  const items = [{ name: '여성컷', amount: 30000 }, { name: '', amount: 0 }, { name: '  ', amount: '' }];
  assert.equal(noticeUsed(items), 30000);
  assert.equal(buildNotice({ ...TPL, prev: 0, items, topup: null }).includes('원 사용하셔서'), true);
  assert.equal(buildNotice({ ...TPL, prev: 0, items, topup: null }).includes('합계'), false, '한 줄뿐이면 합계를 안 쓴다');
});

test('머리말과 맺음말을 바꾸면 문자도 따라 바뀐다', () => {
  const got = buildNotice({ head: '오늘도 감사합니다', tail: ' 남았습니다.', prev: 50000, items: [{ name: '앞머리컷', amount: 10000 }], topup: null });
  assert.equal(got.split('\n')[0], '* 오늘도 감사합니다 *');
  assert.equal(got.split('\n').pop(), '남은 정액권은 40,000원 남았습니다.');
  const blank = buildNotice({ head: '   ', tail: '', prev: 0, items: [], topup: null });
  assert.equal(blank.split('\n')[0], '* 정액권 안내드려요 *', '머리말을 비우면 기본 문구로');
  assert.equal(blank.split('\n').pop(), '남은 정액권은 0원', '맺음말은 비울 수 있다');
});

test('남는 돈은 이전 잔액 + 충전 - 시술이다', () => {
  assert.equal(noticeRemain({ prev: 194400, items: [{ name: 'a', amount: 230000 }], topup: { amount: 2500000 } }), 2464400);
  assert.equal(noticeRemain({ prev: 100000, items: [{ name: 'a', amount: 30000 }], topup: null }), 70000);
  assert.equal(noticeRemain({ prev: 10000, items: [{ name: 'a', amount: 30000 }], topup: null }), -20000, '모자라면 음수로 보여 준다');
  assert.equal(noticeRemain({ prev: 0, items: [], topup: null }), 0);
});

test('세 자리마다 쉼표를 찍는다', () => {
  assert.equal(comma(0), '0');
  assert.equal(comma(2500000), '2,500,000');
  assert.equal(comma(-20000), '-20,000');
});

test('머리말·맺음말은 저장되고 백업에도 따라간다', () => {
  let state = createState();
  assert.equal(state.settings.head, '정액권 안내드려요');
  assert.equal(state.settings.tail, '입니다 : D');
  ({ state } = setSettings(state, { head: '오늘도 감사합니다' }));
  assert.equal(state.settings.head, '오늘도 감사합니다');
  assert.equal(state.settings.tail, '입니다 : D', '건드리지 않은 것은 그대로');
  assert.deepEqual(deserialize(serialize(state)).settings, state.settings);
});

test('쓴 정액권 상품을 기억했다가 이름으로 찾아 준다', () => {
  let state = createState();
  const gold = { name: 'Gold 예약권', amount: 2500000, terms: '사용기한:~18개월', gift: '트리트먼트' };
  ({ state } = rememberProduct(state, gold));
  ({ state } = rememberProduct(state, { name: '실버권', amount: 500000, terms: '', gift: '' }));
  assert.deepEqual(state.settings.products.map(p => p.name), ['Gold 예약권', '실버권']);
  assert.deepEqual(findProduct(state, 'Gold 예약권'), gold);
  assert.equal(findProduct(state, '없는권'), null);

  // 같은 이름을 다시 쓰면 늘지 않고 최신 내용으로 바뀐다
  ({ state } = rememberProduct(state, { name: 'Gold 예약권', amount: 3000000, terms: '사용기한:~24개월', gift: '' }));
  assert.equal(state.settings.products.length, 2);
  assert.equal(findProduct(state, 'Gold 예약권').amount, 3000000);

  // 이름이 비면 기억하지 않는다
  ({ state } = rememberProduct(state, { name: '  ', amount: 100 }));
  assert.equal(state.settings.products.length, 2);
});

test('설정이 없던 옛 백업도 기본 문구로 열린다', () => {
  const old = JSON.stringify({ nextId: 2, customers: [{ id: 1, name: '김OO' }], visits: [], today: { date: '', customerIds: [] } });
  const state = deserialize(old);
  assert.deepEqual(state.settings, { head: '정액권 안내드려요', tail: '입니다 : D', products: [] });
});

// ---------------------------------------------------------------- V2: 대시보드 재료
const { KINDS, monthlyStats, retention, overdueCustomers } = require('./store.js');

function v2State() {
  // 9월: 김OO(신규, 9/5·9/19 두 번), 이OO(예전 고객, 9/10), 박OO(신규 9/12), 최OO(8월 신규, 9/15 재방문), 정OO(8/1 이후 안 옴, 평소 30일)
  let s = createState();
  let kim, lee, park, choi, jung;
  ({ state: s, customer: kim } = addCustomer(s, { name: '김OO', phone: '01011110001' }));
  ({ state: s, customer: lee } = addCustomer(s, { name: '이OO', phone: '01011110002', isLegacy: true }));
  ({ state: s, customer: park } = addCustomer(s, { name: '박OO', phone: '01011110003' }));
  ({ state: s, customer: choi } = addCustomer(s, { name: '최OO', phone: '01011110004' }));
  ({ state: s, customer: jung } = addCustomer(s, { name: '정OO', phone: '01011110005' }));
  ({ state: s } = addVisit(s, kim.id, { done: '커트', kinds: ['커트'] }, '2026-09-05T11:00:00'));
  ({ state: s } = addVisit(s, kim.id, { done: '뿌리 염색', kinds: ['염색'] }, '2026-09-19T11:00:00'));
  ({ state: s } = addVisit(s, lee.id, { done: '커트+펌', kinds: ['커트', '펌'] }, '2026-09-10T11:00:00'));
  ({ state: s } = addVisit(s, park.id, { done: '커트' }, '2026-09-12T11:00:00'));
  ({ state: s } = addVisit(s, choi.id, { done: '커트', kinds: ['커트'] }, '2026-08-20T11:00:00'));
  ({ state: s } = addVisit(s, choi.id, { done: '커트', kinds: ['커트'] }, '2026-09-15T11:00:00'));
  ({ state: s } = addVisit(s, jung.id, { done: '커트', kinds: ['커트'] }, '2026-06-02T11:00:00'));
  ({ state: s } = addVisit(s, jung.id, { done: '커트', kinds: ['커트'] }, '2026-07-02T11:00:00'));
  ({ state: s } = addVisit(s, jung.id, { done: '커트', kinds: ['커트'] }, '2026-08-01T11:00:00'));
  return { s, kim, lee, park, choi, jung };
}

test('시술 종류 칩은 정해진 것만 받고, 없으면 빈 목록', () => {
  const { state, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001' });
  const { visit } = addVisit(state, customer.id, { done: '커트', kinds: ['커트', '펌'] }, '2026-09-05T11:00:00');
  assert.deepEqual(visit.kinds, ['커트', '펌']);
  assert.deepEqual(addVisit(state, customer.id, { done: '커트' }, '2026-09-05T11:00:00').visit.kinds, []);
  assert.throws(() => addVisit(state, customer.id, { done: '커트', kinds: ['마사지'] }, '2026-09-05T11:00:00'), /시술 종류/);
  assert.ok(KINDS.includes('커트') && KINDS.includes('기타'));
});

test('예전부터 오던 고객 체크는 만들 때와 고칠 때 둘 다 되고, 옛 데이터는 false', () => {
  let { state, customer } = addCustomer(createState(), { name: '이OO', phone: '01011110002', isLegacy: true });
  assert.equal(customer.isLegacy, true);
  ({ state } = editCustomer(state, customer.id, { name: '이OO', phone: '01011110002', referrer: '', isLegacy: false }));
  assert.equal(state.customers[0].isLegacy, false);
  const old = deserialize(JSON.stringify({ nextId: 2, customers: [{ id: 1, name: '김OO', phone: '01012345678' }], visits: [] }));
  assert.equal(old.customers[0].isLegacy, false);
});

test('월별 집계: 방문 건수와 방문 고객 수를 따로, 신규+재방문=고객 수, 시술별·회차별', () => {
  const { s } = v2State();
  const m = monthlyStats(s, '2026-09');
  assert.equal(m.visits, 5, '김 2 + 이 1 + 박 1 + 최 1');
  assert.equal(m.customers, 4);
  assert.equal(m.newCustomers, 2, '김·박. 이OO은 예전 고객이라 신규 아님');
  assert.equal(m.returning, 2, '이·최');
  assert.equal(m.perCustomer, 1.25);
  assert.deepEqual(m.kinds, { '커트': 3, '펌': 1, '염색': 1, '클리닉': 0, '기타': 0, '미분류': 1 });
  assert.deepEqual(m.rounds, { first: 1, two3: 2, fourPlus: 0, legacy: 1 });
  assert.equal(monthlyStats(s, '2026-05').visits, 0);
});

test('월별 집계는 지운 방문 기록과 지운 고객을 빼고 센다', () => {
  let { s, park } = v2State();
  const parkVisit = visitsOf(s, park.id)[0];
  ({ state: s } = deleteVisit(s, parkVisit.id, '2026-09-20T09:00:00'));
  assert.equal(monthlyStats(s, '2026-09').visits, 4);
  assert.equal(monthlyStats(s, '2026-09').customers, 3);
});

test('신규 정착률: 처음 온 달별로 150일 안에 두 번째 방문한 비율, 아직 기간이 안 지났으면 집계 중', () => {
  const { s } = v2State();
  const now = retention(s, { days: 150, today: '2026-09-20' });
  const sep = now.find(r => r.month === '2026-09');
  assert.deepEqual({ total: sep.total, returned: sep.returned, pending: sep.pending }, { total: 2, returned: 1, pending: true }, '김 돌아옴, 박 아직');
  assert.equal(now.find(r => r.month === '2026-08').returned, 1, '최 8/20 → 9/15');
  assert.ok(!now.some(r => r.month === '2026-07' && r.total > 0), '예전 고객 이OO은 어느 달에도 신규가 아니다');
  const later = retention(s, { days: 150, today: '2027-03-01' });
  assert.equal(later.find(r => r.month === '2026-06').pending, false);
  assert.equal(later.find(r => r.month === '2026-09').returned, 1);
});

test('주기 초과 고객: 평소 주기의 1.5배를 넘긴 고객만, 방문이 한 번뿐이면 제외', () => {
  const { s, jung } = v2State();
  const list = overdueCustomers(s, '2026-09-20', 1.5);
  assert.deepEqual(list.map(o => o.customer.id), [jung.id]);
  assert.equal(list[0].average, 30);
  assert.equal(list[0].sinceLast, 50);
  assert.equal(list[0].lastDate, '2026-08-01');
  assert.deepEqual(overdueCustomers(s, '2026-08-20', 1.5), [], '8/20엔 19일이라 아직');
});


// ---------------------------------------------------------------- 정액권 잔액 맞추기
const { setPassBalance } = require('./store.js');

test('잔액 맞추기: 카드 잔액과 다르면 그 차이만큼 충전 또는 사용 내역이 하나 생긴다', () => {
  let { state: s, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001' });
  let entry;
  ({ state: s, entry } = setPassBalance(s, customer.id, '300,000원', '2026-09-18T10:00:00'));
  assert.equal(passBalance(s, customer.id), 300000);
  assert.equal(entry.kind, 'charge');
  assert.match(entry.note, /잔액 맞춤/);
  ({ state: s, entry } = setPassBalance(s, customer.id, 250000, '2026-09-18T11:00:00'));
  assert.equal(passBalance(s, customer.id), 250000);
  assert.equal(entry.kind, 'use');
  assert.equal(entry.amount, 50000);
});

test('잔액 맞추기: 같은 금액이면 아무것도 안 생기고, 음수는 거부한다', () => {
  let { state: s, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001' });
  ({ state: s } = setPassBalance(s, customer.id, 100000, '2026-09-18T10:00:00'));
  const before = s.passes.length;
  const r = setPassBalance(s, customer.id, '100000', '2026-09-18T12:00:00');
  assert.equal(r.entry, null);
  assert.equal(r.state.passes.length, before);
  assert.throws(() => setPassBalance(s, customer.id, -1, '2026-09-18T12:00:00'), /잔액/);
});

// ---- 예시 손님 (시험 모드에서 로그인 없이 둘러보기용) --------------------------
test('sampleState — 시험 모드용 예시 손님: 실제 이름 없이 이번 달·지난 달·정액권·오늘 명단·주기 초과가 다 채워진다', () => {
  const { sampleState, monthlyStats, overdueCustomers } = require('./store.js');
  const today = '2026-09-27';
  const s = sampleState(today, `${today}T10:00:00`);
  assert.ok(s.customers.length >= 5, '손님 다섯 이상');
  assert.ok(s.customers.every(c => c.name.includes('예시')), '이름은 전부 "예시"가 들어간 가짜');
  assert.ok(s.customers.every(c => /^010\d{8}$/.test(c.phone)), '번호는 010 열한 자리 가짜');
  assert.ok(s.visits.length > s.customers.length, '방문 기록은 손님 수보다 많다(재방문이 있다)');
  const m = monthlyStats(s, '2026-09');
  assert.ok(m.visits >= 3 && m.newCustomers >= 1 && m.returning >= 1, `이번 달 방문·신규·재방문이 다 있다: ${JSON.stringify(m)}`);
  assert.ok(monthlyStats(s, '2026-08').visits >= 1, '지난 달 방문도 있다');
  assert.ok(s.customers.some(c => c.isLegacy), '예전부터 오던 고객이 있다');
  assert.ok(s.customers.some(c => c.referrer), '소개해 준 분이 적힌 고객이 있다');
  assert.ok(s.customers.some(c => c.profile.talk && c.profile.hair), '고정 정보가 채워진 고객이 있다');
  assert.ok(s.passes.some(p => p.kind === 'charge') && s.passes.some(p => p.kind === 'use'), '정액권 충전·사용이 있다');
  assert.ok(s.visits.some(v => v.done.includes('\n1. ')), '받아쓰기 구조(번호 줄)가 있는 시술 내용이 있다');
  assert.ok(s.visits.some(v => v.kinds.length > 0), '시술 칩이 있다');
  assert.equal(s.today.date, today);
  assert.ok(s.today.entries.length >= 2, '오늘 명단에 둘 이상');
  assert.ok(overdueCustomers(s, today).length >= 1, '주기 초과 고객이 있다');
  const back = deserialize(serialize(s));
  assert.deepEqual(back, s, '저장했다 읽어도 같다');
});

// ---- 네 항목으로 나누기 (오늘 한 시술 / 고객의 고민 / 나의 진단 / 다음 시술할 것) ----

test('splitSections — 항목 이름 없이 말한 글은 전부 시술이다', () => {
  // 순서는 원장이 정한 말하는 순서(10-01): 고민 → 진단 → 시술 → 주기 → 다음 계획. 기록 화면도 이 순서다.
  assert.deepEqual(SECTIONS.map(s => [s.key, s.name, s.label]), [
    ['concern', '고민', '고민'], ['diagnosis', '진단', '진단'], ['done', '시술', '시술'], ['cycle', '주기', '주기'], ['next', '다음 계획', '다음'],
  ]);
  assert.deepEqual(splitSections('앞머리 다듬고 숱 정리했어요'), { done: '앞머리 다듬고 숱 정리했어요', concern: '', diagnosis: '', next: '', cycle: '' });
  assert.deepEqual(splitSections(''), { done: '', concern: '', diagnosis: '', next: '', cycle: '' });
  assert.deepEqual(splitSections(null), { done: '', concern: '', diagnosis: '', next: '', cycle: '' });
});

test('splitSections — 말하면서 "고민은 … 진단은 … 다음에는 …"을 넣으면 그 자리에서 갈라진다', () => {
  const said = '앞머리 다듬고 숱 정리했어요. 고민은 옆머리가 떠요. 진단은 두상이 납작해서 그래요. 다음에는 볼륨펌 상담';
  assert.deepEqual(splitSections(said), { done: '앞머리 다듬고 숱 정리했어요.', concern: '옆머리가 떠요.', diagnosis: '두상이 납작해서 그래요.', next: '볼륨펌 상담', cycle: '' });
  // 문장 끝 점이 없어도 "~고 고민은"처럼 토씨(은·는)가 붙어 있으면 갈라진다
  assert.deepEqual(splitSections('앞머리 다듬었고 고민은 옆머리가 뜨는 거'), { done: '앞머리 다듬었고', concern: '옆머리가 뜨는 거', diagnosis: '', next: '', cycle: '' });
  // 쌍점·쉼표·줄바꿈·"/" 뒤에서도
  assert.deepEqual(splitSections('고민, 옆머리 뜸\n진단: 모질 굵음'), { done: '', concern: '옆머리 뜸', diagnosis: '모질 굵음', next: '', cycle: '' });
  assert.deepEqual(splitSections('커트 / 다음은 볼륨펌'), { done: '커트', concern: '', diagnosis: '', next: '볼륨펌', cycle: '' });
  // 조각 첫머리에서는 토씨 없이 띄어쓰기만으로도
  assert.deepEqual(splitSections('커트. 고민 옆머리 뜸'), { done: '커트.', concern: '옆머리 뜸', diagnosis: '', next: '', cycle: '' });
});

test('splitSections — 원장이 쓸 법한 여러 말이 다 같은 항목으로 간다', () => {
  const n = (t) => splitSections(t).next; const c = (t) => splitSections(t).concern; const g = (t) => splitSections(t).diagnosis; const d = (t) => splitSections(t).done;
  for (const t of ['다음은 볼륨펌', '다음엔 볼륨펌', '다음에 볼륨펌', '다음에는 볼륨펌', '다음 시술은 볼륨펌', '다음 시술할 것은 볼륨펌', '다음 방향은 볼륨펌', '다음 계획은 볼륨펌', '다음번에 볼륨펌', '다음, 볼륨펌', '다음: 볼륨펌']) assert.equal(n(t), '볼륨펌', t);
  for (const t of ['고민은 옆머리', '고객 고민은 옆머리', '고객의 고민은 옆머리', '손님 고민은 옆머리', '고객이 말한 고민은 옆머리']) assert.equal(c(t), '옆머리', t);
  for (const t of ['진단은 모질', '나의 진단은 모질', '내 진단은 모질', '진단: 모질']) assert.equal(g(t), '모질', t);
  for (const t of ['시술은 커트', '오늘 시술은 커트', '오늘 한 시술은 커트', '시술 내용은 커트', '시술: 커트']) assert.equal(d(t), '커트', t);
});

test('splitSections — 다른 말의 일부거나 번호 항목 안이면 갈림 자리가 아니다', () => {
  assert.deepEqual(splitSections('시술 후 만족해함'), { done: '시술 후 만족해함', concern: '', diagnosis: '', next: '', cycle: '' }, '"시술 후"');
  assert.deepEqual(splitSections('다음 주에 다시 오기로 함'), { done: '다음 주에 다시 오기로 함', concern: '', diagnosis: '', next: '', cycle: '' }, '"다음 주"');
  assert.deepEqual(splitSections('고민이 많다고 함').concern, '', '"고민이 많다"는 항목 이름이 아니라 문장의 일부');
  const recipe = '펌 레시피:\n1. 시술: 가슴윗기장 포워드레이어드\n(a) 매직 후 파랑 한바퀴반\n2. 다음: C컬로 펴주고 중화';
  assert.deepEqual(splitSections(recipe), { done: recipe, concern: '', diagnosis: '', next: '', cycle: '' }, '번호 뒤의 "다음:"은 순서 항목');
  assert.deepEqual(splitSections('• 고민: 옆머리\n• 다음: 볼륨펌'), { done: '', concern: '옆머리', diagnosis: '', next: '볼륨펌', cycle: '' }, '표시(•)만 있는 줄 처음의 이름은 가른다(받아쓰기 앱의 꾸밈, 10-02)');
  assert.deepEqual(splitSections('펌. 다음은 커트').next, '커트', '"펌."처럼 한 글자 낱말 뒤의 점은 목록 표시가 아니다');
  // 띄어쓰기만으로 갈라지는 건 낱말 그대로일 때만. "다음번 복직하기 전에는 …"은 말의 일부라 그대로 시술에 남는다
  const free = '뒷머리는 상고로 라인 올려서 다듬었고, 다음번 복직하기 전에는 롤스트레이트를 권했어. 요즘 수영을 다녀서 걱정하고 있음';
  assert.deepEqual(splitSections(free), { done: free, concern: '', diagnosis: '', next: '', cycle: '' }, '"다음번 복직하기"');
  assert.deepEqual(splitSections('요청 사항: 앞머리 짧게').concern, '', '"요청 사항"은 항목 이름이 아니다');
});

test('splitSections — 전부터 쓰던 이름표 "원인"은 진단으로, "요청"은 고민으로 들어간다', () => {
  assert.deepEqual(splitSections('시술, 세미 투블럭. 다음, 복직 전 롤스트레이트 권함. 고민, 가라앉음. 원인, 수영 후 덜 말려 꼬불거림.'),
    { done: '세미 투블럭.', concern: '가라앉음.', diagnosis: '수영 후 덜 말려 꼬불거림.', next: '복직 전 롤스트레이트 권함.', cycle: '' });
  assert.deepEqual(splitSections('커트. 요청은 앞머리 짧게. 원인은 모질이 굵음'), { done: '커트.', concern: '앞머리 짧게.', diagnosis: '모질이 굵음', next: '', cycle: '' });
  assert.equal(joinSections(splitSections('커트. 원인은 모질이 굵음')), '진단: 모질이 굵음\n시술: 커트.', '정리하면 "진단:"으로 적히고 순서는 진단이 먼저');
});

test('splitSections — 같은 항목을 두 번 말하면 이어 붙고, 항목 안의 구조는 그대로 남는다', () => {
  assert.deepEqual(splitSections('고민은 옆머리 뜸. 진단은 모질 굵음. 고민은 앞머리 답답').concern, '옆머리 뜸.\n앞머리 답답');
  assert.deepEqual(splitSections('커트\n고민:\n- 옆머리 뜸\n- 앞머리 답답\n다음: 볼륨펌'), { done: '커트', concern: '- 옆머리 뜸\n- 앞머리 답답', diagnosis: '', next: '볼륨펌', cycle: '' });
  // "다음 시술은"에서 안쪽의 "시술은"이 또 시술 항목으로 잡히지 않는다
  assert.deepEqual(splitSections('커트. 다음 시술은 볼륨펌'), { done: '커트.', concern: '', diagnosis: '', next: '볼륨펌', cycle: '' });
});

test('joinSections — 항목을 말하는 순서대로 "고민: …" 줄로 이어 붙이고, 다시 나눠도 같다', () => {
  // 시술은 맨 앞이면 이름 없이, 앞에 다른 항목이 있으면 "시술: "을 붙인다(안 붙이면 앞 항목에 딸려 들어간다)
  assert.equal(joinSections({ done: '커트', concern: '옆머리 뜸', diagnosis: '', next: '볼륨펌' }), '고민: 옆머리 뜸\n시술: 커트\n다음: 볼륨펌');
  assert.equal(joinSections({ done: '', concern: '옆머리 뜸', diagnosis: '모질', next: '' }), '고민: 옆머리 뜸\n진단: 모질', '시술이 비어도 된다');
  assert.equal(joinSections({ done: '커트', concern: '', diagnosis: '', next: '' }), '커트', '시술만 있으면 이름 없이 그대로');
  assert.equal(joinSections({ done: '커트', concern: '', diagnosis: '', next: '볼륨펌', cycle: '5주' }), '커트\n주기: 5주\n다음: 볼륨펌', '주기가 다음 계획보다 앞');
  const said = '앞머리 다듬고 숱 정리했어요. 고민은 옆머리가 떠요. 진단은 두상이 납작해서 그래요. 다음에는 볼륨펌 상담';
  const once = joinSections(splitSections(said));
  assert.equal(once, '고민: 옆머리가 떠요.\n진단: 두상이 납작해서 그래요.\n시술: 앞머리 다듬고 숱 정리했어요.\n다음: 볼륨펌 상담');
  assert.equal(joinSections(splitSections(once)), once, '한 번 정리한 글은 다시 정리해도 그대로');
  const multi = joinSections({ done: '커트', concern: '- 옆머리 뜸\n- 앞머리 답답', diagnosis: '', next: '볼륨펌', cycle: '' });
  assert.deepEqual(splitSections(multi), { done: '커트', concern: '- 옆머리 뜸\n- 앞머리 답답', diagnosis: '', next: '볼륨펌', cycle: '' }, '여러 줄 항목도 되돌아온다');
  const structured = joinSections({ done: '[오늘 시술 내용]\n• 커트:\n  • 사이드뱅: 코끝부터', concern: '옆머리 뜸', diagnosis: '', next: '' });
  assert.deepEqual(splitSections(structured).done, '[오늘 시술 내용]\n• 커트:\n  • 사이드뱅: 코끝부터', '구조 있는 시술 글도 "시술: " 뒤에 그대로 되돌아온다');
});

test('addVisit·editVisit — 저장할 때 네 항목으로 나눠 정리해 둔다. 시술 없이 고민만 말해도 기록이 된다', () => {
  let state = createState();
  const kim = addCustomer(state, { name: '예시 김', phone: '010-0000-0001' }); state = kim.state;
  let visit;
  ({ state, visit } = addVisit(state, kim.customer.id, { done: '앞머리 다듬었어요. 고민은 옆머리가 떠요. 다음에는 볼륨펌 상담' }, '2026-09-29T14:00:00'));
  assert.equal(visit.done, '고민: 옆머리가 떠요.\n시술: 앞머리 다듬었어요.\n다음: 볼륨펌 상담');
  ({ state, visit } = addVisit(state, kim.customer.id, { done: '고민은 옆머리 뜸. 다음에 볼륨펌' }, '2026-09-29T15:00:00'));
  assert.equal(visit.done, '고민: 옆머리 뜸.\n다음: 볼륨펌', '시술 항목이 비어도 저장된다');
  assert.throws(() => addVisit(state, kim.customer.id, { done: '  ' }, '2026-09-29T16:00:00'), /시술/, '아무것도 없으면 안 된다');
  ({ state, visit } = editVisit(state, visit.id, { done: '고민: 옆머리 뜸\n진단은 모질이 굵어서' }, '2026-09-29T17:00:00'));
  assert.equal(visit.done, '고민: 옆머리 뜸\n진단: 모질이 굵어서', '고칠 때도 정리한다');
  assert.equal(visit.history[0].done, '고민: 옆머리 뜸.\n다음: 볼륨펌', '고치기 전 것은 이력에');
  // 옛 기록(구조 있는 레시피)은 그대로다
  ({ state, visit } = addVisit(state, kim.customer.id, { done: '펌 레시피:\n1. 시술: 포워드\n2. 다음: 중화' }, '2026-09-29T18:00:00'));
  assert.equal(visit.done, '펌 레시피:\n1. 시술: 포워드\n2. 다음: 중화');
});

test('splitSections — 받아쓰기 앱이 붙인 표시(•) 뒤의 이름도 갈라지고, 빈 점 줄과 빈 항목은 버린다 (10-02 원장 화면)', () => {
  // 원장 화면 재현: 글 끝에 "• 진단:"과 "•"가 남아 진단 제목이 둘로 보였다
  const t = '고민: 가운데 프론트 볼륨이 너무 없이 내려오는 점\n진단: 가르마 갈라지는 부분 기장이 너무 길어졌고 · 앞머리에 곱슬이 생겨 모양이 안 잡힘 (정확한\n불명)\n• 진단:\n•';
  assert.deepEqual(splitSections(t), { done: '', concern: '가운데 프론트 볼륨이 너무 없이 내려오는 점', diagnosis: '가르마 갈라지는 부분 기장이 너무 길어졌고 · 앞머리에 곱슬이 생겨 모양이 안 잡힘 (정확한\n불명)', next: '', cycle: '' });
  assert.deepEqual(splitSections('• 고민: 볼륨 없음\n• 진단: 기장 길어짐'), { done: '', concern: '볼륨 없음', diagnosis: '기장 길어짐', next: '', cycle: '' }, '표시 뒤의 이름은 항목');
  assert.deepEqual(splitSections('- 고민은 볼륨 없음\n- 다음은 볼륨펌'), { done: '', concern: '볼륨 없음', diagnosis: '', next: '볼륨펌', cycle: '' }, '"-" 표시도');
  const recipe = '펌 레시피:\n1. 시술: 가슴윗기장 포워드레이어드\n2. 다음: C컬로 펴주고 중화';
  assert.deepEqual(splitSections(recipe).done, recipe, '번호 뒤의 "다음:"은 여전히 순서 항목(레시피)');
  assert.deepEqual(splitSections('커트\n(a) 다음: 중화').done, '커트\n(a) 다음: 중화', '붙임 글자 뒤도 순서 항목');
  // 문장 끝 점·쉼표 바로 뒤에 띄어쓰기 없이 이름이 와도 갈라진다 (받아쓰기 앱이 공백을 빼먹을 때)
  assert.deepEqual(splitSections('내려오는 점.진단, 가르마 길어짐'), { done: '내려오는 점.', concern: '', diagnosis: '가르마 길어짐', next: '', cycle: '' });
  assert.deepEqual(splitSections('볼륨 없음,다음은 볼륨펌').next, '볼륨펌');
  // 이름만 있고 내용이 없으면 항목을 만들지 않는다
  assert.deepEqual(splitSections('커트. 진단:'), { done: '커트.', concern: '', diagnosis: '', next: '', cycle: '' });
  assert.equal(joinSections(splitSections(t)), '고민: 가운데 프론트 볼륨이 너무 없이 내려오는 점\n진단: 가르마 갈라지는 부분 기장이 너무 길어졌고 · 앞머리에 곱슬이 생겨 모양이 안 잡힘 (정확한\n불명)', '정리하면 빈 진단과 빈 점은 사라진다');
});

test('noteOutline — 내용 없는 점 줄("•")은 그리지 않는다', () => {
  assert.deepEqual(noteOutline('• 가르마 길어짐\n•\n• 곱슬 생김'), [
    { kind: 'item', level: 0, text: '가르마 길어짐' }, { kind: 'item', level: 0, text: '곱슬 생김' },
  ]);
  assert.deepEqual(noteOutline('고민:\n• 볼륨 없음\n• '), [
    { kind: 'heading', level: 0, text: '고민' }, { kind: 'item', level: 1, text: '볼륨 없음' },
  ], '끝의 빈 점도');
});

test('noteLabel — "진단"도 이름표다', () => {
  assert.deepEqual(noteLabel('진단: 모질이 굵고 두상이 납작함'), { label: '진단', text: '모질이 굵고 두상이 납작함' });
});

// ---- 방문 주기 항목과 다음 예약 날짜 ----

test('splitSections — "주기는 5주", "다음 예약은 6주 뒤"는 방문 주기 항목이다', () => {
  for (const t of ['주기는 5주', '방문 주기는 5주', '재방문 주기는 5주', '주기: 5주', '주기, 5주', '예약은 5주', '다음 예약은 5주']) assert.equal(splitSections(t).cycle, '5주', t);
  assert.deepEqual(splitSections('커트. 다음에는 볼륨펌 상담. 다음 예약은 6주 뒤'), { done: '커트.', concern: '', diagnosis: '', next: '볼륨펌 상담.', cycle: '6주 뒤' }, '"다음 예약은"은 다음이 아니라 주기');
  assert.deepEqual(splitSections('커트. 주기 5주'), { done: '커트.', concern: '', diagnosis: '', next: '', cycle: '5주' }, '조각 첫머리면 "주기"만 말해도');
  assert.equal(splitSections('예약 잡아 드림').cycle, '', '"예약 잡아 드림"은 항목 이름이 아니다');
  assert.equal(splitSections('주기가 좀 긴 편').cycle, '', '"주기가"는 문장의 일부');
  assert.equal(joinSections({ done: '커트', concern: '', diagnosis: '', next: '볼륨펌', cycle: '5주' }), '커트\n주기: 5주\n다음: 볼륨펌');
  assert.equal(joinSections(splitSections('커트. 주기는 5주')), '커트.\n주기: 5주');
});

test('cycleSpan — 주기 글에서 숫자를 읽는다. 못 읽으면 null', () => {
  assert.deepEqual(cycleSpan('5주'), { kind: 'span', from: 5, to: 5, unit: 'week' });
  assert.deepEqual(cycleSpan('6주 뒤'), { kind: 'span', from: 6, to: 6, unit: 'week' });
  assert.deepEqual(cycleSpan('한 달'), { kind: 'span', from: 1, to: 1, unit: 'month' });
  assert.deepEqual(cycleSpan('한 달 반'), { kind: 'span', from: 1.5, to: 1.5, unit: 'month' });
  assert.deepEqual(cycleSpan('2개월마다'), { kind: 'span', from: 2, to: 2, unit: 'month' });
  assert.deepEqual(cycleSpan('45일'), { kind: 'span', from: 45, to: 45, unit: 'day' });
  assert.deepEqual(cycleSpan('4~5주'), { kind: 'span', from: 4, to: 5, unit: 'week' });
  assert.deepEqual(cycleSpan('4에서 6주 사이'), { kind: 'span', from: 4, to: 6, unit: 'week' });
  assert.deepEqual(cycleSpan('11월 3일에 예약'), { kind: 'date', month: 11, day: 3 }, '날짜를 말하면 날짜로');
  assert.equal(cycleSpan('여름 전에'), null);
  assert.equal(cycleSpan(''), null);
});

test('cycleDue — 마지막 방문 날짜에 주기를 더해 다음 예약 즈음을 낸다', () => {
  assert.deepEqual(cycleDue('2026-09-28', '5주'), { from: '2026-11-02', to: '2026-11-02' });
  assert.deepEqual(cycleDue('2026-09-28', '4~5주'), { from: '2026-10-26', to: '2026-11-02' });
  assert.deepEqual(cycleDue('2026-09-28', '한 달'), { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual(cycleDue('2026-01-31', '한 달'), { from: '2026-02-28', to: '2026-02-28' }, '달을 더할 때 없는 날은 그 달 마지막 날');
  assert.deepEqual(cycleDue('2026-09-28', '한 달 반'), { from: '2026-11-12', to: '2026-11-12' }, '반 달은 15일');
  assert.deepEqual(cycleDue('2026-09-28', '45일'), { from: '2026-11-12', to: '2026-11-12' });
  assert.deepEqual(cycleDue('2026-09-28', '11월 3일'), { from: '2026-11-03', to: '2026-11-03' }, '날짜를 말했으면 그 날짜');
  assert.deepEqual(cycleDue('2026-11-20', '1월 5일'), { from: '2027-01-05', to: '2027-01-05' }, '지난 날짜면 다음 해');
  assert.equal(cycleDue('2026-09-28', '여름 전에'), null, '숫자가 없으면 계산하지 않는다');
});

test('recommendedCycle — 가장 최근에 말한 주기를, 마지막 방문 날짜 기준으로 낸다', () => {
  let state = createState();
  const kim = addCustomer(state, { name: '예시 김', phone: '010-0000-0001' }); state = kim.state;
  const id = kim.customer.id;
  assert.equal(recommendedCycle(state, id), null, '기록이 없으면 없다');
  ({ state } = addVisit(state, id, { done: '커트' }, '2026-07-01T10:00:00'));
  assert.equal(recommendedCycle(state, id), null, '주기를 말한 기록이 없으면 없다');
  ({ state } = addVisit(state, id, { done: '커트. 주기는 5주' }, '2026-08-01T10:00:00'));
  assert.deepEqual(recommendedCycle(state, id), { text: '5주', saidOn: '2026-08-01', base: '2026-08-01', due: { from: '2026-09-05', to: '2026-09-05' } });
  // 그 뒤에 주기를 안 말하고 다녀가면, 권한 주기는 그대로이고 날짜는 마지막 방문에서 다시 센다
  let v;
  ({ state, visit: v } = addVisit(state, id, { done: '앞머리만' }, '2026-09-10T10:00:00'));
  assert.deepEqual(recommendedCycle(state, id), { text: '5주', saidOn: '2026-08-01', base: '2026-09-10', due: { from: '2026-10-15', to: '2026-10-15' } });
  // 새로 말하면 바뀐다. 숫자가 아니면 날짜는 없다
  ({ state, visit: v } = addVisit(state, id, { done: '펌. 주기는 여름 전에 한 번' }, '2026-09-28T10:00:00'));
  assert.deepEqual(recommendedCycle(state, id), { text: '여름 전에 한 번', saidOn: '2026-09-28', base: '2026-09-28', due: null });
  // 지운 기록은 안 본다
  ({ state } = deleteVisit(state, v.id, '2026-09-29T10:00:00'));
  assert.deepEqual(recommendedCycle(state, id).text, '5주');
});

// ---- 가족 (10-07 원장 결정: 정액권을 가족이 잔액 하나로 함께 쓴다. 묶을 때 잔액은 합친다) ----

function familySeed() {
  let state = createState();
  const mk = (name, phone) => { const r = addCustomer(state, { name, phone }); state = r.state; return r.customer.id; };
  const a = mk('고객 A', '010-0000-1001'), b = mk('고객 B', '010-0000-1002'), c = mk('고객 C', '010-0000-1003'), d = mk('고객 D', '010-0000-1004');
  state = chargePass(state, a, { amount: '10만' }, '2026-10-01T10:00:00').state;
  state = chargePass(state, b, { amount: '5만' }, '2026-10-02T10:00:00').state;
  return { state, a, b, c, d };
}

test('joinFamily — 묶으면 잔액이 합쳐지고, 가족 누구의 카드에서 봐도 같은 잔액이다', () => {
  let { state, a, b, c } = familySeed();
  assert.equal(passBalance(state, a), 100000); assert.equal(passBalance(state, b), 50000);
  state = joinFamily(state, b, a).state;
  assert.equal(passBalance(state, a), 150000); assert.equal(passBalance(state, b), 150000, '10만 + 5만');
  assert.deepEqual(familyOf(state, a).map(x => x.name), ['고객 A', '고객 B']);
  assert.deepEqual(familyOf(state, c).map(x => x.name), ['고객 C'], '가족이 없으면 자기 혼자');
  // 셋째도 묶을 수 있다. 누구를 골라도 같은 가족으로 들어간다
  state = joinFamily(state, c, b).state;
  assert.deepEqual(familyOf(state, c).map(x => x.name), ['고객 A', '고객 B', '고객 C']);
  assert.throws(() => joinFamily(state, a, c), /이미 같은 가족/);
  assert.throws(() => joinFamily(state, a, a), /자기 자신/);
  assert.equal(totalPassBalance(state), 150000, '전체 잔액 합계는 가족을 두 번 세지 않는다');
});

test('가족 정액권 — 누가 와서 쓰든 함께 빠지고, 내역에는 쓴 사람이 남는다. 가족 잔액보다 많이는 못 쓴다', () => {
  let { state, a, b } = familySeed();
  state = joinFamily(state, b, a).state;
  state = usePass(state, b, { amount: '12만', note: '펌' }, '2026-10-07T10:00:00').state;   // B 혼자였다면 5만이라 막혔을 금액
  assert.equal(passBalance(state, a), 30000); assert.equal(passBalance(state, b), 30000);
  const list = passEntriesOf(state, a);
  assert.deepEqual(list.map(e => [e.customerId, e.kind, e.amount]), [[b, 'use', 120000], [b, 'charge', 50000], [a, 'charge', 100000]], 'A의 카드에서도 B가 쓴 것이 보인다(최신순)');
  assert.equal(passSummary(state, b).count, 3);
  assert.throws(() => usePass(state, a, { amount: '5만' }, '2026-10-07T11:00:00'), /잔액\(30,000원\)/);
  // 잔액 맞춤도 가족 잔액 기준
  state = setPassBalance(state, a, '20만', '2026-10-07T12:00:00').state;
  assert.equal(passBalance(state, b), 200000);
});

test('가족끼리 묶인 둘이 각자 가족이 있으면 두 가족이 하나가 된다', () => {
  let { state, a, b, c, d } = familySeed();
  state = joinFamily(state, b, a).state;
  state = chargePass(state, d, { amount: '3만' }, '2026-10-03T10:00:00').state;
  state = joinFamily(state, d, c).state;
  state = joinFamily(state, c, a).state;
  assert.deepEqual(familyOf(state, d).map(x => x.name), ['고객 A', '고객 B', '고객 C', '고객 D']);
  assert.equal(passBalance(state, d), 180000);
});

test('leaveFamily — 빼면 그 사람 이름으로 적힌 충전·사용만 따라 나간다. 둘이던 가족은 풀린다', () => {
  let { state, a, b, c } = familySeed();
  state = joinFamily(state, b, a).state;
  state = joinFamily(state, c, a).state;
  state = usePass(state, c, { amount: '2만' }, '2026-10-07T10:00:00').state;
  state = leaveFamily(state, b).state;
  assert.equal(passBalance(state, b), 50000, 'B가 넣은 5만은 B에게');
  assert.equal(passBalance(state, a), 80000, '남은 가족: A 10만 - C가 쓴 2만');
  assert.deepEqual(familyOf(state, a).map(x => x.name), ['고객 A', '고객 C']);
  // 대표(처음 고른 사람)가 빠져도 남은 가족은 그대로 묶여 있다
  state = joinFamily(state, b, a).state;
  state = leaveFamily(state, a).state;
  assert.deepEqual(familyOf(state, b).map(x => x.name), ['고객 B', '고객 C']);
  // 둘만 남은 가족에서 하나가 빠지면 가족이 없어진다
  state = leaveFamily(state, c).state;
  assert.deepEqual(familyOf(state, b).map(x => x.name), ['고객 B']);
  assert.equal(state.customers.find(x => x.id === b).familyId, null);
  assert.throws(() => leaveFamily(state, b), /가족으로 묶여 있지 않습니다/);
});

test('가족 — 지운(감춘) 가족도 잔액에는 남고, 완전히 지우면 그 사람의 충전·사용은 남은 가족에게 넘어가 잔액이 그대로다', () => {
  let { state, a, b } = familySeed();
  state = joinFamily(state, b, a).state;
  state = deleteCustomer(state, b, '2026-10-07T10:00:00').state;
  assert.equal(passBalance(state, a), 150000, '감추기만 했으니 잔액 그대로');
  assert.deepEqual(familyOf(state, a).map(x => x.name), ['고객 A'], '보이는 가족에는 안 나온다');
  state = purgeCustomer(state, b).state;
  assert.equal(passBalance(state, a), 150000, '완전히 지워도 가족 돈은 그대로');
  assert.equal(state.customers.find(x => x.id === a).familyId, null, '혼자 남으면 가족이 풀린다');
  assert.ok(state.passes.every(p => p.customerId !== b));
});

test('buildNotice — 가족 정액권이면 두 줄에 "가족"이 붙는다. 혼자면 쓰던 문장 그대로', () => {
  const base = { head: '정액권 안내드려요', tail: '입니다 : D', prev: 150000, items: [{ name: '커트', amount: 20000 }], date: '2026-10-07' };
  const solo = buildNotice(base);
  assert.ok(solo.includes('- 잔여 정액금 150,000원') && solo.includes('남은 정액권은 130,000원입니다 : D'));
  const fam = buildNotice({ ...base, family: true });
  assert.ok(fam.includes('- 가족 잔여 정액금 150,000원'), fam);
  assert.ok(fam.includes('남은 가족 정액권은 130,000원입니다 : D'), fam);
  assert.equal(fam.replace(/가족 /g, ''), solo, '나머지는 한 글자도 안 바뀐다');
});

test('migrate — 가족 번호가 없는 옛 백업 고객은 가족 없음, 저장했다 꺼내도 가족은 그대로', () => {
  let { state, a, b } = familySeed();
  state = joinFamily(state, b, a).state;
  const back = deserialize(serialize(state));
  assert.equal(passBalance(back, b), 150000);
  const old = JSON.parse(serialize(state));
  old.customers = old.customers.map(({ familyId, ...rest }) => rest);
  assert.ok(deserialize(JSON.stringify(old)).customers.every(c => c.familyId === null));
});

// ---- 고객 관리 · 고객 동향 (10-08 원장) ----
const { customerCounts, trendMonths, recentNewCustomers } = require('./store.js');

test('customerCounts — 살아 있는 고객 수, 그중 예전 고객·카드 뒤 고객·아직 기록 없는 고객', () => {
  let { s } = v2State();
  let none;
  ({ state: s, customer: none } = addCustomer(s, { name: '고객 A', phone: '01011110006' }));
  assert.deepEqual(customerCounts(s), { total: 6, legacy: 1, fresh: 5, noVisit: 1 });
  s = deleteCustomer(s, none.id, '2026-09-20T10:00:00').state;
  assert.deepEqual(customerCounts(s), { total: 5, legacy: 1, fresh: 4, noVisit: 0 }, '지운 고객은 안 센다');
  assert.deepEqual(customerCounts(createState()), { total: 0, legacy: 0, fresh: 0, noVisit: 0 });
});

test('trendMonths — 최근 n달의 방문 고객·신규·재방문. 기록이 시작된 달보다 앞은 안 보인다(추정하지 않음)', () => {
  const { s } = v2State();
  const t = trendMonths(s, '2026-09-20', 6);
  assert.deepEqual(t.map((m) => m.month), ['2026-06', '2026-07', '2026-08', '2026-09'], '6달을 달라 해도 기록은 6월부터');
  const sep = t[3];
  assert.deepEqual([sep.customers, sep.newCustomers, sep.returning, sep.visits], [4, 2, 2, 5]);
  assert.deepEqual(trendMonths(s, '2026-09-20', 2).map((m) => m.month), ['2026-08', '2026-09']);
  assert.deepEqual(trendMonths(s, '2026-11-02', 2).map((m) => m.month), ['2026-10', '2026-11'], '방문 없는 달도 0으로 보인다');
  assert.deepEqual(trendMonths(createState(), '2026-09-20', 6), []);
});

test('recentNewCustomers — 최근 며칠 안에 처음 온 신규 고객과 두 번째로 왔는지. 예전 고객은 빼고 최근 것부터', () => {
  const { s } = v2State();
  const r = recentNewCustomers(s, '2026-09-20', 60);
  assert.deepEqual(r.map((x) => [x.customer.name, x.firstDate, x.visits, x.returned]), [
    ['박OO', '2026-09-12', 1, false],
    ['김OO', '2026-09-05', 2, true],
    ['최OO', '2026-08-20', 2, true],
  ]);
  assert.deepEqual(recentNewCustomers(s, '2026-09-20', 10).map((x) => x.customer.name), ['박OO']);
});

// ---- 고객 관리: 다시 올 때 된 고객 · 정액권 남은 고객 (10-08 원장 1·2번) ----
const { dueCustomers, passHolders } = require('./store.js');

test('dueCustomers — 원장이 권한 주기가 지났거나 7일 안에 다가오는 고객. 지난 것부터, 숫자 없는 주기는 빼고(추정 안 함)', () => {
  let s = createState();
  const mk = (name, phone) => { const r = addCustomer(s, { name, phone }); s = r.state; return r.customer.id; };
  const a = mk('고객 A', '01000000001'), b = mk('고객 B', '01000000002'), c = mk('고객 C', '01000000003'), d = mk('고객 D', '01000000004'), e = mk('고객 E', '01000000005');
  s = addVisit(s, a, { done: '커트. 주기: 5주' }, '2026-08-20T10:00:00').state;          // 9/24 → 10/8에 14일 지남
  s = addVisit(s, b, { done: '뿌리 염색. 주기: 4주' }, '2026-09-12T10:00:00').state;      // 10/10 → 2일 남음
  s = addVisit(s, c, { done: '펌. 주기: 3달' }, '2026-09-01T10:00:00').state;            // 12/1 → 멀었음
  s = addVisit(s, d, { done: '커트. 주기: 여름 전에 한 번' }, '2026-07-01T10:00:00').state; // 숫자 없음
  s = addVisit(s, e, { done: '커트. 주기: 4주' }, '2026-08-01T10:00:00').state;
  s = addVisit(s, e, { done: '커트' }, '2026-10-01T10:00:00').state;                     // 다시 왔으니 10/29 기준
  s = markToday(s, a, '2026-10-08', '14:00').state;
  const r = dueCustomers(s, '2026-10-08');
  assert.deepEqual(r.map((x) => [x.customer.name, x.due.from, x.days, x.text, x.onToday]), [
    ['고객 A', '2026-09-24', 14, '5주', true],
    ['고객 B', '2026-10-10', -2, '4주', false],
  ]);
  assert.equal(r[0].lastDate, '2026-08-20');
  s = deleteCustomer(s, a, '2026-10-08T09:00:00').state;
  assert.deepEqual(dueCustomers(s, '2026-10-08').map((x) => x.customer.name), ['고객 B'], '지운 고객은 빠진다');
  assert.deepEqual(dueCustomers(s, '2026-10-08', 0).map((x) => x.customer.name), [], '다가오는 날수를 0으로 하면 지난 것만');
});

test('passHolders — 정액권이 남은 고객을 잔액 큰 순으로. 가족은 한 줄(잔액 하나), 마지막 방문은 가족 중 가장 최근', () => {
  let s = createState();
  const mk = (name, phone) => { const r = addCustomer(s, { name, phone }); s = r.state; return r.customer.id; };
  const a = mk('고객 A', '01000000001'), b = mk('고객 B', '01000000002'), c = mk('고객 C', '01000000003'), d = mk('고객 D', '01000000004');
  s = chargePass(s, a, { amount: '100000' }, '2026-08-01T10:00:00').state;
  s = chargePass(s, b, { amount: '300000' }, '2026-08-01T10:00:00').state;
  s = chargePass(s, c, { amount: '200000' }, '2026-08-01T10:00:00').state;
  s = usePass(s, c, { amount: '200000' }, '2026-09-01T10:00:00').state;                // 0원은 빠진다
  s = joinFamily(s, d, b).state;                                                         // B·D 가족
  s = addVisit(s, b, { done: '커트' }, '2026-08-10T10:00:00').state;
  s = addVisit(s, d, { done: '커트' }, '2026-09-28T10:00:00').state;
  const r = passHolders(s, '2026-10-08');
  assert.deepEqual(r.map((x) => [x.members.map((m) => m.name), x.balance, x.lastDate, x.sinceLast]), [
    [['고객 B', '고객 D'], 300000, '2026-09-28', 10],
    [['고객 A'], 100000, null, null],
  ]);
  s = deleteCustomer(s, a, '2026-10-08T09:00:00').state;
  assert.deepEqual(passHolders(s, '2026-10-08').map((x) => x.balance), [300000], '지운 고객(가족 모두 지움)은 빠진다');
});

// ---- 선예약 연락 (10-09 원장) ----
const { preBookDates, preBookTargets, setPreBookMark, markPreBook, preBookMessage, setPreBookText, PREBOOK_TEXT, dateKo } = require('./store.js');

test('preBookDates — 말일에 다다음달 예약이 열리고, 선예약은 말일 2일 전, 회신은 말일 하루 전까지, 전날 알림은 말일 3일 전', () => {
  assert.deepEqual(preBookDates('2026-10-09'), { month: '2026-12', eve: '2026-10-28', day: '2026-10-29', replyBy: '2026-10-30', open: '2026-10-31', phase: null });
  assert.equal(preBookDates('2026-10-28').phase, 'eve');
  assert.equal(preBookDates('2026-10-29').phase, 'day');
  assert.equal(preBookDates('2026-10-30').phase, 'after', '회신 기다리는 날');
  assert.equal(preBookDates('2026-10-31').phase, 'after', '일반 오픈 날까지 상자가 남는다');
  const nov = preBookDates('2026-11-01');
  assert.deepEqual([nov.month, nov.day, nov.open], ['2027-01', '2026-11-28', '2026-11-30'], '11월은 30일이 말일, 해가 넘어간다');
  assert.equal(preBookDates('2027-02-10').day, '2027-02-26', '2월(28일)');
  assert.equal(dateKo('2026-10-30'), '10월 30일(금)');
});

test('preBookTargets — 정액권 남은 고객 전부(가족은 한 줄) + 원장이 넣은 고객, 원장이 뺀 고객은 빠진다', () => {
  let s = createState();
  const mk = (name, phone) => { const r = addCustomer(s, { name, phone }); s = r.state; return r.customer.id; };
  const a = mk('고객 A', '01000000001'), b = mk('고객 B', '01000000002'), c = mk('고객 C', '01000000003'), d = mk('고객 D', '01000000004'), e = mk('고객 E', '01000000005');
  s = chargePass(s, a, { amount: '100000' }, '2026-08-01T10:00:00').state;
  s = chargePass(s, b, { amount: '300000' }, '2026-08-01T10:00:00').state;
  s = joinFamily(s, c, b).state;                                                 // B·C 가족
  s = chargePass(s, d, { amount: '50000' }, '2026-08-01T10:00:00').state;
  const names = (st) => preBookTargets(st, '2026-10-29').map((r) => [r.members.map((m) => m.name).join('·'), r.why]);
  assert.deepEqual(names(s), [['고객 A', 'pass'], ['고객 B·고객 C', 'pass'], ['고객 D', 'pass']], '처음엔 정액권 남은 고객 전부, 등록 순');
  s = setPreBookMark(s, e, 'in').state;                                          // 정액권 없지만 예약권 고객
  s = setPreBookMark(s, d, 'out').state;
  assert.deepEqual(names(s), [['고객 A', 'pass'], ['고객 B·고객 C', 'pass'], ['고객 E', 'in']]);
  s = setPreBookMark(s, c, 'out').state;
  assert.deepEqual(names(s).map((x) => x[0]), ['고객 A', '고객 E'], '가족 중 한 사람을 빼면 그 가족 줄이 빠진다');
  s = setPreBookMark(s, c, null).state;
  assert.equal(names(s).length, 3, '되돌리면 다시 자동');
  assert.deepEqual(deserialize(serialize(s)).settings.preBookMarks, { in: [e], out: [d] }, '백업·복원 뒤에도 남는다');
  s = deleteCustomer(s, e, '2026-10-29T09:00:00').state;
  assert.deepEqual(names(s).map((x) => x[0]), ['고객 A', '고객 B·고객 C'], '지운 고객은 빠진다');
});

test('markPreBook — 달마다 보냄·예약함을 남긴다. 다시 누르면 지운다. 여섯 달 지난 기록은 백업에서 버린다', () => {
  let s = createState();
  const r = addCustomer(s, { name: '고객 A', phone: '01000000001' }); s = r.state; const a = r.customer.id;
  s = chargePass(s, a, { amount: '100000' }, '2026-08-01T10:00:00').state;
  s = markPreBook(s, '2026-12', a, 'sent', '2026-10-29T10:12:00').state;
  let row = preBookTargets(s, '2026-10-29')[0];
  assert.deepEqual(row.status, { sent: '2026-10-29T10:12:00' });
  s = markPreBook(s, '2026-12', a, 'booked', '2026-10-29T11:00:00').state;
  assert.deepEqual(preBookTargets(s, '2026-10-29')[0].status, { sent: '2026-10-29T10:12:00', booked: '2026-10-29T11:00:00' });
  assert.deepEqual(preBookTargets(s, '2026-11-28')[0].status, {}, '다음 달(1월 예약)은 새로 시작');
  s = markPreBook(s, '2026-12', a, 'booked', null).state;
  assert.deepEqual(preBookTargets(s, '2026-10-29')[0].status, { sent: '2026-10-29T10:12:00' }, '되돌리기');
  s = markPreBook(s, '2026-01', a, 'sent', '2025-11-29T10:00:00').state;
  const kept = deserialize(serialize(s)).settings.preBookLog;
  assert.ok(kept['2026-12']); assert.ok(!kept['2026-01'], '여섯 달보다 오래된 달은 버린다');
});

test('preBookMessage — 원장 문구(10-09)에 이름·예약월·회신일을 넣는다. 잔액은 넣지 않는다. 문구는 고칠 수 있다', () => {
  let s = createState();
  const r = addCustomer(s, { name: '고객 A', phone: '01000000001' }); s = r.state;
  // 10-28 원장 새 문구: 손님마다 추천 날짜가 들어간다. 아직 안 적었으면 [추천 날짜] 자리가 그대로 보인다
  assert.equal(preBookMessage(s, r.customer.id, '2026-10-29'),
    '고객 A님~ 안녕하세요,\n12월 예약 오픈을 앞두고, 고객님께 선예약을 도와드리고자 먼저 연락드렸습니다.\n추천드리는 날짜는 [추천 날짜]에요 : )\n\n편하신 날짜를 10월 30일(금)까지 회신해 주시면 예약 안내 도와드리겠습니다.\n감사합니다.');
  assert.ok(!PREBOOK_TEXT.includes('{잔액}') && !PREBOOK_TEXT.includes('이틀'));
  s = setPreBookText(s, '{이름} 님, {예약월}월 예약이 {오픈일}에 열립니다.').state;
  assert.equal(preBookMessage(s, r.customer.id, '2026-11-02'), '고객 A 님, 1월 예약이 11월 30일(월)에 열립니다.');
  assert.equal(deserialize(serialize(s)).settings.preBookText, '{이름} 님, {예약월}월 예약이 {오픈일}에 열립니다.');
  assert.ok(preBookMessage(setPreBookText(s, '   ').state, r.customer.id, '2026-10-29').startsWith('고객 A님~ 안녕하세요'), '비우면 기본 문구');
});

// ---- 시술 목록 하나로 (10-24 원장: 정액권용 목록은 지우고, 예약 등록 때 쓰던 시간표에 금액을 더한다) ----
const { serviceList: svcList, setServices: setSvc, editServices: editSvc, addServiceTime: addSvcTime, kindOfService, bookedService } = require('./store.js');

test('시술 시간표에 금액(선택) — 고치는 곳은 한 곳. 금액은 "3만"·"30,000원"도 읽고, 비우면 금액 없음, 이상하면 막는다', () => {
  let s = setSvc(createState(), [{ name: '오마카세 여성컷', minutes: 60, group: '커트', price: '65,000' }, { name: '컷+클리닉', minutes: 90, price: '9만' }, { name: '앞머리컷', minutes: 30 }]);
  assert.deepEqual(svcList(s), [{ name: '오마카세 여성컷', minutes: 60, group: '커트', price: 65000 }, { name: '컷+클리닉', minutes: 90, price: 90000 }, { name: '앞머리컷', minutes: 30 }]);
  assert.throws(() => setSvc(s, [{ name: '콜드펌', minutes: 120, price: '많이' }]), /콜드펌: 금액/);
  const r = editSvc(s, [{ from: '오마카세 여성컷', group: '커트', name: '오마카세 여성컷', minutes: '60', price: '70000' }, { from: '앞머리컷', group: '커트', name: '앞머리컷', minutes: '30', price: '' }, { from: '', group: '펌', name: '콜드펌', minutes: '120', price: '84000' }]);
  assert.deepEqual(svcList(r.state).map((x) => [x.name, x.price ?? null]), [['오마카세 여성컷', 70000], ['앞머리컷', null], ['콜드펌', 84000]], '지운 줄(컷+클리닉)은 빠지고, 금액을 비우면 없음');
  assert.equal(addSvcTime(s, { name: '두피 스파', minutes: 60, group: '클리닉', price: '3만' }).service.price, 30000);
  assert.deepEqual(svcList(deserialize(serialize(r.state))), svcList(r.state), '백업·복원 뒤에도 금액이 남는다');
});

test('옛 정액권용 시술 목록(settings.services)은 읽을 때 버린다 (10-24 원장: 다 지우고 예약 때 쓰던 목록만)', () => {
  const raw = { ...createState(), settings: { ...createState().settings, services: [{ name: '콜드펌', price: 84000 }], serviceTimes: [{ name: '커트', minutes: 60 }] } };
  const s = deserialize(JSON.stringify(raw));
  assert.equal(s.settings.services, undefined);
  assert.deepEqual(svcList(s), [{ name: '커트', minutes: 60 }], '시간표는 그대로');
});

test('kindOfService — 예약한 시술을 기록의 시술 종류 칩(커트·펌·염색·클리닉·기타)으로. 분류 → 이름 순으로 본다', () => {
  const s = setSvc(createState(), [{ name: '오마카세 남성다운컷', minutes: 60, group: '컷' }, { name: '디지털 셋팅펌', minutes: 180, group: '펌' }, { name: '컷+클리닉', minutes: 90, group: '세트' }, { name: '두피 스파', minutes: 60, group: '스페셜' }, { name: '뿌리염색', minutes: 90 }]);
  assert.equal(kindOfService(s, '오마카세 남성다운컷'), '커트', '분류 "컷"은 커트');
  assert.equal(kindOfService(s, '디지털 셋팅펌'), '펌');
  assert.equal(kindOfService(s, '컷+클리닉'), '커트', '분류로 모르면 이름으로 (앞에 나온 것)');
  assert.equal(kindOfService(s, '두피 스파'), '기타');
  assert.equal(kindOfService(s, '뿌리염색'), '염색');
  assert.equal(kindOfService(s, ''), null);
  assert.equal(kindOfService(s, '없는 시술'), null);
});

test('bookedService — 그날 명단에 올린 시술(이름·금액·분). 없거나 시간표에 없으면 null', () => {
  let s = setSvc(createState(), [{ name: '콜드펌', minutes: 120, price: 84000 }, { name: '커트', minutes: 60 }]);
  s = addCustomer(s, { name: '예시 손님' }, '2026-10-24T09:00:00').state;
  const id = s.customers[0].id;
  assert.equal(bookedService(s, id, '2026-10-24'), null);
  s = markToday(s, id, '2026-10-24', '14:00', '콜드펌', '2026-10-24').state;
  assert.deepEqual(bookedService(s, id, '2026-10-24'), { name: '콜드펌', minutes: 120, price: 84000 });
  assert.equal(bookedService(s, id, '2026-10-25'), null, '다른 날은 아니다');
});

// ---- 함께 오는 가족 (10-24 원장: 한 사람이 가족 예약을 다 하고 같이 온다. 기록은 사람마다, 문자는 대표 한 명) ----
const { familyRep, setFamilyRep, familyRoleOf, setFamilyRole, addFamilyMember } = require('./store.js');

test('addFamilyMember — 이름·관계만으로 새 고객을 만들고 그 가족에 넣는다. 번호는 없어도 된다. 처음 사람이 대표', () => {
  let s = createState(), mom;
  ({ state: s, customer: mom } = addCustomer(s, { name: '예시 엄마', phone: '01011110001' }));
  let r = addFamilyMember(s, mom.id, { name: '예시 딸', role: '딸' }); s = r.state;
  assert.equal(r.customer.phone, '');
  assert.deepEqual(familyOf(s, mom.id).map((x) => x.name), ['예시 엄마', '예시 딸']);
  assert.equal(familyRep(s, r.customer.id).id, mom.id);
  assert.equal(familyRoleOf(s, r.customer.id), '딸');
  r = addFamilyMember(s, r.customer.id, { name: '예시 아빠', role: ' 남편 ' }); s = r.state;
  assert.equal(familyOf(s, mom.id).length, 3, '가족 누구에게서 더해도 같은 가족');
  assert.equal(familyRoleOf(s, r.customer.id), '남편');
  assert.throws(() => addFamilyMember(s, mom.id, { name: ' ', role: '아들' }), /이름/);
  assert.equal(familyRep(s, createState().nextId + 99), null, '없는 사람');
  assert.deepEqual(deserialize(serialize(s)).settings.familyRoles, s.settings.familyRoles, '관계는 백업에도');
});

test('setFamilyRep·setFamilyRole — 대표 바꾸기(가족 잔액은 그대로), 관계 고치기·지우기. 가족이 아니면 대표를 못 정한다', () => {
  let s = createState(), mom, dad, other;
  ({ state: s, customer: mom } = addCustomer(s, { name: '예시 엄마', phone: '01011110001' }));
  ({ state: s, customer: other } = addCustomer(s, { name: '고객 O', phone: '01022220000' }));
  ({ state: s, customer: dad } = addFamilyMember(s, mom.id, { name: '예시 아빠', role: '남편' }));
  s = chargePass(s, mom.id, { amount: '30만' }, '2026-10-24T10:00:00').state;
  s = setFamilyRep(s, dad.id);
  assert.equal(familyRep(s, mom.id).id, dad.id);
  assert.equal(passBalance(s, dad.id), 300000, '대표를 바꿔도 가족 잔액은 그대로');
  assert.equal(familyOf(s, mom.id).length, 2);
  assert.throws(() => setFamilyRep(s, other.id), /가족/);
  s = setFamilyRole(s, dad.id, '');
  assert.equal(familyRoleOf(s, dad.id), '');
  s = setFamilyRole(s, mom.id, '아내');
  assert.equal(familyRoleOf(s, mom.id), '아내');
});

// ---- 결산: 그 달 신규 고객 목록 (10-26 원장: 결산을 분류 상자로, 눌러서 자세히) ----
test('newCustomersInMonth — 그 달에 처음 온 고객(예전 고객 빼고), 다시 왔는지와 함께. 최근 순', () => {
  const { newCustomersInMonth } = require('./store.js');
  let s = createState(), a, b, c;
  ({ state: s, customer: a } = addCustomer(s, { name: '고객 A' }));
  ({ state: s, customer: b } = addCustomer(s, { name: '고객 B' }));
  ({ state: s, customer: c } = addCustomer(s, { name: '고객 C', isLegacy: true }));
  s = addVisit(s, a.id, { done: '커트', date: '2026-10-03' }, '2026-10-03T12:00:00').state;
  s = addVisit(s, a.id, { done: '커트', date: '2026-10-20' }, '2026-10-20T12:00:00').state;
  s = addVisit(s, b.id, { done: '펌', date: '2026-10-10' }, '2026-10-10T12:00:00').state;
  s = addVisit(s, c.id, { done: '커트', date: '2026-10-11' }, '2026-10-11T12:00:00').state;
  assert.deepEqual(newCustomersInMonth(s, '2026-10').map((x) => [x.customer.name, x.firstDate, x.returned]), [['고객 B', '2026-10-10', false], ['고객 A', '2026-10-03', true]]);
  assert.deepEqual(newCustomersInMonth(s, '2026-09'), []);
});

// 엄마가 아이 머리를 자르려고 자기 이름으로 예약한 날(10-27 원장): 아이를 가족으로 더해 기록했는데 엄마 막대가 "아직"으로 남았다.
// 예약 자리를 실제로 온 가족에게 넘기면 시간·시술은 그대로, 그 사람 기록으로 완료가 된다.
const { swapTodayEntry, standInFor } = require('./store.js');
test('swapTodayEntry — 그날 명단 자리를 실제로 온 가족에게 넘긴다. 시간·시술은 그대로', () => {
  let s = createState();
  let r = addCustomer(s, { name: '예시 엄마', phone: '01000000009' }); s = r.state; const mom = r.customer;
  r = addFamilyMember(s, mom.id, { name: '예시 아들', role: '아들' }); s = r.state; const son = r.customer;
  s = markToday(s, mom.id, '2026-10-27', '17:30', '커트', '2026-10-27').state;
  const out = swapTodayEntry(s, mom.id, son.id, '2026-10-27');
  const e = out.today.entries.filter((x) => x.date === '2026-10-27');
  assert.deepEqual(e.map((x) => [x.customerId, x.at, x.service]), [[son.id, '17:30', '커트']]);
  // 이미 그날 명단에 있는 사람에게는 못 넘긴다(두 자리가 하나로 합쳐지면 안 됨)
  const both = markToday(s, son.id, '2026-10-27', '18:00', '', '2026-10-27').state;
  assert.throws(() => swapTodayEntry(both, mom.id, son.id, '2026-10-27'), /이미/);
  // 가족이 아니면 막는다
  r = addCustomer(s, { name: '고객 Z' }); s = r.state;
  assert.throws(() => swapTodayEntry(s, mom.id, r.customer.id, '2026-10-27'), /가족/);
});
test('standInFor — 명단에 없는 가족이 기록을 남겼고, 명단의 가족은 아직 기록이 없을 때만 그 자리를 알려 준다', () => {
  let s = createState();
  let r = addCustomer(s, { name: '예시 엄마', phone: '01000000009' }); s = r.state; const mom = r.customer;
  r = addFamilyMember(s, mom.id, { name: '예시 아들', role: '아들' }); s = r.state; const son = r.customer;
  s = markToday(s, mom.id, '2026-10-27', '17:30', '커트', '2026-10-27').state;
  assert.equal(standInFor(s, son.id, '2026-10-27').customerId, mom.id);
  assert.equal(standInFor(s, mom.id, '2026-10-27'), null);   // 엄마는 자기 자리가 있다
  const momDone = addVisit(s, mom.id, { done: '커트' }, '2026-10-27T18:00:00+09:00').state;
  assert.equal(standInFor(momDone, son.id, '2026-10-27'), null);   // 엄마도 기록했으면 엄마가 온 것
  const sonListed = markToday(s, son.id, '2026-10-27', '18:00', '', '2026-10-27').state;
  assert.equal(standInFor(sonListed, son.id, '2026-10-27'), null);   // 아들도 자기 자리가 있으면 넘길 일 없음
});

const { setPreBookPick, preBookPickOf, preBookNeedsPick } = require('./store.js');
test('setPreBookPick — 손님(가족은 한 줄)마다 그달 추천 날짜를 적으면 문구의 {추천일}에 들어간다 (10-28 원장)', () => {
  let s = createState();
  let r = addCustomer(s, { name: '고객 A', phone: '01000000001' }); s = r.state; const a = r.customer;
  r = addCustomer(s, { name: '고객 B' }); s = r.state; const b = r.customer;
  s = joinFamily(s, a.id, b.id).state;
  assert.equal(preBookNeedsPick(s, b.id, '2026-10-29'), true);
  s = setPreBookPick(s, '2026-12', a.id, '  12월 3일   2시 ').state;   // 가족 줄의 key는 가장 작은 번호
  assert.equal(preBookPickOf(s, '2026-12', a.id), '12월 3일 2시');
  assert.ok(preBookMessage(s, b.id, '2026-10-29').includes('추천드리는 날짜는 12월 3일 2시에요 : )'), '가족 누구로 만들어도 같은 날짜');
  assert.equal(preBookNeedsPick(s, a.id, '2026-10-29'), false);
  // 보냄 표시와 함께 남고, 비우면 지워진다. 백업에도 남는다
  s = markPreBook(s, '2026-12', a.id, 'sent', '2026-10-29T10:00:00+09:00').state;
  assert.equal(deserialize(serialize(s)).settings.preBookLog['2026-12'][a.id].pick, '12월 3일 2시');
  s = setPreBookPick(s, '2026-12', a.id, ' ').state;
  assert.equal(preBookPickOf(s, '2026-12', a.id), '');
  assert.ok(s.settings.preBookLog['2026-12'][a.id].sent, '보냄은 그대로');
  // 문구에 {추천일}이 없으면 적을 필요가 없다
  s = setPreBookText(s, '{이름} 님, {예약월}월 예약이 열립니다.').state;
  assert.equal(preBookNeedsPick(s, a.id, '2026-10-29'), false);
});
