// 제품 재고 규칙 테스트. 개수 단위만 쓴다(그램은 안 적는다). 들어온 것(+)과 달마다 센 것(=)으로만 숫자가 움직인다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, addProduct, editProduct, deleteProduct, restoreProduct, liveProducts, deletedProducts, STOCK_CATEGORIES, parseStockText, stockIn, stockCount, markOrdered, unmarkOrdered, markArrived, shortProducts, orderedProducts, lastCountDate, countDue, stockLogsOf, supplierNames, monthlyUsage, fillSuggestion, fillSuggestions, supplierList, addSupplier, removeSupplier, DEFAULT_SUPPLIERS, orderGroups, orderMessage, orderAmount, markOrderedMany, setOrderHead, ORDER_HEAD, deserialize, serialize, sampleState } = require('./store.js');

const NOW = '2026-10-01T10:00:00';

function seeded() {
  let s = createState();
  const ids = {};
  for (const [name, category, qty, min] of [['6N 염색약', '염색약', 3, 2], ['펌제 1제', '펌제', 1, 1], ['트리트먼트', '판매 제품', 5, 1], ['수건', '소모품', 20, 5]]) {
    const r = addProduct(s, { name, category, qty, min }, NOW);
    s = r.state; ids[name] = r.product.id;
  }
  return { s, ids };
}

test('addProduct — 이름·분류·지금 개수·부족 기준으로 제품을 넣는다. 처음 개수는 기록 한 줄로 남는다', () => {
  const s0 = createState();
  const { state, product } = addProduct(s0, { name: ' 6N 염색약 ', category: '염색약', qty: '3', min: '2', link: 'https://example.com/6n' }, NOW);
  assert.deepEqual(product, { id: 1, name: '6N 염색약', category: '염색약', qty: 3, min: 2, link: 'https://example.com/6n', alarm: true, supplier: '', fillTo: 0, orderedAt: null, deletedAt: null });
  assert.equal(state.nextId, 3, '제품 번호와 기록 번호');
  assert.deepEqual(stockLogsOf(state, product.id).map(l => [l.kind, l.qty, l.after]), [['count', 3, 3]]);
  assert.equal(s0.products.length, 0, '원래 상태는 안 바뀐다');
});

test('addProduct — 빈 이름·같은 이름(띄어쓰기 무시)·이상한 분류·음수는 막는다. 부족 기준은 비우면 1', () => {
  const { s } = seeded();
  assert.throws(() => addProduct(s, { name: '  ', category: '염색약' }, NOW), /이름/);
  assert.throws(() => addProduct(s, { name: '6N염색약', category: '염색약' }, NOW), /이미 있는 제품/);
  assert.throws(() => addProduct(s, { name: '새 제품', category: '약재' }, NOW), /분류/);
  assert.throws(() => addProduct(s, { name: '새 제품', category: '소모품', qty: '-1' }, NOW), /개수/);
  assert.throws(() => addProduct(s, { name: '새 제품', category: '소모품', qty: '1.5' }, NOW), /개수/);
  const { product } = addProduct(s, { name: '새 제품', category: '소모품' }, NOW);
  assert.equal(product.qty, 0); assert.equal(product.min, 1);
  assert.deepEqual(STOCK_CATEGORIES, ['염색약', '펌제', '클리닉', '판매 제품', '소모품', '기타']);
});

test('editProduct — 이름·분류·부족 기준·링크·알림을 고친다. 개수는 여기서 못 바꾼다(입고나 세기로만)', () => {
  const { s, ids } = seeded();
  const { state, product } = editProduct(s, ids['수건'], { name: '수건(흰색)', min: '8', alarm: false, link: 'example.com/towel', qty: 99 });
  assert.equal(product.name, '수건(흰색)'); assert.equal(product.min, 8); assert.equal(product.alarm, false); assert.equal(product.link, 'https://example.com/towel');
  assert.equal(product.qty, 20, '개수는 그대로');
  assert.throws(() => editProduct(state, ids['수건'], { name: '펌제1제' }), /이미 있는 제품/);
  assert.throws(() => editProduct(state, ids['수건'], { link: 'javascript:alert(1)' }), /주소/);
});

test('deleteProduct·restoreProduct — 지우기는 감추기. 목록과 부족 목록에서 빠지고 되살릴 수 있다', () => {
  const { s, ids } = seeded();
  const { state } = deleteProduct(s, ids['펌제 1제'], NOW);
  assert.ok(!liveProducts(state).some(p => p.id === ids['펌제 1제']));
  assert.ok(!shortProducts(state).some(p => p.id === ids['펌제 1제']));
  assert.equal(deletedProducts(state).length, 1);
  const back = restoreProduct(state, ids['펌제 1제']).state;
  assert.equal(deletedProducts(back).length, 0);
  assert.equal(liveProducts(back).find(p => p.id === ids['펌제 1제']).qty, 1, '개수도 그대로 돌아온다');
});

