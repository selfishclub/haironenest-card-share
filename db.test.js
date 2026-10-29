const { test } = require('node:test');
const assert = require('node:assert/strict');
global.Store = require('./store.js');
const DB = require('./db.js');
const { createState, addCustomer, addVisit, chargePass, markToday, setSettings, editVisit, purgeVisit, setPhotoConsent, addPhoto, removePhoto, deleteCustomer, purgeCustomer } = global.Store;

test('바뀐 게 없으면 서버에 보낼 것도 없다', () => {
  const s = createState();
  assert.deepEqual(DB.diff(s, s), []);
});

test('고객을 만들면 고객 표에 한 줄 올리고, nextId가 바뀌어 설정도 올린다', () => {
  const s0 = createState();
  const { state: s1 } = addCustomer(s0, { name: '김OO', phone: '010-1111-0001', isLegacy: true });
  const ops = DB.diff(s0, s1);
  const cust = ops.find(o => o.table === 'card_customers');
  assert.equal(cust.upsert.length, 1);
  assert.equal(cust.upsert[0].phone, '01011110001');
  assert.equal(cust.upsert[0].is_legacy, true);
  assert.equal(ops.find(o => o.table === 'card_settings').upsert[0].data.nextId, 2);
});

test('방문 기록을 고치면 그 줄만 올라가고, 완전히 지우면 지우기 명령이 나간다', () => {
  let { state: s, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001' });
  let visit;
  ({ state: s, visit } = addVisit(s, customer.id, { done: '커트', kinds: ['커트'] }, '2026-09-19T11:00:00'));
  const { state: s2 } = editVisit(s, visit.id, { done: '커트, 앞머리', next: '', kinds: ['커트'] }, '2026-09-19T12:00:00');
  const ops = DB.diff(s, s2);
  assert.deepEqual(ops.map(o => o.table), ['card_visits']);
  assert.equal(ops[0].upsert[0].done, '커트, 앞머리');
  assert.equal(ops[0].upsert[0].history.length, 1);
  const { state: s3 } = purgeVisit(s2, visit.id);
  assert.deepEqual(DB.diff(s2, s3), [{ table: 'card_visits', delete: [visit.id] }]);
});

test('오늘 명단·정액권·설정은 각자 표로 간다', () => {
  let { state: s, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001' });
  const base = s;
  ({ state: s } = markToday(s, customer.id, '2026-09-19', '10:00'));
  ({ state: s } = chargePass(s, customer.id, { amount: '150000', note: '' }, '2026-09-19T10:00:00'));
  ({ state: s } = setSettings(s, { head: '안녕하세요' }));
  const tables = DB.diff(base, s).map(o => o.table).sort();
  assert.deepEqual(tables, ['card_passes', 'card_settings', 'card_today']);
  const today = DB.diff(base, s).find(o => o.table === 'card_today').upsert[0];
  assert.equal(today.date, '2026-09-19');
  assert.equal(today.entries[0].customerId, customer.id);
});

test('오늘 줄이 아직 없으면 마지막 날의 명단을 이어받는다 — 안 적은 사람이 다음 날에도 남도록', () => {
  const rows = {
    card_customers: [{ id: 1, name: '김OO', phone: '01011110001', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], created_at: '2026-09-01T10:00:00', deleted_at: null }],
    card_visits: [], card_passes: [], card_settings: [],
    card_today: [
      { date: '2026-09-25', entries: [{ customerId: 1, at: '09:00', date: '2026-09-25' }] },
      { date: '2026-09-27', entries: [{ customerId: 1, at: '10:00', date: '2026-09-27' }] },
    ],
  };
  const s = DB.assemble(rows, '2026-09-28');
  assert.equal(s.today.date, '2026-09-27', '오늘 줄이 없으니 마지막 날(27일) 줄');
  assert.deepEqual(s.today.entries, [{ customerId: 1, at: '10:00', date: '2026-09-27', service: '' }]);
  const rolled = global.Store.rollToday(s, '2026-09-28').state;
  assert.equal(rolled.today.date, '2026-09-28');
  assert.deepEqual(global.Store.pendingList(rolled, '2026-09-28').map(p => p.date), ['2026-09-27']);
  assert.deepEqual(DB.diff(s, rolled), [{ table: 'card_today', upsert: [{ date: '2026-09-28', entries: [{ customerId: 1, at: '10:00', date: '2026-09-27', service: '' }] }] }], '오늘 줄로 저장된다');
  // 오늘 줄이 있으면 그것을 쓴다
  rows.card_today.push({ date: '2026-09-28', entries: [] });
  assert.equal(DB.assemble(rows, '2026-09-28').today.date, '2026-09-28');
});

test('앞날 이름으로 저장된 명단 줄(10-14 전 버그)은 오늘 줄에 합쳐 읽는다 — 미리 올린 예약이 안 사라지게', () => {
  const rows = {
    card_customers: [1, 2].map((id) => ({ id, name: `고객 ${id}`, phone: '', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], created_at: '2026-09-01T10:00:00', deleted_at: null })),
    card_visits: [], card_passes: [], card_settings: [],
    card_today: [
      { date: '2026-10-14', entries: [{ customerId: 1, at: '10:00', date: '2026-10-14' }] },
      { date: '2026-10-15', entries: [{ customerId: 1, at: '10:30', date: '2026-10-14' }, { customerId: 2, at: '11:00', date: '2026-10-15' }] },
    ],
  };
  const s = DB.assemble(rows, '2026-10-14');
  assert.equal(s.today.date, '2026-10-14');
  assert.deepEqual(s.today.entries.map((e) => [e.customerId, e.date, e.at]), [[1, '2026-10-14', '10:00'], [2, '2026-10-15', '11:00']], '오늘 줄이 이기고, 앞날 줄에만 있는 예약은 더한다');
  assert.deepEqual(DB.futureTodayDates(rows, '2026-10-14'), ['2026-10-15'], '정리할 앞날 줄');
  assert.deepEqual(DB.futureTodayDates(rows, '2026-10-15'), []);
});

