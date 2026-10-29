// 원장 앱이 부르는 문자 보내기. 취소 한 줄을 적으면 앱이 맞는 대기 손님(최대 3명)을 고르고, 여기로 번호와 글을 보낸다.
// 원장 로그인 토큰이 있어야 한다. 받는 사람은 한 번에 5명까지. 글은 앱(store.js noticeText)이 만든다.
const L = require('./_lib.js');

module.exports = L.handler(async (req, res) => {
  if (req.method !== 'POST') throw new L.HttpError(405, '허용되지 않는 요청');
  await L.requireOwner(req);
  const body = L.readBody(req);
  // {messages: [{to, text}]} 또는 {to: [...], text} 둘 다 받는다
  const raw = Array.isArray(body.messages) ? body.messages : (Array.isArray(body.to) ? body.to : []).map((to) => ({ to, text: body.text }));
  const seen = new Set();
  const items = raw.map((m) => ({ to: String(m?.to ?? '').replace(/\D/g, ''), text: String(m?.text ?? '').trim() }))
    .filter((m) => /^\d{10,11}$/.test(m.to) && !seen.has(m.to) && seen.add(m.to));
  if (!items.length) throw new L.HttpError(400, '보낼 번호가 없습니다');
  if (items.length > 5) throw new L.HttpError(400, '한 번에 5명까지입니다');
  if (items.some((m) => !m.text || m.text.length > 1000)) throw new L.HttpError(400, '문자 글이 비었거나 너무 깁니다');
  const r = await L.sendSms(items);
  return L.send(res, 200, r);
});
