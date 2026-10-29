// 예약 알림톡 서버 함수 테스트. Supabase·발송킹은 가짜 fetch. 실제로 아무것도 보내지 않는다.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_SERVICE_KEY = 'service-test';
const L = require('./api/_lib.js');
const remind = require('./api/remind.js');

const kst = () => L.kstNow();
const day = (n) => { const d = new Date(kst().slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let db, bk, authOk;
const ENV = { BALSONGKING_ID: 'card-user', BALSONGKING_PW: 'pw-test', BALSONGKING_CHANNEL: '@예시채널', BALSONGKING_CALLBACK: '031-000-0000', BALSONGKING_TEMPLATE: '777', CRON_SECRET: 'cron-test' };
beforeEach(() => {
  Object.assign(process.env, ENV);
  const tomorrow = day(1);
  db = {
    settings: { nextId: 9 },
    customers: [{ id: 1, name: '고객 A', phone: '01011112222', deleted_at: null }, { id: 2, name: '고객 B', phone: '', deleted_at: null }, { id: 3, name: '고객 C', phone: '01033334444', deleted_at: null }],
    today: [{ date: day(0), entries: [{ customerId: 1, at: '14:30', date: tomorrow, service: '커트' }, { customerId: 2, at: '11:00', date: tomorrow }, { customerId: 3, at: '10:00', date: tomorrow }, { customerId: 3, at: '10:00', date: day(2) }] }],
  };
  bk = { calls: [], jobs: [] }; authOk = true;
  global.fetch = async (url, opts = {}) => {
    const ok = (data, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), json: async () => data });
    if (url.includes('/auth/v1/user')) return authOk ? ok({ id: 'owner' }) : ok({ message: 'bad' }, 401);
    if (url.includes('card_settings')) return ok([{ data: db.settings }]);
    if (url.includes('card_customers')) return ok(db.customers);
    if (url.includes('card_today')) return ok(db.today);
    if (url.startsWith('https://balsongking.com/Linkage/API/')) {
      const f = Object.fromEntries([...opts.body.entries()]);
      bk.calls.push(f);
      if (f.Type === 'Report') return ok({ Result: 'OK', Code: 0, Cash: 45000, Total_Cnt: bk.jobs.length, List: bk.jobs });
      if (f.Type === 'Send') { bk.jobs.push({ Job_No: 555, Subject: f.Subject, Send_Date: f.Send_Date, Total_Cnt: JSON.parse(f.Destination).length, Sent_Cnt: 0, Fail_Cnt: 0, Sending_Cnt: 2, Status: '대기' }); return ok({ Result: 'OK', Code: 0, Cash: 44974, Job_No: 555 }); }
      if (f.Type === 'Report_Detail') return ok({ Result: 'OK', Code: 0, List: [{ Name: '고객 C', Phone: '01033334444', Msg_Text: '고객 C님, 내일 예약을 알려드립니다. 오전 10시', Status: '성공', Status_Detail: '성공', Status_Mobile: '' }] });
    }
    return ok({ message: 'unknown ' + url }, 404);
  };
});
const req = (method, headers = {}) => ({ method, query: {}, headers: { host: 'card.test', ...headers } });
const run = async (r) => { const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } }; await remind(r, res); return res; };
const cron = () => run(req('GET', { authorization: 'Bearer cron-test' }));

test('매일 부르면 내일 명단을 발송킹 알림톡 한 번에 맡긴다 — 번호·시간 있는 손님만, 이름·날짜·시간·시술을 채워서', async () => {
  const res = await cron();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.sent, 2);
  assert.deepEqual(res.body.skip.map((x) => [x.name, x.reason]), [['고객 B', '번호 없음']]);
  const send = bk.calls.find((c) => c.Type === 'Send');
  assert.equal(send.Service, 'ATALK'); assert.equal(send.UserID, 'card-user'); assert.equal(send.Template_Seq, '777');
  assert.equal(send.Channel_ID, '@예시채널'); assert.equal(send.Callback, '0310000000');
  assert.equal(send.Fail_To, 'LMS'); assert.equal(send.Fail_To_Template, '0', '문자는 (아잉) 없는 글로');
  assert.equal(send.Fail_To_Main_Text, L.Store.REMIND_SMS_TEMPLATE);
  assert.equal(send.Main_Text, L.Store.REMIND_TEMPLATE);
  assert.equal(send.Subject, `예약 알림 ${day(1)}`);
  if (kst().slice(11, 16) < '18:00') assert.equal(send.Send_Date, `${day(0)} 18:00`, '오후 6시에 나가도록 예약'); else assert.equal(send.Send_Date, '');
  const dest = JSON.parse(send.Destination);
  assert.deepEqual(dest.map((d) => d.Phone), ['01033334444', '01011112222'], '시간순, 모레 예약은 안 들어감');
  const a = Object.fromEntries(dest[1].Replace_Datas.map((x) => [x.Key, x.Value]));
  assert.equal(a['#{이름}'], '고객 A'); assert.equal(a['#{시간}'], '오후 2시 30분'); assert.equal(a['#{시술}'], '커트');
  assert.deepEqual(dest[1].Replace_Fail_Datas, dest[1].Replace_Datas, '문자로 갈 때도 같은 값');
});