test('liveProducts — 분류 순서(염색약→펌제→클리닉→판매 제품→소모품→기타), 같은 분류 안은 이름순', () => {
  let { s } = seeded();
  s = addProduct(s, { name: '가위 기름', category: '기타' }, NOW).state;
  s = addProduct(s, { name: '10N 염색약', category: '염색약' }, NOW).state;
  assert.deepEqual(liveProducts(s).map(p => p.name), ['10N 염색약', '6N 염색약', '펌제 1제', '트리트먼트', '수건', '가위 기름']);
});

test('parseStockText — "6N 염색약 3개, 펌제 1제 2, 트리트먼트 다섯 개"를 제품과 개수로 읽는다 (띄어쓰기·"개"·한글 숫자 상관없이)', () => {
  const { s, ids } = seeded();
  const r = parseStockText('6N 염색약 3개, 펌제1제 2 / 트리트먼트 다섯 개\n수건 열개', s);
  assert.deepEqual(r.matched.map(m => [m.product.id, m.qty]), [[ids['6N 염색약'], 3], [ids['펌제 1제'], 2], [ids['트리트먼트'], 5], [ids['수건'], 10]]);
  assert.deepEqual(r.unknown, []); assert.deepEqual(r.noNumber, []);
});

test('parseStockText — 목록에 없는 이름은 unknown으로, 숫자가 안 붙은 이름은 noNumber로 따로 돌려준다. 같은 제품이 두 번 나오면 뒤 것이 이긴다', () => {
  const { s, ids } = seeded();
  const r = parseStockText('6N 염색약 3, 새로 산 오일 2, 수건', s);
  assert.deepEqual(r.matched.map(m => [m.product.id, m.qty]), [[ids['6N 염색약'], 3]]);
  assert.deepEqual(r.unknown, [{ name: '새로 산 오일', qty: 2 }]);
  assert.deepEqual(r.noNumber, ['수건']);
  const again = parseStockText('수건 3개 수건 7개', s);
  assert.deepEqual(again.matched.map(m => [m.product.id, m.qty]), [[ids['수건'], 7]]);
  assert.deepEqual(parseStockText('', s), { matched: [], unknown: [], noNumber: [] });
});

test('parseStockText — "6N 염색약은 3개 남았어요"처럼 말하듯 적어도 읽는다. 0개도 된다', () => {
  const { s, ids } = seeded();
  const r = parseStockText('6N 염색약은 3개 남았고, 펌제 1제는 0개예요. 트리트먼트 2개 있어요', s);
  assert.deepEqual(r.matched.map(m => [m.product.id, m.qty]), [[ids['6N 염색약'], 3], [ids['펌제 1제'], 0], [ids['트리트먼트'], 2]]);
  assert.deepEqual(r.unknown, []);
});

test('parseStockText — 색상 번호 "7.07"·"5.07"·"8/0"은 이름의 일부다. 개수로 읽지 않는다 (10-03 원장 화면)', () => {
  let s = createState();
  const ids = {};
  for (const name of ['B 7.07', 'B 5.07', '예시 8/0']) { const r = addProduct(s, { name, category: '염색약' }, NOW); s = r.state; ids[name] = r.product.id; }
  // 원장이 말한 그대로: 전에는 "7"과 "5"를 개수로 읽어 이름이 "B"만 남았다
  const r = parseStockText('B 7.07 일곱 개, B 5.07 네 개', s);
  assert.deepEqual(r.matched.map(m => [m.product.id, m.qty]), [[ids['B 7.07'], 7], [ids['B 5.07'], 4]]);
  assert.deepEqual(r.unknown, []); assert.deepEqual(r.noNumber, []);
  // 숫자로 말해도, 띄어쓰기 없이 붙여도
  const r2 = parseStockText('B7.07 7개, B5.07 4 / 예시 8/0 2개', s);
  assert.deepEqual(r2.matched.map(m => [m.product.id, m.qty]), [[ids['B 7.07'], 7], [ids['B 5.07'], 4], [ids['예시 8/0'], 2]]);
  // 목록에 없으면 색상 번호까지 이름으로 돌려준다(새 제품으로 넣을 때 "B"가 아니라 "C 6.0")
  assert.deepEqual(parseStockText('C 6.0 세 개', s).unknown, [{ name: 'C 6.0', qty: 3 }]);
  // 문장 끝 점은 여전히 경계: "3개." 뒤의 이름도 읽는다
  assert.deepEqual(parseStockText('B 7.07 3개. B 5.07 2개.', s).matched.map(m => m.qty), [3, 2]);
});

test('parseStockText — 목록 이름 앞에 다른 말이 붙어 있어도, 색상 번호가 한 제품에만 있으면 그 제품으로 본다', () => {
  let s = createState();
  const ids = {};
  for (const name of ['예시브랜드 7.07', '예시브랜드 5.07', '예시 6.0', '다른 6.0']) { const r = addProduct(s, { name, category: '염색약' }, NOW); s = r.state; ids[name] = r.product.id; }
  const r = parseStockText('B 7.07 일곱 개, 5.07 네 개', s);
  assert.deepEqual(r.matched.map(m => [m.product.id, m.qty]), [[ids['예시브랜드 7.07'], 7], [ids['예시브랜드 5.07'], 4]]);
  // 같은 번호가 두 제품에 있으면 짐작하지 않는다
  const amb = parseStockText('6.0 두 개', s);
  assert.deepEqual(amb.matched, []); assert.deepEqual(amb.unknown, [{ name: '6.0', qty: 2 }]);
});