test('사진은 card_photos 표로 가고, 지우면 표 줄과 창고 파일을 함께 지운다', () => {
  let { state: s, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001' });
  let visit;
  ({ state: s, visit } = addVisit(s, customer.id, { done: '볼륨펌' }, '2026-09-29T14:00:00'));
  ({ state: s } = setPhotoConsent(s, customer.id, true, '2026-09-29'));
  const s0 = s;
  let a, b;
  ({ state: s, photo: a } = addPhoto(s, visit.id, { w: 1600, h: 1200, bytes: 300000 }, '2026-09-29T14:01:00'));
  ({ state: s, photo: b } = addPhoto(s, visit.id, { w: 1600, h: 1200, bytes: 280000 }, '2026-09-29T14:02:00'));
  const up = DB.diff(s0, s).find(o => o.table === 'card_photos');
  assert.deepEqual(up.upsert.map(r => r.path), [a.path, b.path]);
  assert.deepEqual(Object.keys(up.upsert[0]).sort(), ['bytes', 'created_at', 'customer_id', 'h', 'id', 'path', 'visit_id', 'w']);
  const consentRow = DB.diff(createState(), s0).find(o => o.table === 'card_customers').upsert[0];
  assert.deepEqual(consentRow.photo_consent, { at: '2026-09-29' }, '동의도 고객 줄에 실린다');
  // 한 장 지우면: 표 줄 삭제 + 창고 파일 삭제
  const s2 = removePhoto(s, a.id).state;
  assert.deepEqual(DB.diff(s, s2), [
    { table: 'card_photos', delete: [a.id] },
    { storage: DB.PHOTO_BUCKET, remove: [a.path] },
  ]);
  // 고객을 완전히 지우면 남은 사진 파일도
  const s3 = purgeCustomer(deleteCustomer(s2, customer.id, '2026-09-29T15:00:00').state, customer.id).state;
  const storageOp = DB.diff(s2, s3).find(o => o.storage);
  assert.deepEqual(storageOp, { storage: DB.PHOTO_BUCKET, remove: [b.path] });
  assert.equal(DB.PHOTO_BUCKET, 'card-photos');
});

test('서버에 새 표(card_photos)나 새 열(photo_consent)이 아직 없어도 카드는 열리고, 없는 것을 알려준다', async () => {
  // schema.sql을 다시 Run 하기 전의 서버 흉내: card_photos 표 없음, card_customers에 photo_consent 열 없음
  const rowsOf = {
    card_customers: [{ id: 1, name: '김OO', phone: '01011110001', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], deleted_at: null, created_at: '' }],
    card_visits: [], card_passes: [], card_today: [], card_settings: [],
  };
  const fakeLib = { createClient: () => ({
    from: (table) => ({ select: () => ({ range: async () => (!(table in rowsOf)
      ? { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } }
      : { data: rowsOf[table], error: null }) }) }),
  }) };
  DB.init({ SUPABASE_URL: 'x', SUPABASE_KEY: 'y' }, fakeLib);
  const s = await DB.load('2026-09-29');
  assert.deepEqual(s.photos, [], '사진 표가 없으면 사진만 빈 채로 열린다');
  assert.equal(s.customers.length, 1);
  assert.deepEqual(DB.missingTables(), ['card_cancels', 'card_customers.family_id', 'card_customers.photo_consent', 'card_photos', 'card_products', 'card_stock_logs', 'card_waitlist'], '재고 표·가족 열·취소·대기 표도 Run 전엔 없다');
  assert.deepEqual(s.products, []);
  // 열이 없는 동안은 고객 줄에 photo_consent를 싣지 않는다 (있으면 저장이 통째로 막힌다)
  const { state: s2 } = global.Store.editCustomer(s, 1, { name: '김OO', phone: '01011110001', referrer: '소개' });
  const row = DB.diff(s, s2).find(o => o.table === 'card_customers').upsert[0];
  assert.equal('photo_consent' in row, false);
  // 열이 있는 서버면 싣는다
  rowsOf.card_customers[0].photo_consent = null;
  const s3 = await DB.load('2026-09-29');
  assert.deepEqual(DB.missingTables(), ['card_cancels', 'card_customers.family_id', 'card_photos', 'card_products', 'card_stock_logs', 'card_waitlist']);
  const { state: s4 } = global.Store.setPhotoConsent(s3, 1, true, '2026-09-29');
  assert.deepEqual(DB.diff(s3, s4).find(o => o.table === 'card_customers').upsert[0].photo_consent, { at: '2026-09-29' });
  // 다른 표가 없는 것은 진짜 오류다
  const brokenLib = { createClient: () => ({ from: () => ({ select: () => ({ range: async () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) }) }) }) };
  DB.init({ SUPABASE_URL: 'x', SUPABASE_KEY: 'y' }, brokenLib);
  await assert.rejects(() => DB.load('2026-09-29'), /card_customers 읽기 실패/);
});

