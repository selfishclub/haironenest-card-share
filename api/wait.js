// 손님용 서버 함수: 대기 걸기 · 내 대기 보기 · 날짜 바꾸기 · 빼기. 로그인 없이, 자기 것만 (번호 또는 대기 번호 + 확인번호).
// 규칙 검사는 store.js의 addWait가 한다. 한 번호로 대기 3건까지(규칙), 하루 5번까지 시도(여기). 봇을 걸러내는 빈 칸(website)이 차 있으면 조용히 무시.
const L = require('./_lib.js');
const { Store } = L;

const strip = (w) => ({ id: w.id, service: w.service, minutes: w.minutes, month: w.dateTo.slice(0, 7), dateFrom: w.dateFrom, dateTo: w.dateTo, days: w.days, windows: w.windows, note: w.note, status: w.status, createdAt: w.createdAt, notifiedCount: (w.notified ?? []).length });
const withPosition = (state, w) => ({ ...strip(w), position: w.status === 'waiting' ? Store.waitPosition(state, w.id) : null });
const DAILY_TRIES = 5;

module.exports = L.handler(async (req, res) => {
  const q = req.query ?? {};
  if (req.method === 'GET') {
    // 대기 번호 + 확인번호(문자 링크) 또는 전화번호 + 확인번호(손으로 침)
    if (q.c && (q.w || q.p)) {
      const state = Store.expireWaits(await L.loadWaitState(), L.kstNow().slice(0, 10));
      const code = String(q.c).trim();
      const mine = (state.waitlist ?? []).filter((w) => w.code === code && w.status !== 'left' && (q.w ? w.id === Number(q.w) : w.phone === String(q.p).replace(/\D/g, '')));
      if (!mine.length) throw new L.HttpError(404, '그 번호로 걸린 대기를 찾지 못했어요. 번호와 확인번호를 다시 봐 주세요');
      return L.send(res, 200, { waits: mine.map((w) => withPosition(state, w)), name: mine[0].name });
    }
    // 폼에 필요한 것: 시술 목록·고를 수 있는 달·평일/주말·시간대·오늘
    const state = await L.loadWaitState();
    const today = L.kstNow().slice(0, 10);
    return L.send(res, 200, { services: Store.serviceList(state).map(({ name, minutes }) => ({ name, minutes })), months: Store.waitMonths(today), days: Store.WAIT_DAYS, windows: Store.WAIT_WINDOWS, today, maxPerPhone: Store.WAIT_MAX_PER_PHONE, notifyLimit: Store.NOTIFY_LIMIT, smsReady: L.smsReady() });
  }
  if (req.method !== 'POST') throw new L.HttpError(405, '허용되지 않는 요청');
  const body = L.readBody(req);
  if (body.website) return L.send(res, 200, { ok: true });   // 봇
  const now = L.kstNow();
  const today = now.slice(0, 10);

  if (body.action === 'leave' || body.action === 'update') {
    const state = await L.loadWaitState();
    const w = (state.waitlist ?? []).find((x) => x.id === Number(body.w) && x.code === String(body.c ?? '').trim());
    if (!w) throw new L.HttpError(404, '그 대기를 찾지 못했어요');
    if (body.action === 'leave') {
      await L.patchWait(w.id, w.code, { status: 'left' });
      return L.send(res, 200, { ok: true });
    }
    // 바꾸기: 그 대기를 뺀 상태에서 규칙 검사(한 번호 3건 셈에서 자기 자신은 빠지게), 통과하면 달·요일·시간대만 고친다. 줄 순서는 그대로.
    const without = { ...state, waitlist: state.waitlist.filter((x) => x.id !== w.id) };
    const checked = Store.addWait(without, { ...w, month: body.month ?? w.dateTo.slice(0, 7), days: body.days ?? w.days, windows: body.windows ?? w.windows, note: body.note ?? w.note }, now).wait;
    const changed = { dateFrom: checked.dateFrom, dateTo: checked.dateTo, days: checked.days, windows: checked.windows, note: checked.note, status: 'waiting' };
    await L.patchWait(w.id, w.code, { date_from: changed.dateFrom, date_to: changed.dateTo, windows: Store.waitWindowsCol(changed), note: changed.note, status: 'waiting' });
    const after = { ...state, waitlist: state.waitlist.map((x) => (x.id === w.id ? { ...x, ...changed } : x)) };
    return L.send(res, 200, { wait: withPosition(after, after.waitlist.find((x) => x.id === w.id)) });
  }

  // 새로 걸기
  if (body.agree !== true) throw new L.HttpError(400, '안내를 읽고 동의에 표시해 주세요');
  const state = Store.expireWaits(await L.loadWaitState(), today);
  const phone = String(body.phone ?? '').replace(/\D/g, '');
  const triesToday = (state.waitlist ?? []).filter((w) => w.phone === phone && (w.createdAt ?? '').slice(0, 10) === today).length;
  if (phone && triesToday >= DAILY_TRIES) throw new L.HttpError(429, '오늘은 더 걸 수 없어요. 내일 다시 해 주세요');
  const r = Store.addWait(state, { name: body.name, phone: body.phone, service: body.service, month: body.month, days: body.days, windows: body.windows, note: body.note }, now);
  await L.insertWait(r.wait);
  const position = Store.waitPosition(r.state, r.wait.id);
  const url = L.waitUrl(req, r.wait);
  let smsSent = false;
  if (L.smsReady()) {
    try { smsSent = (await L.sendSms([{ to: r.wait.phone, text: Store.waitConfirmText(r.state, r.wait, position, url) }], '대기 접수')).sent > 0; } catch { smsSent = false; }
  }
  return L.send(res, 200, { wait: withPosition(r.state, r.wait), code: r.wait.code, url, smsSent });
});