test('parseStockText — 숫자 이름 제품("7", "10")이 색상 번호 "7.21"·"10.21" 속에 걸리지 않는다. "4.20번"의 "번"은 뗀다 (10-03 원장 화면)', () => {
  let s = createState();
  const ids = {};
  for (const name of ['4.20', '7', '10', '6N 염색약']) { const r = addProduct(s, { name, category: '염색약' }, NOW); s = r.state; ids[name] = r.product.id; }
  // 원장 화면: "7.21"이 "7"로, "10.21"이 "10"으로 들어갔다
  const r = parseStockText('4.20번 3개, 7.21 4개, 10.21 1개', s);
  assert.deepEqual(r.matched.map(m => [m.product.id, m.qty]), [[ids['4.20'], 3]]);
  assert.deepEqual(r.unknown, [{ name: '7.21', qty: 4 }, { name: '10.21', qty: 1 }]);
  // 숫자 이름 제품도 그 숫자만 따로 말하면 찾는다
  assert.deepEqual(parseStockText('7번 2개, 10번 3개', s).matched.map(m => [m.product.id, m.qty]), [[ids['7'], 2], [ids['10'], 3]]);
  // "16N 염색약"은 "6N 염색약"이 아니다
  assert.deepEqual(parseStockText('16N 염색약 2개', s).unknown, [{ name: '16N 염색약', qty: 2 }]);
  // 목록이 비어 있어도 "번"은 이름에 안 붙는다
  assert.deepEqual(parseStockText('4.20번 3개, 8번 1개', createState()).unknown, [{ name: '4.20', qty: 3 }, { name: '8', qty: 1 }]);
});

test('stockIn — 들어온 개수만큼 더하고, 날짜와 함께 기록이 남는다. 도착을 기다리던 제품이면 기다림이 풀린다', () => {
  let { s, ids } = seeded();
  s = markOrdered(s, ids['펌제 1제'], '2026-09-28T10:00:00').state;
  const { state, logs } = stockIn(s, [{ productId: ids['펌제 1제'], qty: 4 }, { productId: ids['6N 염색약'], qty: 2 }], '2026-09-30', NOW, '택배');
  const perm = liveProducts(state).find(p => p.id === ids['펌제 1제']);
  assert.equal(perm.qty, 5); assert.equal(perm.orderedAt, null);
  assert.equal(liveProducts(state).find(p => p.id === ids['6N 염색약']).qty, 5);
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map(l => [l.kind, l.qty, l.before, l.after, l.at.slice(0, 10), l.note]), [['in', 4, 1, 5, '2026-09-30', '택배'], ['in', 2, 3, 5, '2026-09-30', '택배']]);
  assert.throws(() => stockIn(s, [{ productId: ids['수건'], qty: 0 }], '2026-09-30', NOW), /개수/);
  assert.throws(() => stockIn(s, [{ productId: 999, qty: 1 }], '2026-09-30', NOW), /제품/);
  assert.throws(() => stockIn(s, [{ productId: ids['수건'], qty: 1 }], '2026-10-02', NOW), /뒤 날짜/);
  assert.deepEqual(stockIn(s, [], '2026-09-30', NOW).logs, [], '빈 목록은 아무것도 안 한다');
});

test('stockCount — 세어 본 개수로 맞춘다. 같아도 "세어 봤다"는 기록이 남는다(10-09: 달마다 사용량을 세려면 필요)', () => {
  const { s, ids } = seeded();
  const { state, logs } = stockCount(s, [{ productId: ids['6N 염색약'], qty: 1 }, { productId: ids['수건'], qty: 20 }, { productId: ids['트리트먼트'], qty: 0 }], NOW);
  assert.equal(liveProducts(state).find(p => p.id === ids['6N 염색약']).qty, 1);
  assert.equal(liveProducts(state).find(p => p.id === ids['트리트먼트']).qty, 0);
  assert.deepEqual(logs.map(l => [l.productId, l.kind, l.qty, l.before, l.after]), [[ids['6N 염색약'], 'count', 1, 3, 1], [ids['수건'], 'count', 20, 20, 20], [ids['트리트먼트'], 'count', 0, 5, 0]]);
  assert.equal(lastCountDate(state), '2026-10-01');
  assert.throws(() => stockCount(s, [{ productId: ids['수건'], qty: -1 }], NOW), /개수/);
});