test('같은 날 두 번 불려도 한 번만 맡긴다 (발송킹 기록의 제목으로 확인)', async () => {
  await cron();
  const again = await cron();
  assert.equal(again.body.skipped, '이미 보냄');
  assert.equal(bk.calls.filter((c) => c.Type === 'Send').length, 1);
});

test('설정 전·멈춤·열쇠 없음', async () => {
  delete process.env.BALSONGKING_TEMPLATE;
  const r1 = await cron();
  assert.equal(r1.body.skipped, '설정 전'); assert.deepEqual(r1.body.missing, ['BALSONGKING_TEMPLATE']);
  assert.equal(bk.calls.length, 0, '설정 전이면 발송킹을 부르지도 않는다');
  process.env.BALSONGKING_TEMPLATE = '777';
  db.settings.remindOff = true;
  assert.equal((await cron()).body.skipped, '멈춤');
  assert.equal(bk.calls.length, 0);
  // 열쇠가 틀리면 원장 로그인으로 보고, 로그인도 없으면 막는다
  authOk = false;
  const bad = await run(req('GET', { authorization: 'Bearer wrong' }));
  assert.equal(bad.statusCode, 401);
});

test('원장 화면: 설정 상태·잔액·최근 발송 결과. [지금 보내기]도 같은 규칙', async () => {
  const st0 = await run(req('GET', { authorization: 'Bearer owner-token' }));
  assert.equal(st0.statusCode, 200);
  assert.equal(st0.body.ready, true); assert.equal(st0.body.cash, 45000); assert.deepEqual(st0.body.jobs, []);
  const now = await run(req('POST', { authorization: 'Bearer owner-token' }));
  assert.equal(now.body.sent, 2);
  const st = await run(req('GET', { authorization: 'Bearer owner-token' }));
  assert.equal(st.body.jobs.length, 1); assert.equal(st.body.jobs[0].subject, `예약 알림 ${day(1)}`);
  assert.deepEqual(st.body.detail, [{ name: '고객 C', status: '성공', detail: '성공', mobile: '' }]);
  // 고객 카드용(10-26 원장): 오늘·내일 예약분 발송의 사람별 결과(번호·보낸 글 포함). 같은 발송은 한 번만 물어본다
  const p = st.body.people[day(1)];
  assert.equal(p.jobNo, 555);
  assert.deepEqual(p.list, [{ name: '고객 C', phone: '01033334444', status: '성공', detail: '성공', mobile: '', text: '고객 C님, 내일 예약을 알려드립니다. 오전 10시' }]);
  assert.equal(st.body.people[day(0)], undefined, '오늘 예약분 발송이 없으면 없음');
  assert.equal(bk.calls.filter((c) => c.Type === 'Report_Detail').length, 1);
  assert.ok(!JSON.stringify(st.body).includes('pw-test'), '암호는 돌려주지 않는다');
});

test('연결이 아예 안 되면 어디서 왜 막혔는지 알려 준다 (10-23 원장 화면: "fetch failed"만 보였다)', async () => {
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://balsongking.com')) { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }); throw e; }
    return real(url, opts);
  };
  const res = await run(req('GET', { authorization: 'Bearer owner-token' }));
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /발송킹 연결 실패/);
  assert.match(res.body.error, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
});

test('가족(family_id) — 번호 없는 가족 알림은 대표 번호로 간다. 서버도 family_id를 읽는다 (10-24 원장)', async () => {
  db.customers = db.customers.map((c) => ({ ...c, family_id: c.id === 2 || c.id === 1 ? 1 : null }));   // 고객 A(대표)·고객 B(번호 없음, 11시) 한 가족
  const res = await cron();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.sent, 3);
  assert.deepEqual(res.body.skip, [], '번호 없는 가족 B는 대표 A 번호로');
  const dest = JSON.parse(bk.calls.find((c) => c.Type === 'Send').Destination);
  const vals = dest.map((d) => { const v = Object.fromEntries(d.Replace_Datas.map((x) => [x.Key, x.Value])); return [d.Phone, v['#{시간}'], v['#{시술}']]; });
  assert.deepEqual(vals, [['01033334444', '오전 10시', '예약하신 시술'], ['01011112222', '오전 11시', '고객 B 예약하신 시술'], ['01011112222', '오후 2시 30분', '커트']]);
});