test('card_photos 줄과 photo_consent를 읽어 상태로 조립한다', () => {
  const rows = {
    card_customers: [{ id: 1, name: '김OO', phone: '01011110001', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], deleted_at: null, photo_consent: { at: '2026-09-29' } }],
    card_visits: [{ id: 2, customer_id: 1, done: '볼륨펌', next: '', kinds: [], history: [], created_at: '2026-09-29T14:00:00', deleted_at: null }],
    card_passes: [], card_settings: [], card_today: [],
    card_photos: [{ id: 3, customer_id: 1, visit_id: 2, path: '1/2/3.jpg', w: 1600, h: 1200, bytes: 300000, created_at: '2026-09-29T14:01:00' }],
  };
  const s = DB.assemble(rows, '2026-09-29');
  assert.deepEqual(s.photos, [{ id: 3, customerId: 1, visitId: 2, path: '1/2/3.jpg', w: 1600, h: 1200, bytes: 300000, createdAt: '2026-09-29T14:01:00' }]);
  assert.deepEqual(s.customers[0].photoConsent, { at: '2026-09-29' });
  assert.equal(s.nextId, 4, '사진 번호도 다음 번호 계산에 든다');
  assert.deepEqual(DB.diff(s, s), []);
});

test('표에서 읽은 줄을 조립하면 앱 상태가 되고, 다시 diff하면 보낼 게 없다', () => {
  let { state: s, customer } = addCustomer(createState(), { name: '김OO', phone: '01011110001', isLegacy: true });
  ({ state: s } = addVisit(s, customer.id, { done: '커트', kinds: ['커트'] }, '2026-09-19T11:00:00'));
  ({ state: s } = markToday(s, customer.id, '2026-09-19', '10:00'));
  const ops = DB.diff({ ...createState(), settings: null }, s);
  const rows = {};
  for (const op of ops) rows[op.table] = [...(rows[op.table] ?? []), ...(op.upsert ?? [])];
  const back = DB.assemble(rows, '2026-09-19');
  assert.deepEqual(back, s);
  assert.deepEqual(DB.diff(s, back), []);
});