test('shortProducts — 알림 켜진 제품 중 개수가 부족 기준 이하이고 아직 주문 안 한 것. 모자란 순서로', () => {
  let { s, ids } = seeded();
  assert.deepEqual(shortProducts(s).map(p => p.name), ['펌제 1제'], '1개 ≤ 기준 1');
  s = stockCount(s, [{ productId: ids['6N 염색약'], qty: 0 }], NOW).state;
  assert.deepEqual(shortProducts(s).map(p => p.name), ['6N 염색약', '펌제 1제'], '0개가 먼저');
  s = editProduct(s, ids['펌제 1제'], { alarm: false }).state;
  assert.deepEqual(shortProducts(s).map(p => p.name), ['6N 염색약'], '알림을 끄면 빠진다');
  s = markOrdered(s, ids['6N 염색약'], NOW).state;
  assert.deepEqual(shortProducts(s), [], '주문하면 부족 목록에서 빠지고 도착 대기로 간다');
  assert.deepEqual(orderedProducts(s, '2026-10-04').map(o => [o.product.name, o.days]), [['6N 염색약', 3]]);
  s = unmarkOrdered(s, ids['6N 염색약']).state;
  assert.deepEqual(shortProducts(s).map(p => p.name), ['6N 염색약'], '주문 취소하면 돌아온다');
});

test('markArrived — 도착하면 들어온 개수를 더하고 기다림이 풀린다. 주문한 적 없는 제품은 그냥 입고와 같다', () => {
  let { s, ids } = seeded();
  s = markOrdered(s, ids['펌제 1제'], '2026-09-28T10:00:00').state;
  const { state, log } = markArrived(s, ids['펌제 1제'], 6, '2026-10-01', NOW);
  const p = liveProducts(state).find(x => x.id === ids['펌제 1제']);
  assert.equal(p.qty, 7); assert.equal(p.orderedAt, null);
  assert.equal(log.kind, 'in'); assert.equal(log.note, '주문한 것 도착');
  assert.throws(() => markOrdered(state, 999, NOW), /제품/);
});

// ---- 거래처별 주문 (10-06 원장 결정: 카톡 보낼 상대별로 묶고, 글을 복사해 붙인다. 주문 수량은 원장이 정한 숫자) ----

function orderSeed() {
  let s = createState();
  const ids = {};
  const add = (name, f) => { const r = addProduct(s, { name, category: '염색약', ...f }, NOW); s = r.state; ids[name] = r.product.id; };
  add('B 7.07', { qty: 1, min: 2, supplier: '예시상사 실장님', fillTo: 6 });
  add('B 5.07', { qty: 0, min: 1, supplier: '예시상사 실장님', fillTo: '6' });
  add('펌제 1제', { qty: 1, min: 1, supplier: '가나 대리점', fillTo: 4 });
  add('수건', { qty: 3, min: 5 });                                   // 거래처 미정, 주문 수량 미정
  add('트리트먼트', { qty: 9, min: 2, supplier: '가나 대리점', fillTo: 3 });   // 부족하지 않다
  return { s, ids };
}

test('addProduct·editProduct — 거래처(카톡 보낼 상대)와 주문 수량을 적어 둔다. 안 적으면 빈칸·0(미정)', () => {
  const { s, ids } = orderSeed();
  const b = liveProducts(s).find(p => p.id === ids['B 5.07']);
  assert.equal(b.supplier, '예시상사 실장님'); assert.equal(b.fillTo, 6);
  const towel = liveProducts(s).find(p => p.id === ids['수건']);
  assert.equal(towel.supplier, ''); assert.equal(towel.fillTo, 0);
  const { product } = editProduct(s, ids['수건'], { supplier: '  가나 대리점 ', fillTo: '10' });
  assert.equal(product.supplier, '가나 대리점'); assert.equal(product.fillTo, 10);
  assert.equal(editProduct(s, ids['B 7.07'], { name: 'B 7.07' }).product.fillTo, 6, '안 건드리면 그대로');
  assert.throws(() => editProduct(s, ids['수건'], { fillTo: '-1' }), /채워 둘 개수/);
  assert.throws(() => editProduct(s, ids['수건'], { fillTo: '여섯' }), /채워 둘 개수/);
  assert.deepEqual(supplierNames(s), ['가나 대리점', '예시상사 실장님'], '적어 둔 거래처 이름 목록(고를 때 쓴다)');
});

test('orderGroups — 주문할 제품(부족·알림 켬·주문 안 함)을 거래처별로 묶는다. 거래처 미정은 맨 끝', () => {
  let { s, ids } = orderSeed();
  const g = orderGroups(s);
  assert.deepEqual(g.map(x => [x.supplier, x.items.map(p => p.name)]), [
    ['가나 대리점', ['펌제 1제']], ['예시상사 실장님', ['B 5.07', 'B 7.07']], ['', ['수건']],
  ]);
  s = markOrdered(s, ids['펌제 1제'], NOW).state;
  assert.deepEqual(orderGroups(s).map(x => x.supplier), ['예시상사 실장님', ''], '주문한 제품은 빠지고, 빈 묶음은 없다');
  assert.deepEqual(orderGroups(createState()), []);
});

