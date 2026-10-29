// 서버 저장 층. 상태(state) 전체를 알고, 바뀐 줄만 Supabase 표에 넣고 뺀다.
// 규칙(store.js)과 화면(app.js)은 서버를 모른다. 여기만 안다.
// 표 10개: card_customers, card_visits, card_passes, card_photos, card_today, card_settings, card_products, card_stock_logs, card_cancels, card_waitlist
// card_waitlist는 손님 쪽(api/wait.js, 서비스 키)도 쓴다. 여기(원장 앱)는 읽고, 문자 보낸 표시(notified)와 상태만 고친다.
// 사진 파일은 표가 아니라 창고(Storage) card-photos 버킷에 있다. 표에는 자리(path)만.
const DB = (() => {
  let client = null;
  const PHOTO_BUCKET = 'card-photos';
  // 아직 서버에 없는 표·열. 새 기능의 표는 원장이 schema.sql을 다시 Run 해야 생기는데,
  // 그 전에도 카드는 열려야 한다. 없는 표는 빈 것으로 읽고, 없는 열은 줄에 싣지 않는다.
  const OPTIONAL_TABLES = new Set(['card_photos', 'card_products', 'card_stock_logs', 'card_cancels', 'card_waitlist']);
  const missing = new Set();
  const SUPPLIER_COL = 'card_products.supplier';   // supplier·order_qty 두 열을 하나로 본다
  const FAMILY_COL = 'card_customers.family_id';
  // 나중에 더한 열들. schema.sql을 다시 Run 하기 전 서버에는 없으므로, "열 없음"으로 저장이 막히면 그 열을 빼고 다시 보낸다
  const LATE_COLUMNS = {
    card_products: [{ flag: SUPPLIER_COL, cols: ['supplier', 'order_qty'] }],
    card_customers: [{ flag: FAMILY_COL, cols: ['family_id'] }, { flag: 'card_customers.photo_consent', cols: ['photo_consent'] }],
  };
  const missingTables = () => [...missing].sort();

  // ---- 줄 모양 바꾸기: 앱(camelCase) ↔ 표(snake_case) ----------------------
  const toRow = {
    customers: (c) => ({ id: c.id, name: c.name, phone: c.phone ?? '', referrer: c.referrer ?? '', is_legacy: !!c.isLegacy,
      profile: c.profile, profile_history: c.profileHistory ?? [], deleted_at: c.deletedAt ?? null,
      ...(missing.has('card_customers.photo_consent') ? {} : { photo_consent: c.photoConsent ?? null }),
      ...(missing.has(FAMILY_COL) ? {} : { family_id: c.familyId ?? null }) }),   // 가족 번호(10-07). Run 전 서버면 싣지 않는다
    visits: (v) => ({ id: v.id, customer_id: v.customerId, done: v.done, next: v.next ?? '', kinds: v.kinds ?? [],
      history: v.history ?? [], created_at: v.createdAt, deleted_at: v.deletedAt ?? null }),
    passes: (p) => ({ id: p.id, customer_id: p.customerId, kind: p.kind, amount: p.amount, note: p.note ?? '', at: p.at ?? '', visit_id: p.visitId ?? null }),
    photos: (p) => ({ id: p.id, customer_id: p.customerId, visit_id: p.visitId, path: p.path, w: p.w ?? 0, h: p.h ?? 0, bytes: p.bytes ?? 0, created_at: p.createdAt ?? '' }),
    // 거래처·채워 둘 개수(10-06, 열 이름 order_qty)는 원장이 schema.sql을 다시 Run 해야 생기는 열이라, 없는 서버에는 싣지 않는다
    products: (p) => ({ id: p.id, name: p.name, category: p.category, qty: p.qty, min: p.min, link: p.link ?? '', alarm: p.alarm !== false,
      ...(missing.has(SUPPLIER_COL) ? {} : { supplier: p.supplier ?? '', order_qty: p.fillTo ?? 0 }),
      ordered_at: p.orderedAt ?? null, deleted_at: p.deletedAt ?? null }),
    stockLogs: (l) => ({ id: l.id, product_id: l.productId, kind: l.kind, qty: l.qty, before: l.before ?? 0, after: l.after ?? 0, at: l.at ?? '', note: l.note ?? '' }),
    // 예약 취소 기록(10-11). 열흘 동안 취소 자리가 채워지는지 세는 것
    cancels: (c) => ({ id: c.id, date: c.date, time: c.time ?? '', service: c.service ?? '', minutes: c.minutes ?? null, days_before: c.daysBefore ?? null, filled: c.filled ?? 'unknown', filled_in: c.filledIn ?? '', note: c.note ?? '', at: c.at ?? '' }),
    waitlist: (w) => ({ id: w.id, name: w.name, phone: w.phone, service: w.service, minutes: w.minutes ?? null, date_from: w.dateFrom, date_to: w.dateTo, windows: Store.waitWindowsCol(w), note: w.note ?? '', code: w.code ?? '', status: w.status ?? 'waiting', created_at: w.createdAt ?? '', notified: w.notified ?? [] }),
  };
  const fromRow = {
    customers: (r) => ({ id: r.id, name: r.name, phone: r.phone ?? '', referrer: r.referrer ?? '', isLegacy: !!r.is_legacy,
      profile: r.profile ?? { talk: '', hair: '' }, profileHistory: r.profile_history ?? [], deletedAt: r.deleted_at ?? null, photoConsent: r.photo_consent ?? null, familyId: r.family_id ?? null }),
    visits: (r) => ({ id: r.id, customerId: r.customer_id, done: r.done, next: r.next ?? '', kinds: r.kinds ?? [],
      history: r.history ?? [], createdAt: r.created_at, deletedAt: r.deleted_at ?? null }),
    passes: (r) => ({ id: r.id, customerId: r.customer_id, kind: r.kind, amount: r.amount, note: r.note ?? '', at: r.at ?? '', visitId: r.visit_id ?? null }),
    photos: (r) => ({ id: r.id, customerId: r.customer_id, visitId: r.visit_id, path: r.path, w: r.w ?? 0, h: r.h ?? 0, bytes: r.bytes ?? 0, createdAt: r.created_at ?? '' }),
    products: (r) => ({ id: r.id, name: r.name, category: r.category, qty: r.qty ?? 0, min: r.min ?? 1, link: r.link ?? '', alarm: r.alarm !== false,
      supplier: r.supplier ?? '', fillTo: r.order_qty ?? 0, orderedAt: r.ordered_at ?? null, deletedAt: r.deleted_at ?? null }),
    stockLogs: (r) => ({ id: r.id, productId: r.product_id, kind: r.kind, qty: r.qty ?? 0, before: r.before ?? 0, after: r.after ?? 0, at: r.at ?? '', note: r.note ?? '' }),
    cancels: (r) => ({ id: r.id, date: r.date, time: r.time ?? '', service: r.service ?? '', minutes: r.minutes ?? null, daysBefore: r.days_before ?? null, filled: r.filled ?? 'unknown', filledIn: r.filled_in ?? '', note: r.note ?? '', at: r.at ?? '' }),
    waitlist: (r) => ({ id: r.id, name: r.name, phone: r.phone, service: r.service, minutes: r.minutes ?? null, dateFrom: r.date_from, dateTo: r.date_to, windows: r.windows ?? [], note: r.note ?? '', code: r.code ?? '', status: r.status ?? 'waiting', createdAt: r.created_at ?? '', notified: r.notified ?? [] }),
  };
  const TABLE = { customers: 'card_customers', visits: 'card_visits', passes: 'card_passes', photos: 'card_photos', products: 'card_products', stockLogs: 'card_stock_logs', cancels: 'card_cancels', waitlist: 'card_waitlist' };
  // 키 순서가 달라도 같은 내용이면 같다고 본다.
  const stable = (x) => Array.isArray(x) ? '[' + x.map(stable).join(',') + ']'
    : (x && typeof x === 'object') ? '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}'
    : JSON.stringify(x);
  const same = (a, b) => stable(a) === stable(b);

  // 두 상태를 비교해 "무엇을 올리고(upsert) 무엇을 지울지(delete)"를 표별로 계산한다. 순수 함수라 테스트한다.
  function diff(prev, next) {
    const ops = [];
    for (const key of ['customers', 'visits', 'passes', 'photos', 'products', 'stockLogs', 'cancels', 'waitlist']) {
      const before = new Map((prev[key] ?? []).map((x) => [x.id, x]));
      const after = new Map((next[key] ?? []).map((x) => [x.id, x]));
      const upsert = [];
      for (const [id, x] of after) if (!before.has(id) || !same(before.get(id), x)) upsert.push(toRow[key](x));
      const del = [...before.keys()].filter((id) => !after.has(id));
      if (upsert.length) ops.push({ table: TABLE[key], upsert });
      if (del.length) ops.push({ table: TABLE[key], delete: del });
    }
    // 사라진 사진은 창고 파일도 지운다 (표 줄 삭제 다음에)
    const gone = (prev.photos ?? []).filter((p) => !(next.photos ?? []).some((q) => q.id === p.id)).map((p) => p.path);
    if (gone.length) ops.push({ storage: PHOTO_BUCKET, remove: gone });
    if (next.today && next.today.date && !same(prev.today, next.today)) {
      ops.push({ table: 'card_today', upsert: [{ date: next.today.date, entries: next.today.entries ?? [] }] });
    }
    if (!same(prev.settings, next.settings) || prev.nextId !== next.nextId) {
      ops.push({ table: 'card_settings', upsert: [{ id: 1, data: { ...(next.settings ?? {}), nextId: next.nextId } }] });
    }
    return ops;
  }

  // 표에서 읽어 온 줄들을 앱 상태로 조립한다. 순수 함수.
  function assemble(rows, todayDate) {
    const settingsRow = (rows.card_settings ?? [])[0];
    const data = settingsRow ? { ...settingsRow.data } : {};
    const nextIdSaved = data.nextId; delete data.nextId;
    const customers = (rows.card_customers ?? []).map(fromRow.customers);
    const visits = (rows.card_visits ?? []).map(fromRow.visits);
    const passes = (rows.card_passes ?? []).map(fromRow.passes);
    const photos = (rows.card_photos ?? []).map(fromRow.photos);
    const products = (rows.card_products ?? []).map(fromRow.products);
    const stockLogs = (rows.card_stock_logs ?? []).map(fromRow.stockLogs);
    const cancels = (rows.card_cancels ?? []).map(fromRow.cancels);
    const waitlist = (rows.card_waitlist ?? []).map(fromRow.waitlist);
    const maxId = Math.max(0, ...customers.map((x) => x.id), ...visits.map((x) => x.id), ...passes.map((x) => x.id), ...photos.map((x) => x.id), ...products.map((x) => x.id), ...stockLogs.map((x) => x.id), ...cancels.map((x) => x.id), ...waitlist.map((x) => x.id));
    // 오늘 줄이 있으면 그것, 없으면 그 앞 마지막 날의 줄. 새 날 첫 열기에 어제 안 적은 사람을 이어받기 위해서다.
    // 적은 사람을 빼고 오늘 날짜로 넘기는 일은 Store.rollToday가 한다(규칙은 store에).
    const base = (rows.card_today ?? []).filter((t) => t.date <= todayDate).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    // 10-14 전에는 내일 예약을 올리면 줄 이름이 내일이 되어 오늘 다시 읽을 때 안 보였다. 그런 앞날 줄의 항목 중
    // 오늘 줄에 없는 것(사람+날짜)만 더한다. load가 합친 뒤 앞날 줄을 지운다.
    const later = (rows.card_today ?? []).filter((t) => t.date > todayDate);
    const todayRow = later.length ? { date: base?.date ?? todayDate, entries: later.reduce((acc, t) => [...acc, ...(t.entries ?? []).filter((e) => !acc.some((a) => a.customerId === e.customerId && a.date === e.date))], base?.entries ?? []) } : base;
    const raw = {
      nextId: Math.max(Number.isInteger(nextIdSaved) ? nextIdSaved : 1, maxId + 1),
      customers, visits, passes, photos, products, stockLogs, cancels, waitlist, settings: data,
      today: todayRow ? { date: todayRow.date, entries: todayRow.entries ?? [] } : { date: '', entries: [] },
    };
    // 옛 데이터·빈 값은 store의 이전(migrate) 규칙으로 한 번 더 다듬는다.
    return Store.deserialize(JSON.stringify(raw));
  }

  // ---- 실제 서버 ----------------------------------------------------------
  function init(config, supabaseLib) {
    client = supabaseLib.createClient(config.SUPABASE_URL, config.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    return client;
  }
  async function session() { const { data } = await client.auth.getSession(); return data.session; }
  async function login(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message.includes('Invalid') ? '비밀번호가 맞지 않습니다' : error.message);
  }
  async function logout() { await client.auth.signOut(); }

  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select('*').range(from, from + 999);
      if (error) {
        // 새 표가 아직 없으면 그 표만 빈 것으로 두고 나머지는 연다 (PGRST205: 표를 못 찾음)
        if (OPTIONAL_TABLES.has(table) && (error.code === 'PGRST205' || /schema cache/i.test(error.message ?? ''))) { missing.add(table); return []; }
        throw new Error(`${table} 읽기 실패: ${error.message}`);
      }
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  async function load(todayDate) {
    const names = ['card_customers', 'card_visits', 'card_passes', 'card_photos', 'card_today', 'card_settings', 'card_products', 'card_stock_logs', 'card_cancels', 'card_waitlist'];
    missing.clear();
    const lists = await Promise.all(names.map(fetchAll));
    const rows = Object.fromEntries(names.map((n, i) => [n, lists[i]]));
    // 새 열(photo_consent)이 아직 없는 서버인지: 고객 줄이 하나라도 있는데 그 키가 없으면 없는 것
    if (rows.card_customers.length && !('photo_consent' in rows.card_customers[0])) missing.add('card_customers.photo_consent');
    if (rows.card_products.length && !('supplier' in rows.card_products[0])) missing.add(SUPPLIER_COL);
    if (rows.card_customers.length && !('family_id' in rows.card_customers[0])) missing.add(FAMILY_COL);
    const state = assemble(rows, todayDate);
    // 앞날 이름의 명단 줄(10-14 전 버그)은 합쳐 읽었으니 오늘 줄로 저장하고 지운다. 다음 날 그 낡은 줄이 다시 잡히지 않게.
    const later = futureTodayDates(rows, todayDate);
    if (later.length) {
      const { error } = await client.from('card_today').upsert([{ date: todayDate, entries: state.today.entries }]);
      if (!error) await client.from('card_today').delete().in('date', later);
    }
    return state;
  }
  const futureTodayDates = (rows, todayDate) => (rows.card_today ?? []).filter((t) => t.date > todayDate).map((t) => t.date);
  async function apply(ops) {
    for (const op of ops) {
      if (op.upsert) {
        let rows = op.upsert;
        let { error } = await client.from(op.table).upsert(rows);
        // 표가 비어 있으면 읽을 때 새 열이 있는지 알 수 없다. "열 없음"(PGRST204)으로 막히면 그 열을 빼고 다시 보낸다
        for (const late of LATE_COLUMNS[op.table] ?? []) {
          if (!error) break;
          const named = late.cols.some(col => (error.message ?? '').includes(`'${col}'`));
          if (missing.has(late.flag) || !(named || (error.code === 'PGRST204' && late.cols.some(col => col in (rows[0] ?? {}))))) continue;
          missing.add(late.flag);
          rows = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !late.cols.includes(k))));
          ({ error } = await client.from(op.table).upsert(rows));
        }
        if (error) throw new Error(`${op.table} 저장 실패: ${error.message}`);
      }
      if (op.delete) {
        const { error } = await client.from(op.table).delete().in('id', op.delete);
        if (error) throw new Error(`${op.table} 지우기 실패: ${error.message}`);
      }
      if (op.storage) {
        const { error } = await client.storage.from(op.storage).remove(op.remove);
        if (error) throw new Error(`사진 파일 지우기 실패: ${error.message}`);
      }
    }
  }
  function save(prev, next) { return apply(diff(prev, next)); }

  // 백업 파일 전체를 서버로 옮긴다: 표를 비우고 다시 넣는다.
  async function replaceAll(state) {
    // 사진 표도 비운다. 창고의 파일은 여기서 건드리지 않는다(백업 파일에 사진은 없으니 그대로 두면 표만 새로 맞춰진다).
    for (const t of ['card_photos', 'card_visits', 'card_passes', 'card_customers', 'card_stock_logs', 'card_products', 'card_cancels', 'card_waitlist']) {
      if (missing.has(t)) continue;   // 아직 안 만든 표는 비울 것도 없다
      const { error } = await client.from(t).delete().gte('id', 0);
      if (error) throw new Error(`${t} 비우기 실패: ${error.message}`);
    }
    for (const t of ['card_today']) {
      const { error } = await client.from(t).delete().neq('date', '');
      if (error) throw new Error(`${t} 비우기 실패: ${error.message}`);
    }
    const empty = Store.createState();
    empty.settings = null; // settings도 반드시 올리게
    await apply(diff(empty, state));
  }

  // ---- 사진 창고 -----------------------------------------------------------
  async function putPhoto(path, blob) {
    const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`사진 올리기 실패: ${error.message}`);
  }
  // 비공개 창고라 볼 때마다 한 시간짜리 주소를 받는다. 같은 화면 안에서는 한 번만.
  const urlCache = new Map();
  async function photoUrl(path) {
    const hit = urlCache.get(path);
    if (hit && hit.until > Date.now()) return hit.url;
    const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
    if (error) throw new Error(`사진 주소 받기 실패: ${error.message}`);
    urlCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }

  return { PHOTO_BUCKET, diff, assemble, futureTodayDates, init, session, login, logout, load, save, replaceAll, putPhoto, photoUrl, missingTables };
})();

if (typeof module !== 'undefined') module.exports = DB;