test('표가 비어 있으면 빈 상태로 시작하고, nextId는 가장 큰 id보다 크다', () => {
  const empty = DB.assemble({}, '2026-09-19');
  assert.deepEqual(empty, createState());
  const withRows = DB.assemble({ card_customers: [{ id: 7, name: '김OO', phone: '', profile: { talk: '', hair: '' }, profile_history: [] }] }, '2026-09-19');
  assert.equal(withRows.nextId, 8);
});

test('V3 — 제품과 재고 기록은 각자 표로 가고, 줄 모양은 snake_case', () => {
  const { addProduct, stockIn, markOrdered } = global.Store;
  const s0 = createState();
  const { state: s1, product } = addProduct(s0, { name: '6N 염색약', category: '염색약', qty: 3, min: 2, link: 'https://example.com/6n' }, '2026-10-01T10:00:00');
  const ops = DB.diff(s0, s1);
  const prod = ops.find(o => o.table === 'card_products');
  assert.deepEqual(prod.upsert, [{ id: product.id, name: '6N 염색약', category: '염색약', qty: 3, min: 2, link: 'https://example.com/6n', alarm: true, supplier: '', order_qty: 0, ordered_at: null, deleted_at: null }]);
  const log = ops.find(o => o.table === 'card_stock_logs');
  assert.equal(log.upsert.length, 1);
  assert.equal(log.upsert[0].product_id, product.id);
  assert.equal(log.upsert[0].kind, 'count');
  // 주문 표시만 바꾸면 제품 줄 하나만 올라간다
  const { state: s2 } = markOrdered(s1, product.id, '2026-10-02T10:00:00');
  assert.deepEqual(DB.diff(s1, s2).map(o => o.table), ['card_products']);
  assert.equal(DB.diff(s1, s2)[0].upsert[0].ordered_at, '2026-10-02T10:00:00');
  // 입고하면 제품 줄과 기록 줄, 그리고 번호가 올라 설정
  const { state: s3 } = stockIn(s2, [{ productId: product.id, qty: 2 }], '2026-10-03', '2026-10-03T10:00:00', '택배');
  assert.deepEqual(DB.diff(s2, s3).map(o => o.table).sort(), ['card_products', 'card_settings', 'card_stock_logs']);
});

test('V3 — 표에서 읽은 제품·재고 줄이 앱 모양으로 조립되고, 표가 아직 없으면 빈 목록이다', () => {
  const rows = {
    card_products: [{ id: 7, name: '펌제 1제', category: '펌제', qty: 1, min: 1, link: '', alarm: true, ordered_at: null, deleted_at: null, updated_at: 'x' }],
    card_stock_logs: [{ id: 8, product_id: 7, kind: 'count', qty: 1, before: 0, after: 1, at: '2026-10-01T10:00:00', note: '제품 넣음', updated_at: 'x' }],
  };
  const st = DB.assemble(rows, '2026-10-01');
  assert.deepEqual(st.products, [{ id: 7, name: '펌제 1제', category: '펌제', qty: 1, min: 1, link: '', alarm: true, supplier: '', fillTo: 0, orderedAt: null, deletedAt: null }], '거래처 열이 없는 옛 줄도 빈칸·0으로');
  assert.deepEqual(st.stockLogs, [{ id: 8, productId: 7, kind: 'count', qty: 1, before: 0, after: 1, at: '2026-10-01T10:00:00', note: '제품 넣음' }]);
  assert.equal(st.nextId, 9);
  const empty = DB.assemble({}, '2026-10-01');
  assert.deepEqual(empty.products, []); assert.deepEqual(empty.stockLogs, []);
});

