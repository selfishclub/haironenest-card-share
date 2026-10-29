// 전날 예약 알림톡 (10-21 원장: 발송킹, 전날 오후 6시).
// GET + "Bearer CRON_SECRET" — Vercel이 매일 한 번 부른다(vercel.json, 한국 시간 오후 5시대). 내일 명단을 읽어 발송킹에 "오늘 18:00 발송"으로 맡긴다.
//   카드에 올려 둔 예약 그대로 간다. 번호·시간이 없는 손님은 빠진다(카드 화면에 표시). 같은 날 두 번 불려도 발송킹 기록(제목)으로 보고 한 번만 맡긴다.
// GET + 원장 로그인 — 카드 [예약관리]의 알림톡 상자: 설정 상태·잔액·최근 발송 결과.
// POST + 원장 로그인 — [지금 보내기]: 오후 6시에 못 나갔을 때 내일 명단을 지금 보낸다(이미 맡긴 날이면 안 보냄).
const L = require('./_lib.js');

const kv = (vars) => Object.entries(vars).map(([Key, Value]) => ({ Key, Value }));
const shift = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const subjectFor = (date) => `예약 알림 ${date}`;
const SEND_AT = '18:00';

async function sendReminders() {
  const now = L.kstNow(), today = now.slice(0, 10), tomorrow = shift(today, 1);
  const missing = L.balsongMissing();
  if (missing.length) return { skipped: '설정 전', missing };
  const state = await L.loadRemindState(today);
  if (state.settings?.remindOff) return { skipped: '멈춤', date: tomorrow };
  const { send, skip } = L.Store.reminderList(state, tomorrow);
  if (!send.length) return { sent: 0, date: tomorrow, skip };
  const subject = subjectFor(tomorrow);
  const done = await L.balsong({ Service: 'ATALK', Type: 'Report', Date_Start: shift(today, -1), Date_End: tomorrow, List_EA: '10', Page: '1', Search_Field: 'Subject', Search_Word: subject });
  const already = (done.List ?? []).find((j) => j.Subject === subject);
  if (already) return { skipped: '이미 보냄', date: tomorrow, jobNo: already.Job_No };
  const sendAt = now.slice(11, 16) < SEND_AT ? `${today} ${SEND_AT}` : '';
  const r = await L.balsong({
    Service: 'ATALK', Type: 'Send', Channel_ID: L.env('BALSONGKING_CHANNEL'), Template_Seq: L.env('BALSONGKING_TEMPLATE'),
    Callback: L.env('BALSONGKING_CALLBACK').replace(/\D/g, ''), Subject: subject, Main_Text: L.Store.REMIND_TEMPLATE,
    Send_Date: sendAt, Fail_To: 'LMS', Fail_To_Template: '0', Fail_To_Main_Text: L.Store.REMIND_SMS_TEMPLATE,   // 카톡이 안 되는 손님은 같은 글을 문자로((아잉) 이모티콘 글자는 뺌)
    Destination: send.map((x) => ({ Company: '', Name: x.name, Phone: x.phone, Replace_Datas: kv(x.vars), Replace_Fail_Datas: kv(x.vars) })),
  });
  return { sent: send.length, date: tomorrow, sendAt: sendAt || '지금', jobNo: r.Job_No, cash: r.Cash, skip };
}

async function status() {
  const today = L.kstNow().slice(0, 10);
  const missing = L.balsongMissing();
  const state = await L.loadRemindState(today);
  const out = { ready: !missing.length && !!L.env('CRON_SECRET'), missing: [...missing, ...(L.env('CRON_SECRET') ? [] : ['CRON_SECRET'])], off: !!state.settings?.remindOff, sendAt: SEND_AT };
  if (missing.length) return out;
  const rep = await L.balsong({ Service: 'ATALK', Type: 'Report', Date_Start: shift(today, -7), Date_End: shift(today, 1), List_EA: '10', Page: '1', Search_Field: 'Subject', Search_Word: '예약 알림' });
  out.cash = rep.Cash;
  out.jobs = (rep.List ?? []).map((j) => ({ jobNo: j.Job_No, subject: j.Subject, sendDate: j.Send_Date, total: j.Total_Cnt, sent: j.Sent_Cnt, fail: j.Fail_Cnt, sending: j.Sending_Cnt, status: j.Status }));
  // 사람별 결과: 최근 한 건(알림톡 상자)과, 고객 카드가 쓰는 오늘·내일 예약분(10-26 원장: 카드에서 알림이 갔는지 보기). 같은 발송은 한 번만 묻는다(1초 3번 제한)
  const details = new Map();
  const detailOf = async (jobNo) => {
    if (!details.has(jobNo)) details.set(jobNo, ((await L.balsong({ Service: 'ATALK', Type: 'Report_Detail', Job_No: String(jobNo), List_EA: '100', Page: '1' })).List ?? []));
    return details.get(jobNo);
  };
  if (out.jobs.length) out.detail = (await detailOf(out.jobs[0].jobNo)).map((x) => ({ name: x.Name, status: x.Status, detail: x.Status_Detail, mobile: x.Status_Mobile || '' }));
  out.people = {};
  for (const date of [today, shift(today, 1)]) {
    const j = out.jobs.find((x) => x.subject === subjectFor(date));
    if (j) out.people[date] = { jobNo: j.jobNo, sendDate: j.sendDate, list: (await detailOf(j.jobNo)).map((x) => ({ name: x.Name, phone: String(x.Phone ?? '').replace(/\D/g, ''), status: x.Status, detail: x.Status_Detail, mobile: x.Status_Mobile || '', text: x.Msg_Text || '' })) };
  }
  return out;
}

module.exports = L.handler(async (req, res) => {
  const secret = L.env('CRON_SECRET');
  if (req.method === 'GET' && secret && String(req.headers.authorization ?? '') === `Bearer ${secret}`) return L.send(res, 200, await sendReminders());
  await L.requireOwner(req);
  if (req.method === 'GET') return L.send(res, 200, await status());
  if (req.method === 'POST') return L.send(res, 200, await sendReminders());
  throw new L.HttpError(405, '허용되지 않는 요청');
});
module.exports.sendReminders = sendReminders;