test('orderMessage — 거래처에 보낼 글. 첫 줄 인사, 제품마다 원장이 정한 주문 수량, 끝인사. 수량 미정은 "?개"', () => {
  let { s, ids } = orderSeed();
  // 10-08 원장: 주문 개수 = 채워 둘 개수 - 지금 개수. B 7.07은 6개까지 채우는데 1개 남았으니 5개
  assert.equal(orderMessage(s, '예시상사 실장님'), `${ORDER_HEAD}\n- B 5.07  6개\n- B 7.07  5개\n감사합니다.`);
  assert.equal(orderMessage(s, ''), `${ORDER_HEAD}\n- 수건  ?개\n감사합니다.`, '수량을 안 정한 제품은 보내기 전에 눈에 띄게');
  // 이번만 바꾼 수량. 0으로 하면 이번엔 빼고 보낸다
  assert.equal(orderMessage(s, '예시상사 실장님', { [ids['B 7.07']]: 10, [ids['B 5.07']]: 0 }), `${ORDER_HEAD}\n- B 7.07  10개\n감사합니다.`);
  assert.equal(orderMessage(s, '예시상사 실장님', { [ids['B 7.07']]: 0, [ids['B 5.07']]: 0 }), '', '다 빼면 보낼 글도 없다');
  // 첫 줄은 원장이 고칠 수 있고, 백업·복원 뒤에도 남는다
  s = setOrderHead(s, '실장님 안녕하세요, 평택 헤어원네스트예요. 주문 부탁드려요.').state;
  assert.ok(orderMessage(s, '가나 대리점').startsWith('실장님 안녕하세요, 평택 헤어원네스트예요. 주문 부탁드려요.\n- 펌제 1제  3개'));
  assert.equal(deserialize(serialize(s)).settings.orderHead, '실장님 안녕하세요, 평택 헤어원네스트예요. 주문 부탁드려요.');
  assert.equal(orderMessage(setOrderHead(s, '  ').state, '가나 대리점').split('\n')[0], ORDER_HEAD, '비우면 기본 인사');
});

test('orderAmount — 늘 맞춰 둘 개수(채워 둘 개수)에서 지금 개수를 뺀 만큼 주문한다 (10-08 원장)', () => {
  let s = createState();
  const add = (f) => { const r = addProduct(s, { name: f.name, category: '염색약', ...f }, NOW); s = r.state; return r.product; };
  assert.equal(orderAmount(add({ name: '10번', qty: 2, min: 2, fillTo: 10 })), 8, '10개 맞춰 두는 제품이 2개 남으면 8개');
  assert.equal(orderAmount(add({ name: '0개 남음', qty: 0, min: 1, fillTo: 6 })), 6);
  assert.equal(orderAmount(add({ name: '미정', qty: 1, min: 1 })), 0, '채워 둘 개수를 안 정했으면 0(미정, 글에는 ?개)');
  assert.throws(() => add({ name: '이상함', qty: 0, min: 3, fillTo: 2 }), /채워 둘 개수는 부족 기준\(3개\)보다/);
  assert.throws(() => add({ name: '같음', qty: 0, min: 3, fillTo: 3 }), /부족 기준/);
});

test('markOrderedMany — 보낸 묶음을 한꺼번에 도착 대기로', () => {
  const { s, ids } = orderSeed();
  const { state } = markOrderedMany(s, [ids['B 7.07'], ids['B 5.07']], NOW);
  assert.deepEqual(orderGroups(state).map(x => x.supplier), ['가나 대리점', '']);
  assert.deepEqual(orderedProducts(state, NOW.slice(0, 10)).map(o => o.product.name).sort(), ['B 5.07', 'B 7.07']);
});

test('migrate — 거래처·주문 수량이 없는 옛 백업 제품은 빈칸·0으로 열린다', () => {
  const { s } = orderSeed();
  const old = JSON.parse(serialize(s));
  old.products = old.products.map(({ supplier, fillTo, ...rest }) => rest);
  const back = deserialize(JSON.stringify(old));
  assert.ok(back.products.every(p => p.supplier === '' && p.fillTo === 0));
  // 10-06~08 사이 백업은 이름이 orderQty였다. 같은 숫자로 읽는다
  const mid = JSON.parse(serialize(s));
  mid.products = mid.products.map(({ fillTo, ...rest }) => ({ ...rest, orderQty: fillTo }));
  assert.deepEqual(deserialize(JSON.stringify(mid)).products.map(p => p.fillTo), s.products.map(p => p.fillTo));
});

test('countDue — 이번 달에 센 적이 없으면 세야 한다. 제품이 하나도 없으면 아니다', () => {
  let { s, ids } = seeded();
  assert.equal(countDue(createState(), '2026-10-01'), false);
  assert.equal(countDue(s, '2026-10-01'), false, '제품을 넣은 날이 센 날이다');
  assert.equal(countDue(s, '2026-11-01'), true);
  s = stockCount(s, [{ productId: ids['수건'], qty: 18 }], '2026-11-02T10:00:00').state;
  assert.equal(countDue(s, '2026-11-20'), false);
  assert.equal(lastCountDate(s), '2026-11-02');
});