test('10-06 거래처·주문 수량 — 열이 있으면 싣고, 서버에 아직 없으면(Run 전) 빼고 저장한다', async () => {
  const { addProduct, editProduct } = global.Store;
  const s0 = createState();
  const { state: s1, product } = addProduct(s0, { name: 'B 7.07', category: '염색약', supplier: '예시상사', fillTo: 6 }, '2026-10-06T10:00:00');
  assert.deepEqual(DB.diff(s0, s1).find(o => o.table === 'card_products').upsert[0].supplier, '예시상사');
  assert.equal(DB.diff(s0, s1).find(o => o.table === 'card_products').upsert[0].order_qty, 6);
  assert.deepEqual(DB.assemble({ card_products: [{ id: 3, name: 'B', category: '염색약', qty: 0, min: 1, link: '', alarm: true, supplier: '가나', order_qty: 4, ordered_at: null, deleted_at: null }] }, '2026-10-06').products[0].fillTo, 4);
  // Run 전 서버: 제품 줄에 supplier 키가 없다 → 그 열은 싣지 않는다
  const rowsOf = { card_customers: [], card_visits: [], card_passes: [], card_photos: [], card_today: [], card_settings: [], card_stock_logs: [],
    card_products: [{ id: 3, name: 'B', category: '염색약', qty: 0, min: 1, link: '', alarm: true, ordered_at: null, deleted_at: null }] };
  const upserts = [];
  const lib = { createClient: () => ({
    from: (table) => ({
      select: () => ({ range: async () => ({ data: rowsOf[table] ?? [], error: null }) }),
      upsert: async (rows) => { upserts.push({ table, rows }); return { error: null }; },
    }),
  }) };
  DB.init({ SUPABASE_URL: 'x', SUPABASE_KEY: 'y' }, lib);
  const st = await DB.load('2026-10-06');
  assert.ok(DB.missingTables().includes('card_products.supplier'), 'Run 전이면 알려준다');
  const { state: st2 } = editProduct(st, 3, { supplier: '가나', fillTo: 4 });
  const row = DB.diff(st, st2).find(o => o.table === 'card_products').upsert[0];
  assert.equal('supplier' in row, false); assert.equal('order_qty' in row, false);
  // 제품 표가 비어 있어 미리 알 수 없을 때: 저장이 "열 없음"으로 막히면 그 열을 빼고 다시 보낸다
  rowsOf.card_products = [];
  let first = true;
  const lib2 = { createClient: () => ({
    from: (table) => ({
      select: () => ({ range: async () => ({ data: rowsOf[table] ?? [], error: null }) }),
      upsert: async (rows) => {
        upserts.push({ table, rows });
        if (table === 'card_products' && first && rows.some(r => 'supplier' in r)) { first = false; return { error: { code: 'PGRST204', message: "Could not find the 'order_qty' column of 'card_products' in the schema cache" } }; }
        return { error: null };
      },
    }),
  }) };
  DB.init({ SUPABASE_URL: 'x', SUPABASE_KEY: 'y' }, lib2);
  const e0 = await DB.load('2026-10-06');
  const { state: e1 } = addProduct(e0, { name: '펌제', category: '펌제', supplier: '가나', fillTo: 2 }, '2026-10-06T11:00:00');
  upserts.length = 0;
  await DB.save(e0, e1);
  const prodUps = upserts.filter(u => u.table === 'card_products');
  assert.equal(prodUps.length, 2, '한 번 막히고 다시 보냈다');
  assert.equal('supplier' in prodUps[1].rows[0], false, '다시 보낼 때는 새 열을 뺐다');
  assert.ok(DB.missingTables().includes('card_products.supplier'));
});

