// 서버 함수(Vercel api/) 공용 도우미. 브라우저 코드가 아니다 — 비밀 키(서비스 키, 문자 API 키)는 여기(Vercel 환경 변수)에만 있다.
// Vercel 환경 변수: SUPABASE_SERVICE_KEY(필수), SITE_URL(없으면 요청 호스트).
// 발송킹(10-21 알림톡, 10-23부터 대기 문자도): BALSONGKING_ID · BALSONGKING_PW(카드 전용 사용자) · BALSONGKING_CALLBACK(발신번호) — 문자는 이 셋, 알림톡은 BALSONGKING_CHANNEL(@채널) · BALSONGKING_TEMPLATE(승인된 템플릿 고유번호)까지. CRON_SECRET(Vercel이 매일 부를 때 쓰는 열쇠).
// 규칙은 store.js 그대로 쓴다(require). 서버는 Supabase REST와 발송킹에 fetch로만 말한다(설치할 패키지 없음).
const CONFIG = require('../config.js');
const Store = require('../store.js');

const env = (k) => process.env[k] ?? '';
const SUPABASE_URL = env('SUPABASE_URL') || CONFIG.SUPABASE_URL;

// Vercel은 UTC로 돈다. 날짜·시각은 한국 시간으로.
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19);

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
// 바깥 서버에 연결 자체가 안 될 때(Node는 "fetch failed"만 준다) 어디서 왜 막혔는지 붙여 알린다(10-23: 원장 화면에 "fetch failed"만 보였다)
async function connect(where, url, opts) {
  try { return await fetch(url, opts); }
  catch (e) {
    const c = e?.cause;
    throw new HttpError(502, `${where} 연결 실패: ${[c?.code, c?.message].filter(Boolean).join(' · ') || e?.message || '알 수 없음'}`);
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function readBody(req) {
  if (req.body === undefined || req.body === null || req.body === '') return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body)); } catch { throw new HttpError(400, '보낸 내용을 읽을 수 없습니다'); }
}
function siteUrl(req) {
  const fromEnv = env('SITE_URL').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? `https://${host}` : '';
}
const waitUrl = (req, wait) => `${siteUrl(req)}/wait.html?w=${wait.id}&c=${encodeURIComponent(wait.code)}`;