test('stockLogsOf — 최신순. 제품 번호 없이 부르면 전체', () => {
  let { s, ids } = seeded();
  s = stockIn(s, [{ productId: ids['수건'], qty: 5 }], '2026-10-02', '2026-10-02T09:00:00').state;
  const all = stockLogsOf(s);
  assert.equal(all.length, 5);
  assert.equal(all[0].kind, 'in');
  assert.deepEqual(stockLogsOf(s, ids['수건']).map(l => l.kind), ['in', 'count']);
});

test('serialize·deserialize — 제품과 재고 기록이 저장되고, 옛 백업(제품 없음)도 열린다', () => {
  let { s, ids } = seeded();
  s = markOrdered(s, ids['펌제 1제'], NOW).state;
  const back = deserialize(serialize(s));
  assert.deepEqual(back.products, s.products);
  assert.deepEqual(back.stockLogs, s.stockLogs);
  const old = deserialize(JSON.stringify({ nextId: 1, customers: [], visits: [] }));
  assert.deepEqual(old.products, []); assert.deepEqual(old.stockLogs, []);
  // 모양이 안 맞는 줄은 버린다
  const odd = deserialize(JSON.stringify({ nextId: 5, customers: [], products: [{ id: 1, name: '것', category: '없는 분류', qty: '3', min: null }, { name: '번호 없음' }], stockLogs: [{ id: 2, productId: 1, kind: 'in', qty: 1, at: NOW }, { id: 3 }] }));
  assert.deepEqual(odd.products, [{ id: 1, name: '것', category: '기타', qty: 3, min: 1, link: '', alarm: true, supplier: '', fillTo: 0, orderedAt: null, deletedAt: null }]);
  assert.equal(odd.stockLogs.length, 1);
});

test('sampleState — 예시 제품이 들어 있고 그중 하나는 부족하다 (둘러보는 사람이 재고 화면을 볼 수 있게)', () => {
  const s = sampleState('2026-10-01', NOW);
  assert.ok(liveProducts(s).length >= 3);
  assert.ok(shortProducts(s).length >= 1);
});

test('supplierList·addSupplier — 거래처는 눌러서 고른다. 기본 넷(10-08 원장) + 원장이 [+]로 더한 것 + 제품에 이미 적힌 것', () => {
  let s = createState();
  assert.deepEqual(DEFAULT_SUPPLIERS, ['로레알', 'JMW', '아모스', '화인']);
  assert.deepEqual(supplierList(s), ['로레알', 'JMW', '아모스', '화인'], '처음엔 원장이 알려 준 순서 그대로');
  // 전에 손으로 적어 둔 거래처도 단추로 보인다(사라지지 않게)
  s = addProduct(s, { name: '수건', category: '기타', supplier: '예시상사' }, NOW).state;
  assert.deepEqual(supplierList(s), ['로레알', 'JMW', '아모스', '화인', '예시상사']);
  // [+]로 더하면 목록 끝에 붙고 settings에 남는다(백업·복원 뒤에도)
  let r = addSupplier(s, '  가나 대리점 ');
  assert.equal(r.name, '가나 대리점');
  s = r.state;
  assert.deepEqual(supplierList(s), ['로레알', 'JMW', '아모스', '화인', '가나 대리점', '예시상사']);
  assert.deepEqual(deserialize(serialize(s)).settings.suppliers, ['로레알', 'JMW', '아모스', '화인', '가나 대리점']);
  // 이미 있는 이름(띄어쓰기·대소문자만 다른 것 포함)은 두 번 안 생기고 있던 이름을 돌려준다
  r = addSupplier(s, 'jmw');
  assert.equal(r.name, 'JMW'); assert.equal(r.state, s);
  assert.equal(addSupplier(s, '가나대리점').name, '가나 대리점');
  assert.throws(() => addSupplier(s, '   '), /업체 이름/);
  // 잘못 넣은 이름은 뺄 수 있다. 제품에 적힌 이름은 제품을 고치기 전까지 그대로 보인다
  s = removeSupplier(s, '가나 대리점').state;
  assert.deepEqual(supplierList(s), ['로레알', 'JMW', '아모스', '화인', '예시상사']);
  s = removeSupplier(s, '로레알').state;
  assert.deepEqual(deserialize(serialize(s)).settings.suppliers, ['JMW', '아모스', '화인'], '기본 업체도 뺄 수 있다');
  assert.deepEqual(supplierList(deserialize(serialize(createState()))), DEFAULT_SUPPLIERS, '옛 백업엔 목록이 없어 기본 넷');
});