test('10-07 가족 번호(family_id) — 열이 있으면 싣고, Run 전 서버면 빼고 저장한다', async () => {
  const { joinFamily } = global.Store;
  let { state: s0, customer: a } = addCustomer(createState(), { name: '고객 A', phone: '01000001001' });
  let b; ({ state: s0, customer: b } = addCustomer(s0, { name: '고객 B', phone: '01000001002' }));
  const { state: s1 } = joinFamily(s0, b.id, a.id);
  const rows = DB.diff(s0, s1).find(o => o.table === 'card_customers').upsert;
  assert.deepEqual(rows.map(r => r.family_id).sort(), [a.id, a.id]);
  assert.equal(DB.assemble({ card_customers: [{ id: 3, name: 'C', phone: '', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], deleted_at: null, created_at: '', family_id: 9 }] }, '2026-10-07').customers[0].familyId, 9);
  assert.equal(DB.assemble({ card_customers: [{ id: 3, name: 'C', phone: '', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], deleted_at: null, created_at: '' }] }, '2026-10-07').customers[0].familyId, null, '열 없는 옛 줄은 가족 없음');
  // Run 전 서버: 고객 줄에 family_id 키가 없다
  const rowsOf = { card_customers: [{ id: 1, name: '고객 A', phone: '01000001001', referrer: '', is_legacy: false, profile: { talk: '', hair: '' }, profile_history: [], deleted_at: null, created_at: '', photo_consent: null }],
    card_visits: [], card_passes: [], card_photos: [], card_today: [], card_settings: [], card_products: [], card_stock_logs: [] };
  const lib = { createClient: () => ({ from: (table) => ({ select: () => ({ range: async () => ({ data: rowsOf[table] ?? [], error: null }) }), upsert: async () => ({ error: null }) }) }) };
  DB.init({ SUPABASE_URL: 'x', SUPABASE_KEY: 'y' }, lib);
  const st = await DB.load('2026-10-07');
  assert.ok(DB.missingTables().includes('card_customers.family_id'));
  const { state: st2 } = global.Store.editCustomer(st, 1, { name: '고객 A', phone: '01000001001', referrer: '소개' });
  const row = DB.diff(st, st2).find(o => o.table === 'card_customers').upsert[0];
  assert.equal('family_id' in row, false);
  assert.equal('photo_consent' in row, true, '다른 열은 그대로 싣는다');
});

test('취소 기록(10-11)은 card_cancels 표에 한 줄. 채워짐을 바꾸면 그 줄만, 지우면 지우기 명령. 읽어 오면 같은 모양', () => {
  const s0 = createState();
  const { state: s1, cancel } = global.Store.addCancel(s0, { text: '10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐' }, '2026-10-12T09:00:00', '2026-10-12');
  const ops = DB.diff(s0, s1);
  const row = ops.find(o => o.table === 'card_cancels').upsert[0];
  assert.deepEqual(row, { id: cancel.id, date: '2026-10-15', time: '14:00', service: '열펌 매직', minutes: 180, days_before: 3, filled: 'yes', filled_in: '다음 날', note: '10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐', at: '2026-10-12T09:00:00' });
  const s2 = global.Store.setCancelFilled(s1, cancel.id, 'no');
  const ops2 = DB.diff(s1, s2);
  assert.equal(ops2.length, 1);
  assert.equal(ops2[0].upsert[0].filled, 'no');
  const s3 = global.Store.deleteCancel(s2, cancel.id);
  assert.deepEqual(DB.diff(s2, s3), [{ table: 'card_cancels', delete: [cancel.id] }]);
  const back = DB.assemble({ card_cancels: [row], card_settings: [{ id: 1, data: { nextId: 5 } }] }, '2026-10-12');
  assert.deepEqual(back.cancels, s1.cancels);
  assert.deepEqual(DB.assemble({}, '2026-10-12').cancels, [], '표가 아직 없어도(Run 전) 열린다');
});

test('대기(10-11)는 card_waitlist 표에 한 줄(요일은 windows 열에 함께, 10-23). 문자 보낸 표시만 바뀌면 그 줄만 올라간다. 읽어 오면 같은 모양', () => {
  const s0 = createState();
  const { state: s1, wait } = global.Store.addWait(s0, { name: '대기예시', phone: '01099990001', service: '커트', month: '2026-11', days: ['weekday'], windows: ['pm'], code: '123456' }, '2026-10-12T10:00:00');
  const row = DB.diff(s0, s1).find(o => o.table === 'card_waitlist').upsert[0];
  assert.deepEqual(row, { id: wait.id, name: '대기예시', phone: '01099990001', service: '커트', minutes: 60, date_from: '2026-11-01', date_to: '2026-11-30', windows: ['pm', 'weekday'], note: '', code: '123456', status: 'waiting', created_at: '2026-10-12T10:00:00', notified: [] });
  const s2 = global.Store.markNotified(s1, [wait.id], 77, '2026-10-19T11:00:00');
  const ops = DB.diff(s1, s2);
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].upsert[0].notified, [{ cancelId: 77, at: '2026-10-19T11:00:00' }]);
  assert.deepEqual(DB.assemble({ card_waitlist: [row], card_settings: [{ id: 1, data: { nextId: 5 } }] }, '2026-10-12').waitlist, s1.waitlist);
});
