// 상담 카드 저장 규칙. 화면과 무관한 순수 함수만 둔다.
// 브라우저에서는 <script src="store.js">로 읽어 전역 Store를 쓰고, 테스트에서는 require로 읽는다.
// 모든 함수는 기존 state를 바꾸지 않고 새 state를 돌려준다.
const Store = (() => {
  const emptyProfile = () => ({ talk: '', hair: '' });
  const KINDS = ['커트', '펌', '염색', '클리닉', '기타'];

  function createState() {
    return { nextId: 1, customers: [], visits: [], passes: [], settings: defaultSettings(), today: { date: '', entries: [] }, photos: [], products: [], stockLogs: [], cancels: [], waitlist: [] };
  }

  // ---- 고객 --------------------------------------------------------------

  const digitsOnly = (v) => (v ?? '').replace(/\D/g, '');

  function cleanPhone(phone) {
    const d = digitsOnly(phone);
    if (d && !/^\d{10,11}$/.test(d)) throw new Error('전화번호는 숫자 10~11자리로 적으세요 (예: 010-1234-5678)');
    return d;
  }

  // 지운 고객(deletedAt)은 목록·검색·번호 중복 검사에서 모두 빠진다.
  // 그래야 지운 고객과 같은 번호로 새 고객을 만들 수 있다.
  const activeCustomers = (state) => state.customers.filter(c => !c.deletedAt);

  function phoneClash(state, phone, exceptId) {
    if (!phone) return null;
    return activeCustomers(state).find(c => c.phone === phone && c.id !== exceptId) ?? null;
  }

  function assertPhoneFree(state, phone, exceptId) {
    const dup = phoneClash(state, phone, exceptId);
    if (dup) throw new Error(`이미 같은 번호의 고객이 있습니다: ${dup.name}`);
  }

  function addCustomer(state, { name, phone, referrer, isLegacy }) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('이름을 입력하세요');
    const clean = cleanPhone(phone);
    assertPhoneFree(state, clean);
    const customer = { id: state.nextId, name: trimmed, phone: clean, referrer: (referrer ?? '').trim(), isLegacy: !!isLegacy, profile: emptyProfile(), profileHistory: [], deletedAt: null, photoConsent: null, familyId: null };
    return {
      state: { ...state, nextId: state.nextId + 1, customers: [...state.customers, customer] },
      customer,
    };
  }

  function editCustomer(state, customerId, { name, phone, referrer, isLegacy }) {
    const c = requireCustomer(state, customerId);
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new Error('이름을 입력하세요');
    const clean = cleanPhone(phone);
    assertPhoneFree(state, clean, customerId);
    const updated = { ...c, name: trimmed, phone: clean, referrer: (referrer ?? '').trim(), isLegacy: isLegacy === undefined ? !!c.isLegacy : !!isLegacy };
    return {
      state: { ...state, customers: state.customers.map(x => (x.id === customerId ? updated : x)) },
      customer: updated,
    };
  }

  // 목록·명단에서 보일 때: 앞 3자리와 뒤 4자리만. 옛 뒤 4자리 데이터는 ****-1234
  function maskPhone(phone) {
    if (!phone) return '';
    if (phone.length <= 4) return `****-${phone}`;
    const head = phone.slice(0, 3);
    const tail = phone.slice(-4);
    return `${head}-${'*'.repeat(phone.length - 7)}-${tail}`;
  }

  function findCustomers(state, query) {
    const q = (query ?? '').trim();
    const live = activeCustomers(state);
    if (!q) return live;
    const qd = digitsOnly(q);
    return live.filter(c => c.name.includes(q) || (qd && c.phone && c.phone.includes(qd)));
  }

  function findAny(state, customerId) {
    const c = state.customers.find(x => x.id === customerId);
    if (!c) throw new Error('고객을 찾을 수 없습니다');
    return c;
  }

  // 고치기·방문 기록처럼 살아 있는 고객에게만 해야 하는 일은 이걸 쓴다.
  function requireCustomer(state, customerId) {
    const c = findAny(state, customerId);
    if (c.deletedAt) throw new Error('지운 고객입니다. 먼저 되살리세요');
    return c;
  }

  // ---- 지우기 -------------------------------------------------------------
  // 두 단계로 나눈다. deleteCustomer는 목록에서 감추기만 해서 되살릴 수 있고,
  // purgeCustomer는 고객과 그 방문 기록을 정말로 없애 되살릴 수 없다.

  function deleteCustomer(state, customerId, now) {
    const c = requireCustomer(state, customerId);
    const updated = { ...c, deletedAt: now };
    return {
      state: {
        ...state,
        customers: state.customers.map(x => (x.id === customerId ? updated : x)),
        today: { ...state.today, entries: state.today.entries.filter(e => e.customerId !== customerId) },
      },
      customer: updated,
    };
  }

  function restoreCustomer(state, customerId) {
    const c = findAny(state, customerId);
    if (!c.deletedAt) return { state, customer: c };
    const clash = phoneClash(state, c.phone, customerId);
    if (clash) throw new Error(`같은 번호를 쓰는 고객(${clash.name})이 있어 되살릴 수 없습니다`);
    const updated = { ...c, deletedAt: null };
    return {
      state: { ...state, customers: state.customers.map(x => (x.id === customerId ? updated : x)) },
      customer: updated,
    };
  }

  // 가족으로 묶여 있으면 그 사람의 충전·사용 내역은 남은 가족(가장 작은 번호)에게 넘긴다. 사람은 지워도 가족 돈은 그대로다.
  function purgeCustomer(state, customerId) {
    const gone = findAny(state, customerId);
    const key = gone.familyId ?? null;
    const others = key === null ? [] : state.customers.filter(x => x.id !== customerId && x.familyId === key);
    const heir = others.length ? Math.min(...others.map(x => x.id)) : null;
    const newKey = others.length <= 1 ? null : key === customerId ? heir : key;
    return {
      state: {
        ...state,
        customers: state.customers.filter(x => x.id !== customerId).map(x => (key !== null && x.familyId === key ? { ...x, familyId: newKey } : x)),
        visits: state.visits.filter(v => v.customerId !== customerId),
        passes: heir === null ? state.passes.filter(x => x.customerId !== customerId)
          : state.passes.map(x => (x.customerId === customerId ? { ...x, customerId: heir, visitId: null } : x)),
        photos: state.photos.filter(x => x.customerId !== customerId),
        today: { ...state.today, entries: state.today.entries.filter(e => e.customerId !== customerId) },
      },
    };
  }

  // 지운 고객 목록. 최근에 지운 것이 위로 온다.
  function deletedCustomers(state) {
    return state.customers
      .filter(c => c.deletedAt)
      .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : b.id - a.id));
  }

  // 고정 정보(고객이 한 말·생활·직업 / 얼굴형·모질·두상). 고치면 이전 내용이 이력에 남는다.
  function setProfile(state, customerId, { talk, hair }, now) {
    const c = requireCustomer(state, customerId);
    const next = { talk: (talk ?? '').trim(), hair: (hair ?? '').trim() };
    const wasEmpty = !c.profile.talk && !c.profile.hair;
    const unchanged = c.profile.talk === next.talk && c.profile.hair === next.hair;
    const history = wasEmpty || unchanged ? c.profileHistory : [...c.profileHistory, { ...c.profile, replacedAt: now }];
    const updated = { ...c, profile: next, profileHistory: history };
    return {
      state: { ...state, customers: state.customers.map(x => (x.id === customerId ? updated : x)) },
      customer: updated,
    };
  }

  // ---- 방문 기록 (오늘 시술과 이유 / 다음 방향) -----------------------------

  function visitFields({ done, next, kinds }) {
    const raw = (done ?? '').trim();
    if (!raw) throw new Error('오늘 시술 내용을 입력하세요');
    // 말한 글을 네 항목(시술·고민·진단·다음)으로 나눠 "고민: …" 줄로 정리해 둔다. 항목 이름 없이 말했으면 그대로다.
    const d = joinSections(splitSections(raw));
    const ks = Array.isArray(kinds) ? kinds : [];
    const bad = ks.find(k => !KINDS.includes(k));
    if (bad) throw new Error(`시술 종류는 ${KINDS.join('·')} 중에서 고르세요`);
    return { done: d, next: (next ?? '').trim(), kinds: [...new Set(ks)] };
  }

  // 방문 날짜. 못 적고 지나간 날 것을 나중에 적을 때 그 날짜로 둔다.
  // 시각은 건드리지 않는다: 새로 적으면 지금 시각, 고치면 원래 시각을 그대로 쓴다.
  // 비우면 null(그대로 둔다). 오늘보다 뒤는 안 된다.
  function visitDate(date, now) {
    const d = (date ?? '').trim();
    if (!d) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    const real = m && (() => { const x = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); return x.getFullYear() === Number(m[1]) && x.getMonth() === Number(m[2]) - 1 && x.getDate() === Number(m[3]); })();
    if (!real) throw new Error('날짜는 2026-09-15처럼 적으세요');
    if (d > now.slice(0, 10)) throw new Error('오늘보다 뒤 날짜에는 기록을 남길 수 없습니다');
    return d;
  }

  function addVisit(state, customerId, fields, now) {
    requireCustomer(state, customerId);
    const date = visitDate(fields.date, now);
    const createdAt = date ? date + now.slice(10) : now;
    const visit = { id: state.nextId, customerId, ...visitFields(fields), createdAt, history: [], deletedAt: null };
    return {
      state: { ...state, nextId: state.nextId + 1, visits: [...state.visits, visit] },
      visit,
    };
  }

  function editVisit(state, visitId, fields, now) {
    const clean = visitFields(fields);
    const target = state.visits.find(v => v.id === visitId);
    if (!target) throw new Error('방문 기록을 찾을 수 없습니다');
    if (target.deletedAt) throw new Error('지운 기록입니다. 먼저 되살리세요');
    // 날짜를 옮기면 이전 날짜도 이력에 남는다. 같은 날짜면 안 옮긴 것으로 본다.
    const date = visitDate(fields.date, now);
    const moved = date !== null && date !== target.createdAt.slice(0, 10);
    const createdAt = moved ? date + target.createdAt.slice(10) : target.createdAt;
    const entry = { done: target.done, next: target.next, replacedAt: now, ...(moved ? { createdAt: target.createdAt } : {}) };
    const updated = { ...target, ...clean, createdAt, history: [...target.history, entry] };
    return {
      state: { ...state, visits: state.visits.map(v => (v.id === visitId ? updated : v)) },
      visit: updated,
    };
  }

  // 지운 기록은 여기서 빠지므로, 방문 목록과 주기 계산이 모두 알아서 따라간다.
  function visitsOf(state, customerId) {
    return state.visits
      .filter(v => v.customerId === customerId && !v.deletedAt)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
  }

  // ---- 읽기 쉽게 줄 나누기 ----------------------------------------------
  // 저장은 말한 그대로 두고, 보여줄 때만 항목으로 나눈다. 자르는 자리는 셋뿐이다:
  // 줄바꿈, "/"(숫자 사이 분수는 빼고), 한글로 끝난 문장의 점(1.5처럼 숫자 뒤 점은 빼고).
  // 쉼표에서는 안 자른다. "파랑 롤 한 바퀴 반, 120도 5분"처럼 한 항목 안에서도 쓰이기 때문이다.
  function noteLines(text) {
    const lines = rawLines(text);
    if (isStructured(lines)) return noteOutline(text).filter(o => o.kind === 'item').map(o => o.text);
    return String(text ?? '')
      .split(/\n|(?<!\d)\s*\/\s*(?!\d)|(?<=[가-힣])\.\s*|(?<=[가-힣]고)요?,\s*/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // 글에 제목(쌍점으로 끝나는 줄)·번호 줄·"•" 같은 표시가 이미 있으면 원장이 정한 구조다.
  // 그때는 줄바꿈에서만 나누고 그 구조를 그대로 살린다. 카드 규칙(문장 끝·"/")을 덧씌우지 않는다.
  // 구조가 없는 글(말한 그대로)은 noteLines로 나눠 전부 항목이다.
  const BULLET_RE = /^[•·\-*–—▪◦]\s*/;
  const NUMBER_RE = /^\d+[.)]\s*(?![\d.])\S/;   // "1. 컷"·"2) 펌"은 번호, "1.5바퀴"는 소수라 아니다
  // 붙임 글자: (a) (b) a. b) 가. 나. ① ② — 번호 줄 밑의 세부 항목. "컷."처럼 보통 글자 뒤 점은 아니다.
  const LETTER_RE = /^(?:\([a-zA-Z가-힣]\)|[a-zA-Z][.)]|[가나다라마바사아자차카타파하][.)]|[①-⑳㉠-㉻])\s*/;
  const BRACKET_RE = /^\[(.+)\]$/;   // [고객 정보 및 모발 상태] 같은 제목 줄
  const rawLines = (text) => String(text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const isStructured = (lines) => lines.length >= 2 && lines.some(l => BULLET_RE.test(l) || LETTER_RE.test(l) || /:$/.test(l) || BRACKET_RE.test(l));
  // 번호 줄이 제목인가: 쌍점 없이 짧고(16자 이하), 뒤에 번호 아닌 줄이 따라올 때만. "1. 옆머리: 투블럭"은 내용이 있는 항목이다.
  const isNumberedTitle = (line, next) => NUMBER_RE.test(line) && !/[:：]/.test(line) && line.replace(/^\d+[.)]\s*/, '').length <= 16
    && !!next && !NUMBER_RE.test(next) && !/:$/.test(next);
  const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, '  ').length;
  const isMarked = (line) => BULLET_RE.test(line) || LETTER_RE.test(line);
  // 소제목은 점을 안 찍는다(원장, 09-30): [대괄호] 줄은 제목, "• 커트:"처럼 표시 뒤 쌍점으로 끝나는 줄과
  // 밑에 더 들여쓴 표시 줄을 거느린 표시 줄은 작은 제목. 들여쓰기가 있는 글에서는 들여쓰기가 돌아오면 작은 제목 밖으로 나온다.
  function noteOutline(text) {
    if (!isStructured(rawLines(text))) return noteLines(text).map(t => ({ kind: 'item', level: 0, text: t }));
    const raw = String(text ?? '').split('\n');
    const all = raw.map(s => s.trim());   // 빈 줄도 남긴다: 덩어리의 경계
    const indents = raw.map(indentOf);
    const indented = indents.some(n => n > 0);   // 들여쓰기를 쓴 글에서만 들여쓰기로 단을 판단한다
    const out = [];
    let headLevel = -1;   // 마지막 제목의 단. -1이면 제목 없음
    let subLevel = -1;    // 마지막 작은 제목의 단
    let subIndent = -1;   // 그 작은 제목 줄의 들여쓰기
    let numLevel = -1;    // 마지막 번호 항목의 단 (그 밑에 (a)(b)·• 가 붙는다)
    const openSub = (level, text, indent) => { subLevel = level; subIndent = indent; numLevel = -1; out.push({ kind: 'sub', level, text }); };
    all.forEach((line, i) => {
      if (!line) { subLevel = -1; numLevel = -1; return; }   // 빈 줄: 들여쓰기를 푼다
      const br = BRACKET_RE.exec(line);
      if (br) { headLevel = 0; subLevel = -1; numLevel = -1; out.push({ kind: 'heading', level: 0, text: br[1].trim() }); return; }
      if (indented && subLevel >= 0 && indents[i] <= subIndent) { subLevel = -1; numLevel = -1; }   // 들여쓰기가 돌아왔다
      const marked = isMarked(line);
      const bare = line.replace(BULLET_RE, '').replace(LETTER_RE, '');
      if (!bare.trim()) return;                                                        // "•"만 있는 줄: 그릴 것이 없다
      if (/:$/.test(line)) {
        const title = bare.replace(/\s*:$/, '');
        if (marked || indents[i] > 0) { openSub(headLevel + 1, title, indents[i]); return; }
        headLevel = 0; subLevel = -1; numLevel = -1; out.push({ kind: 'heading', level: 0, text: title }); return;
      }
      const nextIdx = all.findIndex((l, j) => j > i && l);
      const next = nextIdx >= 0 ? all[nextIdx] : undefined;
      if (isNumberedTitle(line, next)) { openSub(headLevel + 1, line, indents[i]); return; }
      if (marked && next !== undefined && isMarked(next) && indents[nextIdx] > indents[i] && bare.length <= 16 && !/[:：]/.test(bare)) { openSub(headLevel + 1, bare, indents[i]); return; }
      const base = (subLevel >= 0 ? subLevel : headLevel) + 1;
      if (NUMBER_RE.test(line)) { numLevel = base; out.push({ kind: 'item', level: base, text: line }); return; }
      const under = numLevel >= 0 ? numLevel + 1 : base;
      if (LETTER_RE.test(line)) { out.push({ kind: 'item', level: under, text: line.replace(LETTER_RE, '') }); return; }
      out.push({ kind: 'item', level: under, text: line.replace(BULLET_RE, '') });
    });
    return out;
  }

  // 번호(1. 2) …)로 시작하는 조각. 번호가 표시 역할을 하니 점을 따로 찍지 않는다. "1.5바퀴"·"120도"는 아니다.
  const noteNumbered = (item) => NUMBER_RE.test(String(item ?? '').trim());

  // 항목 안의 "짧은말: 내용" — 옆머리: 13mm. 이름은 여덟 자까지. 보여줄 때 이름을 굵게 한다.
  function noteInline(item) {
    const m = /^([^:：]{1,8}?)\s*[:：]\s*(.+)$/.exec(String(item ?? '').trim());
    return m ? { key: m[1].trim(), text: m[2].trim() } : { key: null, text: String(item ?? '').trim() };
  }

  // 조각 앞의 이름표. "시술, 세미 투블럭" → 시술 / 세미 투블럭. 이름표 낱말은 여기 한 곳.
  // "시술 후", "다음번", "상태는"처럼 다른 말의 일부면 이름표가 아니다.
  const NOTE_LABELS = ['시술', '레시피', '고민', '원인', '진단', '다음', '요청', '상태', '주의'];
  const NOT_LABEL_NEXT = /^(?:후|전|중|은|는|이|가|을|를|도|에|로|으로|과|와|부터|까지|마다)(?:\s|$)/;
  const LABEL_RE = new RegExp(`^(${NOTE_LABELS.join('|')})(?:\\s*[:：,]\\s*|\\s+)(.+)$`);
  function noteLabel(item) {
    const s = String(item ?? '').trim();
    const m = LABEL_RE.exec(s);
    if (!m || NOT_LABEL_NEXT.test(m[2])) return { label: null, text: s };
    return { label: m[1], text: m[2].trim() };
  }

  // 말하는 끝맺음을 차트 말투로. 보여줄 때만 쓰고 저장된 글은 건드리지 않는다.
  // 원장이 실제로 쓰는 말이 모이면 이 표를 그에 맞춰 고친다.
  const TIDY_RULES = [
    [/인 듯해요?$/, '인 듯'], [/인 것 같아요?$/, '인 듯'], [/것 같아요?$/, '듯'],
    [/거[예에]요?$/, '것'], [/이에요?$/, '임'], [/예요$/, '임'],
    [/합니다$/, '함'], [/입니다$/, '임'], [/됩니다$/, '됨'], [/습니다$/, '음'],
    [/하고요?$/, '함'], [/해요?$/, '함'], [/돼요?$/, '됨'], [/네요$/, '음'],
  ];
  function noteTidy(item) {
    const s = String(item ?? '').trim().replace(/[.,!\s]+$/, '');
    for (const [re, to] of TIDY_RULES) if (re.test(s)) return s.replace(re, to);
    // 한글 뒤의 '어·아·고(요)'는 '음'으로: 다듬었어·다듬었고 → 다듬었음, 많아요 → 많음, 감고 → 감음
    const m = /([가-힣])[어아고]요?$/.exec(s);
    if (m) return s.slice(0, m.index + 1) + '음';
    // 과거형 뒤의 '지(요)'도: 권유했지 → 권유했음. "두 가지"처럼 받침 ㅆ이 없으면 그대로
    const z = /([가-힣])지요?$/.exec(s);
    if (z && (z[1].charCodeAt(0) - 0xAC00) % 28 === 20) return s.slice(0, z.index + 1) + '음';
    return s;
  }

  // ---- 네 항목으로 나누기 (오늘 한 시술 / 고객의 고민 / 나의 진단 / 다음 시술할 것) ----
  // 원장이 말하면서 "고민은 …", "진단은 …", "다음에는 …"처럼 항목 이름을 앞에 붙이면 저장할 때(visitFields)
  // 그 자리에서 갈라 "고민: …" 줄로 정리해 둔다(09-29 원장 요청). 이름 없이 말한 부분은 전부 '시술'이다.
  // 갈림 자리는 조각 첫머리(줄 처음·"/"·문장 끝 점·"~고," 뒤)이거나, 문장 가운데라도 토씨(은·는)나 쌍점이 붙었을 때.
  // "시술 후", "다음 주"처럼 다른 말의 일부는 아니고, "2. 다음: 중화"처럼 번호·표시 뒤는 순서 항목이라 아니다.
  // bare: 낱말 그대로 쓰면 띄어쓰기만으로도 갈라지는 이름("고민 옆머리 뜸"). 옛 이름표 '원인'은 진단으로, '요청'은 고민으로 들어간다.
  // 순서는 원장이 정한 말하는 순서(10-01): 고민 → 진단 → 시술 → 주기 → 다음 계획. 기록 화면·저장되는 글·안내가 모두 이 순서.
  const SECTIONS = [
    { key: 'concern', name: '고민', label: '고민', bare: ['고민', '요청'], cue: '(?:고객(?:의|이\\s*말한|이\\s*말하는|이\\s*말씀하신)?\\s*|손님(?:의|이)?\\s*)?(?:고민|요청)', tail: '은|는' },
    { key: 'diagnosis', name: '진단', label: '진단', bare: ['진단', '원인'], cue: '(?:나의\\s*|내\\s*|원장\\s*)?(?:진단|원인)', tail: '은|는' },
    { key: 'done', name: '시술', label: '시술', bare: ['시술'], cue: '(?:오늘\\s*(?:한\\s*)?)?시술(?:\\s*내용)?', tail: '은|는|이' },
    // 방문 주기(09-30 원장 요청): "주기는 5주", "다음 예약은 6주 뒤". "다음 예약은"은 '다음'보다 길게 잡혀 주기가 이긴다
    { key: 'cycle', name: '주기', label: '주기', bare: ['주기'], cue: '(?:재?방문\\s*)?주기|(?:다음\\s*)?예약', tail: '은|는' },
    { key: 'next', name: '다음 계획', label: '다음', bare: ['다음'], cue: '다음(?:\\s*(?:시술(?:\\s*할\\s*(?:것|거))?|방향|계획|에\\s*할\\s*(?:것|거)|번))?', tail: '은|는|엔|에는|에' },
  ];
  // 항목 이름 뒤: 쌍점·쉼표 / 토씨 뒤 띄어쓰기 / 띄어쓰기만(낱말 그대로이고 조각 첫머리일 때만 인정)
  // 이름 앞에는 띄어쓰기·"/"나 문장 끝 점·쉼표(받아쓰기 앱이 공백을 빼먹기도 한다)가 온다. 줄 처음의 표시(• - *)는 건너뛴다.
  const SECTION_RES = SECTIONS.map(sec => ({ ...sec, re: new RegExp(`(?:^|(?<=[\\s\\/.,!?)]))(${sec.cue})(?:\\s*[:：,]\\s*|\\s*(?:${sec.tail})(?=\\s|$)\\s*|(\\s+))`, 'g') }));
  // 번호·붙임 글자(LETTER_RE와 같은 범위) 뒤의 이름은 순서 항목("2. 다음: 중화")이라 안 가른다. "펌."처럼 한 글자 낱말 뒤의 점은 목록 표시가 아니다.
  // 표시(• - *)만 있는 줄 처음은 받아쓰기 앱이 붙인 꾸밈이라 그 뒤의 이름("• 진단:")은 가른다(10-02 원장 화면).
  const LIST_MARK_RE = /^\s*(?:\d+[.)]|\([a-zA-Z가-힣]\)|[a-zA-Z][.)]|[가나다라마바사아자차카타파하][.)]|[①-⑳㉠-㉻])\s*$/;
  const BULLET_ONLY_RE = /^\s*[•·\-*–—▪◦]\s*$/;
  // 띄어쓰기만으로 갈랐을 때 뒤에 오면 안 되는 말: "다음 주에", "시술 후", "고민 은"처럼 다른 말의 일부. "후두부"처럼 붙은 낱말은 괜찮다.
  const NOT_SECTION_NEXT = /^(?:(?:주|달|날|해|년|번|후|전|중)(?:에|엔|에는|부터|까지|\s|$)|사항|(?:은|는|이|가|을|를|도|에|로|으로|과|와|부터|까지|마다)(?:\s|$))/;
  const isFragStart = (before) => { const b = before.replace(/\s+$/, ''); return b === '' || /[\n\/]$/.test(b) || /[가-힣]\.$/.test(b) || /[가-힣]고요?,$/.test(b); };
  const emptySections = () => Object.fromEntries(SECTIONS.map(s => [s.key, '']));
  function splitSections(text) {
    const t = String(text ?? '');
    const cuts = [];
    for (const sec of SECTION_RES) {
      sec.re.lastIndex = 0;
      for (let m; (m = sec.re.exec(t));) {
        const before = t.slice(0, m.index);
        const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
        if (LIST_MARK_RE.test(lineBefore) && lineBefore.trim()) continue;             // "2. 다음: 중화"
        const afterBullet = BULLET_ONLY_RE.test(lineBefore) && lineBefore.trim();     // "• 진단:" — 표시째 떼어 낸다
        if (m[2] !== undefined && (!sec.bare.includes(m[1]) || !(afterBullet || isFragStart(before)) || NOT_SECTION_NEXT.test(t.slice(m.index + m[0].length)))) continue;
        cuts.push({ key: sec.key, start: afterBullet ? m.index - lineBefore.length : m.index, end: m.index + m[0].length });
      }
    }
    cuts.sort((a, b) => (a.start - b.start) || (b.end - a.end));   // 같은 자리면 긴 이름("다음 예약은")이 먼저
    const out = emptySections();
    // 앞뒤의 띄어쓰기·"/"·쉼표와, 내용 없는 점 줄("•")은 버린다. 이름만 있고 내용이 없으면 항목이 안 생긴다
    const clean = (s) => s.split('\n').filter(l => !BULLET_ONLY_RE.test(l) || !l.trim()).join('\n').replace(/^[\s\/,]+|[\s\/,]+$/g, '');
    const add = (key, body) => { const b = clean(body); if (b) out[key] = out[key] ? `${out[key]}\n${b}` : b; };
    let pos = 0, key = 'done', lastEnd = -1;
    for (const c of cuts) {
      if (c.start < lastEnd) continue;                                                // "다음 시술은" 안의 "시술은"
      add(key, t.slice(pos, c.start));
      key = c.key; pos = c.end; lastEnd = c.end;
    }
    add(key, t.slice(pos));
    return out;
  }
  // ---- 방문 주기 글에서 숫자 읽기와 다음 예약 즈음 ----
  // "5주"·"한 달 반"·"4~5주"·"45일"은 기간, "11월 3일"은 날짜. 못 읽으면 null이고 그때는 계산하지 않고 말 그대로만 보인다.
  const KO_NUM = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 석: 3, 네: 4, 넷: 4, 넉: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
  const NUM = '(\\d+(?:\\.\\d+)?|한|하나|두|둘|세|셋|석|네|넷|넉|다섯|여섯|일곱|여덟|아홉|열)';
  const SPAN_RE = new RegExp(`${NUM}\\s*(?:(?:~|-|–|에서|이나|나|또는)\\s*${NUM}\\s*)?(주일|주|개월|달|일)(\\s*반)?`);
  const DATE_RE = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
  const UNIT = { 주일: 'week', 주: 'week', 개월: 'month', 달: 'month', 일: 'day' };
  const toNum = (x) => (KO_NUM[x] ?? Number(x));
  function cycleSpan(text) {
    const t = String(text ?? '');
    const d = DATE_RE.exec(t);
    if (d) return { kind: 'date', month: Number(d[1]), day: Number(d[2]) };
    const m = SPAN_RE.exec(t);
    if (!m) return null;
    const half = m[4] ? 0.5 : 0;
    const from = toNum(m[1]) + half;
    const to = (m[2] ? toNum(m[2]) : toNum(m[1])) + half;
    return { kind: 'span', from, to, unit: UNIT[m[3]] };
  }
  const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const utc = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return { y, m, d }; };
  // 달을 더할 때 없는 날(1월 31일 + 1달)은 그 달 마지막 날. 반 달은 15일.
  function addSpan(iso, n, unit) {
    const { y, m, d } = utc(iso);
    if (unit === 'day') return isoOf(Date.UTC(y, m - 1, d + Math.round(n)));
    if (unit === 'week') return isoOf(Date.UTC(y, m - 1, d + Math.round(n * 7)));
    const whole = Math.floor(n);
    const last = new Date(Date.UTC(y, m - 1 + whole + 1, 0)).getUTCDate();
    return isoOf(Date.UTC(y, m - 1 + whole, Math.min(d, last) + Math.round((n - whole) * 30)));
  }
  function cycleDue(baseDate, text) {
    const span = cycleSpan(text);
    if (!span) return null;
    if (span.kind === 'date') {
      const { y } = utc(baseDate);
      let iso = isoOf(Date.UTC(y, span.month - 1, span.day));
      if (iso < baseDate.slice(0, 10)) iso = isoOf(Date.UTC(y + 1, span.month - 1, span.day));   // 지난 날짜면 다음 해
      return { from: iso, to: iso };
    }
    return { from: addSpan(baseDate, span.from, span.unit), to: addSpan(baseDate, span.to, span.unit) };
  }
  // 가장 최근에 말한 주기. 날짜는 마지막 방문에서 다시 센다(주기는 되풀이되는 것이라 말한 날이 아니라 마지막 방문 기준).
  function recommendedCycle(state, customerId) {
    const desc = visitsOf(state, customerId);
    const said = desc.find(v => splitSections(v.done).cycle);
    if (!said) return null;
    const text = splitSections(said.done).cycle.split('\n')[0].trim();
    const base = desc[0].createdAt.slice(0, 10);
    return { text, saidOn: said.createdAt.slice(0, 10), base, due: cycleDue(base, text) };
  }

  // 나눈 항목을 말하는 순서대로 한 글로. "고민: …" 줄 꼴이고, 시술은 맨 앞이면 이름 없이(옛 기록과 같게),
  // 앞에 다른 항목이 있으면 "시술: "을 붙인다(안 붙이면 앞 항목에 딸려 들어간다). 다시 splitSections에 넣어도 같은 항목이 나온다.
  function joinSections(sections) {
    const lines = [];
    for (const sec of SECTIONS) {
      const body = String(sections?.[sec.key] ?? '').trim();
      if (body) lines.push(sec.key === 'done' && lines.length === 0 ? body : `${sec.label}: ${body}`);
    }
    return lines.join('\n');
  }

  // ---- 방문 기록 지우기 ----------------------------------------------------
  // 고객 지우기와 같은 두 단계. [지우기]는 감추기만 하고, [완전히 지우기]라야 없앤다.

  function requireVisit(state, visitId) {
    const v = state.visits.find(x => x.id === visitId);
    if (!v) throw new Error('방문 기록을 찾을 수 없습니다');
    return v;
  }

  function deleteVisit(state, visitId, now) {
    const v = requireVisit(state, visitId);
    if (v.deletedAt) return { state, visit: v };
    const updated = { ...v, deletedAt: now };
    return {
      state: { ...state, visits: state.visits.map(x => (x.id === visitId ? updated : x)) },
      visit: updated,
    };
  }

  function restoreVisit(state, visitId) {
    const v = requireVisit(state, visitId);
    if (!v.deletedAt) return { state, visit: v };
    const updated = { ...v, deletedAt: null };
    return {
      state: { ...state, visits: state.visits.map(x => (x.id === visitId ? updated : x)) },
      visit: updated,
    };
  }

  function purgeVisit(state, visitId) {
    requireVisit(state, visitId);
    return { state: { ...state, visits: state.visits.filter(x => x.id !== visitId), photos: state.photos.filter(p => p.visitId !== visitId) } };
  }

  // ---- 사진 --------------------------------------------------------------
  // 방문 기록 하나에 붙는다. 동의를 받은 고객만, 한 방문에 PHOTO_LIMIT장까지.
  // 파일 자체는 서버의 비공개 창고에 있고, 여기에는 자리(path)와 크기만 둔다. 저장소(GitHub)에는 가지 않는다.
  const PHOTO_LIMIT = 4;

  function setPhotoConsent(state, customerId, ok, date) {
    const c = requireCustomer(state, customerId);
    const updated = { ...c, photoConsent: ok ? { at: String(date ?? '').slice(0, 10) } : null };
    return { state: { ...state, customers: state.customers.map(x => (x.id === customerId ? updated : x)) }, customer: updated };
  }

  // 찍은 순서대로
  function photosOf(state, visitId) {
    return state.photos.filter(p => p.visitId === visitId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  }

  function addPhoto(state, visitId, { w, h, bytes }, now) {
    const v = requireVisit(state, visitId);
    if (v.deletedAt) throw new Error('지운 기록에는 사진을 붙일 수 없습니다. 먼저 되살리세요');
    const c = requireCustomer(state, v.customerId);
    if (!c.photoConsent) throw new Error('사진 동의가 없습니다. 카드 첫 줄 [고치기]에서 사진 동의를 체크하세요');
    if (photosOf(state, visitId).length >= PHOTO_LIMIT) throw new Error(`한 방문에 사진은 ${PHOTO_LIMIT}장까지입니다`);
    const id = state.nextId;
    const photo = { id, customerId: v.customerId, visitId, path: `${v.customerId}/${visitId}/${id}.jpg`, w: Number(w) || 0, h: Number(h) || 0, bytes: Number(bytes) || 0, createdAt: now };
    return { state: { ...state, nextId: id + 1, photos: [...state.photos, photo] }, photo };
  }

  // 사진은 바로 지운다(되살리기 없음). 파일 삭제는 db.js가 이 변화를 보고 한다.
  function removePhoto(state, photoId) {
    const photo = state.photos.find(x => x.id === photoId);
    if (!photo) throw new Error('사진을 찾을 수 없습니다');
    return { state: { ...state, photos: state.photos.filter(x => x.id !== photoId) }, photo };
  }

  // 그 고객의 지운 기록. 최근에 지운 것이 위로.
  function deletedVisitsOf(state, customerId) {
    return state.visits
      .filter(v => v.customerId === customerId && v.deletedAt)
      .sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : b.id - a.id));
  }

  // 지운 기록을 보관하는 기간. 이 날수가 지나면 저절로 없어진다. 바꾸려면 이 한 줄만 고친다.
  const TRASH_DAYS = 7;

  // 지운 지 TRASH_DAYS가 지난 방문 기록을 없앤다. 앱을 열 때 한 번 돈다.
  // 지운 고객은 건드리지 않는다. 고객 하나에는 몇 해치 기록이 딸려 있어서
  // 저절로 없애기에는 무게가 다르다.
  function sweepDeletedVisits(state, now) {
    const kept = state.visits.filter(v => !v.deletedAt || daysBetween(v.deletedAt, now) < TRASH_DAYS);
    const removed = state.visits.length - kept.length;
    return removed === 0 ? { state, removed: 0 } : { state: { ...state, visits: kept }, removed };
  }

  // 저절로 사라지기까지 남은 날. 지운 기록이 아니면 null.
  function daysLeftInTrash(visit, now) {
    if (!visit || !visit.deletedAt) return null;
    return Math.max(0, TRASH_DAYS - daysBetween(visit.deletedAt, now));
  }

  // ---- 방문 주기 ----------------------------------------------------------
  // 날짜만 보고 센다. 같은 날 두 번 와도 0일, 시각은 따지지 않는다.

  const dayNumber = (iso) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };
  const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

  // 최신순 방문 기록에 '이전 방문에서 며칠 만'(sincePrev)을 붙인다. 맨 처음 방문은 null.
  function visitsWithGaps(state, customerId) {
    const desc = visitsOf(state, customerId);
    return desc.map((v, i) => ({ ...v, sincePrev: desc[i + 1] ? daysBetween(desc[i + 1].createdAt, v.createdAt) : null }));
  }

  // date(오늘) 기준 한 줄 요약.
  // lastDate·sinceLast는 오늘 것을 뺀 '지난번'을 가리켜서, 오늘 기록을 남겨도 값이 흔들리지 않는다.
  function visitCycle(state, customerId, date) {
    const desc = visitsOf(state, customerId);
    const before = desc.filter(v => v.createdAt.slice(0, 10) < date);
    const gaps = [];
    for (let i = 0; i < desc.length - 1; i++) gaps.push(daysBetween(desc[i + 1].createdAt, desc[i].createdAt));
    return {
      count: desc.length,
      lastDate: before.length ? before[0].createdAt.slice(0, 10) : '',
      sinceLast: before.length ? daysBetween(before[0].createdAt, date) : null,
      average: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    };
  }

  // ---- 정액권 (금액권) -----------------------------------------------------
  // 충전(+)과 사용(-)을 쌓고 그 합이 잔액이다. 횟수권은 쓰지 않는다.
  // 돈 계산의 원본은 핸드SOS다. 여기 숫자는 시술 중에 카드만 보고도 알려고 두는 것이다.

  const formatWon = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

  // '150000' '150,000' '150000원' '15만'을 모두 받는다.
  function cleanAmount(v) {
    const raw = String(v ?? '').trim().replace(/[\s,원]/g, '');
    if (!raw) throw new Error('금액을 적으세요');
    const man = /^(\d+)만$/.exec(raw);
    const n = man ? Number(man[1]) * 10000 : (/^\d+$/.test(raw) ? Number(raw) : NaN);
    if (!Number.isInteger(n) || n <= 0) throw new Error('금액은 숫자로 적으세요 (예: 150000 또는 15만)');
    return n;
  }

  // ---- 가족 (10-07 원장 결정) ----
  // 정액권을 가족이 잔액 하나로 함께 쓴다. 같은 가족은 같은 familyId(처음 묶을 때 고른 사람의 번호)를 갖고,
  // 가족 잔액은 가족 모두의 충전·사용 내역을 더한 값이다. 그래서 묶으면 잔액이 합쳐지고, 내역에는 누가 넣고 썼는지 남는다.
  // 감춘(지운) 가족도 잔액에는 남는다. 화면에 보이는 가족(familyOf)은 살아 있는 사람만.
  function familyMemberIds(state, customerId) {
    const c = state.customers.find(x => x.id === customerId);
    const key = c?.familyId ?? null;
    if (key === null) return [customerId];
    return state.customers.filter(x => x.familyId === key).map(x => x.id);
  }
  function familyOf(state, customerId) {
    const ids = new Set(familyMemberIds(state, customerId));
    return state.customers.filter(x => ids.has(x.id) && !x.deletedAt).sort((a, b) => a.id - b.id);
  }
  // customerId를 otherId의 가족으로. 둘 다 가족이 있으면 두 가족이 하나가 된다.
  function joinFamily(state, customerId, otherId) {
    if (customerId === otherId) throw new Error('자기 자신과는 가족으로 묶을 수 없습니다');
    const me = requireCustomer(state, customerId);
    const other = requireCustomer(state, otherId);
    const myKey = me.familyId ?? null;
    const otherKey = other.familyId ?? null;
    if (myKey !== null && myKey === otherKey) throw new Error('이미 같은 가족입니다');
    const target = otherKey ?? myKey ?? otherId;
    const moves = (x) => x.id === customerId || x.id === otherId || (myKey !== null && x.familyId === myKey) || (otherKey !== null && x.familyId === otherKey);
    return { state: { ...state, customers: state.customers.map(x => (moves(x) ? { ...x, familyId: target } : x)) } };
  }
  // 가족에서 뺀다. 그 사람 이름으로 적힌 충전·사용만 따라 나간다(잘못 묶었을 때 되돌리기와 같다).
  // 한 사람만 남으면 가족이 풀리고, 대표 번호의 주인이 빠지면 남은 가족 중 가장 작은 번호로 바꾼다.
  function leaveFamily(state, customerId) {
    const c = findAny(state, customerId);
    const key = c.familyId ?? null;
    if (key === null) throw new Error('가족으로 묶여 있지 않습니다');
    const others = state.customers.filter(x => x.id !== customerId && x.familyId === key);
    const newKey = others.length <= 1 ? null : key === customerId ? Math.min(...others.map(x => x.id)) : key;
    return { state: { ...state, customers: state.customers.map(x => (x.id === customerId ? { ...x, familyId: null } : x.familyId === key ? { ...x, familyId: newKey } : x)) } };
  }

  // ---- 함께 오는 가족 (10-24 원장: 한 사람이 가족 예약을 다 하고 같이 온다. 기록은 사람마다, 문자는 대표 한 명) ----
  // 대표 = 가족 번호(familyId)의 주인. 그 사람이 지워졌으면 남은 가족 중 가장 작은 번호. 관계(남편·딸…)는 settings.familyRoles {고객번호: 말}.
  function familyRep(state, customerId) {
    const c = state.customers.find(x => x.id === customerId);
    if (!c) return null;
    const fam = familyOf(state, customerId);
    if (fam.length < 2) return c;
    return fam.find(x => x.id === c.familyId) ?? fam[0];
  }
  function setFamilyRep(state, customerId) {
    const c = requireCustomer(state, customerId);
    const key = c.familyId ?? null;
    if (key === null || familyOf(state, customerId).length < 2) throw new Error('가족으로 묶여 있어야 대표를 정할 수 있습니다');
    return { ...state, customers: state.customers.map(x => (x.familyId === key ? { ...x, familyId: customerId } : x)) };
  }
  const familyRoleOf = (state, customerId) => String(state.settings?.familyRoles?.[customerId] ?? '');
  function setFamilyRole(state, customerId, role) {
    const r = String(role ?? '').trim().replace(/\s+/g, ' ').slice(0, 10);
    const { [customerId]: _, ...rest } = state.settings?.familyRoles ?? {};
    return { ...state, settings: { ...state.settings, familyRoles: r ? { ...rest, [customerId]: r } : rest } };
  }
  // 카드에서 [+ 가족 추가]: 이름·관계만으로 새 고객을 만들고 그 가족에 넣는다(번호는 없어도 된다). 이미 있던 사람이 대표로 남는다
  function addFamilyMember(state, ofId, { name, role }) {
    requireCustomer(state, ofId);
    const r = addCustomer(state, { name, phone: '' });
    const joined = joinFamily(r.state, r.customer.id, ofId).state;
    const next = setFamilyRole(joined, r.customer.id, role);
    return { state: next, customer: next.customers.find(x => x.id === r.customer.id) };
  }

  const passesOf = (state, customerId) => { const ids = new Set(familyMemberIds(state, customerId)); return state.passes.filter(p => ids.has(p.customerId)); };
  // 모든 고객의 잔액 합계(백업 확인용). 가족을 여러 번 세지 않도록 내역을 한 번씩만 더한다.
  const totalPassBalance = (state) => state.passes.reduce((sum, p) => sum + (p.kind === 'charge' ? p.amount : -p.amount), 0);

  // 최신순. 같은 시각이면 나중에 넣은 것이 위로.
  function passEntriesOf(state, customerId) {
    return passesOf(state, customerId).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
  }

  function passBalance(state, customerId) {
    return passesOf(state, customerId).reduce((sum, p) => sum + (p.kind === 'charge' ? p.amount : -p.amount), 0);
  }

  function passSummary(state, customerId) {
    const list = passEntriesOf(state, customerId);
    return {
      balance: passBalance(state, customerId),
      charged: list.filter(p => p.kind === 'charge').reduce((s, p) => s + p.amount, 0),
      used: list.filter(p => p.kind === 'use').reduce((s, p) => s + p.amount, 0),
      count: list.length,
      lastAt: list.length ? list[0].at : '',
    };
  }

  function addPass(state, customerId, kind, { amount, note, visitId }, now) {
    requireCustomer(state, customerId);
    const won = cleanAmount(amount);
    if (kind === 'use') {
      const left = passBalance(state, customerId);
      if (won > left) throw new Error(`정액권 잔액(${formatWon(left)})보다 많습니다`);
    }
    const entry = { id: state.nextId, customerId, kind, amount: won, note: (note ?? '').trim(), at: now, visitId: visitId ?? null };
    return { state: { ...state, nextId: state.nextId + 1, passes: [...state.passes, entry] }, entry };
  }

  const chargePass = (state, customerId, fields, now) => addPass(state, customerId, 'charge', fields, now);
  const usePass = (state, customerId, fields, now) => addPass(state, customerId, 'use', fields, now);

  // 정액권 내역은 한 줄짜리 숫자라 바로 지운다. 잔액이 눈앞에서 바뀌므로 실수를 곧바로 안다.
  function deletePass(state, entryId) {
    if (!state.passes.some(p => p.id === entryId)) throw new Error('정액권 내역을 찾을 수 없습니다');
    return { state: { ...state, passes: state.passes.filter(p => p.id !== entryId) } };
  }

  // ---- 정액권 안내문 -------------------------------------------------------
  // 원장님이 쓰시던 안내문 아티팩트의 문장을 그대로 옮겼다. 손님이 받는 문자라
  // 줄 순서와 띄어쓰기('230,000 원'처럼 원 앞 한 칸)까지 건드리지 않는다.

  const comma = (n) => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const defaultSettings = () => ({ head: '정액권 안내드려요', tail: '입니다 : D', products: [] });

  const noticeItems = (items) => (items ?? []).filter(it => (it.name ?? '').trim() || Number(it.amount));
  const noticeUsed = (items) => noticeItems(items).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  function noticeRemain({ prev, items, topup }) {
    return (Number(prev) || 0) + (topup ? (Number(topup.amount) || 0) : 0) - noticeUsed(items);
  }

  // date(YYYY-MM-DD)를 주면 시술내역 제목에 붙는다: 손님이 언제 시술받고 언제 정액권을 썼는지.
  // 원장이 2026-09-22에 넣어 달라고 한 것. 그 외 문장은 쓰던 문자 그대로.
  // family: 가족 정액권이면 "잔여 정액금"·"남은 정액권" 앞에 "가족 "만 붙인다(10-07). 나머지 문장은 그대로.
  function buildNotice({ head, tail, prev, items, topup, date, family }) {
    const fam = family ? '가족 ' : '';
    const rows = noticeItems(items);
    const day = (date ?? '').trim() ? ` (${date.trim().slice(0, 10).replace(/-/g, '.')})` : '';
    const L = [];
    L.push(`* ${(head ?? '').trim() || '정액권 안내드려요'} *`);
    L.push('');
    L.push(`- ${fam}잔여 정액금 ${comma(prev)}원`);
    if (topup) {
      L.push(`- ${(topup.name ?? '').trim() || '정액권'} ${comma(topup.amount)}원`);
      if ((topup.terms ?? '').trim()) L.push(`(${topup.terms.trim()})`);
      if ((topup.gift ?? '').trim()) L.push(`- ${topup.gift.trim()} 선물`);
    }
    L.push('');
    L.push(`* 시술내역${day} *`);
    if (rows.length === 0) L.push('(시술 항목을 적어 주세요)');
    else if (rows.length === 1) L.push(`${rows[0].name} ${comma(rows[0].amount)} 원 사용하셔서`);
    else {
      rows.forEach(it => L.push(`${it.name} ${comma(it.amount)} 원`));
      L.push(`합계 ${comma(noticeUsed(rows))} 원 사용하셔서`);
    }
    L.push('');
    L.push(`남은 ${fam}정액권은 ${comma(noticeRemain({ prev, items: rows, topup }))}원${tail ?? ''}`);
    return L.join('\n');
  }

  function setSettings(state, patch) {
    return { state: { ...state, settings: { ...state.settings, ...patch } } };
  }

  // 시술 등록(10-09, 이름·금액 settings.services)은 10-24 원장 요청으로 지웠다. 금액은 시술 시간표(serviceTimes)에 함께 둔다 — 목록은 하나.

  // 한 번 쓴 정액권 상품을 기억해 두었다가, 다음에 이름만 고르면 나머지가 채워지게 한다.
  function rememberProduct(state, { name, amount, terms, gift }) {
    const n = (name ?? '').trim();
    if (!n) return { state };
    const item = { name: n, amount: Number(amount) || 0, terms: (terms ?? '').trim(), gift: (gift ?? '').trim() };
    const has = state.settings.products.some(p => p.name === n);
    const products = has ? state.settings.products.map(p => (p.name === n ? item : p)) : [...state.settings.products, item];
    return { state: { ...state, settings: { ...state.settings, products } } };
  }

  // 카드 잔액을 원장이 적은 금액(핸드SOS 기준)에 맞춘다. 차이만큼 충전(+) 또는 사용(-) 한 줄을 남긴다.
  // 카드 만들기 전에 끊은 정액권처럼 카드가 모르는 잔액을 처음 맞출 때 쓴다.
  function setPassBalance(state, customerId, target, now) {
    requireCustomer(state, customerId);
    const raw = String(target ?? '').trim().replace(/[\s,원]/g, '');
    if (raw.startsWith('-')) throw new Error('잔액은 0원 이상이어야 합니다');
    const want = raw === '0' ? 0 : cleanAmount(raw);
    const have = passBalance(state, customerId);
    if (want === have) return { state, entry: null };
    const diff = want - have;
    const entry = { id: state.nextId, customerId, kind: diff > 0 ? 'charge' : 'use', amount: Math.abs(diff), note: '잔액 맞춤 (핸드SOS 기준)', at: now, visitId: null };
    return { state: { ...state, nextId: state.nextId + 1, passes: [...state.passes, entry] }, entry };
  }

  const findProduct = (state, name) => state.settings.products.find(p => p.name === (name ?? '').trim()) ?? null;

  // ---- 오늘 명단 ----------------------------------------------------------

  // 명단 한 줄은 { customerId, at }. at은 'HH:MM'이거나 ''(시간 안 정함).
  // 시간을 적은 사람이 시간순으로 앞에 오고, 안 적은 사람은 올린 순서대로 뒤에 붙는다.

  const pad2 = (n) => String(n).padStart(2, '0');

  // 예약 시간 후보. 영업시간이 바뀌면 이 세 줄만 고치면 명단의 고르는 칸이 따라 바뀐다.
  const OPEN_MIN = 10 * 60;   // 오전 10시부터
  const CLOSE_MIN = 19 * 60;  // 마지막 예약 19시
  const STEP_MIN = 30;        // 30분 간격

  function timeSlots() {
    const out = [];
    for (let m = OPEN_MIN; m <= CLOSE_MIN; m += STEP_MIN) out.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
    return out;
  }

  // '10:00' '9:30' '930' '1030' '10' 을 모두 받아 'HH:MM'으로 맞춘다. 빈 값은 빈 값 그대로.
  function cleanTime(at) {
    const raw = (at ?? '').trim();
    if (!raw) return '';
    const d = raw.replace(/\D/g, '');
    let h, m;
    if (/^\d{1,2}$/.test(d)) { h = Number(d); m = 0; }
    else if (/^\d{3}$/.test(d)) { h = Number(d.slice(0, 1)); m = Number(d.slice(1)); }
    else if (/^\d{4}$/.test(d)) { h = Number(d.slice(0, 2)); m = Number(d.slice(2)); }
    else throw new Error('시간은 10:00 처럼 적으세요');
    if (h > 23 || m > 59) throw new Error('시간은 10:00 처럼 적으세요');
    return `${pad2(h)}:${pad2(m)}`;
  }

  // 명단 항목은 저마다 날짜를 갖는다: { customerId, at, date }. today.date는 마지막으로 넘긴 날.
  // 안 적은 사람은 날이 바뀌어도 남는다. 원장이 잊은 사람을 다음 날 아침에도 보이게 하려는 것이다.
  const entriesOn = (state, date) => state.today.entries.filter(e => e.date === date);
  const sameEntry = (e, customerId, date) => e.customerId === customerId && e.date === date;
  const liveCustomer = (state, id) => { const c = state.customers.find(x => x.id === id); return c && !c.deletedAt ? c : null; };
  // 그 항목의 날짜에 방문 기록이 있는가. 오늘 날짜로 적은 것은 어제 항목을 지우지 못한다.
  const recordedOn = (state, e) => visitsOf(state, e.customerId).some(v => v.createdAt.startsWith(e.date));

  // 날이 바뀌면 부른다(앱을 열 때, 명단에 올릴 때). 지난 날짜 항목 중 안 적은 것은 계속 남고,
  // 적은 것도 TIMELINE_KEEP_DAYS 동안은 남는다(10-13 원장: 날짜를 눌러 그날 타임테이블을 입력 여부와 함께 본다). 그 뒤에는 빠진다.
  const TIMELINE_KEEP_DAYS = 60;
  function rollToday(state, date) {
    const floor = shiftDate(date, -TIMELINE_KEEP_DAYS);
    const keep = state.today.entries.filter(e => e.date >= date || !recordedOn(state, e) || e.date >= floor);
    if (keep.length === state.today.entries.length && state.today.date === date) return { state, dropped: 0 };
    return { state: { ...state, today: { date, entries: keep } }, dropped: state.today.entries.length - keep.length };
  }

  // 이미 명단에 있으면 시간만 채운다(비워 부르면 적어둔 시간을 지우지 않는다).
  // 시술(10-13, 선택)은 시간표(serviceList)에 있는 이름만 남기고, 타임테이블에서 그 분만큼 칸을 차지한다.
  const cleanService = (state, name) => serviceList(state).find(x => squash(x.name) === squash(name))?.name ?? '';
  // today(선택, 10-14): 지금 날짜. 주면 명단은 그날까지만 넘긴다 — 내일 예약을 미리 올려도 today.date가 내일로 가지 않는다
  // (서버는 today.date를 줄 이름으로 저장하고, 오늘 다시 읽을 때 오늘 이전 줄만 보므로 내일로 가면 그 사이 저장이 안 보인다).
  function markToday(state, customerId, date, at, service, today) {
    requireCustomer(state, customerId);
    const time = cleanTime(at);
    const svc = cleanService(state, service);
    const upto = today && today < date ? today : date;
    const base = upto >= state.today.date ? rollToday(state, upto).state : state;
    const already = base.today.entries.some(e => sameEntry(e, customerId, date));
    const entries = already
      ? base.today.entries.map(e => (sameEntry(e, customerId, date) ? { ...e, at: time || e.at, service: svc || e.service || '' } : e))
      : [...base.today.entries, { customerId, at: time, date, service: svc }];
    return { state: { ...base, today: { ...base.today, entries } } };
  }
  function setTodayService(state, customerId, date, service) {
    const svc = cleanService(state, service);
    return { ...state, today: { ...state.today, entries: state.today.entries.map(e => (sameEntry(e, customerId, date) ? { ...e, service: svc } : e)) } };
  }

  function setTodayTime(state, customerId, date, at) {
    const time = cleanTime(at);
    if (!state.today.entries.some(e => sameEntry(e, customerId, date))) return { state };
    return { state: { ...state, today: { ...state.today, entries: state.today.entries.map(e => (sameEntry(e, customerId, date) ? { ...e, at: time } : e)) } } };
  }

  // 가족 이름으로 잡힌 예약에 실제로는 다른 가족이 왔을 때(10-27 원장: 엄마가 아이 커트를 자기 이름으로 예약) 그 자리를 넘긴다.
  // 시간·시술은 그대로. 이미 그날 명단에 있는 사람에게는 못 넘긴다(두 예약이 하나로 합쳐지면 안 된다).
  function swapTodayEntry(state, fromId, toId, date) {
    requireCustomer(state, toId);
    if (!state.today.entries.some(e => sameEntry(e, fromId, date))) throw new Error('그날 명단에 없는 손님입니다');
    if (!familyOf(state, fromId).some(c => c.id === toId)) throw new Error('같은 가족에게만 넘길 수 있습니다');
    if (state.today.entries.some(e => sameEntry(e, toId, date))) throw new Error('그 가족은 이미 그날 명단에 있습니다');
    return { ...state, today: { ...state.today, entries: state.today.entries.map(e => (sameEntry(e, fromId, date) ? { ...e, customerId: toId } : e)) } };
  }
  // 명단에 없는 사람이 그날 기록을 남겼는데, 명단의 가족은 아직 기록이 없으면 그 가족의 자리(넘길 후보). 없으면 null
  function standInFor(state, customerId, date) {
    if (state.today.entries.some(e => sameEntry(e, customerId, date))) return null;
    const fam = familyOf(state, customerId).filter(c => c.id !== customerId).map(c => c.id);
    return state.today.entries.find(e => e.date === date && fam.includes(e.customerId) && !recordedOn(state, e)) ?? null;
  }

  // 예약이 취소되거나 잘못 올린 사람을 명단에서만 뺀다. 고객과 기록은 그대로다. 지난 명단이면 그 날짜 항목만.
  function unmarkToday(state, customerId, date) {
    return { state: { ...state, today: { ...state.today, entries: state.today.entries.filter(e => !sameEntry(e, customerId, date)) } } };
  }

  // 그날 예약 요약(10-14 원장: 내일 예약을 미리 올려 알림톡에 대비). 번호 없는 손님은 알림톡이 못 간다.
  function bookingSummary(state, date) {
    const list = entriesOn(state, date).map(e => liveCustomer(state, e.customerId)).filter(Boolean);
    // 번호가 없어도 같은 날 오는 가족·대표가 대신 받으면 빼고 센다(10-24): 알림톡이 실제로 못 가는 사람만
    const unreached = new Set(reminderList(state, date).skip.filter(x => x.reason === '번호 없음').map(x => x.customerId));
    return { total: list.length, noPhone: list.filter(c => !c.phone && unreached.has(c.id)) };
  }
  // 올리는 칸에 "이름 010-1234-5678"처럼 함께 치면 나눠 읽는다. 10~11자리 숫자만 번호로 본다.
  function splitNamePhone(q) {
    const text = String(q ?? '').trim();
    const m = text.match(/(0\d{1,2})[\s-]?(\d{3,4})[\s-]?(\d{4})\s*$/);
    const phone = m ? m.slice(1).join('') : '';
    if (!m || !/^\d{10,11}$/.test(phone)) return { name: text, phone: '' };
    return { name: text.slice(0, m.index).trim(), phone };
  }

  // 지난 날짜에 명단에 올렸는데 그날 기록이 없는 사람. 날짜순, 같은 날은 시간순. 지운 고객은 빠진다.
  function pendingList(state, date) {
    const key = (e) => `${e.date} ${e.at || '99:99'}`;
    return state.today.entries
      .filter(e => e.date < date && liveCustomer(state, e.customerId) && !recordedOn(state, e))
      .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
      .map(e => ({ date: e.date, at: e.at, customer: liveCustomer(state, e.customerId), ...visitCycle(state, e.customerId, e.date) }));
  }

  function todayList(state, date) {
    const live = entriesOn(state, date).filter(e => liveCustomer(state, e.customerId));
    const byTime = live
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        if (a.e.at && b.e.at) return a.e.at < b.e.at ? -1 : a.e.at > b.e.at ? 1 : a.i - b.i;
        if (a.e.at) return -1;
        if (b.e.at) return 1;
        return a.i - b.i;
      });
    return byTime.map(({ e }, idx) => {
      const customer = state.customers.find(c => c.id === e.customerId);
      const visits = visitsOf(state, e.customerId);
      const todays = visits.filter(v => v.createdAt.startsWith(date));
      const previous = visits.find(v => !v.createdAt.startsWith(date));
      const cycle = visitCycle(state, e.customerId, date);
      return { order: idx + 1, at: e.at, service: e.service ?? '', minutes: e.service ? serviceMinutes(state, e.service) : null, customer, recorded: todays.length > 0, lastNext: previous ? previous.next : '', balance: passBalance(state, e.customerId), ...cycle };
    });
  }

  // ---- 오늘 타임테이블 (10-13 원장: 핸드SOS처럼 가로로, 몇 시에 누가) ----------
  // 10:00~19:30 30분 칸 스무 개. 시술이 있으면 그 분만큼(올림) 칸을 차지하고, 겹치면 다음 줄(lane). 영업시간 밖은 가장자리 칸에.
  const TIMELINE_END = 20 * 60;
  const TIMELINE_SLOTS = (() => { const out = []; for (let m = OPEN_MIN; m < TIMELINE_END; m += STEP_MIN) out.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`); return out; })();
  const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  function timeline(state, date) {
    const list = todayList(state, date);
    const lanes = [];
    const untimed = [];
    for (const t of list) {
      if (!t.at) { untimed.push(t); continue; }
      const start = Math.min(Math.max(minutesOf(t.at), OPEN_MIN), TIMELINE_END - STEP_MIN);
      const col = Math.floor((start - OPEN_MIN) / STEP_MIN);
      const want = Math.max(1, Math.ceil((t.minutes || STEP_MIN) / STEP_MIN));
      const span = Math.min(want, TIMELINE_SLOTS.length - col);
      const endMin = Math.min(start + want * STEP_MIN, TIMELINE_END);
      const block = { ...t, col, span, end: `${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}` };
      let lane = lanes.find(l => l.every(b => b.col + b.span <= col || col + span <= b.col));
      if (!lane) { lane = []; lanes.push(lane); }
      lane.push(block);
    }
    for (const l of lanes) l.sort((a, b) => a.col - b.col);
    return { slots: TIMELINE_SLOTS, lanes, untimed, total: list.length, recorded: list.filter(t => t.recorded).length };
  }

  // ---- V2: 월별 집계, 정착률, 주기 초과 ----------------------------------

  const liveCustomers = (state) => state.customers.filter(c => !c.deletedAt);
  const ascVisits = (state, customerId) => [...visitsOf(state, customerId)].reverse(); // 오래된 것부터
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

  // 한 달의 방문 건수·고객 수·신규·재방문·시술별·회차별
  function monthlyStats(state, month) {
    const kinds = Object.fromEntries(KINDS.map(k => [k, 0]));
    kinds['미분류'] = 0;
    let visits = 0, customers = 0, newCustomers = 0;
    const rounds = { first: 0, two3: 0, fourPlus: 0, legacy: 0 };
    for (const c of liveCustomers(state)) {
      const all = ascVisits(state, c.id);
      const inMonth = all.filter(v => v.createdAt.startsWith(month));
      if (inMonth.length === 0) continue;
      customers += 1;
      visits += inMonth.length;
      for (const v of inMonth) {
        if (!v.kinds || v.kinds.length === 0) kinds['미분류'] += 1;
        else for (const k of v.kinds) kinds[k] = (kinds[k] ?? 0) + 1;
      }
      if (!c.isLegacy && all[0].createdAt.startsWith(month)) newCustomers += 1;
      if (c.isLegacy) rounds.legacy += 1;
      else {
        const round = all.indexOf(inMonth[inMonth.length - 1]) + 1; // 그 달 마지막 방문이 몇 번째인지
        if (round === 1) rounds.first += 1; else if (round <= 3) rounds.two3 += 1; else rounds.fourPlus += 1;
      }
    }
    const returning = customers - newCustomers;
    return {
      month, visits, customers, newCustomers, returning,
      perCustomer: customers ? Math.round((visits / customers) * 100) / 100 : 0,
      returningRatio: customers ? Math.round((returning / customers) * 100) / 100 : 0,
      kinds, rounds,
    };
  }

  // 처음 온 달별로, days 안에 두 번째 방문이 있었던 비율 (예전 고객 제외)
  function retention(state, { days = 150, today }) {
    const byMonth = {};
    for (const c of liveCustomers(state)) {
      if (c.isLegacy) continue;
      const all = ascVisits(state, c.id);
      if (all.length === 0) continue;
      const first = all[0].createdAt.slice(0, 10);
      const month = first.slice(0, 7);
      const row = byMonth[month] ?? (byMonth[month] = { month, total: 0, returned: 0 });
      row.total += 1;
      if (all.length > 1 && daysBetween(first, all[1].createdAt.slice(0, 10)) <= days) row.returned += 1;
    }
    return Object.values(byMonth).sort((a, b) => (a.month < b.month ? -1 : 1)).map(r => {
      const end = new Date(r.month + '-01T00:00:00');
      end.setMonth(end.getMonth() + 1); end.setDate(0); // 그 달 말일
      end.setDate(end.getDate() + days);
      return { ...r, pending: today < iso(end), rate: r.total ? Math.round((r.returned / r.total) * 100) / 100 : 0 };
    });
  }

  // 평소 주기의 factor배를 넘겼는데 안 온 고객. 방문이 한 번뿐이면 평소 주기가 없어 제외
  function overdueCustomers(state, today, factor = 1.5) {
    const out = [];
    for (const c of liveCustomers(state)) {
      const cyc = visitCycle(state, c.id, today);
      if (cyc.average === null || cyc.sinceLast === null) continue;
      if (cyc.sinceLast > cyc.average * factor) out.push({ customer: c, lastDate: cyc.lastDate, average: cyc.average, sinceLast: cyc.sinceLast });
    }
    return out.sort((a, b) => b.sinceLast - a.sinceLast);
  }

  // ---- 고객 관리 · 고객 동향 (10-08 원장) ----------------------------------
  // 기록에서 그때그때 센다. 기록이 없는 달·사람은 추정하지 않는다.
  function customerCounts(state) {
    const live = liveCustomers(state);
    const legacy = live.filter(c => c.isLegacy).length;
    const noVisit = live.filter(c => visitsOf(state, c.id).length === 0).length;
    return { total: live.length, legacy, fresh: live.length - legacy, noVisit };
  }
  // 최근 n달(오늘이 든 달까지). 첫 기록이 있는 달보다 앞은 자른다.
  function trendMonths(state, today, n = 6) {
    const dates = state.visits.filter(v => !v.deletedAt && liveCustomer(state, v.customerId)).map(v => v.createdAt.slice(0, 7));
    if (dates.length === 0) return [];
    const first = dates.sort()[0];
    const out = [];
    const d = new Date(today.slice(0, 7) + '-01T00:00:00');
    for (let i = 0; i < n; i++) {
      const m = iso(d).slice(0, 7);
      if (m < first) break;
      out.unshift(monthlyStats(state, m));
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }
  // 최근 days일 안에 처음 온 신규 고객(예전 고객 제외), 최근 것부터. returned = 두 번째 방문이 있음
  // 그 달에 처음 온 고객(예전 고객 빼고). 결산 [신규 고객] 칸(10-26)
  function newCustomersInMonth(state, month) {
    const out = [];
    for (const c of liveCustomers(state)) {
      if (c.isLegacy) continue;
      const all = ascVisits(state, c.id);
      if (!all.length || !all[0].createdAt.startsWith(month)) continue;
      out.push({ customer: c, firstDate: all[0].createdAt.slice(0, 10), visits: all.length, returned: all.length > 1 });
    }
    return out.sort((a, b) => (a.firstDate < b.firstDate ? 1 : a.firstDate > b.firstDate ? -1 : b.customer.id - a.customer.id));
  }
  function recentNewCustomers(state, today, days = 60) {
    const out = [];
    for (const c of liveCustomers(state)) {
      if (c.isLegacy) continue;
      const all = ascVisits(state, c.id);
      if (all.length === 0) continue;
      const firstDate = all[0].createdAt.slice(0, 10);
      const since = daysBetween(firstDate, today);
      if (since < 0 || since > days) continue;
      out.push({ customer: c, firstDate, visits: all.length, returned: all.length > 1 });
    }
    return out.sort((a, b) => (a.firstDate < b.firstDate ? 1 : a.firstDate > b.firstDate ? -1 : b.customer.id - a.customer.id));
  }

  // 원장이 권한 주기(recommendedCycle)가 지났거나 soonDays일 안에 다가오는 고객. days = 지난 날수(음수면 남은 날수).
  // 주기에 숫자가 없으면(due null) 빼고 추정하지 않는다. 오늘 명단에 있으면 onToday.
  function dueCustomers(state, today, soonDays = 7) {
    const todayIds = new Set(entriesOn(state, today).map(e => e.customerId));
    const out = [];
    for (const c of liveCustomers(state)) {
      const rc = recommendedCycle(state, c.id);
      if (!rc || !rc.due) continue;
      const days = daysBetween(rc.due.from, today);   // 4~5주처럼 범위면 이른 날 기준
      if (days < -soonDays) continue;
      out.push({ customer: c, lastDate: rc.base, text: rc.text, due: rc.due, days, onToday: todayIds.has(c.id) });
    }
    return out.sort((a, b) => b.days - a.days || a.customer.id - b.customer.id);
  }
  // 정액권이 남은 고객, 잔액 큰 순. 가족은 잔액이 하나라 한 줄(members), 마지막 방문은 가족 중 가장 최근.
  function passHolders(state, today) {
    const seen = new Set();
    const out = [];
    for (const c of liveCustomers(state)) {
      const ids = familyMemberIds(state, c.id);
      const key = ids.slice().sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const balance = passBalance(state, c.id);
      if (balance <= 0) continue;
      const members = familyOf(state, c.id);
      const dates = members.flatMap(m => visitsOf(state, m.id).map(v => v.createdAt.slice(0, 10))).sort();
      const lastDate = dates.length ? dates[dates.length - 1] : null;
      out.push({ customer: members[0], members, balance, lastDate, sinceLast: lastDate ? daysBetween(lastDate, today) : null });
    }
    return out.sort((a, b) => b.balance - a.balance || a.customer.id - b.customer.id);
  }

  // ---- 선예약 연락 (10-09 원장) ------------------------------------------------
  // 매달 말일에 다다음달 예약이 열리고, 그 2일 전에 선예약 대상 고객에게 먼저 연락한다(보내기는 원장이 손으로:
  // 카카오 채널에 붙여넣기, 핸드폰은 문자). 대상은 정액권 남은 고객 전부(가족은 한 줄) + 원장이 넣은 고객 − 뺀 고객.
  // 넣고 뺀 것(preBookMarks)·달마다 보냄/예약함(preBookLog)·문구(preBookText)는 settings JSON이라 SQL이 필요 없다.
  // 10-28 원장 새 문구: 손님마다 추천 날짜({추천일}, 원장이 줄마다 적음)가 들어간다
  const PREBOOK_TEXT = '{이름}님~ 안녕하세요,\n{예약월}월 예약 오픈을 앞두고, 고객님께 선예약을 도와드리고자 먼저 연락드렸습니다.\n추천드리는 날짜는 {추천일}에요 : )\n\n편하신 날짜를 {회신일}까지 회신해 주시면 예약 안내 도와드리겠습니다.\n감사합니다.';
  const PREBOOK_PICK_EMPTY = '[추천 날짜]';
  const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];
  const dateKo = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEK_KO[d.getDay()]})`; };
  // ---- 전날 예약 알림톡 (10-21 원장: 발송킹, 전날 오후 6시) ----
  // 서버(api/remind.js)가 매일 오후 5시대에 내일 명단을 읽어 발송킹에 "오늘 18:00 발송"으로 맡긴다. 규칙은 여기 하나.
  // REMIND_TEMPLATE은 원장이 발송킹에 심사 받은 문구와 글자 하나까지 같아야 한다(바꾸면 다시 심사). 미리 보기·문자 전환에도 같은 글.
  // 10-22 원장 승인본: 끝의 "(아잉)"은 카톡에서 이모티콘으로 바뀌는 글자. 문자로 갈 때(카톡 실패)는 글자 그대로 보이니 뺀 글(REMIND_SMS_TEMPLATE)을 쓴다.
  const REMIND_SMS_TEMPLATE = '[헤어원네스트] 예약 안내\n\n#{이름}님, 내일 예약을 알려드립니다.\n\n■ 일시: #{날짜} #{시간}\n■ 시술: #{시술}\n\n변경이나 취소가 필요하시면 이 채널로 미리 말씀해 주세요.';
  const REMIND_TEMPLATE = `${REMIND_SMS_TEMPLATE}(아잉)`;
  const timeKo = (hhmm) => {
    const h = Number(String(hhmm).slice(0, 2)), m = Number(String(hhmm).slice(3, 5));
    return `${h < 12 ? '오전' : '오후'} ${h > 12 ? h - 12 : h}시${m ? ` ${m}분` : ''}`;
  };
  // send: 보낼 손님(시간순), skip: 못 보내는 손님과 이유(번호 없음 · 시간 없음 — 원장이 채우면 간다)
  // 가족(10-24 원장 1번): 번호 있는 사람은 같이 오든 따로 오든 늘 자기 알림. 번호 없는 가족(아이 등)만 대표 번호로 간다 —
  // 대표가 그날 같은 시간에 오면 대표 알림 한 통에 "가족 N명"으로 같이, 시간이 다르거나 대표가 안 오면 대표 번호로 따로 한 통.
  // 대표에게 번호가 없으면 그날 오는 가족 중 번호 있는 사람. 그것도 없으면 "번호 없음".
  function reminderList(state, date) {
    const skip = [];
    const list = todayList(state, date);
    const units = new Map();
    for (const t of list) {
      const c = t.customer;
      let to = c.phone ? c : null;
      if (!to && familyOf(state, c.id).length > 1) {
        const rep = familyRep(state, c.id);
        const famIds = new Set(familyOf(state, c.id).map(x => x.id));
        to = rep?.phone ? rep : list.find(x => famIds.has(x.customer.id) && x.customer.phone)?.customer ?? null;
      }
      if (!to) { skip.push({ customerId: c.id, name: c.name, reason: '번호 없음' }); continue; }
      if (!t.at) { skip.push({ customerId: c.id, name: c.name, reason: '시간 없음' }); continue; }
      const key = `${to.id}|${t.at}`;
      if (!units.has(key)) units.set(key, { to, at: t.at, members: [] });
      units.get(key).members.push(t);
    }
    const send = [...units.values()].map(({ to, at, members }) => {
      const own = members.length === 1 && members[0].customer.id === to.id;
      const svcs = [...new Set(members.map(m => m.service).filter(Boolean))];
      const service = own ? members[0].service
        : members.some(m => m.customer.id === to.id) ? `가족 ${members.length}명${svcs.length ? ` (${svcs.join('·')})` : ''}`
        : members.length === 1 ? `${members[0].customer.name} ${members[0].service || '예약하신 시술'}`
        : `${members.map(m => m.customer.name).join('·')}${svcs.length ? ` (${svcs.join('·')})` : ''}`;
      return { customerId: to.id, name: to.name, phone: to.phone, at, service, ...(own ? {} : { family: members.map(m => m.customer) }),
        vars: { '#{이름}': to.name, '#{날짜}': dateKo(date), '#{시간}': timeKo(at), '#{시술}': service || '예약하신 시술' } };
    });
    return { send: send.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)), skip };
  }
  // 고객 카드에서 그 예약의 알림톡이 갔는지(10-26 원장). report = 발송킹 그날 발송의 사람별 결과 {sendDate, list:[{phone, status, detail, mobile, text}]}
  // (api/remind.js가 원장 화면에 준다), 없으면 null. now는 한국 시간 'YYYY-MM-DDTHH:MM:SS'. 그날 예약이 없으면 null.
  function remindStatusOf(state, customerId, date, report, now) {
    if (!(state.today?.entries ?? []).some(e => e.customerId === customerId && e.date === date)) return null;
    if (state.settings?.remindOff) return { state: 'warn', text: '알림 멈춤 중이라 안 감' };
    const { send, skip } = reminderList(state, date);
    const sk = skip.find(x => x.customerId === customerId);
    if (sk) return { state: 'bad', text: `알림톡 안 감 · ${sk.reason}` };
    const unit = send.find(u => u.customerId === customerId && !u.family) ?? send.find(u => (u.family ?? []).some(f => f.id === customerId));
    if (!unit) return null;
    const via = unit.customerId !== customerId ? ` · ${unit.name}님 번호로` : '';
    const today = now.slice(0, 10), eve = shiftDate(date, -1);
    if (!report) {
      if (today < eve) return { state: 'pending', text: `전날(${Number(eve.slice(5, 7))}월 ${Number(eve.slice(8, 10))}일) 오후 6시에 보냄${via}` };
      if (today === eve && now.slice(11, 16) < '18:10') return { state: 'pending', text: `오늘 오후 6시에 보낼 예정${via}` };
      return { state: 'warn', text: `보낸 기록 없음${via}` };
    }
    const phone = digitsOnly(unit.phone), time = timeKo(unit.at);
    const mine = (report.list ?? []).filter(r => digitsOnly(r.phone) === phone);
    const row = mine.find(r => String(r.text ?? '').includes(time)) ?? (mine.length === 1 ? mine[0] : null);
    const when = report.sendDate ? ` (${report.sendDate})` : '';
    if (!row) return { state: 'warn', text: '이번 알림에 안 들어감 (보낸 뒤에 올린 예약) · 직접 연락하세요' };
    if (row.status === '성공') return { state: 'ok', text: `알림톡 보냄 · 성공${when}${via}` };
    if (row.status === '실패') return row.mobile === '성공' ? { state: 'ok', text: `카톡이 안 돼 문자로 보냄 · 성공${when}${via}` }
      : { state: 'bad', text: `알림톡 실패${row.detail ? ` · ${row.detail}` : ''} · 직접 연락하세요${via}` };
    return { state: 'pending', text: `발송 맡김${report.sendDate ? ` · ${report.sendDate}에 나감` : ''}${via}` };
  }
  // 그날 예약 손님마다 알림 결과(remindStatusOf)와 합계(10-26 원장: "3명만 뜨고 실제로 갔는지 모르겠다").
  // sent = 발송킹에 그날 예약분 발송 기록이 있음, overdue = 전날 오후 6시가 지났는데 기록이 없음(크론이 안 돈 것 — [지금 보내기])
  function remindReport(state, date, report, now) {
    const rows = todayList(state, date).map(t => ({ customer: t.customer, at: t.at, service: t.service, status: remindStatusOf(state, t.customer.id, date, report, now) })).filter(r => r.status);
    const count = { ok: 0, bad: 0, pending: 0, warn: 0 };
    for (const r of rows) count[r.status.state] = (count[r.status.state] ?? 0) + 1;
    const eve = shiftDate(date, -1);
    const overdue = !report && !state.settings?.remindOff && rows.some(r => r.status.state !== 'bad') && (now.slice(0, 10) > eve || (now.slice(0, 10) === eve && now.slice(11, 16) >= '18:10'));
    return { rows, count, sent: !!report, overdue };
  }
  const reminderText = (vars, template = REMIND_TEMPLATE) => Object.entries(vars ?? {}).reduce((t, [k, v]) => t.split(k).join(v), template);
  // 쉬는 날·휴가에 알림을 멈춘다. 서버가 settings를 읽어 보고 안 보낸다.
  function setRemindOff(state, off) {
    const { remindOff: _, ...rest } = state.settings ?? {};
    return { ...state, settings: off ? { ...rest, remindOff: true } : rest };
  }

  function preBookDates(today) {
    const t = new Date(today.slice(0, 10) + 'T00:00:00');
    const last = iso(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    const target = new Date(t.getFullYear(), t.getMonth() + 2, 1);
    const day = shiftDate(last, -2), eve = shiftDate(last, -3), replyBy = shiftDate(last, -1);
    const d = today.slice(0, 10);
    const phase = d === eve ? 'eve' : d === day ? 'day' : d > day && d <= last ? 'after' : null;
    return { month: iso(target).slice(0, 7), eve, day, replyBy, open: last, phase };
  }
  const preBookMarksOf = (state) => {
    const m = state.settings?.preBookMarks ?? {};
    return { in: Array.isArray(m.in) ? m.in : [], out: Array.isArray(m.out) ? m.out : [] };
  };
  function setPreBookMark(state, customerId, mark) {
    const m = preBookMarksOf(state);
    const next = { in: m.in.filter(x => x !== customerId), out: m.out.filter(x => x !== customerId) };
    if (mark === 'in') next.in.push(customerId);
    else if (mark === 'out') next.out.push(customerId);
    return { state: { ...state, settings: { ...state.settings, preBookMarks: next } } };
  }
  const preBookMarkOf = (state, customerId) => { const m = preBookMarksOf(state); return m.in.includes(customerId) ? 'in' : m.out.includes(customerId) ? 'out' : null; };
  // 줄 하나 = 가족 하나(정액권 잔액을 같이 쓰므로 한 번만 연락). key는 가족 중 가장 작은 번호(살아 있는 사람).
  function preBookTargets(state, today) {
    const { month } = preBookDates(today);
    const m = preBookMarksOf(state);
    const log = state.settings?.preBookLog?.[month] ?? {};
    const seen = new Set();
    const out = [];
    for (const c of liveCustomers(state).sort((x, y) => x.id - y.id)) {
      const members = familyOf(state, c.id);
      const key = members[0].id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (members.some(x => m.out.includes(x.id))) continue;
      const balance = passBalance(state, c.id);
      const why = members.some(x => m.in.includes(x.id)) ? 'in' : balance > 0 ? 'pass' : null;
      if (!why) continue;
      out.push({ key, customer: members[0], members, balance, why, cycle: recommendedCycle(state, members[0].id), status: { ...(log[key] ?? {}) } });
    }
    return out;
  }
  // field: 'sent' | 'booked', at이 null이면 지운다
  function markPreBook(state, month, key, field, at) {
    const all = { ...(state.settings?.preBookLog ?? {}) };
    const mine = { ...(all[month] ?? {}) };
    const row = { ...(mine[key] ?? {}) };
    if (at) row[field] = at; else delete row[field];
    if (Object.keys(row).length) mine[key] = row; else delete mine[key];
    all[month] = mine;
    return { state: { ...state, settings: { ...state.settings, preBookLog: all } } };
  }
  function setPreBookText(state, text) {
    return { state: { ...state, settings: { ...state.settings, preBookText: String(text ?? '').trim() } } };
  }
  const preBookTextOf = (state) => String(state.settings?.preBookText ?? '').trim() || PREBOOK_TEXT;
  const preBookKeyOf = (state, customerId) => familyOf(state, customerId)[0]?.id ?? customerId;   // 가족은 가장 작은 번호 한 줄(preBookTargets와 같게)
  // 그달 그 줄(가족 key)의 추천 날짜. 원장이 "12월 3일 2시"처럼 적는다(짐작해 채우지 않는다)
  const preBookPickOf = (state, month, key) => String(state.settings?.preBookLog?.[month]?.[key]?.pick ?? '');
  function setPreBookPick(state, month, key, text) {
    const pick = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const all = { ...(state.settings?.preBookLog ?? {}) };
    const mine = { ...(all[month] ?? {}) };
    const row = { ...(mine[key] ?? {}) };
    if (pick) row.pick = pick; else delete row.pick;
    if (Object.keys(row).length) mine[key] = row; else delete mine[key];
    all[month] = mine;
    return { state: { ...state, settings: { ...state.settings, preBookLog: all } } };
  }
  // 문구에 추천 날짜 자리가 있는데 아직 안 적었으면 true (보내기 전에 막는다)
  const preBookNeedsPick = (state, customerId, today) => preBookTextOf(state).includes('{추천일}') && !preBookPickOf(state, preBookDates(today).month, preBookKeyOf(state, customerId));
  function preBookMessage(state, customerId, today) {
    const c = state.customers.find(x => x.id === customerId);
    const d = preBookDates(today);
    const text = preBookTextOf(state);
    return text.replace(/\{이름\}/g, c?.name ?? '')
      .replace(/\{추천일\}/g, preBookPickOf(state, d.month, preBookKeyOf(state, customerId)) || PREBOOK_PICK_EMPTY)
      .replace(/\{예약월\}/g, String(Number(d.month.slice(5, 7))))
      .replace(/\{회신일\}/g, dateKo(d.replyBy))
      .replace(/\{오픈일\}/g, dateKo(d.open))
      .replace(/\{선예약일\}/g, dateKo(d.day));
  }
  // 백업에 남길 보냄/예약함 기록: 가장 최근 달에서 여섯 달 안쪽만
  function keepPreBookLog(v) {
    if (!v || typeof v !== 'object') return {};
    const months = Object.keys(v).filter(k => /^\d{4}-\d{2}$/.test(k)).sort();
    if (!months.length) return {};
    const n = (k) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7));
    const newest = n(months[months.length - 1]);
    return Object.fromEntries(months.filter(k => newest - n(k) < 6).map(k => [k, v[k]]));
  }

  // ---- V3: 제품 재고 -------------------------------------------------------
  // 개수 단위만 쓴다(원장 결정 10-01: 그램은 안 적는다). 숫자가 움직이는 길은 둘뿐이다.
  //   들어온 것(stockIn, +)과 달마다 세어 본 것(stockCount, =). 쓸 때마다 빼는 단추는 없다 — 일일이 못 적는다.
  // 그래서 "부족"은 마지막으로 센 숫자 기준이고, 한 달에 한 번 세는 것이 이 기능의 전제다 (countDue가 챙긴다).
  // 돈은 다루지 않는다. 매입가·판매 매출의 원본은 핸드SOS다.

  const STOCK_CATEGORIES = ['염색약', '펌제', '클리닉', '판매 제품', '소모품', '기타'];
  const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
  const liveProducts = (state) => (state.products ?? []).filter(p => !p.deletedAt)
    .sort((a, b) => (STOCK_CATEGORIES.indexOf(a.category) - STOCK_CATEGORIES.indexOf(b.category)) || a.name.localeCompare(b.name, 'ko'));
  const deletedProducts = (state) => (state.products ?? []).filter(p => p.deletedAt);

  function requireProduct(state, productId) {
    const p = (state.products ?? []).find(x => x.id === productId && !x.deletedAt);
    if (!p) throw new Error('제품을 찾을 수 없습니다');
    return p;
  }
  function cleanQty(v) {
    const raw = String(v ?? '').trim().replace(/개$/, '');
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error('개수는 0 이상의 정수로 적으세요 (예: 3)');
    return n;
  }
  // 주문 주소는 원장이 붙여 넣는 값이라 http(s)만 받는다 (DK님 safeUrl과 같은 이유).
  function cleanLink(v) {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try { const u = new URL(withScheme); if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString(); } catch { /* 아래에서 막는다 */ }
    throw new Error('주문 주소는 http로 시작하는 웹 주소만 됩니다');
  }
  // 채워 둘 개수(fillTo): 이 제품을 늘 몇 개로 맞춰 두는지. 주문할 때는 여기서 지금 개수를 뺀 만큼 시킨다
  // (10-08 원장: "10개로 맞춰 두는 제품이 2개 남으면 8개"). 비우면 0(미정). 서버 열 이름은 order_qty 그대로.
  function cleanFillTo(v) {
    const raw = String(v ?? '').trim().replace(/개$/, '');
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error('채워 둘 개수는 0 이상의 정수로 적으세요 (예: 10)');
    return n;
  }
  // 부족 기준 이하가 되면 주문하는데, 채워 둘 개수가 그보다 작거나 같으면 주문할 것이 없다. 잘못 적은 것으로 본다
  function checkFillTo(fill, min) {
    if (fill > 0 && fill <= min) throw new Error(`채워 둘 개수는 부족 기준(${min}개)보다 커야 합니다`);
    return fill;
  }
  function productFields(state, { name, category, min, link, alarm, supplier, fillTo }, exceptId) {
    const n = String(name ?? '').trim();
    if (!n) throw new Error('제품 이름을 적으세요');
    if ((state.products ?? []).some(p => p.id !== exceptId && !p.deletedAt && squash(p.name) === squash(n))) throw new Error(`이미 있는 제품입니다: ${n}`);
    const cat = String(category ?? '기타').trim() || '기타';
    if (!STOCK_CATEGORIES.includes(cat)) throw new Error(`분류는 ${STOCK_CATEGORIES.join('·')} 중에서 고르세요`);
    const mn = min === undefined || min === null || String(min).trim() === '' ? 1 : cleanQty(min);
    // 거래처 = 카톡 보낼 상대(10-06 원장: 제조사가 아니라 주문 글을 받는 사람). 주문할 제품이 이 이름으로 묶인다
    return { name: n, category: cat, min: mn, link: cleanLink(link), alarm: alarm === undefined ? true : !!alarm,
      supplier: String(supplier ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), fillTo: checkFillTo(cleanFillTo(fillTo), mn) };
  }
  const stockLog = (state, productId, kind, qty, before, after, at, note) => ({ id: state.nextId, productId, kind, qty, before, after, at, note: String(note ?? '').trim() });

  // 처음 개수는 "센 것"으로 한 줄 남긴다. 그래야 넣은 달이 센 달로 잡힌다.
  function addProduct(state, fields, now) {
    const base = productFields(state, fields);
    const qty = fields.qty === undefined ? 0 : cleanQty(fields.qty);
    const product = { id: state.nextId, ...base, qty, orderedAt: null, deletedAt: null };
    const next = { ...state, nextId: state.nextId + 1, products: [...(state.products ?? []), product] };
    const log = stockLog(next, product.id, 'count', qty, 0, qty, now, '제품 넣음');
    return { state: { ...next, nextId: next.nextId + 1, stockLogs: [...(next.stockLogs ?? []), log] }, product, log };
  }
  // 이름·분류·부족 기준·주소·알림·거래처·주문 수량만. 개수는 입고나 세기로만 바뀐다(기록 없이 숫자가 바뀌지 않게).
  function editProduct(state, productId, patch) {
    const target = requireProduct(state, productId);
    const base = productFields(state, { name: patch.name ?? target.name, category: patch.category ?? target.category, min: patch.min ?? target.min, link: patch.link ?? target.link, alarm: patch.alarm ?? target.alarm,
      supplier: patch.supplier ?? target.supplier, fillTo: patch.fillTo ?? target.fillTo }, productId);
    const product = { ...target, ...base };
    return { state: { ...state, products: state.products.map(p => (p.id === productId ? product : p)) }, product };
  }
  function deleteProduct(state, productId, now) {
    requireProduct(state, productId);
    return { state: { ...state, products: state.products.map(p => (p.id === productId ? { ...p, deletedAt: now } : p)) } };
  }
  function restoreProduct(state, productId) {
    if (!(state.products ?? []).some(p => p.id === productId && p.deletedAt)) throw new Error('지운 제품이 아닙니다');
    return { state: { ...state, products: state.products.map(p => (p.id === productId ? { ...p, deletedAt: null } : p)) } };
  }

  // 원장이 말로 센 것을 글로 받는다: "6N 염색약 3개, 펌제 1제 2, 트리트먼트 다섯 개" 또는
  // "6N 염색약은 3개 남았고, 펌제 1제는 0개예요"처럼 말하듯 적은 것. 숫자(또는 한글 숫자+개)가
  // 경계이고, 그 앞 글에서 제품 이름을 찾는다(띄어쓰기·토씨 무시, 긴 이름 우선: "6N 염색약"이 "염색약"보다 먼저).
  // 숫자가 들어간 제품 이름("6N", "펌제 1제")을 개수로 잘못 읽지 않도록, 숫자는 "개"가 붙거나 낱말이 끝나야 개수다.
  // 색상 번호("7.07", "5.07", "8/0")와 영문에 붙은 숫자("B7")도 이름의 일부다(10-03 원장 화면: "7.07"의 7을 개수로 읽었다).
  // 그래서 점·빗금은 숫자 사이에 있으면 경계가 아니다. 문장 끝 점("3개.")은 여전히 경계.
  const KO_TENS = { 열: 10, 스무: 20, 스물: 20 };
  const KO_COUNT_RE = '(?:열|스무|스물)(?:한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉)?|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉';
  const COUNT_RE = new RegExp(`(?<![\\d./])(\\d+)\\s*개|(?<![A-Za-z\\d./])(\\d+)(?=\\s|$|[,·;\\n]|[./](?!\\d))|(?<![가-힣])(${KO_COUNT_RE})\\s*개`, 'g');
  const koCount = (w) => { const m = /^(열|스무|스물)?(.*)$/.exec(w); return (m[1] ? KO_TENS[m[1]] : 0) + (m[2] ? KO_NUM[m[2]] : 0); };
  const STOCK_SEP_RE = /[,·;\n]|(?<!\d)[./]|[./](?!\d)/;   // 숫자 사이의 점·빗금("7.07", "8/0")은 경계가 아니다
  const PARTICLE_RE = /(?<=[가-힣])(은|는|이|가|도|을|를|의)$/;
  // "4.20번"의 "번"은 번호라는 뜻이라 이름에서 뗀다(10-03)
  const cleanChunkName = (chunk) => chunk.split(STOCK_SEP_RE).map(s => s.trim()).filter(Boolean).pop()?.replace(PARTICLE_RE, '').replace(/(?<=\d)\s*번$/, '').trim() ?? '';
  // 글 속에서 제품 이름을 찾는다. 숫자로 시작하거나 끝나는 이름은 앞뒤에 숫자가 더 이어지면 그 이름이 아니다:
  // 목록의 "7"이 "7.21" 속에, "6N 염색약"이 "16N 염색약" 속에 걸리지 않게(10-03 원장 화면: "7.21"이 "7"로 들어갔다)
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const nameRe = (name) => {
    const n = squash(name);
    return new RegExp(`${/^\d/.test(n) ? '(?<![\\d./])' : ''}${escRe(n)}${/\d$/.test(n) ? '(?![\\d]|[./]\\d)' : ''}`);
  };
  const findProductIn = (chunk, products) => {
    const flat = squash(chunk);
    return products.filter(p => nameRe(p.name).test(flat)).sort((a, b) => squash(b.name).length - squash(a.name).length)[0] ?? null;
  };
  const looksLikeFiller = (s) => !s || /(요|다|고|음|요\.|다\.)$/.test(s);
  // 이름이 목록과 꼭 같지 않아도("B 7.07" ↔ 목록 "예시브랜드 7.07") 색상 번호가 한 제품에만 있으면 그 제품이다.
  // 같은 번호가 두 제품에 있으면 짐작하지 않는다(목록에 없음으로 돌려준다).
  const CODE_RE = /\d+(?:[./]\d+)+|\d+[A-Za-z]+(?![A-Za-z])/g;
  const findProductByCode = (chunk, products) => {
    const codes = (squash(chunk).match(CODE_RE) ?? []);
    if (!codes.length) return null;
    const res = codes.map(c => new RegExp(`(?<![\\d./])${escRe(c)}(?![\\d./a-z])`));
    const hits = products.filter(p => res.every(re => re.test(squash(p.name))));
    return hits.length === 1 ? hits[0] : null;
  };
  function parseStockText(text, state) {
    const products = liveProducts(state);
    const matched = new Map();
    const unknown = [];
    const noNumber = [];
    let last = 0;
    for (const m of String(text ?? '').matchAll(COUNT_RE)) {
      const qty = m[3] ? koCount(m[3]) : Number(m[1] ?? m[2]);
      const chunk = text.slice(last, m.index);
      last = m.index + m[0].length;
      const p = findProductIn(chunk, products) ?? findProductByCode(cleanChunkName(chunk), products);
      if (p) matched.set(p.id, { product: p, qty });
      else { const name = cleanChunkName(chunk); if (name) unknown.push({ name, qty }); }
    }
    const tail = text.slice(last);
    const tailProduct = findProductIn(tail, products);
    if (tailProduct) noNumber.push(tailProduct.name);
    else { const name = cleanChunkName(tail); if (!looksLikeFiller(name)) noNumber.push(name); }
    return { matched: [...matched.values()], unknown, noNumber };
  }

  // 들어온 것. 날짜는 택배가 온 날(비우면 오늘). 도착을 기다리던 제품이면 기다림이 풀린다.
  function stockIn(state, items, date, now, note) {
    const day = visitDate(date, now);
    const at = day ? day + now.slice(10) : now;
    let next = state;
    const logs = [];
    for (const it of items ?? []) {
      const p = requireProduct(next, it.productId);
      const qty = cleanQty(it.qty);
      if (qty <= 0) throw new Error(`${p.name}: 들어온 개수는 1 이상이어야 합니다`);
      const log = stockLog(next, p.id, 'in', qty, p.qty, p.qty + qty, at, note);
      next = setOrderedQty({ ...next, nextId: next.nextId + 1, products: next.products.map(x => (x.id === p.id ? { ...x, qty: p.qty + qty, orderedAt: null } : x)), stockLogs: [...(next.stockLogs ?? []), log] }, p.id, undefined);
      logs.push(log);
    }
    return { state: next, logs };
  }
  // 세어 본 개수로 맞춘다. 차이가 없으면 기록도 없다 — 그래도 "센 날"은 남겨야 하므로 차이 없는 달은 settings에 둔다.
  function stockCount(state, items, now) {
    let next = state;
    const logs = [];
    for (const it of items ?? []) {
      const p = requireProduct(next, it.productId);
      const qty = cleanQty(it.qty);
      // 같아도 남긴다(10-09): 달마다 쓴 개수는 센 날과 센 날 사이로 세기 때문에, 센 날이 빠지면 두 달이 하나로 붙는다
      const log = stockLog(next, p.id, 'count', qty, p.qty, qty, now, '');
      next = { ...next, nextId: next.nextId + 1, products: next.products.map(x => (x.id === p.id ? { ...x, qty } : x)), stockLogs: [...(next.stockLogs ?? []), log] };
      logs.push(log);
    }
    if ((items ?? []).length) next = { ...next, settings: { ...next.settings, lastCountAt: now } };
    return { state: next, logs };
  }
  // ---- 한 달 사용량 (10-09 원장) ----
  // 센 날과 센 날 사이에 쓴 개수 = 지난번 센 개수 + 그 사이 들어온 것 − 이번에 센 개수 = 이번 세기 기록의 before − after.
  // (개수는 입고와 세기로만 바뀌므로 before가 곧 "지난번 센 개수 + 들어온 것"이다.) 제품을 넣을 때 남는 세기 기록이 첫 기준.
  // 어느 달로 볼지는 두 날의 가운데 날로 정한다: 10.1→11.1은 10월, 말일에 일찍 세도(10.1→10.31) 10월.
  // 같은 날 다시 센 것(고쳐 센 것)은 앞 기간에 더한다. 음수(센 게 더 많음)는 고치지 않고 그대로 보인다.
  function monthlyUsage(state, productId) {
    const counts = (state.stockLogs ?? []).filter(l => l.productId === productId && l.kind === 'count')
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
    const periods = [];
    for (let i = 1; i < counts.length; i++) {
      const from = counts[i - 1].at.slice(0, 10), to = counts[i].at.slice(0, 10);
      const used = counts[i].before - counts[i].after;
      if (from === to) { if (periods.length) periods[periods.length - 1].used += used; continue; }
      const mid = shiftDate(from, Math.floor(daysBetween(from, to) / 2)).slice(0, 7);
      periods.push({ month: mid, used, from, to });
    }
    const out = [];
    for (const p of periods) {
      const last = out[out.length - 1];
      if (last && last.month === p.month) { last.used += p.used; last.to = p.to; }
      else out.push({ ...p });
    }
    return out;
  }
  // 월별 재고표(10-09 원장): 달마다 1일 재고(그 달을 연 세기 기록의 개수, startAt은 실제 센 날)·입고·사용.
  // 달 나누기는 monthlyUsage와 같다. 마지막 세기 뒤는 "지금 달"(open)이고 사용은 다음에 셀 때 나온다(null).
  function stockSheet(state, productId) {
    const logs = (state.stockLogs ?? []).filter(l => l.productId === productId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
    const counts = logs.filter(l => l.kind === 'count');
    if (!counts.length) return {};
    const lastOn = (d) => counts.filter(c => c.at.slice(0, 10) === d).pop();   // 그날 마지막으로 센 것
    const insBetween = (fromAt, toAt) => logs.filter(l => l.kind === 'in' && l.at > fromAt && (toAt === null || l.at < toAt)).map(l => ({ date: l.at.slice(0, 10), qty: l.qty }));
    const out = {};
    const periods = monthlyUsage(state, productId);
    for (const p of periods) {
      const a = lastOn(p.from), z = lastOn(p.to);
      out[p.month] = { start: a.after, startAt: p.from, ins: insBetween(a.at, z.at), used: p.used, open: false };
    }
    const last = counts[counts.length - 1];
    const lastDate = last.at.slice(0, 10);
    let month = shiftDate(lastDate, 15).slice(0, 7);
    const closed = periods.length ? periods[periods.length - 1].month : null;
    if (closed && month <= closed) { const d = new Date(closed + '-01T00:00:00'); d.setMonth(d.getMonth() + 1); month = iso(d).slice(0, 7); }
    out[month] = { start: last.after, startAt: lastDate, ins: insBetween(last.at, null), used: null, open: true };
    return out;
  }
  // 채워 둘 개수 제안: 최근 3달(음수 달은 빼고) 평균을 올림 + 부족 기준. 안 썼으면 없음. 바꾸는 건 원장이 [적용]으로.
  function fillSuggestion(state, productId) {
    const p = (state.products ?? []).find(x => x.id === productId);
    if (!p) return null;
    const usage = monthlyUsage(state, productId);
    const pick = usage.filter(u => u.used >= 0).slice(-3);
    if (!pick.length) return null;
    const avg = Math.ceil(pick.reduce((n, u) => n + u.used, 0) / pick.length);
    if (avg <= 0) return null;
    const skipped = usage.filter(u => u.used < 0 && u.month > pick[0].month);
    return { months: pick.map(u => u.month), used: pick.map(u => u.used), avg, fillTo: avg + p.min, ...(skipped.length ? { warn: skipped[skipped.length - 1].month } : {}) };
  }
  function fillSuggestions(state) {
    return liveProducts(state).map(p => ({ product: p, ...fillSuggestion(state, p.id) })).filter(x => x.fillTo && x.fillTo !== x.product.fillTo);
  }
  // 주문한 개수(10-15 원장: 도착하면 주문한 개수와 맞춰 본다)는 settings.orderedQtys {제품번호: 개수}에 둔다.
  // 표(card_products)에 열을 더하지 않으려는 것 — settings JSON이라 SQL이 필요 없다. 도착·주문 취소하면 지운다.
  function setOrderedQty(state, productId, qty) {
    const cur = state.settings?.orderedQtys ?? {};
    if (qty === undefined && !(productId in cur)) return state;
    const { [productId]: _, ...rest } = cur;
    return { ...state, settings: { ...state.settings, orderedQtys: qty === undefined ? rest : { ...rest, [productId]: qty } } };
  }
  // qty(선택): 이번에 보낸 개수. 주면 남긴다.
  function markOrdered(state, productId, now, qty) {
    requireProduct(state, productId);
    const next = { ...state, products: state.products.map(p => (p.id === productId ? { ...p, orderedAt: now } : p)) };
    return { state: qty === undefined ? next : setOrderedQty(next, productId, Math.max(0, Math.floor(Number(qty)) || 0)) };
  }
  function unmarkOrdered(state, productId) {
    requireProduct(state, productId);
    return { state: setOrderedQty({ ...state, products: state.products.map(p => (p.id === productId ? { ...p, orderedAt: null } : p)) }, productId, undefined) };
  }
  function markArrived(state, productId, qty, date, now) {
    const r = stockIn(state, [{ productId, qty }], date, now, '주문한 것 도착');
    return { state: r.state, log: r.logs[0] };
  }
  // 체크한 것만 한꺼번에 도착(10-15 원장). items: [{productId, qty}] — qty는 들어온 개수(주문한 개수와 달라도 들어온 만큼).
  function markArrivedMany(state, items, date, now) {
    if (!(items ?? []).length) throw new Error('도착한 제품을 체크하세요');
    return stockIn(state, items, date, now, '주문한 것 도착');
  }
  // 알림 켜진 제품 중 개수가 부족 기준 이하이고 아직 주문 안 한 것. 모자란 순서로.
  const shortProducts = (state) => liveProducts(state).filter(p => p.alarm && !p.orderedAt && p.qty <= p.min).sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name, 'ko'));
  // ordered: 주문한 개수. 남긴 게 없으면(10-15 전 주문) 채워 둘 개수 − 남은 개수로 보이고 recorded=false.
  const orderedProducts = (state, today) => liveProducts(state).filter(p => p.orderedAt).map(p => {
    const kept = state.settings?.orderedQtys?.[p.id];
    return { product: p, days: daysBetween(p.orderedAt.slice(0, 10), today), ordered: kept ?? orderAmount(p), recorded: kept !== undefined };
  }).sort((a, b) => b.days - a.days);
  function lastCountDate(state) {
    const fromLogs = (state.stockLogs ?? []).filter(l => l.kind === 'count').map(l => l.at.slice(0, 10));
    const fromSettings = state.settings?.lastCountAt ? [state.settings.lastCountAt.slice(0, 10)] : [];
    return [...fromLogs, ...fromSettings].sort().pop() ?? '';
  }
  // 이번 달에 센 적이 없으면 세야 한다. 제품이 없으면 셀 것도 없다.
  const countDue = (state, today) => liveProducts(state).length > 0 && lastCountDate(state).slice(0, 7) !== today.slice(0, 7);
  const stockLogsOf = (state, productId) => (state.stockLogs ?? []).filter(l => productId === undefined || l.productId === productId)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
  // 거래처 카카오톡에 붙일 글. 권장 주문량은 제안하지 않는다 (DK님도 뺐다).
  // ---- 거래처별 주문 (10-06 원장 결정) ----
  // 카톡 보낼 상대(거래처)별로 주문할 제품을 묶고, 묶음마다 보낼 글을 만든다. 보내기는 원장이 한다:
  // PC는 복사해서 붙이고, 핸드폰은 공유 창으로 카카오톡에 넘긴다(개인 카톡은 바로 보내는 길이 없다).
  const ORDER_HEAD = '안녕하세요, 헤어원네스트입니다. 주문 부탁드립니다.';
  const ORDER_TAIL = '감사합니다.';
  const byName = (a, b) => a.localeCompare(b, 'ko');
  const supplierNames = (state) => [...new Set(liveProducts(state).map(p => p.supplier).filter(Boolean))].sort(byName);
  // 거래처는 눌러서 고른다(10-08 원장). 기본 넷 + 원장이 [+]로 더한 것(settings.suppliers, 고른 순서 그대로),
  // 끝에 제품에 이미 적혀 있지만 목록에 없는 이름(전에 손으로 적은 것)을 붙인다.
  const DEFAULT_SUPPLIERS = ['로레알', 'JMW', '아모스', '화인'];
  const supplierKey = (n) => String(n ?? '').replace(/\s+/g, '').toLowerCase();
  const savedSuppliers = (state) => (Array.isArray(state.settings?.suppliers) ? state.settings.suppliers : DEFAULT_SUPPLIERS);
  function supplierList(state) {
    const list = [...savedSuppliers(state)];
    const keys = new Set(list.map(supplierKey));
    for (const n of supplierNames(state)) if (!keys.has(supplierKey(n))) { list.push(n); keys.add(supplierKey(n)); }
    return list;
  }
  function addSupplier(state, name) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!n) throw new Error('업체 이름을 적으세요');
    const same = supplierList(state).find((x) => supplierKey(x) === supplierKey(n));
    const saved = savedSuppliers(state);
    if (same && saved.includes(same)) return { state, name: same };
    return { state: { ...state, settings: { ...state.settings, suppliers: [...saved, same ?? n] } }, name: same ?? n };
  }
  function removeSupplier(state, name) {
    const k = supplierKey(name);
    return { state: { ...state, settings: { ...state.settings, suppliers: savedSuppliers(state).filter((x) => supplierKey(x) !== k) } } };
  }
  // 이번에 주문할 개수 = 채워 둘 개수 - 지금 개수. 안 정했으면 0(미정)이고 글에는 "?개"로 나간다.
  const orderAmount = (p) => (p.fillTo > p.qty ? p.fillTo - p.qty : 0);
  function orderGroups(state) {
    const groups = new Map();
    for (const p of shortProducts(state)) {
      const k = p.supplier ?? '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '') - (b === '') || byName(a, b))
      .map(([supplier, items]) => ({ supplier, items: items.sort((x, y) => byName(x.name, y.name)) }));
  }
  // qtys: 이번만 바꾼 수량 {제품번호: 개수}. 0이면 이번엔 빼고 보낸다. 정해 둔 수량이 없으면 "?개"로 눈에 띄게.
  function orderMessage(state, supplier, qtys = {}) {
    const group = orderGroups(state).find(g => g.supplier === (supplier ?? ''));
    const lines = (group?.items ?? []).map(p => {
      const q = qtys[p.id] !== undefined && qtys[p.id] !== '' ? Number(qtys[p.id]) : orderAmount(p);
      if (qtys[p.id] !== undefined && qtys[p.id] !== '' && q === 0) return null;
      return `- ${p.name}  ${q > 0 ? `${q}개` : '?개'}`;
    }).filter(Boolean);
    if (!lines.length) return '';
    const head = String(state.settings?.orderHead ?? '').trim() || ORDER_HEAD;
    return [head, ...lines, ORDER_TAIL].join('\n');
  }
  function setOrderHead(state, text) {
    return { state: { ...state, settings: { ...state.settings, orderHead: String(text ?? '').trim() } } };
  }
  // qtys: 주문 글에서 이번만 바꾼 수량 {제품번호: 글자}. 없으면 orderAmount — 주문 글에 들어간 수와 같다(orderMessage).
  function markOrderedMany(state, productIds, now, qtys = {}) {
    let next = state;
    for (const id of productIds ?? []) {
      const p = requireProduct(next, id);
      const q = qtys[id] !== undefined && qtys[id] !== '' ? Number(qtys[id]) : orderAmount(p);
      next = markOrdered(next, id, now, q).state;
    }
    return { state: next };
  }

  // ---- 예시 손님 (시험 모드 전용) ------------------------------------------
  // 로그인 없이 둘러보는 사람이 빈 화면 대신 볼 수 있게, 가짜 손님 여섯을 만든다.
  // 이름에 전부 "예시"가 들어가고 번호는 010-0000-000N. 실제 고객 기록과 무관하다.
  function shiftDate(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function sampleState(today, now) {
    const at = (days) => shiftDate(today, days) + 'T10:00:00';
    let s = createState();
    const add = (fields) => { const r = addCustomer(s, fields); s = r.state; return r.customer.id; };
    const visit = (id, days, fields) => { s = addVisit(s, id, { ...fields, date: shiftDate(today, days) }, at(days)).state; };
    const profile = (id, talk, hair) => { s = setProfile(s, id, { talk, hair }, now).state; };

    const kim = add({ name: '김예시', phone: '01000000001', isLegacy: true });
    profile(kim, '학원 원장. 토요일 오전만 가능. 커피 안 드심', '둥근 얼굴형 / 가는 모발 / 두상 뒤가 납작');
    visit(kim, -150, { done: '뿌리 볼륨펌 / 앞머리 정돈', next: '3개월 뒤 커트만', kinds: ['펌'] });
    visit(kim, -90, { done: '가슴윗기장 포워드레이어드 / 숱 정리', next: '다음엔 층 조금 더', kinds: ['커트'] });
    visit(kim, -30, { done: '펌 레시피:\n1. 시술: 가슴윗기장 포워드레이어드\n(a) 매직 후 파랑 한바퀴반\n(b) 120도 5분\n2. 다음: C컬로 펴주고 중화', next: '여름엔 볼륨 줄이기', kinds: ['커트', '펌'] });
    visit(kim, 0, { done: '앞머리 정돈 / 끝 1cm', next: '뿌리 볼륨펌 다시 권함', kinds: ['커트'] });

    const lee = add({ name: '이예시', phone: '01000000002', referrer: '김예시' });
    profile(lee, '김예시님 소개. 첫 방문. 염색 자주 함', '직모 / 모량 많음');
    visit(lee, -3, { done: '뿌리염색 6N / 손상 부위 클리닉', next: '5주 뒤 뿌리', kinds: ['염색', '클리닉'] });

    const park = add({ name: '박예시', phone: '01000000003', isLegacy: true });
    profile(park, '정액권 손님. 문자 확인을 잘 안 하심', '곱슬 / 두피 예민');
    s = chargePass(s, park, { amount: '300000', note: '30만 원 정액권' }, at(-40)).state;
    visit(park, -40, { done: '두피 클리닉 / 커트', next: '한 달 뒤 커트', kinds: ['클리닉', '커트'] });
    s = usePass(s, park, { amount: '50000', note: '두피 클리닉' }, at(-40)).state;
    visit(park, -10, { done: '여성컷 / 앞머리 정돈', next: '다음엔 층 정리', kinds: ['커트'] });
    s = usePass(s, park, { amount: '30000', note: '여성컷' }, at(-10)).state;

    const choi = add({ name: '최예시', phone: '01000000004' });
    profile(choi, '한 달에 한 번 오시던 분. 요즘 뜸함', '반곱슬 / 숱 보통');
    visit(choi, -200, { done: '셋팅펌', next: '한 달 뒤 커트', kinds: ['펌'] });
    visit(choi, -170, { done: '커트 / 끝 정리', next: '', kinds: ['커트'] });
    visit(choi, -140, { done: '커트 / 앞머리', next: '펌 다시 권함', kinds: ['커트'] });

    const jung = add({ name: '정예시', phone: '01000000005', isLegacy: true });
    visit(jung, -60, { done: '남성컷 투블럭 6mm', next: '', kinds: ['커트'] });
    visit(jung, -5, { done: '남성컷 투블럭 / 옆 9mm', next: '다음엔 6mm로', kinds: ['커트'] });

    const han = add({ name: '한예시', phone: '01000000006', referrer: '블로그' });
    visit(han, -1, { done: '앞머리 커트하고 끝만 정리했어요. 고민은 앞머리가 자꾸 눈을 찔러서 답답한 것. 진단은 가마 때문에 앞머리가 갈라져서 그런 거예요. 다음에는 2주 뒤 펌 상담. 주기는 5주', next: '', kinds: ['커트'] });

    s = markToday(s, kim, today, '10:00', '커트').state;
    s = markToday(s, lee, today, '11:00', '뿌리염색').state;
    s = markToday(s, han, today, '14:00', '열펌 매직').state;

    // 예시 제품: 하나는 부족, 하나는 주문해서 도착 대기. 이름은 전부 "예시".
    const prod = (fields, days) => { const r = addProduct(s, fields, at(days)); s = r.state; return r.product.id; };
    // 거래처는 카톡 보낼 상대(10-06). 이름은 전부 예시
    prod({ name: '예시 염색약 6N', category: '염색약', qty: 3, min: 2, supplier: '예시상사 실장님', fillTo: 6 }, -20);
    const p7 = prod({ name: '예시 염색약 7N', category: '염색약', qty: 1, min: 2, supplier: '예시상사 실장님', fillTo: 6 }, -20);
    const perm = prod({ name: '예시 펌제 1제', category: '펌제', qty: 0, min: 1, supplier: '예시 대리점', fillTo: 4 }, -20);
    prod({ name: '예시 트리트먼트', category: '판매 제품', qty: 4, min: 1, supplier: '예시 대리점', fillTo: 3 }, -20);
    prod({ name: '예시 수건', category: '소모품', qty: 20, min: 5 }, -20);
    s = stockIn(s, [{ productId: p7, qty: 2 }], shiftDate(today, -12), at(-12), '택배').state;
    s = stockCount(s, [{ productId: p7, qty: 1 }], at(-2)).state;
    s = markOrdered(s, perm, at(-3)).state;
    // 예시 취소 기록 두 건: 하나는 채워짐, 하나는 아직 모름 (10-11)
    const md = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
    s = addCancel(s, { text: `${md(shiftDate(today, -2))} 2시 커트, 전날 취소, 다음 날 채워짐 (예시)` }, at(-3), today).state;
    s = addCancel(s, { text: `${md(shiftDate(today, 5))} 오전 11시 열펌, 3일 전 취소 (예시)` }, at(-1), today).state;
    // 예시 대기 두 건 (C안): 열펌 손님과 커트 손님. 번호·이름은 전부 예시
    s = addWait(s, { name: '대기예시 A', phone: '01000000011', service: '열펌 매직', month: addMonths(today.slice(0, 7), 1), days: ['weekday'], windows: ['pm', 'eve'], code: '111111' }, at(-4)).state;
    s = addWait(s, { name: '대기예시 B', phone: '01000000012', service: '커트', month: today.slice(0, 7), days: ['weekday', 'weekend'], windows: ['am', 'pm', 'eve'], code: '222222', note: '토요일이면 더 좋아요' }, at(-2)).state;
    return s;
  }

  // ---- V4 첫 걸음: 시술 시간표와 예약 취소 기록 (10-11 원장) -------------------
  // 10/11~21 열흘은 대기 시스템을 만들기 전에 "취소가 나면 그 자리가 채워지는지"를 센다.
  // 원장은 말하듯 한 줄 적고(예: "10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐"), 카드가 네 가지를 읽는다:
  // 언제 예약이었나(date·time) · 무슨 시술(service·minutes) · 며칠 전 취소(daysBefore) · 채워졌나(filled yes/no/unknown, filledIn 얼마 만에).
  // 원글은 note에 그대로 남는다. 시술 시간표는 settings.serviceTimes(없으면 원장이 10-11에 준 기본값). settings.services는 매장 세션의 시술 등록(이름·금액, 10-09)이라 다른 것.
  const DEFAULT_SERVICES = [
    { name: '커트', minutes: 60 }, { name: '일반 콜드펌', minutes: 120 }, { name: '열펌 매직', minutes: 180 }, { name: '매직세팅', minutes: 240 },
    { name: '클리닉', minutes: 60 }, { name: '뿌리염색', minutes: 90 }, { name: '전체 염색', minutes: 120 },
  ];
  const cleanServices = (list) => (Array.isArray(list) ? list : [])
    .filter(x => x && typeof x.name === 'string' && x.name.trim() && Number.isInteger(Number(x.minutes)) && Number(x.minutes) > 0)
    .map(x => ({ name: x.name.trim(), minutes: Number(x.minutes), ...(typeof x.group === 'string' && x.group.trim() ? { group: x.group.trim() } : {}), ...(Number.isInteger(Number(x.price)) && Number(x.price) > 0 ? { price: Number(x.price) } : {}) }));
  // 시술항목 분류(10-13 원장: 커트 → 남성 컷·여성 컷·아이 컷). 분류를 안 정했으면 이름으로 짐작해 묶는다(보여 줄 때만).
  const guessGroup = (name) => { const n = squash(name); return /컷|커트/.test(n) ? '커트' : /펌|매직|세팅|셋팅/.test(n) ? '펌' : /염색|뿌리|탈색/.test(n) ? '염색' : /클리닉/.test(n) ? '클리닉' : '기타'; };
  const serviceGroupOf = (x) => (x?.group && String(x.group).trim()) || guessGroup(x?.name);
  const serviceList = (state) => { const l = cleanServices(state.settings?.serviceTimes); return l.length ? l : DEFAULT_SERVICES.map(x => ({ ...x })); };
  const serviceGroups = (state) => [...new Set(serviceList(state).map(serviceGroupOf))];
  const servicesInGroup = (state, group) => serviceList(state).filter(x => serviceGroupOf(x) === group);
  const serviceMinutes = (state, name) => serviceList(state).find(x => squash(x.name) === squash(name))?.minutes ?? null;
  // 예약한 시술 → 방문 기록의 시술 종류 칩(KINDS). 분류가 칩 이름이면 그것, 아니면 분류 이름·시술 이름으로 짐작(10-24 원장: 예약하면 기록에 미리 체크)
  function kindOfService(state, name) {
    const x = serviceList(state).find(s => squash(s.name) === squash(name));
    if (!x) return null;
    const g = serviceGroupOf(x);
    if (KINDS.includes(g)) return g;
    const byGroup = guessGroup(g);
    return byGroup !== '기타' ? byGroup : guessGroup(x.name);
  }
  // 그날 명단에 올린 그 손님의 시술(이름·분·금액). 정액권 안내문 "오늘 시술"을 미리 채울 때 쓴다(10-24 원장)
  function bookedService(state, customerId, date) {
    const e = (state.today?.entries ?? []).find(x => x.customerId === customerId && x.date === date && x.service);
    return e ? serviceList(state).find(x => squash(x.name) === squash(e.service)) ?? null : null;
  }
  function setServices(state, list) {
    // 금액(10-24, 선택): 비우면 없음, "3만"·"30,000원"도 읽는다(cleanAmount)
    const priceOf = (x) => { const v = x?.price; if (v === undefined || v === null || String(v).trim() === '') return {}; try { return { price: cleanAmount(v) }; } catch (e) { throw new Error(`${String(x?.name ?? '').trim()}: ${e.message}`); } };
    const rows = (list ?? []).map(x => ({ name: String(x?.name ?? '').trim(), minutes: Number(x?.minutes), ...(String(x?.group ?? '').trim() ? { group: String(x.group).trim() } : {}), ...priceOf(x) }));
    if (!rows.length) throw new Error('시술이 하나는 있어야 합니다');
    const seen = new Set();
    for (const r of rows) {
      if (!r.name) throw new Error('시술 이름을 적으세요');
      if (!Number.isInteger(r.minutes) || r.minutes <= 0) throw new Error(`${r.name}: 걸리는 시간은 분 단위 숫자로 적으세요 (예: 60)`);
      const k = squash(r.name);
      if (seen.has(k)) throw new Error(`같은 이름이 둘입니다: ${r.name}`);
      seen.add(k);
    }
    return { ...state, settings: { ...state.settings, serviceTimes: rows } };
  }

  // 손님 올리는 칸의 [+ 시술항목 추가](10-13 원장): 이름과 걸리는 시간으로 시간표 맨 끝에 하나 더한다.
  function addServiceTime(state, { name, minutes, group, price }) {
    const n = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!n) throw new Error('시술 이름을 적으세요');
    if (serviceList(state).some(x => squash(x.name) === squash(n))) throw new Error(`이미 있는 시술입니다: ${n}`);
    const m = Number(minutes);
    if (String(minutes ?? '').trim() === '' || !Number.isInteger(m) || m <= 0) throw new Error('걸리는 시간을 고르세요');
    const g = String(group ?? '').trim();
    const next = setServices(state, [...serviceList(state), { name: n, minutes: m, group: g, price }]);
    return { state: next, service: serviceList(next).at(-1) };
  }

  // 시술항목 관리(10-16 원장: 더하기·고치기·지우기를 한곳에서). rows: [{from?(원래 이름), group, name, minutes}].
  // 이름을 비운 새 줄은 버리고, 원래 있던 줄의 이름을 비우면 막는다(지우려면 줄을 지운다). 바꾼 이름은 명단 항목의 시술에도 따라간다.
  // 지운 시술을 쓰던 명단 항목은 이름만 남고(막대는 한 칸) orphans로 알려 준다.
  function editServices(state, rows) {
    const kept = (rows ?? []).filter(x => x?.from || String(x?.name ?? '').trim() || String(x?.minutes ?? '').trim());
    const next = setServices(state, kept.map(x => ({ name: String(x.name ?? '').trim().replace(/\s+/g, ' '), minutes: x.minutes, group: x.group, price: x.price })));
    const rename = new Map(kept.filter(x => x.from && squash(x.from) !== squash(x.name)).map(x => [squash(x.from), String(x.name).trim().replace(/\s+/g, ' ')]));
    const entries = next.today.entries.map(e => (e.service && rename.has(squash(e.service)) ? { ...e, service: rename.get(squash(e.service)) } : e));
    const out = { ...next, today: { ...next.today, entries } };
    const orphans = entries.filter(e => e.service && serviceMinutes(out, e.service) === null);
    return { state: out, orphans };
  }

  // 줄임말 → 시간표 이름. 그 이름이 시간표에 있을 때만 쓴다. "펌"·"염색"만으로는 어느 것인지 몰라 짐작하지 않는다.
  const SERVICE_ALIASES = { 콜드펌: '일반 콜드펌', 일반펌: '일반 콜드펌', 열펌: '열펌 매직', 매직: '열펌 매직', 세팅: '매직세팅', 셋팅: '매직세팅', 매직셋팅: '매직세팅', 뿌리: '뿌리염색', 전체염색: '전체 염색', 컷: '커트', 커트: '커트', 클리닉: '클리닉' };
  const FILLED = ['yes', 'no', 'unknown'];
  const KO_DAYS = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 여드레: 8, 아흐레: 9, 열흘: 10 };
  const realDay = (y, m, d) => { const x = new Date(y, m - 1, d); return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
  const FILLED_IN_RE = /(바로|금방|곧|당일|다음\s*날|이튿날|그날|(?:\d+|한|두|세|네|다섯|반)\s*(?:시간|분|일)\s*(?:만에|뒤|후|안에))/;
  function parseCancelText(text, state, today) {
    let rest = ' ' + String(text ?? '') + ' ';
    const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
    const take = (re) => { const m = re.exec(rest); if (m) rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length); return m; };
    // 언제: "10월 15일" · "10/15" · "15일"(이번 달) · 오늘·내일·모레·어제·그제. 열흘 넘게 지난 달·일이면 다음 해로.
    let date = null;
    let m = take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/) || take(/(?<!\d)(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/);
    if (m) { date = realDay(y, Number(m[1]), Number(m[2])); if (date && date < shiftDate(today, -45)) date = realDay(y + 1, Number(m[1]), Number(m[2])); }
    else if ((m = take(/(?<![\d.\/])(\d{1,2})\s*일(?!\s*(?:전|뒤|후|만|안|째|주일))/))) date = realDay(y, mo, Number(m[1]));
    else if ((m = take(/(오늘|내일|모레|어제|그제)/))) date = shiftDate(today, { 오늘: 0, 내일: 1, 모레: 2, 어제: -1, 그제: -2 }[m[1]]);
    // 몇 시: "2시" "오후 2시" "14시" "2시 반" "2시 30분". 앞뒤 말 없는 1~7시는 영업시간상 오후. "2시간 뒤"의 시간은 아니다.
    let time = '';
    m = take(/(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*시(?!간)\s*(반|(\d{1,2})\s*분)?/);
    if (m) {
      let h = Number(m[2]); const min = m[3] === '반' ? 30 : m[4] ? Number(m[4]) : 0;
      if (m[1] === '오전' || m[1] === '아침') { /* 그대로 */ } else if (h < 8 || m[1]) h = h < 12 ? h + 12 : h;
      if (h <= 23 && min <= 59) time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    // 며칠 전: 당일 · 전날·하루 전 · 사흘 전 · 3일 전 · 일주일 전 · 2주 전 · 한 달 전
    let daysBefore = null;
    if (take(/당일(?!\s*(?:에|채|들어|잡|찼|메))/)) daysBefore = 0;
    else if (take(/전날|전\s*일\s*(?:에)?\s*취소/)) daysBefore = 1;
    else if ((m = take(/(하루|이틀|사흘|나흘|닷새|엿새|이레|여드레|아흐레|열흘)\s*전/))) daysBefore = KO_DAYS[m[1]];
    else if (take(/일\s*주일\s*전/)) daysBefore = 7;
    else if ((m = take(/(\d+|한|두|세|네)\s*(주|달|개월)\s*전/))) daysBefore = toNum(m[1]) * (m[2] === '주' ? 7 : 30);
    else if ((m = take(/(\d+)\s*일\s*전/))) daysBefore = Number(m[1]);
    // 채워졌나: 아니라는 말이 먼저(안 채워짐·못 채움·비었음·아무도), 그다음 채워졌다는 말. 둘 다 없으면 모름.
    let filled = 'unknown', filledIn = '';
    if (/비어|비었|빈\s*채|빈\s*자리|못\s*채|안\s*채|안\s*잡|못\s*잡|아무도|안\s*메|못\s*메|안\s*들어|안\s*찼/.test(rest)) filled = 'no';
    else if (/채워|채웠|채움|찼|잡혔|잡았|잡음|들어왔|들어옴|메웠|메워|메움/.test(rest)) { filled = 'yes'; filledIn = (FILLED_IN_RE.exec(rest)?.[1] ?? '').replace(/\s+/g, ' ').trim(); }
    // 무슨 시술: 시간표 이름과 줄임말 중 글에 있는 가장 긴 것
    const list = serviceList(state);
    const names = new Map(list.map(x => [squash(x.name), x.name]));
    for (const [k, v] of Object.entries(SERVICE_ALIASES)) if (list.some(x => squash(x.name) === squash(v))) names.set(squash(k), list.find(x => squash(x.name) === squash(v)).name);
    const sq = squash(text);
    const hit = [...names.keys()].filter(k => k && sq.includes(k)).sort((a, b) => b.length - a.length)[0];
    const service = hit ? names.get(hit) : '';
    return { date, time, service, minutes: service ? serviceMinutes(state, service) : null, daysBefore, filled, filledIn };
  }

  const cleanCancelDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? '').trim()); return m ? realDay(Number(m[1]), Number(m[2]), Number(m[3])) : null; };
  const given = (v) => v !== undefined && v !== null && v !== '';
  // 적은 글을 읽고, 원장이 따로 고른 값(fields.date·time·service·daysBefore·filled·filledIn)이 있으면 그것이 이긴다
  function buildCancel(state, fields, today) {
    const text = String(fields?.text ?? '').trim();
    if (!text) throw new Error('취소된 예약을 한 줄 적으세요 (예: 10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐)');
    const p = parseCancelText(text, state, today);
    const date = given(fields.date) ? cleanCancelDate(fields.date) : p.date;
    if (!date) throw new Error('언제 예약이었는지 날짜를 적으세요 (예: 10월 15일)');
    const service = given(fields.service) ? String(fields.service).trim() : p.service;
    const filled = given(fields.filled) ? fields.filled : p.filled;
    if (!FILLED.includes(filled)) throw new Error('채워짐 값이 이상합니다');
    const daysBefore = given(fields.daysBefore) ? Number(fields.daysBefore) : p.daysBefore;
    return {
      date, time: given(fields.time) ? String(fields.time) : p.time, service, minutes: service ? serviceMinutes(state, service) : null,
      daysBefore: Number.isInteger(daysBefore) && daysBefore >= 0 ? daysBefore : null,
      filled, filledIn: filled === 'yes' ? (given(fields.filledIn) ? String(fields.filledIn).trim() : p.filledIn) : '', note: text,
    };
  }
  function addCancel(state, fields, now, today) {
    const cancel = { id: state.nextId, ...buildCancel(state, fields, today), at: now };
    return { state: { ...state, nextId: state.nextId + 1, cancels: [...(state.cancels ?? []), cancel] }, cancel };
  }
  const requireCancel = (state, id) => { const c = (state.cancels ?? []).find(x => x.id === id); if (!c) throw new Error('없는 취소 기록입니다'); return c; };
  function editCancel(state, id, fields, today) {
    const c = requireCancel(state, id);
    const cancel = { ...c, ...buildCancel(state, fields, today) };
    return { state: { ...state, cancels: state.cancels.map(x => (x.id === id ? cancel : x)) }, cancel };
  }
  function setCancelFilled(state, id, filled, filledIn) {
    requireCancel(state, id);
    if (!FILLED.includes(filled)) throw new Error('채워짐 값이 이상합니다');
    return { ...state, cancels: state.cancels.map(x => (x.id === id ? { ...x, filled, filledIn: filled === 'yes' ? String(filledIn ?? '').trim() : '' } : x)) };
  }
  // 10초짜리 기록이라 휴지통 없이 바로 지운다
  const deleteCancel = (state, id) => ({ ...state, cancels: (state.cancels ?? []).filter(x => x.id !== id) });
  const cancelList = (state) => [...(state.cancels ?? [])].sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));
  // 적은 날(at) 기준 기간 안의 취소 수. 기간이 없으면 전부
  function cancelSummary(state, from, to) {
    const rows = (state.cancels ?? []).filter(c => { const d = (c.at ?? '').slice(0, 10); return (!from || d >= from) && (!to || d <= to); });
    return { total: rows.length, filled: rows.filter(c => c.filled === 'yes').length, empty: rows.filter(c => c.filled === 'no').length, unknown: rows.filter(c => c.filled === 'unknown').length };
  }

  // ---- 예약 대기 (C안, 10-11 원장 승인 · 10-23 원장: 희망 월·평일/주말·시간대 셋) ----------------
  // 예약은 네이버에 그대로 두고, 대기는 "자리 나면 문자를 받는 줄"이다. 손님이 링크(wait.html)에서 직접 걸고(시술·희망 월 하나·평일/주말·시간대·전화),
  // 원장이 취소를 한 줄 적으면 시술이 그 시간 안에 들어가는 대기 손님 중 줄 앞 3명에게 한꺼번에 문자가 간다. 자리를 막거나 답을 기다리지 않는다(네이버 선착순).
  // 줄 순서는 먼저 건 순인데, 문자를 받은 사람은 그때 줄 맨 뒤로 간다(10-23 원장: 한 사람이 계속 앞을 막지 않게). 대기는 그 달 끝까지.
  // 원장이 하는 일은 취소 한 줄 적기뿐. 손님 쪽 쓰기는 api/wait.js가 이 함수들로 검사하고 표 card_waitlist에 넣는다.
  const WAIT_WINDOWS = [
    { key: 'am', label: '오전', hint: '10시~1시', from: '00:00', to: '13:00' },
    { key: 'pm', label: '오후', hint: '1시~5시', from: '13:00', to: '17:00' },
    { key: 'eve', label: '5시 이후', hint: '5시~', from: '17:00', to: '24:00' },
  ];
  const WINDOW_KEYS = WAIT_WINDOWS.map(w => w.key);
  const windowOf = (time) => (time ? WAIT_WINDOWS.find(w => w.from <= time && time < w.to)?.key ?? null : null);
  const windowLabels = (keys) => WAIT_WINDOWS.filter(w => keys.includes(w.key)).map(w => w.label).join('·');
  const WAIT_DAYS = [{ key: 'weekday', label: '평일' }, { key: 'weekend', label: '주말' }];
  const DAY_KEYS = WAIT_DAYS.map(d => d.key);
  const dayKindOf = (iso) => { const g = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay(); return g === 0 || g === 6 ? 'weekend' : 'weekday'; };
  const dayLabels = (keys) => WAIT_DAYS.filter(d => keys.includes(d.key)).map(d => d.label).join('·');
  const WAIT_STATUS = ['waiting', 'left', 'expired', 'booked'];
  const WAIT_MAX_PER_PHONE = 3;
  const WAIT_MONTHS = 3;   // 고를 수 있는 달: 이번 달부터 석 달 (네이버는 다다음달까지 열린다)
  const NOTIFY_LIMIT = 3;   // 자리 하나에 문자를 보내는 대기 손님 수 (줄 앞부터, 한꺼번에)
  const cleanWindows = (v) => (Array.isArray(v) ? [...new Set(v.filter(k => WINDOW_KEYS.includes(k)))] : []);
  const cleanDays = (v) => (Array.isArray(v) ? DAY_KEYS.filter(k => v.includes(k)) : []);
  // 표에는 열을 더하지 않고 windows 열(jsonb)에 요일도 함께 싣는다(["pm","eve","weekday"]) — 원장이 SQL을 다시 Run 하지 않게. 읽을 때 migrate가 가른다.
  const waitWindowsCol = (w) => [...(w.windows ?? []), ...(w.days ?? [])];
  const monthEnd = (ym) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
  const addMonths = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const waitMonths = (today) => Array.from({ length: WAIT_MONTHS }, (_, i) => addMonths(today.slice(0, 7), i));
  const monthLabel = (ym) => `${Number(ym.slice(5, 7))}월`;
  const clockLabel = (t) => {
    if (!t) return '';
    const h = Number(t.slice(0, 2)), m = Number(t.slice(3, 5));
    const part = h < 12 ? '오전' : h === 12 ? '낮' : h < 18 ? '오후' : '저녁';
    return `${part} ${h > 12 ? h - 12 : h}시${m ? ` ${m}분` : ''}`;
  };
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}(${WEEKDAYS[new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()]})`;
  const activeWaits = (state) => (state.waitlist ?? []).filter(w => w.status === 'waiting');
  // 줄에 선 시각: 건 시각, 문자를 받았으면 마지막으로 받은 시각(그때 맨 뒤로 간다)
  const queuedAt = (w) => (w.notified ?? []).reduce((t, n) => (n.at > t ? n.at : t), w.createdAt ?? '');
  const earlier = (a, b) => queuedAt(a) < queuedAt(b) || (queuedAt(a) === queuedAt(b) && a.id < b.id);   // 같은 초면 번호가 작은 쪽이 앞

  // fields.month: 'YYYY-MM' 하나. 날짜는 그 달 1일(지났으면 오늘)~말일로 정한다(표 모양 date_from·date_to 그대로).
  function addWait(state, fields, now) {
    const today = now.slice(0, 10);
    const name = String(fields?.name ?? '').trim();
    if (!name) throw new Error('이름을 적어 주세요');
    const phone = digitsOnly(fields?.phone);
    if (!/^\d{10,11}$/.test(phone)) throw new Error('전화번호는 숫자 10~11자리로 적어 주세요 (예: 010-1234-5678)');
    const service = serviceList(state).find(x => squash(x.name) === squash(fields?.service));
    if (!service) throw new Error('시술을 골라 주세요');
    const month = String(fields?.month ?? '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('희망 월을 골라 주세요');
    if (month < today.slice(0, 7)) throw new Error('지난 달이에요. 이번 달 이후로 골라 주세요');
    if (!waitMonths(today).includes(month)) throw new Error(`희망 월은 ${monthLabel(waitMonths(today).at(-1))}까지 고를 수 있어요`);
    const dateFrom = `${month}-01` < today ? today : `${month}-01`, dateTo = monthEnd(month);
    const days = cleanDays(fields?.days);
    if (!days.length) throw new Error('평일·주말 중 하나는 골라 주세요');
    const windows = cleanWindows(fields?.windows);
    if (!windows.length) throw new Error('되는 시간대를 하나는 골라 주세요');
    if (activeWaits(state).filter(w => w.phone === phone).length >= WAIT_MAX_PER_PHONE) throw new Error(`한 번호로 대기는 ${WAIT_MAX_PER_PHONE}건까지예요. 지난 대기를 빼고 다시 걸어 주세요`);
    const code = String(fields?.code ?? '').trim() || String(Math.floor(100000 + Math.random() * 900000));
    const wait = { id: state.nextId, name, phone, service: service.name, minutes: service.minutes, dateFrom, dateTo, days, windows: WINDOW_KEYS.filter(k => windows.includes(k)), note: String(fields?.note ?? '').trim().slice(0, 200), code, status: 'waiting', createdAt: now, notified: [] };
    return { state: { ...state, nextId: state.nextId + 1, waitlist: [...(state.waitlist ?? []), wait] }, wait };
  }
  const requireWait = (state, id) => { const w = (state.waitlist ?? []).find(x => x.id === id); if (!w) throw new Error('없는 대기예요'); return w; };
  const setWaitStatus = (state, id, status) => { requireWait(state, id); return { ...state, waitlist: state.waitlist.map(x => (x.id === id ? { ...x, status } : x)) }; };
  const leaveWait = (state, id) => setWaitStatus(state, id, 'left');
  const bookWait = (state, id) => setWaitStatus(state, id, 'booked');
  const expireWaits = (state, today) => ({ ...state, waitlist: (state.waitlist ?? []).map(w => (w.status === 'waiting' && w.dateTo < today ? { ...w, status: 'expired' } : w)) });
  // 그 달이 끝난 대기는 상태와 상관없이 지운다(손님 동의 글: "대기가 끝나면 지워요"). 원장 앱을 열 때 한 번 돈다.
  function sweepWaits(state, today) {
    const kept = (state.waitlist ?? []).filter(w => w.dateTo >= today);
    const removed = (state.waitlist ?? []).length - kept.length;
    return removed === 0 ? { state, removed: 0 } : { state: { ...state, waitlist: kept }, removed };
  }
  const waitsOf = (state, phone) => { const p = digitsOnly(phone); return (state.waitlist ?? []).filter(w => w.phone === p && w.status !== 'left'); };
  const overlaps = (a, b) => a.dateFrom <= b.dateTo && b.dateFrom <= a.dateTo && a.windows.some(k => b.windows.includes(k)) && (a.days ?? DAY_KEYS).some(k => (b.days ?? DAY_KEYS).includes(k));
  // 같은 시술이고 달·요일·시간대가 겹치는 대기 중 내 앞에 선 사람 수 + 1. 전체 줄이 아니라 "내 조건에서 몇 번째"다.
  function waitPosition(state, id) {
    const me = requireWait(state, id);
    return activeWaits(state).filter(w => w.id !== me.id && squash(w.service) === squash(me.service) && overlaps(w, me) && earlier(w, me)).length + 1;
  }
  // 취소 한 줄(날짜·시각·분)에 맞는 대기: 날짜가 그 달 안, 평일/주말이 맞고, 시각이 되는 시간대(시각을 모르면 안 따짐),
  // 시술이 빈 시간 안에 들어감(필요한 분 ≤ 빈 분, 10-23 원장: "들어가면 보냄"), 같은 취소로 이미 문자 받은 사람은 빼고, 줄 앞부터.
  // 취소의 시술(분)을 모르면 아무도 안 맞는다 — 어느 시술이 들어갈 자리인지 모르면 문자를 안 보낸다.
  function matchWaiters(state, cancel) {
    if (!cancel || !cancel.minutes || !cancel.date) return [];
    const win = windowOf(cancel.time), kind = dayKindOf(cancel.date);
    return activeWaits(state)
      .filter(w => w.dateFrom <= cancel.date && cancel.date <= w.dateTo && (w.days ?? DAY_KEYS).includes(kind) && w.minutes <= cancel.minutes && (!win || w.windows.includes(win)) && !(w.notified ?? []).some(n => n.cancelId === cancel.id))
      .sort((a, b) => (earlier(a, b) ? -1 : 1));
  }
  // 기다리는 대기 전체를 줄 순서대로 (원장 화면 목록)
  const waitQueue = (state) => activeWaits(state).sort((a, b) => (earlier(a, b) ? -1 : 1));
  const markNotified = (state, ids, cancelId, now) => ({ ...state, waitlist: (state.waitlist ?? []).map(w => (ids.includes(w.id) ? { ...w, notified: [...(w.notified ?? []), { cancelId, at: now }] } : w)) });
  const bookingUrlOf = (state) => (typeof state.settings?.bookingUrl === 'string' ? state.settings.bookingUrl.trim() : '');
  const setBookingUrl = (state, url) => ({ ...state, settings: { ...state.settings, bookingUrl: String(url ?? '').trim() } });
  const waitWhen = (w) => `${monthLabel(w.dateTo.slice(0, 7))} ${dayLabels(w.days ?? DAY_KEYS)} ${windowLabels(w.windows)}`;
  // 손님에게 가는 문자. "선착순"과 "원장이 따로 연락하지 않는다"를 꼭 넣는다 — 대기가 원장의 빚이 되지 않게.
  function noticeText(state, cancel, waitUrl) {
    const url = bookingUrlOf(state);
    const when = `${dayLabel(cancel.date)}${cancel.time ? ' ' + clockLabel(cancel.time) : ''}`;
    return `[헤어원네스트] ${when} ${cancel.service} 자리가 났어요. 네이버 예약에서 지금 잡으세요 (선착순, 원장이 따로 연락하지는 않아요)${url ? ': ' + url : '.'}\n이 문자를 받으셔서 대기 순서는 맨 뒤로 갔어요(대기는 그대로예요).\n대기 바꾸기·빼기: ${waitUrl}`;
  }
  function waitConfirmText(state, wait, position, waitUrl) {
    return `[헤어원네스트] 대기 접수: ${wait.service}, ${waitWhen(wait)}. 같은 조건 대기 ${position}번째. 자리가 나면 줄 앞 ${NOTIFY_LIMIT}분께 한꺼번에 문자를 드려요 (예약은 네이버 선착순).\n바꾸기·빼기: ${waitUrl}`;
  }

  // ---- 저장 ---------------------------------------------------------------

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(raw) {
    if (!raw) return createState();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return createState(); }
    if (!parsed || !Array.isArray(parsed.customers)) return createState();
    return migrate(parsed);
  }

  // 이전 버전(자유 메모 한 칸: memos[].text)을 방문 기록(visits[].done)으로 옮긴다.
  function migrate(p) {
    const customers = p.customers.map(({ last4, ...c }) => ({
      ...c, phone: c.phone ?? last4 ?? '', referrer: c.referrer ?? '', isLegacy: !!c.isLegacy, profile: c.profile ?? emptyProfile(), profileHistory: c.profileHistory ?? [], deletedAt: c.deletedAt ?? null,
      photoConsent: c.photoConsent && typeof c.photoConsent.at === 'string' ? { at: c.photoConsent.at } : null,
      familyId: Number.isInteger(c.familyId) ? c.familyId : null,
    }));
    // 사진: 옛 백업에는 없다. 모양이 안 맞는 줄은 버린다.
    const photos = (p.photos ?? []).filter(x => x && typeof x.id === 'number' && typeof x.customerId === 'number' && typeof x.visitId === 'number' && typeof x.path === 'string')
      .map(x => ({ id: x.id, customerId: x.customerId, visitId: x.visitId, path: x.path, w: Number(x.w) || 0, h: Number(x.h) || 0, bytes: Number(x.bytes) || 0, createdAt: x.createdAt ?? '' }));
    const fromMemos = (p.memos ?? []).map(m => ({
      id: m.id, customerId: m.customerId, done: m.text, next: '', createdAt: m.createdAt,
      history: (m.history ?? []).map(h => ({ done: h.text, next: '', replacedAt: h.replacedAt })),
    }));
    const visits = [...(p.visits ?? []), ...fromMemos].map(v => ({ ...v, deletedAt: v.deletedAt ?? null, kinds: Array.isArray(v.kinds) ? v.kinds.filter(k => KINDS.includes(k)) : [] }));
    const today = migrateToday(p.today);
    const settings = migrateSettings(p.settings);
    const passes = (p.passes ?? []).filter(x => x && typeof x.customerId === 'number' && (x.kind === 'charge' || x.kind === 'use'))
      .map(x => ({ id: x.id, customerId: x.customerId, kind: x.kind, amount: Number(x.amount) || 0, note: x.note ?? '', at: x.at ?? '', visitId: x.visitId ?? null }));
    // 제품·재고 기록 (V3). 옛 백업에는 없다. 모양이 안 맞는 줄은 버리고, 모르는 분류는 '기타'로.
    const products = (p.products ?? []).filter(x => x && typeof x.id === 'number' && typeof x.name === 'string' && x.name).map(x => {
      const mn = Number(x.min);
      return { id: x.id, name: x.name, category: STOCK_CATEGORIES.includes(x.category) ? x.category : '기타', qty: Math.max(0, Math.trunc(Number(x.qty) || 0)),
        min: x.min === null || x.min === undefined || x.min === '' || !Number.isInteger(mn) || mn < 0 ? 1 : mn,
        link: typeof x.link === 'string' ? x.link : '', alarm: x.alarm === undefined ? true : !!x.alarm,
        supplier: typeof x.supplier === 'string' ? x.supplier : '', fillTo: (v => (Number.isInteger(v) && v > 0 ? v : 0))(Number(x.fillTo ?? x.orderQty)),   // 10-06~08 백업은 orderQty
        orderedAt: typeof x.orderedAt === 'string' && x.orderedAt ? x.orderedAt : null, deletedAt: x.deletedAt ?? null };
    });
    const stockLogs = (p.stockLogs ?? []).filter(x => x && typeof x.id === 'number' && typeof x.productId === 'number' && (x.kind === 'in' || x.kind === 'count'))
      .map(x => ({ id: x.id, productId: x.productId, kind: x.kind, qty: Number(x.qty) || 0, before: Number(x.before) || 0, after: Number(x.after) || 0, at: x.at ?? '', note: x.note ?? '' }));
    // 취소 기록 (V4, 10-11). 옛 백업에는 없다. 날짜가 없거나 이상한 줄은 버리고, 채워짐 값이 이상하면 모름으로
    const cancels = (p.cancels ?? []).filter(x => x && typeof x.id === 'number' && cleanCancelDate(x.date))
      .map(x => ({ id: x.id, date: cleanCancelDate(x.date), time: typeof x.time === 'string' ? x.time : '', service: typeof x.service === 'string' ? x.service : '',
        minutes: Number.isInteger(x.minutes) && x.minutes > 0 ? x.minutes : null, daysBefore: Number.isInteger(x.daysBefore) && x.daysBefore >= 0 ? x.daysBefore : null,
        filled: FILLED.includes(x.filled) ? x.filled : 'unknown', filledIn: typeof x.filledIn === 'string' ? x.filledIn : '', note: typeof x.note === 'string' ? x.note : '', at: typeof x.at === 'string' ? x.at : '' }));
    // 예약 대기 (C안, 10-11). 이름·번호·시술·날짜가 없는 줄은 버린다. 상태를 모르면 waiting, 시간대·요일 모양이 틀리면 전부
    const waitlist = (p.waitlist ?? []).filter(x => x && typeof x.id === 'number' && typeof x.name === 'string' && x.name && typeof x.phone === 'string' && typeof x.service === 'string' && cleanCancelDate(x.dateFrom) && cleanCancelDate(x.dateTo))
      .map(x => ({ id: x.id, name: x.name, phone: digitsOnly(x.phone), service: x.service, minutes: Number.isInteger(x.minutes) && x.minutes > 0 ? x.minutes : (serviceMinutes({ settings }, x.service) ?? null),
        dateFrom: cleanCancelDate(x.dateFrom), dateTo: cleanCancelDate(x.dateTo), windows: cleanWindows(x.windows).length ? WINDOW_KEYS.filter(k => cleanWindows(x.windows).includes(k)) : [...WINDOW_KEYS],
        days: cleanDays(x.days).length ? cleanDays(x.days) : cleanDays(x.windows).length ? cleanDays(x.windows) : [...DAY_KEYS],   // 표에서는 windows 열에 함께 온다. 10-23 전 대기는 평일·주말 둘 다
        note: typeof x.note === 'string' ? x.note : '', code: String(x.code ?? ''), status: WAIT_STATUS.includes(x.status) ? x.status : 'waiting', createdAt: typeof x.createdAt === 'string' ? x.createdAt : '',
        notified: (Array.isArray(x.notified) ? x.notified : []).filter(n => n && typeof n.cancelId === 'number').map(n => ({ cancelId: n.cancelId, at: typeof n.at === 'string' ? n.at : '' })) }));
    return { nextId: p.nextId ?? 1, customers, visits, passes, settings, today, photos, products, stockLogs, cancels, waitlist };
  }

  function migrateSettings(v) {
    const d = defaultSettings();
    if (!v || typeof v !== 'object') return d;
    return {
      head: typeof v.head === 'string' ? v.head : d.head,
      tail: typeof v.tail === 'string' ? v.tail : d.tail,
      products: (Array.isArray(v.products) ? v.products : []).filter(p => p && p.name).map(p => ({
        name: String(p.name), amount: Number(p.amount) || 0, terms: String(p.terms ?? ''), gift: String(p.gift ?? ''),
      })),
      // 재고를 센 시각(차이가 없어 기록이 안 남은 달을 위해). 정착 기준일·주기 배수도 적혀 있으면 지킨다.
      ...(typeof v.lastCountAt === 'string' && v.lastCountAt ? { lastCountAt: v.lastCountAt } : {}),
      ...(Array.isArray(v.suppliers) ? { suppliers: [...new Set(v.suppliers.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))] } : {}),   // 거래처 단추(10-08)
      ...(typeof v.preBookText === 'string' && v.preBookText.trim() ? { preBookText: v.preBookText } : {}),   // 선예약 문구(10-09)
      ...(v.preBookMarks && typeof v.preBookMarks === 'object' ? { preBookMarks: { in: (v.preBookMarks.in ?? []).filter(Number.isInteger), out: (v.preBookMarks.out ?? []).filter(Number.isInteger) } } : {}),
      ...(v.preBookLog && typeof v.preBookLog === 'object' ? { preBookLog: keepPreBookLog(v.preBookLog) } : {}),
      ...(typeof v.orderHead === 'string' && v.orderHead.trim() ? { orderHead: v.orderHead } : {}),
      ...(v.remindOff === true ? { remindOff: true } : {}),
      ...(v.familyRoles && typeof v.familyRoles === 'object' ? { familyRoles: Object.fromEntries(Object.entries(v.familyRoles).filter(([k, r]) => /^\d+$/.test(k) && typeof r === 'string' && r.trim())) } : {}),   // 가족 관계(10-24)   // 예약 알림톡 멈춤(10-21)
      ...(v.orderedQtys && typeof v.orderedQtys === 'object' ? { orderedQtys: Object.fromEntries(Object.entries(v.orderedQtys).filter(([k, n]) => /^\d+$/.test(k) && Number.isInteger(n) && n >= 0)) } : {}),   // 주문한 개수(10-15)   // 주문 글 첫 줄(10-06)
      ...(cleanServices(v.serviceTimes).length ? { serviceTimes: cleanServices(v.serviceTimes) } : {}),   // 시술 시간표(10-11, 이름·분). 망가졌으면 기본값
      ...(typeof v.bookingUrl === 'string' && v.bookingUrl.trim() ? { bookingUrl: v.bookingUrl.trim() } : {}),   // 네이버 예약 주소(문자에 넣음)
      ...(Number.isFinite(Number(v.retentionDays)) && v.retentionDays !== undefined ? { retentionDays: Number(v.retentionDays) } : {}),
      ...(Number.isFinite(Number(v.overdueFactor)) && v.overdueFactor !== undefined ? { overdueFactor: Number(v.overdueFactor) } : {}),
    };
  }

  // 옛 백업은 오늘 명단이 번호 목록(customerIds)이었다. 시간 없는 줄로 옮긴다.
  function migrateToday(t) {
    if (!t || typeof t.date !== 'string') return { date: '', entries: [] };
    if (Array.isArray(t.entries)) {
      // 항목마다 날짜. 옛 백업(항목에 날짜 없음)은 그 명단의 날짜를 붙인다.
      return { date: t.date, entries: t.entries.filter(e => e && typeof e.customerId === 'number').map(e => ({ customerId: e.customerId, at: e.at ?? '', date: typeof e.date === 'string' && e.date ? e.date : t.date, service: typeof e.service === 'string' ? e.service : '' })) };
    }
    if (Array.isArray(t.customerIds)) {
      return { date: t.date, entries: t.customerIds.map(id => ({ customerId: id, at: '', date: t.date, service: '' })) };
    }
    return { date: '', entries: [] };
  }

  return { KINDS, sampleState, WAIT_WINDOWS, WAIT_DAYS, windowOf, windowLabels, dayLabels, dayKindOf, waitMonths, monthLabel, waitWhen, waitWindowsCol, addWait, leaveWait, bookWait, expireWaits, sweepWaits, waitsOf, waitQueue, waitPosition, matchWaiters, NOTIFY_LIMIT, WAIT_MAX_PER_PHONE, markNotified, noticeText, waitConfirmText, setBookingUrl, bookingUrlOf, clockLabel, dayLabel, DEFAULT_SERVICES, serviceList, addServiceTime, serviceGroups, servicesInGroup, serviceGroupOf, setServices, editServices, serviceMinutes, parseCancelText, addCancel, editCancel, setCancelFilled, deleteCancel, cancelList, cancelSummary, STOCK_CATEGORIES, addProduct, editProduct, deleteProduct, restoreProduct, liveProducts, deletedProducts, parseStockText, stockIn, stockCount, markOrdered, unmarkOrdered, markArrived, markArrivedMany, shortProducts, orderedProducts, lastCountDate, countDue, stockLogsOf, supplierNames, stockSheet, monthlyUsage, fillSuggestion, fillSuggestions, supplierList, addSupplier, removeSupplier, DEFAULT_SUPPLIERS, orderGroups, orderMessage, orderAmount, setOrderHead, markOrderedMany, ORDER_HEAD, cleanDate: visitDate, noteLines, noteOutline, noteInline, noteNumbered, noteLabel, noteTidy, NOTE_LABELS, splitSections, joinSections, SECTIONS, cycleSpan, cycleDue, recommendedCycle, monthlyStats, retention, overdueCustomers, customerCounts, trendMonths, recentNewCustomers, newCustomersInMonth, dueCustomers, passHolders, reminderList, remindStatusOf, remindReport, reminderText, REMIND_TEMPLATE, REMIND_SMS_TEMPLATE, timeKo, setRemindOff, preBookDates, preBookTargets, setPreBookMark, preBookMarkOf, markPreBook, preBookMessage, setPreBookText, PREBOOK_TEXT, setPreBookPick, preBookPickOf, preBookNeedsPick, dateKo, setPassBalance, createState, timeSlots, timeline, TIMELINE_SLOTS, TIMELINE_KEEP_DAYS, setTodayService, formatWon, comma, buildNotice, noticeRemain, noticeUsed, setSettings, rememberProduct, findProduct, cleanAmount, kindOfService, bookedService, chargePass, usePass, deletePass, passEntriesOf, passBalance, passSummary, familyOf, joinFamily, leaveFamily, familyRep, setFamilyRep, familyRoleOf, setFamilyRole, addFamilyMember, totalPassBalance, visitsWithGaps, visitCycle, addCustomer, editCustomer, deleteCustomer, restoreCustomer, purgeCustomer, deletedCustomers, maskPhone, findCustomers, setProfile, addVisit, editVisit, deleteVisit, restoreVisit, purgeVisit, deletedVisitsOf, sweepDeletedVisits, daysLeftInTrash, visitsOf, markToday, setTodayTime, unmarkToday, swapTodayEntry, standInFor, todayList, pendingList, rollToday, bookingSummary, splitNamePhone, setPhotoConsent, addPhoto, removePhoto, photosOf, PHOTO_LIMIT, serialize, deserialize };
})();

if (typeof module !== 'undefined') module.exports = Store;
