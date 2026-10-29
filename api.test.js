// 서버 함수 테스트. 바깥(Supabase REST·발송킹)은 가짜 fetch로 막고, 손님 쪽 규칙·자기 것만 보기·문자 글·로그인 확인을 본다.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_SERVICE_KEY = 'service-test';
process.env.SITE_URL = 'https://card.test';
const L = require('./api/_lib.js');
const wait = require('./api/wait.js');
const sms = require('./api/sms.js');

// 가짜 서버: 표 두 개를 메모리에 두고, REST 요청을 흉내 낸다
let db, calls, smsCalls, authOk;
beforeEach(() => {
  db = { settings: { nextId: 10, serviceTimes: [{ name: '커트', minutes: 60 }, { name: '열펌 매직', minutes: 180 }], bookingUrl: 'https://booking.naver.com/x' }, waitlist: [] };
  calls = []; smsCalls = []; authOk = true;
  for (const k of ['BALSONGKING_ID', 'BALSONGKING_PW', 'BALSONGKING_CALLBACK']) delete process.env[k];
  global.fetch = async (url, opts = {}) => {
    const form = opts.body instanceof FormData ? Object.fromEntries([...opts.body.entries()]) : null;
    calls.push({ url, method: opts.method ?? 'GET', body: form ?? (opts.body ? JSON.parse(opts.body) : undefined), headers: opts.headers ?? {} });
    const ok = (data, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), json: async () => data });
    if (url.includes('/auth/v1/user')) return authOk ? ok({ id: 'owner' }) : ok({ message: 'bad' }, 401);
    if (url.startsWith('https://balsongking.com/Linkage/API/')) { smsCalls.push({ ...form, Destination: JSON.parse(form.Destination) }); return ok({ Result: 'OK', Code: 0, Cash: 40000, Job_No: 777 }); }
    if (url.includes('card_settings')) return ok([{ data: db.settings }]);
    if (url.includes('card_waitlist')) {
      const row = (w) => ({ id: w.id, name: w.name, phone: w.phone, service: w.service, minutes: w.minutes, date_from: w.dateFrom, date_to: w.dateTo, windows: w.windows, note: w.note, code: w.code, status: w.status, created_at: w.createdAt, notified: w.notified });
      if ((opts.method ?? 'GET') === 'GET') return ok(db.waitlist.map(row));
      if (opts.method === 'POST') { const r = JSON.parse(opts.body); db.waitlist.push({ id: r.id, name: r.name, phone: r.phone, service: r.service, minutes: r.minutes, dateFrom: r.date_from, dateTo: r.date_to, windows: r.windows, note: r.note, code: r.code, status: r.status, createdAt: r.created_at, notified: r.notified }); return ok(null, 201); }
      if (opts.method === 'PATCH') { const m = /id=eq\.(\d+)&code=eq\.(\w+)/.exec(url); const p = JSON.parse(opts.body); db.waitlist = db.waitlist.map((w) => (w.id === Number(m[1]) && w.code === m[2] ? { ...w, ...(p.status ? { status: p.status } : {}), ...(p.date_from ? { dateFrom: p.date_from, dateTo: p.date_to, windows: p.windows, note: p.note } : {}) } : w)); return ok(null, 204); }
    }
    return ok({ message: 'unknown ' + url }, 404);
  };
});
const req = (method, { query, body, headers } = {}) => ({ method, query: query ?? {}, body, headers: { host: 'card.test', ...(headers ?? {}) } });
const run = async (fn, r) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } }; await fn(r, res); return res; };
const month = (n) => { const d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const good = () => ({ name: '대기예시', phone: '010-9999-0001', service: '열펌 매직', month: month(1), days: ['weekday', 'weekend'], windows: ['pm', 'eve'], agree: true });
const smsOn = () => { process.env.BALSONGKING_ID = 'card'; process.env.BALSONGKING_PW = 'pw'; process.env.BALSONGKING_CALLBACK = '031-000-0000'; };

test('GET /api/wait — 폼에 필요한 시술 목록·고를 수 있는 달 셋·평일/주말·시간대 셋·오늘을 준다 (손님 정보는 없다)', async () => {
  const res = await run(wait, req('GET'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.services.map((x) => x.name), ['커트', '열펌 매직']);
  assert.deepEqual(res.body.months, [month(0), month(1), month(2)]);
  assert.deepEqual(res.body.days.map((d) => d.label), ['평일', '주말']);
  assert.deepEqual(res.body.windows.map((w) => w.label), ['오전', '오후', '5시 이후']);
  assert.equal(res.body.notifyLimit, 3);
  assert.equal(res.body.smsReady, false);
  assert.ok(!('waits' in res.body));
});

test('POST /api/wait — 대기를 걸면 표에 한 줄, 확인번호와 "같은 시술 N번째"와 바꾸기 주소를 돌려준다. 문자 설정 전이면 smsSent=false', async () => {
  const res = await run(wait, req('POST', { body: good() }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.waitlist.length, 1);
  assert.equal(db.waitlist[0].id, 10, '설정의 nextId부터');
  assert.equal(db.waitlist[0].phone, '01099990001');
  assert.deepEqual(db.waitlist[0].windows, ['pm', 'eve', 'weekday', 'weekend'], '표의 windows 열에 요일도 함께');
  assert.equal(db.waitlist[0].dateTo.slice(0, 7), month(1));
  assert.equal(res.body.wait.month, month(1));
  assert.deepEqual(res.body.wait.days, ['weekday', 'weekend']);
  assert.equal(res.body.wait.position, 1);
  assert.match(res.body.code, /^\d{6}$/);
  assert.equal(res.body.url, `https://card.test/wait.html?w=10&c=${res.body.code}`);
  assert.equal(res.body.smsSent, false);
  assert.ok(!('phone' in res.body.wait) && !('name' in res.body.wait), '돌려주는 것에 이름·번호는 없다');
  const res2 = await run(wait, req('POST', { body: { ...good(), phone: '01099990002' } }));
  assert.equal(res2.body.wait.position, 2);
});

test('POST /api/wait — 규칙에 안 맞으면 400과 쉬운 말. 동의 없으면 막고, 봇 칸이 차 있으면 조용히 무시', async () => {
  let res = await run(wait, req('POST', { body: { ...good(), service: '펌' } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /시술/);
  res = await run(wait, req('POST', { body: { ...good(), agree: false } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /동의/);
  res = await run(wait, req('POST', { body: { ...good(), website: 'spam' } }));
  assert.equal(res.statusCode, 200); assert.equal(db.waitlist.length, 0);
  for (let i = 0; i < 3; i++) await run(wait, req('POST', { body: good() }));
  res = await run(wait, req('POST', { body: good() }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /3건/);
});

test('POST /api/wait — 발송킹 문자 설정(아이디·암호·발신번호)이 있으면 접수 문자를 LMS로 보낸다 (확인번호 링크 포함)', async () => {
  smsOn();
  const res = await run(wait, req('POST', { body: good() }));
  assert.equal(res.body.smsSent, true);
  assert.equal(smsCalls.length, 1);
  const f = smsCalls[0];
  assert.deepEqual([f.UserID, f.UserPW, f.Service, f.Type, f.Callback, f.Subject], ['card', 'pw', 'LMS', 'Send', '0310000000', '대기 접수']);
  const m = f.Destination[0];
  assert.equal(m.Phone, '01099990001');
  assert.ok(m.Msg_Text.startsWith('[헤어원네스트] 대기 접수: 열펌 매직,'));
  assert.ok(m.Msg_Text.includes(res.body.url));
  assert.equal(f.Main_Text, m.Msg_Text);
});

test('GET /api/wait?w=&c= 또는 ?p=&c= — 자기 것만 보인다. 틀리면 404. 뺀 것은 안 보인다', async () => {
  const a = (await run(wait, req('POST', { body: good() }))).body;
  await run(wait, req('POST', { body: { ...good(), phone: '01099990002', service: '커트' } }));
  let res = await run(wait, req('GET', { query: { w: String(a.wait.id), c: a.code } }));
  assert.equal(res.statusCode, 200); assert.equal(res.body.waits.length, 1); assert.equal(res.body.name, '대기예시'); assert.equal(res.body.waits[0].position, 1);
  res = await run(wait, req('GET', { query: { p: '010-9999-0001', c: a.code } }));
  assert.equal(res.body.waits.length, 1);
  res = await run(wait, req('GET', { query: { w: String(a.wait.id), c: '000000' } }));
  assert.equal(res.statusCode, 404);
  res = await run(wait, req('POST', { body: { action: 'leave', w: a.wait.id, c: a.code } }));
  assert.equal(res.statusCode, 200); assert.equal(db.waitlist[0].status, 'left');
  res = await run(wait, req('GET', { query: { w: String(a.wait.id), c: a.code } }));
  assert.equal(res.statusCode, 404);
});

test('POST /api/wait action=update — 달·요일·시간대를 바꾼다. 규칙 검사는 같고, 틀린 확인번호면 404', async () => {
  const a = (await run(wait, req('POST', { body: good() }))).body;
  let res = await run(wait, req('POST', { body: { action: 'update', w: a.wait.id, c: a.code, month: month(2), days: ['weekend'], windows: ['am'] } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([db.waitlist[0].dateFrom, db.waitlist[0].windows], [`${month(2)}-01`, ['am', 'weekend']]);
  assert.deepEqual([res.body.wait.month, res.body.wait.days, res.body.wait.windows], [month(2), ['weekend'], ['am']]);
  res = await run(wait, req('POST', { body: { action: 'update', w: a.wait.id, c: a.code, days: [] } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /평일·주말/);
  res = await run(wait, req('POST', { body: { action: 'update', w: a.wait.id, c: 'nope', month: month(1) } }));
  assert.equal(res.statusCode, 404);
});

test('POST /api/sms — 원장 토큰이 있어야 하고, 번호 5명까지, 문자 설정 전이면 503', async () => {
  let res = await run(sms, req('POST', { body: { to: ['01011110001'], text: '자리 났어요' } }));
  assert.equal(res.statusCode, 401);
  res = await run(sms, req('POST', { body: { to: ['01011110001'], text: '자리 났어요' }, headers: { authorization: 'Bearer tok' } }));
  assert.equal(res.statusCode, 503); assert.match(res.body.error, /문자 설정 전/);
  smsOn();
  res = await run(sms, req('POST', { body: { to: ['010-1111-0001', '01011110001', 'bad'], text: '자리 났어요' }, headers: { authorization: 'Bearer tok' } }));
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { sent: 1, failed: [] });
  assert.equal(smsCalls[0].Destination.length, 1, '같은 번호는 한 번만, 이상한 번호는 뺀다');
  assert.deepEqual([smsCalls[0].Service, smsCalls[0].Subject], ['LMS', '대기 자리 안내']);
  authOk = false;
  res = await run(sms, req('POST', { body: { to: ['01011110001'], text: 'x' }, headers: { authorization: 'Bearer tok' } }));
  assert.equal(res.statusCode, 401);
  authOk = true;
  res = await run(sms, req('POST', { body: { to: ['01011110001', '01011110002', '01011110003', '01011110004', '01011110005', '01011110006'], text: 'x' }, headers: { authorization: 'Bearer tok' } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /5명/);
  res = await run(sms, req('POST', { body: { messages: [{ to: '01011110001', text: '갑에게' }, { to: '01011110002', text: '을에게' }] }, headers: { authorization: 'Bearer tok' } }));
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { sent: 2, failed: [] });
  assert.deepEqual(smsCalls.at(-1).Destination.map((m) => [m.Phone, m.Msg_Text]), [['01011110001', '갑에게'], ['01011110002', '을에게']], '사람마다 다른 글, 한 번에 묶어서');
});