// ---- Supabase REST (서비스 키: RLS를 지나친다. 그래서 이 파일은 손님이 자기 것만 보게 스스로 걸러야 한다) ----
function serviceHeaders() {
  const key = env('SUPABASE_SERVICE_KEY');
  if (!key) throw new HttpError(503, '서버 설정 전입니다 (SUPABASE_SERVICE_KEY)');
  // 새 방식 비밀 열쇠(sb_secret_…)는 apikey 머리에만 싣는다(JWT가 아니라 Authorization에 넣지 않는다). 옛 service_role(eyJ…)은 둘 다.
  return key.startsWith('sb_') ? { apikey: key, 'Content-Type': 'application/json' } : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
async function rest(method, path, body, extra = {}) {
  const r = await connect('저장소(Supabase)', `${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...serviceHeaders(), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && data.message) || String(text).slice(0, 200);
    if (r.status === 404 || /schema cache|does not exist/i.test(msg)) throw new HttpError(503, '대기 표가 아직 없습니다 (원장이 schema.sql을 Run 해야 합니다)');
    throw new HttpError(502, `서버 저장소 오류: ${msg}`);
  }
  return data;
}
// 원장 앱의 상태 모양으로 조립한다. 규칙(store.js)이 바로 쓰게.
async function loadWaitState() {
  const [settingsRows, waitRows] = await Promise.all([rest('GET', 'card_settings?select=data&id=eq.1'), rest('GET', 'card_waitlist?select=*')]);
  const data = { ...((settingsRows ?? [])[0]?.data ?? {}) };
  const nextIdSaved = data.nextId; delete data.nextId;
  const waitlist = (waitRows ?? []).map((r) => ({ id: r.id, name: r.name, phone: r.phone, service: r.service, minutes: r.minutes ?? null, dateFrom: r.date_from, dateTo: r.date_to, windows: r.windows ?? [], note: r.note ?? '', code: r.code ?? '', status: r.status ?? 'waiting', createdAt: r.created_at ?? '', notified: r.notified ?? [] }));
  const maxId = Math.max(0, ...waitlist.map((w) => w.id));
  const raw = { ...Store.createState(), settings: data, waitlist, nextId: Math.max(Number.isInteger(nextIdSaved) ? nextIdSaved : 1, maxId + 1) };
  return Store.deserialize(JSON.stringify(raw));
}
const toRow = (w) => ({ id: w.id, name: w.name, phone: w.phone, service: w.service, minutes: w.minutes ?? null, date_from: w.dateFrom, date_to: w.dateTo, windows: Store.waitWindowsCol(w), note: w.note ?? '', code: w.code ?? '', status: w.status ?? 'waiting', created_at: w.createdAt ?? '', notified: w.notified ?? [] });
async function insertWait(wait) { await rest('POST', 'card_waitlist', toRow(wait), { Prefer: 'return=minimal' }); }
async function patchWait(id, code, patch) { await rest('PATCH', `card_waitlist?id=eq.${Number(id)}&code=eq.${encodeURIComponent(code)}`, patch, { Prefer: 'return=minimal' }); }

// 원장 앱이 보낸 로그인 토큰이 진짜인지 Supabase에 묻는다 (문자 보내기는 원장만)
async function requireOwner(req) {
  const auth = String(req.headers.authorization ?? '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw new HttpError(401, '로그인이 필요합니다');
  const r = await connect('로그인 확인(Supabase)', `${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new HttpError(401, '로그인이 만료됐습니다. 다시 로그인하세요');
  return r.json();
}

// ---- 문자 (발송킹, 10-23. 10-11~22는 솔라피였으나 가입 전이라 한 번도 안 씀) ----
// 알림톡과 같은 발송킹 계정·발신번호·예치금으로 LMS를 보낸다. 대기 문자는 링크가 들어가 90바이트(SMS)를 넘으므로 늘 LMS.
// 채널·템플릿은 필요 없다(알림톡이 아니라 문자). 사람마다 글이 달라(대기 바꾸기 링크) Destination의 Msg_Text로 한 번에 묶어 보낸다.
const SMS_KEYS = ['BALSONGKING_ID', 'BALSONGKING_PW', 'BALSONGKING_CALLBACK'];
const smsReady = () => SMS_KEYS.every((k) => env(k));
// items: [{to, text}]. subject는 발송킹 발송 내역에 보이는 제목(최대 64바이트).
async function sendSms(items, subject = '대기 자리 안내') {
  if (!smsReady()) throw new HttpError(503, `문자 설정 전입니다 (Vercel 환경 변수 ${SMS_KEYS.filter((k) => !env(k)).join('·')})`);
  const list = items.map((it) => ({ Phone: String(it.to).replace(/\D/g, ''), Msg_Text: String(it.text) }));
  await balsong({ Service: 'LMS', Type: 'Send', Callback: env('BALSONGKING_CALLBACK').replace(/\D/g, ''), Subject: subject, Main_Text: list[0].Msg_Text, Destination: list });
  // 발송킹은 접수만 알려 주고 사람별 결과는 나중(Report_Detail)에 나온다. 접수되면 보낸 것으로 본다.
  return { sent: list.length, failed: [] };
}

// ---- 예약 알림톡 (발송킹, 10-21) ----
// 발송킹 API는 POST 폼 + 아이디·암호. 고정 IP 등록이 없어 Vercel에서 바로 부른다. 1초에 3번 넘게 부르면 10분 막히므로 한 번에 묶어 보내고 사이를 띄운다.
const BALSONG_URL = 'https://balsongking.com/Linkage/API/';
const BALSONG_KEYS = ['BALSONGKING_ID', 'BALSONGKING_PW', 'BALSONGKING_CHANNEL', 'BALSONGKING_CALLBACK', 'BALSONGKING_TEMPLATE'];
const balsongMissing = () => BALSONG_KEYS.filter((k) => !env(k));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let lastBalsong = 0;
async function balsong(fields) {
  const wait = 500 - (Date.now() - lastBalsong);
  if (wait > 0) await pause(wait);
  lastBalsong = Date.now();
  const form = new FormData();
  for (const [k, v] of Object.entries({ UserID: env('BALSONGKING_ID'), UserPW: env('BALSONGKING_PW'), ...fields })) form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  const r = await connect('발송킹', BALSONG_URL, { method: 'POST', body: form });
  const data = await r.json().catch(() => null);
  if (!data) throw new HttpError(502, `발송킹 응답을 읽을 수 없습니다 (${r.status})`);
  if (data.Result !== 'OK') throw new HttpError(502, `발송킹: ${data.Message || '요청 실패'} (${data.Code})`);
  return data;
}
// 알림에 필요한 것만 읽는다: 고객(이름·번호), 명단(오늘 이전 마지막 줄 — 앞날 예약도 이 줄에 있다), 설정(멈춤)
async function loadRemindState(todayDate) {
  const [settingsRows, custRows, todayRows] = await Promise.all([
    rest('GET', 'card_settings?select=data&id=eq.1'),
    rest('GET', 'card_customers?select=id,name,phone,deleted_at,family_id'),   // 가족(10-24): 같은 날 가족은 대표 한 명에게만
    rest('GET', `card_today?select=date,entries&date=lte.${todayDate}&order=date.desc&limit=1`),
  ]);
  const data = { ...((settingsRows ?? [])[0]?.data ?? {}) }; delete data.nextId;
  const customers = (custRows ?? []).map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? '', deletedAt: r.deleted_at ?? null, familyId: Number.isInteger(r.family_id) ? r.family_id : null }));
  const t = (todayRows ?? [])[0];
  const raw = { ...Store.createState(), settings: data, customers, today: t ? { date: t.date, entries: t.entries ?? [] } : { date: '', entries: [] } };
  return Store.deserialize(JSON.stringify(raw));
}

// 함수 하나를 감싼다: 오류를 JSON으로, 모르는 오류는 500
const handler = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    const status = e instanceof HttpError ? e.status : (e && e.message && !(e instanceof TypeError)) ? 400 : 500;
    send(res, status, { error: e?.message ?? '알 수 없는 오류' });
  }
};

module.exports = { Store, env, kstNow, balsong, balsongMissing, loadRemindState, HttpError, send, readBody, siteUrl, waitUrl, rest, loadWaitState, insertWait, patchWait, requireOwner, smsReady, sendSms, handler };