// ---- 한 달 사용량과 채워 둘 개수 제안 (10-09 원장: 개수로, 3달 평균 + 부족 기준, 매달 1일, 제안만) ----
function usageSeed() {
  let s = createState();
  const r = addProduct(s, { name: '6N 염색약', category: '염색약', qty: 10, min: 2 }, '2026-07-01T10:00:00'); s = r.state;
  const id = r.product.id;
  s = stockCount(s, [{ productId: id, qty: 6 }], '2026-08-01T10:00:00').state;                 // 7월: 10 → 6, 4개 씀
  s = stockIn(s, [{ productId: id, qty: 6 }], '2026-08-10', '2026-08-10T10:00:00', '').state;  // 12개
  s = stockCount(s, [{ productId: id, qty: 7 }], '2026-09-02T10:00:00').state;                 // 8월: 12 → 7, 5개 씀
  s = stockCount(s, [{ productId: id, qty: 4 }], '2026-10-01T10:00:00').state;                 // 9월: 7 → 4, 3개 씀
  return { s, id };
}

test('monthlyUsage — 센 날과 센 날 사이에 쓴 개수(지난번 센 개수 + 들어온 것 − 이번에 센 개수). 1일쯤 세면 지난달로 잡힌다', () => {
  const { s, id } = usageSeed();
  assert.deepEqual(monthlyUsage(s, id), [
    { month: '2026-07', used: 4, from: '2026-07-01', to: '2026-08-01' },
    { month: '2026-08', used: 5, from: '2026-08-01', to: '2026-09-02' },
    { month: '2026-09', used: 3, from: '2026-09-02', to: '2026-10-01' },
  ]);
  let t = stockCount(s, [{ productId: id, qty: 4 }], '2026-10-31T18:00:00').state;            // 말일에 일찍 세도 10월
  assert.deepEqual(monthlyUsage(t, id).at(-1), { month: '2026-10', used: 0, from: '2026-10-01', to: '2026-10-31' }, '같은 개수를 세면 0개 씀');
  t = stockCount(s, [{ productId: id, qty: 9 }], '2026-11-01T10:00:00').state;
  assert.equal(monthlyUsage(t, id).at(-1).used, -5, '센 개수가 더 많으면 음수 그대로(들어온 것을 안 적었을 수 있음) — 고치지 않는다');
});

test('fillSuggestion — 최근 3달 평균(올림) + 부족 기준. 음수 달은 빼고, 쓴 적이 없으면 제안 없음', () => {
  let { s, id } = usageSeed();
  assert.deepEqual(fillSuggestion(s, id), { months: ['2026-07', '2026-08', '2026-09'], used: [4, 5, 3], avg: 4, fillTo: 6 }, '(4+5+3)/3 = 4, + 기준 2 = 6');
  assert.deepEqual(fillSuggestions(s).map((x) => [x.product.name, x.fillTo]), [['6N 염색약', 6]], '지금 채워 둘 개수(0)와 다르면 제안');
  s = editProduct(s, id, { fillTo: 6 }).state;
  assert.deepEqual(fillSuggestions(s), [], '이미 같으면 제안 안 함');
  const t = stockCount(s, [{ productId: id, qty: 9 }], '2026-11-01T10:00:00').state;             // 10월 -5
  assert.deepEqual(fillSuggestion(t, id).months, ['2026-07', '2026-08', '2026-09'], '음수 달은 빼고 그 앞 달로');
  assert.equal(fillSuggestion(t, id).warn, '2026-10', '뺀 달을 알려 준다');
  let u = createState();
  const r = addProduct(u, { name: '수건', category: '소모품', qty: 5, min: 1 }, '2026-09-01T10:00:00'); u = r.state;
  assert.equal(fillSuggestion(u, r.product.id), null, '센 적이 한 번(넣을 때)뿐이면 없음');
  u = stockCount(u, [{ productId: r.product.id, qty: 5 }], '2026-10-01T10:00:00').state;
  assert.equal(fillSuggestion(u, r.product.id), null, '안 썼으면 없음(채워 둘 개수는 부족 기준보다 커야 한다)');
  u = stockCount(u, [{ productId: r.product.id, qty: 2 }], '2026-11-01T10:00:00').state;
  assert.deepEqual(fillSuggestion(u, r.product.id), { months: ['2026-09', '2026-10'], used: [0, 3], avg: 2, fillTo: 3 }, '기록이 2달뿐이면 있는 만큼: (0+3)/2 = 1.5 → 2, + 1');
});


// ---- 월별 재고표 (10-09 원장: 달마다 1일 재고 · 입고 · 사용) ----
const { stockSheet } = require('./store.js');

test('stockSheet — 제품마다 달별로 1일 재고(그 달 처음 센 개수)·입고(날짜·수량)·사용. 지금 달은 사용이 아직 없다', () => {
  let { s, id } = usageSeed();
  s = stockIn(s, [{ productId: id, qty: 3 }], '2026-10-12', '2026-10-12T15:00:00', '').state;
  const sh = stockSheet(s, id);
  assert.deepEqual(Object.keys(sh), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(sh['2026-07'], { start: 10, startAt: '2026-07-01', ins: [], used: 4, open: false });
  assert.deepEqual(sh['2026-08'], { start: 6, startAt: '2026-08-01', ins: [{ date: '2026-08-10', qty: 6 }], used: 5, open: false }, '6 + 6 − 7 = 5');
  assert.deepEqual(sh['2026-09'], { start: 7, startAt: '2026-09-02', ins: [], used: 3, open: false }, '1일에 못 세고 2일에 센 것도 그 달 1일 재고');
  assert.deepEqual(sh['2026-10'], { start: 4, startAt: '2026-10-01', ins: [{ date: '2026-10-12', qty: 3 }], used: null, open: true }, '지금 달: 다음에 세면 사용이 나온다');
  // 말일에 일찍 세면: 10월이 닫히고 11월이 열린다
  const t = stockCount(s, [{ productId: id, qty: 5 }], '2026-10-31T18:00:00').state;
  const sh2 = stockSheet(t, id);
  assert.deepEqual([sh2['2026-10'].used, sh2['2026-10'].open], [2, false], '4 + 3 − 5 = 2');
  assert.deepEqual(sh2['2026-11'], { start: 5, startAt: '2026-10-31', ins: [], used: null, open: true });
  // 처음 넣기만 한 제품: 그 달이 열려 있고 사용은 아직 없다
  let u = createState();
  const r = addProduct(u, { name: '수건', category: '소모품', qty: 20, min: 5 }, '2026-10-01T10:00:00'); u = r.state;
  assert.deepEqual(stockSheet(u, r.product.id), { '2026-10': { start: 20, startAt: '2026-10-01', ins: [], used: null, open: true } });
});

// 10-15 원장: 도착 확인은 "내가 주문한 개수"와 맞춰 보는 일. 보낸 개수를 남기고, 도착한 것만 체크해 한꺼번에 넣는다.
const { markArrivedMany } = require('./store.js');
test('주문한 개수가 남는다 — 이번만 바꾼 수량이면 그 수, 아니면 채워 둘 개수 − 남은 개수', () => {
  const { s, ids } = orderSeed();
  const { state } = markOrderedMany(s, [ids['B 7.07'], ids['B 5.07'], ids['수건']], NOW, { [ids['B 5.07']]: '4' });
  const o = Object.fromEntries(orderedProducts(state, '2026-10-02').map(x => [x.product.name, [x.ordered, x.recorded]]));
  assert.deepEqual(o['B 7.07'], [5, true], '6개까지 채움, 1개 남음 → 5개');
  assert.deepEqual(o['B 5.07'], [4, true], '이번만 4개로 바꿔 보냄');
  assert.deepEqual(o['수건'], [0, true], '채워 둘 개수 미정이면 0(글에는 ?개)');
  // 개수를 남기기 전에 주문한 것(옛 기록)은 채워 둘 개수 기준으로 보이고 recorded=false
  const old = markOrdered(s, ids['펌제 1제'], NOW).state;
  assert.deepEqual(orderedProducts(old, '2026-10-02').map(x => [x.ordered, x.recorded]), [[3, false]]);
  // 주문 취소하면 남긴 개수도 지운다
  const un = unmarkOrdered(state, ids['B 5.07']).state;
  assert.equal(un.settings.orderedQtys[ids['B 5.07']], undefined);
  // 백업으로 꺼내도 남는다
  assert.deepEqual(deserialize(serialize(state)).settings.orderedQtys, state.settings.orderedQtys);
});

test('markArrivedMany — 체크한 것만 들어온 개수만큼 한꺼번에 더하고 기다림·남긴 개수를 푼다', () => {
  const { s, ids } = orderSeed();
  let { state } = markOrderedMany(s, [ids['B 7.07'], ids['B 5.07'], ids['펌제 1제']], NOW);
  const r = markArrivedMany(state, [{ productId: ids['B 7.07'], qty: 5 }, { productId: ids['B 5.07'], qty: '3' }], '2026-10-03', '2026-10-03T11:00:00');
  state = r.state;
  const p = (n) => state.products.find(x => x.id === ids[n]);
  assert.equal(p('B 7.07').qty, 6); assert.equal(p('B 5.07').qty, 3, '6개 주문했는데 3개만 와도 들어온 만큼');
  assert.equal(p('B 7.07').orderedAt, null);
  assert.deepEqual(orderedProducts(state, '2026-10-03').map(x => x.product.name), ['펌제 1제'], '체크 안 한 것은 그대로 기다림');
  assert.deepEqual(Object.keys(state.settings.orderedQtys).map(Number), [ids['펌제 1제']]);
  assert.deepEqual(r.logs.map(l => [l.kind, l.qty, l.note]), [['in', 5, '주문한 것 도착'], ['in', 3, '주문한 것 도착']]);
  assert.throws(() => markArrivedMany(state, [{ productId: ids['펌제 1제'], qty: '' }], '2026-10-03', '2026-10-03T11:00:00'), /펌제 1제: 들어온 개수/);
  assert.throws(() => markArrivedMany(state, [], '2026-10-03', NOW), /도착한 제품을 체크/);
});
