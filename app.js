// 화면 연결. 규칙은 전부 store.js에 있고, 여기서는 그리기와 이벤트만 다룬다.
(() => {
  const KEY = 'haironenest-card:v1';
  // ?local=1 이면 서버 대신 이 브라우저 저장소를 쓴다 (시험용·비상용).
  const USE_LOCAL = new URLSearchParams(location.search).has('local');
  let state = Store.createState();
  let view = { kind: 'today' }; // { kind: 'today' } | { kind: 'card', id } | { kind: 'monthly', month } | { kind: 'stock' } | { kind: 'customers' } | { kind: 'soon', what }
  let editingVisitId = null;
  let editingProfile = false;
  let editingIdentity = false;
  let trashOpen = false;
  let visitTrashOpen = false;
  let passForm = null;   // null | 'charge'  ([사용]은 10-09에 뺐다: 차감은 안내문 한 곳에서만)
  let passOpen = false;
  let noticeOpen = false;
  let cardTab = 'today';   // 'today' | 'history'
  let pendingDate = null;  // 지난 명단에서 열었으면 그 날짜. 오늘 적는 칸의 날짜가 그날로 맞춰진다
  // V3 재고 화면. 적던 글은 다시 그려도 남는다 (명단의 이름 칸과 같은 이유).
  let stock = { mode: 'count', text: '', date: '', editId: null, addOpen: false, tab: null, cat: '', sheetEnd: null, arriveId: null, msg: '', orderQtys: {}, arrive: {} };   // arrive: 도착 체크한 제품 {제품번호: 들어온 개수 글자}(10-15)   // orderQtys: 이번만 바꾼 주문 수량 {제품번호: 글자}
  let reserve = { text: '', msg: '', editId: null, servicesOpen: false, tab: 'cancel' };   // 예약관리: 취소 적는 칸의 글, 고치는 중인 기록, 시술 시간표 펼침, 보고 있는 칸(10-23 원장: 아이콘으로 하나씩)
  let custQ = '';          // 고객 관리의 찾기 글자(다시 그려도 남게)
  let preBook = { edit: false, open: false, manage: false, q: '' };   // 선예약: 문구 고치는 중 · 끝난 상자 펼침 · 고객 관리에서 대상 고치기 · 대상 찾기 글자
  let checksHint = '';     // "오늘 확인할 것"에서 연결 전인 줄을 눌렀을 때 보여 줄 설명

  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, '0');
  const now = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const today = () => now().slice(0, 10);
  const fmt = (iso) => `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
  const esc = (s) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const customerOf = (id) => state.customers.find((c) => c.id === id);

  // ---- 저장소: 서버(DB) 또는 브라우저(Local) — 같은 모양 ------------------
  const PHOTO_KEY = 'haironenest-card:photos';   // 시험 모드 사진(데이터 URL). 서버 모드에서는 창고에 있다
  const localPhotos = () => { try { return JSON.parse(localStorage.getItem(PHOTO_KEY)) || {}; } catch { return {}; } };
  const Local = {
    async session() { return true; },
    async login() {}, async logout() {},
    async load() { return Store.deserialize(localStorage.getItem(KEY)); },
    async save(prev, next) {
      localStorage.setItem(KEY, Store.serialize(next));
      const gone = (prev.photos ?? []).filter((p) => !(next.photos ?? []).some((q) => q.id === p.id));
      if (gone.length) { const all = localPhotos(); gone.forEach((p) => delete all[p.path]); localStorage.setItem(PHOTO_KEY, JSON.stringify(all)); }
    },
    async replaceAll(next) { localStorage.setItem(KEY, Store.serialize(next)); },
    async putPhoto(path, blob) {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      const all = localPhotos(); all[path] = dataUrl;
      try { localStorage.setItem(PHOTO_KEY, JSON.stringify(all)); } catch { throw new Error('시험 모드의 사진 공간이 찼습니다. 사진을 몇 장 지우세요'); }
    },
    async photoUrl(path) { const u = localPhotos()[path]; if (!u) throw new Error('사진 파일이 없습니다'); return u; },
  };
  const storage = USE_LOCAL ? Local : DB;
  let pendingSaves = 0;
  function showSync(text, kind) { const el = $('#sync'); el.textContent = text; el.className = `sync ${kind ?? ''}`; el.hidden = !text; }

  function commit(next) {
    const prev = state;
    state = next;
    pendingSaves += 1; showSync('저장 중…');
    storage.save(prev, next)
      .then(() => { pendingSaves -= 1; if (pendingSaves === 0) showSync(''); })
      .catch((err) => { pendingSaves -= 1; showSync(`서버 저장 실패: ${err.message} — 인터넷을 확인하고 새로고침하세요`, 'error'); });
  }
  // ---- 적다 만 글 (임시 보관) ---------------------------------------------
  // 상담하며 조각조각 채우는 동안 화면을 다시 그려도, 다른 카드에 갔다 와도, 새로고침해도 남는다.
  // 서버에는 [방문 기록 저장]을 눌렀을 때만 간다. 이 컴퓨터 브라우저 안에만 둔다.
  const DRAFT_KEY = 'haironenest-card:drafts';
  let drafts = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; } })();
  function persistDrafts() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch {} }
  const draftOf = (id) => drafts[id] ?? null;
  function saveDraft() {
    if (view.kind !== 'card' || !$('#visit-form')) return;
    const d = { date: $('#visit-date').value, done: $('#visit-done').value, kinds: readChips('visit-kind'), next: '' };
    if (!d.done.trim() && d.kinds.length === 0) delete drafts[view.id];
    else drafts[view.id] = d;
    persistDrafts();
  }
  function clearDraft(id) { delete drafts[id]; persistDrafts(); }

  // 적다 만 글이 있는 카드도 '고치는 중'이다. 창을 다시 잡아도 서버에서 다시 읽어 덮지 않는다.
  const isEditing = () => svcMgr !== null || famAdd !== null || editingVisitId !== null || editingProfile || editingIdentity || passForm !== null || noticeOpen || (view.kind === 'card' && !!drafts[view.id])
    || (view.kind === 'stock' && (stock.editId !== null || stock.addOpen || stock.arriveId !== null || Object.keys(stock.arrive).length > 0 || !!stock.text.trim()))
    || (view.kind === 'reserve' && (reserve.editId !== null || !!reserve.text.trim()))
    || !!document.activeElement?.classList?.contains('pb-pick')   // 선예약 추천 날짜를 적는 중
    || !!($('#add-name')?.value.trim() || $('#add-at')?.value || $('#add-grp')?.value);   // 타임테이블 올리는 칸에 시간·시술·이름을 넣는 중
  function showMsg(el, text, kind) { if (el) { el.textContent = text; el.className = `msg ${kind}`; } }
  // 카드를 여는 것과 오늘 명단에 올리는 것은 다른 일이다. 지난 기록을 뒤늦게 적으려고
  // 왼쪽에서 연 고객이 오늘 명단에 끼면 안 되니, 명단에 올리는 길은 오른쪽 위 칸과 [오늘] 버튼뿐이다.
  // 핸드폰(좁은 화면)에서는 오늘 명단이 위, 카드가 아래다. 이름을 눌러도 카드가 화면 밖에 열려서
  // 명단이 긴 날은 한참 내려야 했다. 좁은 화면일 때만 그 자리로 데려간다. 매장 PC 화면은 그대로.
  const isNarrow = () => window.matchMedia('(max-width: 800px)').matches;
  function bringIntoView(sel) {
    if (!isNarrow()) return;
    const el = $(sel);
    // 부드럽게 움직이는 방식은 화면이 가려져 있거나 절전 중이면 안 움직일 때가 있어 바로 옮긴다
    if (el) el.scrollIntoView({ block: 'start' });
  }
  function openCard(id, date) { if (view.kind !== 'card' || view.id !== id) { clearPending(); famAdd = null; } view = { kind: 'card', id }; editingVisitId = null; editingProfile = false; editingIdentity = false; passForm = null; passOpen = false; noticeOpen = false; cardTab = 'today'; pendingDate = date || null; render(); }

  // ---- 고객 관리(10-08 원장): 찾기 결과 목록. 칸 전체를 다시 그리면 커서가 날아가니 목록만 다시 그린다 ----
  function renderCustomers() {
    const list = $('#cm-list');
    if (!list) return;
    const q = custQ.trim();
    if (!q) { list.innerHTML = ''; return; }
    const found = Store.findCustomers(state, q);
    if (found.length === 0) {
      list.innerHTML = `<li class="empty">찾는 고객이 없습니다. <button type="button" class="link small" data-reg-name="${esc(q)}">"${esc(q)}" 새 고객으로 등록</button></li>`;
      return;
    }
    const todayIds = state.today.date === today() ? state.today.entries.map((e) => e.customerId) : [];
    list.innerHTML = found.map((c) => {
      const last = Store.visitsOf(state, c.id)[0];
      return `
      <li data-open="${c.id}">
        <span>${esc(c.name)} <small>${esc(Store.maskPhone(c.phone))}${last ? ` · 지난 방문 ${last.createdAt.slice(0, 10).replace(/-/g, '.')}` : ' · 아직 기록 없음'}</small></span>
        ${todayIds.includes(c.id) ? '<small>오늘</small>' : `<button type="button" class="small secondary" data-today="${c.id}">오늘</button>`}
      </li>`;
    }).join('');
  }

  // 명단에 올릴 때 고르는 시술(10-13). 시술 시간표의 이름. 안 골라도 된다
  // 시술항목 고르기(10-13 원장: "시술 안 고름" 대신 "시술항목", 손님 올리는 칸에는 맨 아래 [+ 시술항목 추가])
  const ADD_SVC = '__add';
  const svcLabel = (x) => `${esc(x.name)} ${durLabel(x.minutes)}`;
  // 카드 첫 줄처럼 칸 하나만 있을 때: 분류별로 묶은 목록(optgroup)
  const svcOptions = (selected) => `<option value="">시술항목</option>` + Store.serviceGroups(state).map((g) => `<optgroup label="${esc(g)}">${Store.servicesInGroup(state, g).map((x) => `<option value="${esc(x.name)}" ${x.name === selected ? 'selected' : ''}>${svcLabel(x)}</option>`).join('')}</optgroup>`).join('');
  // 손님 올리는 칸(10-13 원장): 분류를 먼저 고르면 옆 칸에 그 분류의 시술만 나온다. 맨 아래 [+ 시술항목 추가]
  const grpOptions = (selected) => `<option value="">시술항목</option>` + Store.serviceGroups(state).map((g) => `<option value="${esc(g)}" ${g === selected ? 'selected' : ''}>${esc(g)}</option>`).join('') + `<option value="${ADD_SVC}">+ 새 분류 추가</option>`;
  const subOptions = (group, selected) => {
    const list = group ? Store.servicesInGroup(state, group) : [];
    return (list.length > 1 ? `<option value="">${esc(group)} 중에서</option>` : '') + list.map((x) => `<option value="${esc(x.name)}" ${x.name === selected ? 'selected' : ''}>${svcLabel(x)}</option>`).join('')
      + (group ? `<option value="${ADD_SVC}">+ ${esc(group)}에 추가</option>` : '');   // 10-13 원장: 분류 안의 하위 시술도 직접 더하기
  };
  const groupOfService = (name) => { const x = Store.serviceList(state).find((y) => y.name === name); return x ? Store.serviceGroupOf(x) : ''; };
  const durLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
  const DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
  // 시술항목 관리(10-16 원장: 더하기·고치기·지우기를 한곳에서). 열리면 시간표를 복사한 줄들을 고치고 [저장]에서 한 번에 바꾼다.
  // rows: [{k, from(원래 이름, 새 줄은 ''), group, name, minutes}] — 치는 대로 여기에 담아 다시 그려도 남는다. null이면 닫힘.
  let svcMgr = null;
  let svcMgrKey = 0;
  function openSvcMgr(addTo) {
    if (!svcMgr) svcMgr = { rows: Store.serviceList(state).map((x) => ({ k: ++svcMgrKey, from: x.name, group: Store.serviceGroupOf(x), name: x.name, minutes: String(x.minutes), price: x.price ? Store.comma(x.price) : '' })) };
    let focusK = null;
    if (addTo !== undefined) {   // '' = 새 분류, 그 밖 = 그 분류에 새 줄
      const groups = new Set(svcMgr.rows.map((r) => r.group));
      let g = addTo;
      if (!g) { g = '새 분류'; for (let i = 2; groups.has(g); i++) g = `새 분류 ${i}`; }
      const row = { k: ++svcMgrKey, from: '', group: g, name: '', minutes: '', price: '' };
      // 그 분류 마지막 줄 뒤에 넣는다(분류 순서 그대로)
      const last = svcMgr.rows.map((r) => r.group).lastIndexOf(g);
      svcMgr.rows.splice(last < 0 ? svcMgr.rows.length : last + 1, 0, row);
      focusK = row.k;
      svcMgr.focus = !addTo ? `g:${g}` : `n:${row.k}`;
    }
    return focusK;
  }
  function renderSvcMgr() {
    if (!svcMgr) return '';
    const groups = [...new Set(svcMgr.rows.map((r) => r.group))];
    const minOpts = (m) => { const list = DURATIONS.includes(Number(m)) || !m ? DURATIONS : [...DURATIONS, Number(m)].sort((a, b) => a - b); return `<option value="">시간</option>${list.map((x) => `<option value="${x}" ${String(x) === String(m) ? 'selected' : ''}>${durLabel(x)}</option>`).join('')}`; };
    const grpOpts = (g) => groups.map((x) => `<option value="${esc(x)}" ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
    return `
      <div class="svc-mgr" id="svc-mgr">
        <div class="svc-mgr-head"><b>시술항목 관리</b><small>이름 · 걸리는 시간 · 금액을 여기 한 곳에서 고칩니다(예약·알림톡·대기·정액권 안내문이 모두 이 목록을 씁니다). 컷+클리닉처럼 함께 하는 시술은 한 항목으로 만드세요. ▲▼ 순서대로 고르는 칸에 나옵니다. [저장]을 눌러야 바뀝니다.</small></div>
        ${groups.map((g, gi) => {
          const rows = svcMgr.rows.filter((r) => r.group === g);
          const mv = (act, key, val, on, label, title) => `<button type="button" class="mv" data-mgr="${act}" data-${key}="${val}" ${on ? '' : 'disabled'} title="${title}">${label}</button>`;
          return `
          <div class="svc-g">
            <div class="svc-g-head">${mv('g-up', 'grp', esc(g), gi > 0, '▲', '분류를 위로')}${mv('g-down', 'grp', esc(g), gi < groups.length - 1, '▼', '분류를 아래로')}<input type="text" class="svc-g-name" data-grp="${esc(g)}" value="${esc(g)}" title="분류 이름 (고치면 이 분류의 시술이 모두 따라갑니다)" autocomplete="off"><small>${rows.length}개</small><button type="button" class="link small danger" data-mgr="del-group" data-grp="${esc(g)}">분류 지우기</button></div>
            ${rows.map((r, ri) => `
              <div class="svc-m-row" data-k="${r.k}">
                ${mv('up', 'k', r.k, ri > 0, '▲', '위로')}${mv('down', 'k', r.k, ri < rows.length - 1, '▼', '아래로')}
                <input type="text" class="svc-m-name" data-k="${r.k}" value="${esc(r.name)}" placeholder="시술 이름 (예: ${g === '커트' ? '남성 컷' : g === '펌' ? '볼륨펌' : g === '염색' ? '새치 염색' : '두피 스파'})" autocomplete="off">
                <select class="svc-m-min" data-k="${r.k}" title="걸리는 시간 (타임테이블 막대 길이)">${minOpts(r.minutes)}</select>
                <input type="text" class="svc-m-price" data-k="${r.k}" value="${esc(r.price)}" inputmode="numeric" placeholder="금액" title="금액 — 정액권 안내문에서 누르면 채워집니다 (안 적어도 됨)" autocomplete="off">
                ${groups.length > 1 ? `<select class="svc-m-grp" data-k="${r.k}" title="다른 분류로 옮기기">${grpOpts(g)}</select>` : ''}
                <button type="button" class="link small danger" data-mgr="del" data-k="${r.k}">삭제</button>
              </div>`).join('')}
            <button type="button" class="link small" data-mgr="add" data-grp="${esc(g)}">+ ${esc(g)}에 추가</button>
          </div>`;
        }).join('')}
        <div class="svc-mgr-foot">
          <button type="button" class="small secondary" data-mgr="add-group">+ 새 분류</button>
          <span class="msg" id="svc-mgr-msg"></span>
          <button type="button" class="small secondary" data-mgr="cancel">취소</button>
          <button type="button" class="small" data-mgr="save">저장</button>
        </div>
      </div>`;
  }
  function redrawSvcMgr() {
    const box = $('#svc-mgr-slot'); if (!box) return;
    box.innerHTML = renderSvcMgr();
    const f = svcMgr?.focus; if (!f) return;
    svcMgr.focus = null;
    const el = f.startsWith('g:') ? [...document.querySelectorAll('.svc-g-name')].find((x) => x.dataset.grp === f.slice(2)) : $(`.svc-m-name[data-k="${f.slice(2)}"]`);
    if (el) { el.focus(); if (f.startsWith('g:')) el.select(); }
  }
  function saveSvcMgr() {
    try {
      const added = svcMgr.rows.filter((r) => !r.from && r.name.trim());
      const r = Store.editServices(state, svcMgr.rows.map((x) => ({ from: x.from, group: x.group, name: x.name, minutes: x.minutes, price: x.price })));
      commit(r.state); svcMgr = null; render();
      const orphans = r.orphans.filter((e) => e.date >= today());
      if (added.length === 1) { const g = added[0].group; $('#add-grp').value = g; $('#add-svc').innerHTML = subOptions(g, added[0].name.trim()); $('#add-svc').hidden = false; $('#add-svc').value = added[0].name.trim(); }
      showMsg($('#today-msg'), `시술항목을 저장했습니다${added.length === 1 ? ` — ${added[0].name.trim()}을 골라 두었습니다` : ''}${orphans.length ? ` · 지운 시술로 올려 둔 예약 ${orphans.length}건은 시술 이름만 남습니다(카드에서 시술을 다시 고르세요)` : ''}`, orphans.length ? 'draft' : 'ok');
    } catch (err) { showMsg($('#svc-mgr-msg'), err.message, 'error'); }
  }
  function timeOptions(selected) {
    const slots = Store.timeSlots();
    const all = slots.includes(selected) || !selected ? slots : [...slots, selected].sort();
    return `<option value="">시간 없음</option>` +
      all.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`).join('');
  }

  // 지운 기록이 저절로 없어지기까지 남은 날.
  function leftText(left) {
    if (left === null) return '';
    return left === 0 ? '오늘 사라짐' : `${left}일 뒤 사라짐`;
  }

  // 정액권 상자. 잔액과 [충전], 그리고 접어둔 내역. 차감은 아래 안내문 한 곳에서만(10-09 원장: [사용] 단추를 뺐다 — 두 곳에서 빼면 두 번 빠진다).
  function renderPass(c) {
    const sum = Store.passSummary(state, c.id);
    const won = Store.formatWon;
    const form = passForm === null ? '' : `
      <div class="pass-form">
        <div class="row">
          <input type="text" id="pass-amount" inputmode="numeric" placeholder="충전할 금액 (예: 30만)" autocomplete="off">
          <input type="text" id="pass-note" placeholder="메모 (비워도 됨)" autocomplete="off">
          <button type="button" class="secondary" data-action="pass-cancel">취소</button>
          <button type="button" data-action="pass-save">충전</button>
        </div>
        <div class="msg" id="pass-msg"></div>
      </div>`;
    const list = Store.passEntriesOf(state, c.id);
    const fam = Store.familyOf(state, c.id);
    const famOn = fam.length > 1;
    return `
      <div class="pass">
        <div class="row">
          <div><b>${famOn ? '가족 정액권' : '정액권'}</b> <span class="amount ${sum.balance > 0 ? 'has' : ''}">${won(sum.balance)}</span>${famOn ? ` <small class="fam-names">${fam.map((x) => esc(x.name)).join(' · ')} 함께</small>` : ''}</div>
          <button type="button" class="small secondary" data-action="pass-charge">충전</button>
        </div>
        ${form}
        <p class="note">돈 계산의 원본은 핸드SOS입니다. 여기 숫자는 시술 중에 보려고 옮겨 적는 것입니다.</p>
        ${sum.count === 0 ? '' : `
          <details class="pass-list" ${passOpen ? 'open' : ''}>
            <summary>내역 ${sum.count}건 · 넣은 돈 ${won(sum.charged)} · 쓴 돈 ${won(sum.used)}</summary>
            ${list.map((e) => `
              <div class="pass-row">
                <span class="when">${fmt(e.at)}</span>
                <span class="kind ${e.kind}">${e.kind === 'charge' ? '충전' : '사용'}</span>
                ${famOn ? `<span class="who">${esc(nameOfCustomer(e.customerId))}</span>` : ''}
                <span class="won ${e.kind}">${e.kind === 'charge' ? '+' : '-'}${won(e.amount)}</span>
                <span class="memo">${esc(e.note)}</span>
                <button type="button" class="link danger" data-action="pass-del" data-id="${e.id}">지우기</button>
              </div>`).join('')}
          </details>`}
      </div>`;
  }

  // ---- 안내문 "오늘 시술": 분류 카드 → 세부 시술 (10-24 원장) -------------------
  // 목록은 시술 시간표 하나(이름·걸리는 시간·금액). 분류(커트·펌·염색…)를 누르면 그 분류 시술이 나오고, 누르면 이름·금액이 채워진다.
  // 고치는 곳은 타임테이블 옆 [시술항목 관리] 한 곳. 이 칸만 다시 그린다(안내문에 적던 줄이 날아가지 않게).
  let svcCat = null;   // 펼친 분류
  let famAdd = null;   // 카드의 [+ 가족 추가] 칸: {name, role} — 치는 대로 담아 다시 그려도 남는다. null이면 닫힘(10-24)
  function svcInner() {
    const list = Store.serviceList(state);
    const groups = Store.serviceGroups(state);
    if (svcCat !== null && !groups.includes(svcCat)) svcCat = null;
    const cats = groups.map((g) => `<button type="button" class="svc-cat ${svcCat === g ? 'on' : ''}" data-svc-cat="${esc(g)}">${esc(g)} <small>${Store.servicesInGroup(state, g).length}</small></button>`).join('');
    const sub = svcCat === null ? '' : `<div class="svc-sub">${list.map((x, i) => (Store.serviceGroupOf(x) === svcCat ? `<button type="button" class="svc-chip" data-svc="${i}">${esc(x.name)} <small>${x.price ? Store.comma(x.price) : '금액 없음'}</small></button>` : '')).join('')}</div>`;
    return `
        <div class="svc-cats">${cats}<button type="button" class="link small" data-svc-act="manage">시술·금액 고치기</button></div>
        ${svcCat === null ? '<p class="hint svc-pick">분류를 누르면 세부 시술이 나옵니다</p>' : ''}
        ${sub}`;
  }
  function renderServices(where) {
    return `<div class="svc svc-box" data-where="${where}">${svcInner()}</div>`;
  }
  function refreshServices() {
    for (const el of document.querySelectorAll('.svc-box')) el.innerHTML = svcInner();
  }
  // 안내문 "오늘 시술": 비어 있는 첫 줄을 채우고, 없으면 한 줄 더한다.
  function useService(sv) {
    const box = $('#notice-items');
    let row = [...box.querySelectorAll('.notice-item')].find((r) => !r.querySelector('.it-name').value.trim() && !r.querySelector('.it-amt').value.trim());
    if (!row) { row = noticeRow(); box.appendChild(row); }
    row.querySelector('.it-name').value = sv.name;
    row.querySelector('.it-amt').value = sv.price ? Store.comma(sv.price) : '';
    refreshNotice();
  }

  // ---- 정액권 안내문 만들기 ------------------------------------------------
  // 손님에게 보낼 문자를 여기서 만들어 복사한다. 고객 이름과 잔액은 이미 카드에
  // 있으니 다시 적지 않는다. 글자를 칠 때마다 카드 전체를 다시 그리면 커서가
  // 날아가므로, 아래 refreshNotice가 미리보기와 합계만 바꾼다.

  const digitsOf = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

  function renderNotice(c) {
    const st = state.settings;
    const bal = Store.passBalance(state, c.id);
    return `
      <details class="notice" ${noticeOpen ? 'open' : ''}>
        <summary>정액권 안내문 만들기 <small>${isFamily(c.id) ? '가족 잔액' : '잔액'} ${Store.formatWon(bal)}</small></summary>
        <div class="notice-body">
          <div class="date-row">
            <label style="margin:0">시술·사용 날짜</label>
            <input type="date" id="notice-date" value="${today()}" max="${today()}">
            <small>문자에 적히고, 정액권 내역에도 이 날짜로 남습니다</small>
          </div>
          <label style="margin-top:0">지금 남은 잔액 (시술 전, 핸드SOS 기준)</label>
          <div class="row">
            <input type="text" id="notice-prev" class="won" inputmode="numeric" value="${bal > 0 ? Store.comma(bal) : ''}" placeholder="예: 300000 (카드 만들기 전에 끊은 정액권이면 여기 적으세요)" autocomplete="off">
          </div>
          <p class="hint">카드가 아는 잔액은 ${Store.formatWon(bal)}입니다. 다르게 적으면 [복사하고 정액권에 반영]할 때 카드 잔액을 이 금액에 맞춘 뒤 오늘 시술을 뺍니다.</p>
          <label>오늘 시술 <small class="muted">분류 → 시술을 누르면 이름·금액이 채워집니다 · 오늘 예약에 올린 시술은 미리 들어가 있습니다</small></label>
          ${renderServices('notice')}
          <div id="notice-items"></div>
          <button type="button" class="secondary small" data-action="notice-add">+ 시술 한 줄 더</button>

          <label class="check"><input type="checkbox" id="notice-topup-on"> 정액권 충전 안내 넣기</label>
          <div id="notice-topup" hidden>
            <div class="row">
              <input type="text" id="notice-topup-name" list="product-list" placeholder="정액권 이름 (예: Gold 예약권)" autocomplete="off">
              <input type="text" id="notice-topup-amt" class="won" inputmode="numeric" placeholder="결제 금액" autocomplete="off">
            </div>
            <input type="text" id="notice-topup-terms" placeholder="괄호 안 조건 (예: 사용기한:~18개월 / 우선예약권:소진시까지)" autocomplete="off">
            <input type="text" id="notice-topup-gift" placeholder="함께 드리는 선물 (비워도 됨)" autocomplete="off">
            ${st.products.length ? `<p class="hint">이름 칸에서 ${esc(st.products.map((p) => p.name).join(' · '))} 중 하나를 고르면 금액·조건·선물이 저절로 채워집니다.</p>` : ''}
          </div>
          <datalist id="product-list">${st.products.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist>

          <details class="tpl">
            <summary>머리말 · 맺음말 바꾸기</summary>
            <input type="text" id="notice-head" value="${esc(st.head)}" placeholder="맨 윗줄 (양옆 * 는 자동)">
            <input type="text" id="notice-tail" value="${esc(st.tail)}" placeholder="마지막 줄 금액 뒤에 붙는 말">
          </details>

          <div class="notice-total"><span>남은 정액권</span><b id="notice-total">${Store.formatWon(bal)}</b></div>
          <pre class="preview" id="notice-preview"></pre>
          <div class="row">
            <div class="msg" id="notice-msg"></div>
            <button type="button" class="secondary" data-action="notice-copy">복사만</button>
            <button type="button" data-action="notice-apply">복사하고 정액권에 반영</button>
          </div>
          <div class="soon-row"><button type="button" class="link small soon" data-action="notice-kakao" title="아직 연결 전">알림톡으로 보내기 · 연결 전</button></div>
        </div>
      </details>`;
  }

  function noticeRow(name = '', amount = '') {
    const row = document.createElement('div');
    row.className = 'row notice-item';
    row.innerHTML = `
      <input type="text" class="it-name" list="service-list" placeholder="시술명" autocomplete="off" value="${esc(name)}">
      <input type="text" class="it-amt won" inputmode="numeric" placeholder="금액" autocomplete="off" value="${esc(amount)}">
      <button type="button" class="secondary small" data-action="notice-row-del">×</button>`;
    return row;
  }

  function readNotice() {
    const items = [...document.querySelectorAll('.notice-item')].map((r) => ({
      name: r.querySelector('.it-name').value.trim(),
      amount: digitsOf(r.querySelector('.it-amt').value),
    }));
    const on = $('#notice-topup-on').checked;
    const tName = $('#notice-topup-name').value.trim();
    const tAmt = digitsOf($('#notice-topup-amt').value);
    const prevRaw = $('#notice-prev') ? $('#notice-prev').value.trim() : '';
    return {
      head: $('#notice-head').value,
      tail: $('#notice-tail').value,
      date: $('#notice-date') ? $('#notice-date').value : today(),
      prev: prevRaw === '' ? Store.passBalance(state, view.id) : Number(digitsOf(prevRaw)) || 0,
      prevTyped: prevRaw !== '',
      family: isFamily(view.id),
      items,
      // 스위치를 켰어도 이름·금액이 둘 다 비면 빈 줄을 내보내지 않는다
      topup: on && (tName || tAmt)
        ? { name: tName, amount: tAmt, terms: $('#notice-topup-terms').value, gift: $('#notice-topup-gift').value }
        : null,
    };
  }

  function refreshNotice() {
    if (!$('#notice-preview')) return;
    const f = readNotice();
    const remain = Store.noticeRemain(f);
    const total = $('#notice-total');
    total.textContent = Store.formatWon(remain);
    total.classList.toggle('short', remain < 0);
    $('#notice-preview').textContent = Store.buildNotice(f);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }
  // file:// 로 연 화면에서는 위 방법이 막히기도 한다. 그때 쓰는 옛 방식.
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  // 며칠 만의 방문인지 한 줄로. 아직 온 적이 없으면 '첫 방문'.
  // short: 오른쪽 명단 줄처럼 좁은 자리용. 날짜는 빼고 며칠 만인지와 평균만.
  // 원장이 기록에 말한 방문 주기와 다음 예약 즈음. "권한 주기 5주 → 11.02쯤". 숫자가 아니면 말만.
  const shortDay = (iso) => (iso.slice(0, 4) === today().slice(0, 4) ? iso.slice(5).replace('-', '.') : iso.replace(/-/g, '.'));
  const dueText = (due) => (due ? ` → ${shortDay(due.from)}${due.to !== due.from ? `~${shortDay(due.to)}` : ''}쯤` : '');
  function recommendedText(customerId, short) {
    const r = Store.recommendedCycle(state, customerId);
    if (!r) return '';
    return `<span class="rec" title="${r.saidOn.replace(/-/g, '.')} 기록에 적은 주기 · 마지막 방문 ${r.base.replace(/-/g, '.')} 기준">${short ? '권한' : '권한 주기'} ${esc(r.text)}${dueText(r.due)}</span>`;
  }

  function cycleText(cy, short) {
    if (cy.sinceLast === null) return '첫 방문';
    const last = cy.lastDate.replace(/-/g, '.');
    const avg = cy.average ? ` · 보통 ${cy.average}일마다` : '';
    return short ? `<b>${cy.sinceLast}일 만</b>${avg}` : `<b>${cy.sinceLast}일 만</b> · 지난 방문 ${last}${avg}`;
  }

  // ---- 왼쪽 아래: 지운 고객 (되살리기 / 완전히 지우기) ----------------------
  function renderTrash() {
    const box = $('#trash');
    const gone = Store.deletedCustomers(state);
    if (gone.length === 0) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <details class="trash" ${trashOpen ? 'open' : ''}>
        <summary>지운 고객 ${gone.length}명</summary>
        <p class="note">되살리면 방문 기록까지 그대로 돌아옵니다.</p>
        <ul class="list">
          ${gone.map((c) => `
            <li>
              <span>${esc(c.name)} <small>${esc(Store.maskPhone(c.phone))}</small></span>
              <span class="actions">
                <button type="button" class="small secondary" data-restore="${c.id}">되살리기</button>
                <button type="button" class="small danger" data-purge="${c.id}">완전히 지우기</button>
              </span>
            </li>`).join('')}
        </ul>
        <div class="msg" id="trash-msg"></div>
      </details>`;
  }

  // ---- 오른쪽: 오늘 명단 (카드를 열어도 그대로 있다) --------------------
  // 가운데에 아무 카드도 안 열렸을 때: 오늘 확인할 것 → 이번 달 한 줄 → 안내.
  // 타임테이블 (10-13 원장): 머리글 밑에 가로로. 명단 자체다 — 오른쪽 명단 칸은 없앴다(원장 10-13).
  // 빈 칸을 누르면 그 시간이 올리는 칸에 들어가고, 막대를 누르면 가운데에 카드(고정 정보·지난 방문·적는 칸)가 열린다.
  // 기록 남긴 손님은 초록, 아직인 손님은 빨강. ◀ ▶와 날짜로 다른 날(지난 60일·앞날)도 본다. 규칙은 Store.timeline.
  let tlDate = today();
  const shiftDay = (iso, n) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const dayTitle = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일 (${WEEK[new Date(iso + 'T00:00:00').getDay()]})`;
  function renderTimeline() {
    const d = tlDate, isToday = d === today(), isFuture = d > today();
    const tl = Store.timeline(state, d);
    // 앞날(10-14 원장: 내일 예약 미리 올리기)은 아직 기록할 때가 아니라 빨강 대신 '예약' 색, 카드는 오늘 날짜로 연다
    const blockCls = (b) => (isFuture ? 'booked' : b.recorded ? 'done' : 'todo');
    const openDate = isToday || isFuture ? '' : `data-open-date="${d}"`;
    const noPhIds = new Set(isFuture ? Store.bookingSummary(state, tlDate).noPhone.map((c) => c.id) : []);   // 가족 대표가 받으면 번호 없어도 표시 안 함(10-24)
    const noPh = (b) => (noPhIds.has(b.customer.id) ? ' <i class="nophone" title="번호가 없으면 알림톡이 못 갑니다. 카드 [고치기]에서 번호를 넣으세요">번호 없음</i>' : '');
    const bs = isFuture ? Store.bookingSummary(state, d) : null;
    const cols = tl.slots.length;
    const lanesN = Math.max(1, tl.lanes.length);
    const activeId = view.kind === 'card' ? view.id : null;
    // 다시 그려도 치던 이름과 고른 시간·시술은 그대로
    const keepAt = $('#add-at')?.value ?? '', keepSvc = $('#add-svc')?.value ?? '', keepName = $('#add-name')?.value ?? '';
    const keepGrp = ($('#add-grp')?.value && $('#add-grp').value !== ADD_SVC) ? $('#add-grp').value : groupOfService(keepSvc);
    const head = tl.slots.map((t, i) => `<div class="tl-slot ${t.endsWith(':00') ? 'hour' : 'half'}" style="grid-column:${i + 1}">${t.endsWith(':00') ? `${Number(t.slice(0, 2))}시` : '30'}</div>`).join('');
    const cells = tl.slots.map((t, i) => `<div class="tl-cell ${t.endsWith(':00') ? 'hour' : ''}" style="grid-column:${i + 1}; grid-row:2 / span ${lanesN}" data-at="${t}" title="${t}에 손님 올리기"></div>`).join('');
    const blocks = tl.lanes.map((lane, li) => lane.map((b) => `
      <div class="tl-block ${blockCls(b)}${noPhIds.has(b.customer.id) ? ' no-phone' : ''} ${b.customer.id === activeId ? 'active' : ''}" style="grid-column:${b.col + 1} / span ${b.span}; grid-row:${li + 2}" data-open="${b.customer.id}" ${openDate} title="${esc(b.customer.name)} · ${b.at}~${b.end}${b.service ? ' · ' + esc(b.service) : ''} · ${isFuture ? '예약' : b.recorded ? '기록 남김' : '아직 안 적음'}">
        <b>${esc(b.customer.name)}</b><small>${noPhIds.has(b.customer.id) ? '<i class="nophone">번호 없음</i> · ' : ''}${b.service ? `${esc(b.service)} · ` : isFuture ? '<i class="nosvc">시술 없음</i> · ' : ''}${b.at}${b.minutes ? `(${b.minutes}분)` : ''}</small>
      </div>`).join('')).join('');
    const empty = tl.total === 0 ? `<div class="tl-empty" style="grid-column:1 / span ${cols}; grid-row:2">${isToday ? '빈 칸을 누르거나 아래 칸에 시간·이름을 넣어 오늘 올 손님을 올리세요' : isFuture ? '빈 칸을 누르거나 아래 칸에 시간·이름을 넣어 이 날 예약을 미리 올리세요' : '이 날은 올린 손님이 없습니다'}</div>` : '';
    const pending = Store.pendingList(state, today());
    return `
      <div class="timeline">
        <div class="tl-head">
          <button type="button" class="small secondary" data-tl="prev" title="전날">◀</button>
          <input type="date" id="tl-date" value="${d}" title="날짜를 골라 그날 타임테이블을 봅니다">
          <button type="button" class="small secondary" data-tl="next" title="다음 날">▶</button>
          ${isToday ? '' : '<button type="button" class="small" data-tl="today">오늘로</button>'}
          <b>${isToday ? '오늘' : dayTitle(d)}${isFuture ? ' <span class="tl-tag">예약</span>' : ''}</b>
          ${isFuture
            ? `<small>예약 ${bs.total}명${bs.noPhone.length ? ` · <span class="bad">번호 없음 ${bs.noPhone.length}명</span>` : ''} · 미리 올려 두면 그날 그대로 오늘 명단이 됩니다</small>`
            : `<small>${tl.total}명 · <span class="ok">기록 ${tl.recorded}</span> · <span class="${tl.total - tl.recorded ? 'bad' : ''}">아직 ${tl.total - tl.recorded}</span> · 막대를 누르면 카드, 빈 칸을 누르면 그 시간에 올리기</small>`}
        </div>
        <div class="tl-scroll"><div class="tl-grid" style="grid-template-columns: repeat(${cols}, minmax(56px, 1fr)); grid-template-rows: 22px repeat(${lanesN}, 46px)">${head}${cells}${blocks}${empty}</div></div>
        ${tl.untimed.length ? `<div class="tl-untimed">시간 없음: ${tl.untimed.map((b) => `<button type="button" class="link small ${isFuture ? '' : b.recorded ? 'ok' : 'bad'}" data-open="${b.customer.id}" ${openDate}>${esc(b.customer.name)}${noPh(b)}${b.service ? ` <small>${esc(b.service)}</small>` : ''}</button>`).join(' ')}</div>` : ''}
        ${renderTlSelected(d)}
        <div class="tl-add">
          <select class="at" id="add-at" title="예약 시간 (안 골라도 됩니다)">${timeOptions(keepAt)}</select>
          <select class="svc grp" id="add-grp" title="시술항목 분류 (안 골라도 됩니다) · 맨 아래 [+ 새 분류 추가]">${grpOptions(keepGrp)}</select>
          <select class="svc" id="add-svc" title="시술 (막대 폭)" ${keepGrp ? '' : 'hidden'}>${subOptions(keepGrp, keepSvc)}</select>
          <button type="button" class="link small svc-mgr-btn" data-mgr="open" title="시술항목 더하기 · 고치기 · 지우기">시술항목 관리</button>
          <input type="text" id="add-name" value="${esc(keepName)}" placeholder="이름이나 번호 → ${isToday ? '오늘' : dayTitle(d)} 명단에 올립니다" autocomplete="off">
          <div class="msg" id="today-msg"></div>
          ${renderFamPrompt()}
          <div id="add-hits"></div>
        </div>
        <div id="svc-mgr-slot">${renderSvcMgr()}</div>
        ${pending.length ? `<div class="tl-pending">아직 안 적은 지난 명단: ${pending.map((p) => `<button type="button" class="link small bad" data-open="${p.customer.id}" data-open-date="${p.date}">${fmtDay(p.date).slice(5)} ${esc(p.customer.name)}${p.at ? ` ${p.at}` : ''}</button>`).join(' ')}</div>` : ''}
      </div>`;
  }
  // 눌러 본 막대의 예약 고치기(10-23 원장: 시술을 안 고르고 올렸는데 고칠 곳을 못 찾았다 — 카드 첫 줄 오른쪽 끝은 눈에 안 띈다).
  // 타임테이블 바로 밑에 시간·시술·명단에서 빼기. 시술을 안 고른 앞날 예약은 알림톡에 "예약하신 시술"로 나간다고 알려 준다.
  function renderTlSelected(d) {
    const id = view.kind === 'card' ? view.id : null;
    const entry = id && state.today.entries.find((e) => e.customerId === id && e.date === d);
    const c = entry && state.customers.find((x) => x.id === id && !x.deletedAt);
    if (!c) return '';
    return `
      <div class="tl-sel">
        <b>${esc(c.name)}</b><small>${d === today() ? '오늘' : esc(dayTitle(d))} 예약</small>
        <label>시간 <select class="at" data-at="${c.id}" data-date="${d}">${timeOptions(entry.at)}</select></label>
        <label>시술 <select class="svc" data-svc="${c.id}" data-date="${d}">${svcOptions(entry.service)}</select></label>
        ${!entry.service && d > today() ? '<span class="bad small-note">시술을 고르면 알림톡에 시술 이름이 들어갑니다 (안 고르면 "예약하신 시술")</span>' : ''}
        ${(() => {   // 가족 이름으로 잡힌 예약에 다른 가족이 왔을 때 넘기기(10-27 원장)
          const others = Store.familyOf(state, c.id).filter((x) => x.id !== c.id && !state.today.entries.some((e) => e.customerId === x.id && e.date === d));
          return others.length ? `<label>실제로 온 사람 <select data-swap="${c.id}" data-date="${d}"><option value="">${esc(c.name)} 본인</option>${others.map((x) => `<option value="${x.id}">${esc(x.name)}${Store.familyRoleOf(state, x.id) ? ` (${esc(Store.familyRoleOf(state, x.id))})` : ''}</option>`).join('')}</select></label>` : '';
        })()}
        <button type="button" class="link small" data-drop="${c.id}" data-drop-date="${d}">명단에서 빼기</button>
      </div>`;
  }
  function renderCenterEmpty() {
    const pb = Store.preBookDates(today());
    const top = pb.phase === 'day' || pb.phase === 'after' ? renderPreBook('main') : '';
    return `${top}${renderHome()}`;   // 숫자 줄은 10-26 원장 요청으로 결산 안으로 옮겼다   // 안내 글은 10-13 원장 요청으로 뺐다. 10-26: 메뉴와 오늘 확인할 것을 분류 상자로 합침
  }

  // ---- V3 메인(10-02 원장): 가운데 고객 등록 칸은 늘 펼쳐 둔다. 기본 단추는 만들고 오늘 명단에 올리기(아침 흐름),
  // "만들기만"은 명단에 안 올린다(예전 손님을 미리 넣을 때). 만든 뒤에는 그 카드가 열리고 고정 정보부터 적게 된다.
  function renderRegister() {
    return `
      <form class="reg" id="new-customer-form">
        <div class="head"><b>고객 등록</b><small>처음 온 손님은 여기서 만들고 오늘 명단에 올립니다</small></div>
        <div class="row">
          <input type="text" id="new-name" placeholder="이름 (필수)" autocomplete="off">
          <input type="text" id="new-phone" placeholder="전화번호 (예: 010-1234-5678)" inputmode="tel" autocomplete="off">
          <input type="text" id="new-referrer" placeholder="소개해 준 분 (없으면 비움)" autocomplete="off">
        </div>
        <div class="foot">
          <label class="legacy"><input type="checkbox" id="new-legacy"> 예전부터 오던 고객 (신규로 세지 않음)</label>
          <button type="button" class="link small" data-action="create-only">만들기만 (명단에 안 올림)</button>
          <button type="submit">만들고 오늘 명단에 올리기</button>
        </div>
        <div class="msg" id="new-msg"></div>
      </form>`;
  }
  function createCustomer(toToday) {
    try {
      const made = Store.addCustomer(state, { name: $('#new-name').value, phone: $('#new-phone').value, referrer: $('#new-referrer').value, isLegacy: $('#new-legacy').checked });
      const next = toToday ? Store.markToday(made.state, made.customer.id, tlDate, '', '', today()).state : made.state;
      commit(next);
      custQ = '';
      openCard(made.customer.id);
      editingProfile = true; render();
    } catch (err) { showMsg($('#new-msg'), err.message, 'error'); }
  }

  // ---- 선예약 연락 (10-09 원장): 말일 2일 전, 대상 고객에게 원장이 한 명씩 보낸다 ----
  // PC는 [문구 복사] → 카카오 채널 대화방에 붙여넣기, 핸드폰은 [문자]가 번호·글이 채워진 문자 앱을 연다. 자동 전송은 없다.
  // main: 선예약 날~일반 오픈 날 첫 화면 맨 위. manage: 고객 관리 안(대상 넣고 빼기·문구 고치기).
  const isPhone = () => !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const smsHref = (phone, text) => `sms:${String(phone).replace(/[^\d+]/g, '')}${/iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
  const hhmm = (at) => (at ? at.slice(11, 16) : '');
  function renderPreBook(where) {
    const d = today();
    const pb = Store.preBookDates(d);
    const rows = Store.preBookTargets(state, d);
    const M = Number(pb.month.slice(5, 7));
    const sent = rows.filter((r) => r.status.sent || r.status.booked).length;
    const booked = rows.filter((r) => r.status.booked).length;
    const manage = where === 'manage';
    const head = `<b class="t">${M}월 선예약 연락${pb.phase === 'day' ? '일' : ''}</b> <span class="muted">선예약 ${Store.dateKo(pb.day)} · 회신 ${Store.dateKo(pb.replyBy)}까지 · 일반 오픈 ${Store.dateKo(pb.open)}</span>`;
    if (manage && !preBook.manage) {
      return `<div class="pb pb-closed" id="cm-prebook"><div class="pb-top"><div>${head}<div class="muted">대상 ${rows.length}명 · 보냄 ${sent}명 · 예약함 ${booked}명</div></div><button type="button" class="small secondary" data-pb="manage">대상·문구 보기</button></div></div>`;
    }
    const done = rows.length > 0 && sent === rows.length;
    if (!manage && done && !preBook.open) {
      return `<div class="pb pb-closed"><div class="pb-top"><div>${head}<div class="muted">${rows.length}명 모두 보냄 · 예약함 ${booked}명</div></div><button type="button" class="small secondary" data-pb="open">펼치기</button></div></div>`;
    }
    const phone = isPhone();
    const needPickSlot = (state.settings?.preBookText || Store.PREBOOK_TEXT).includes('{추천일}');
    const row = (r) => {
      const st = r.status;
      const msg = Store.preBookMessage(state, r.customer.id, d);
      const cyc = r.cycle ? `권한 ${esc(r.cycle.text)}${dueText(r.cycle.due)}` : '<span class="muted">권한 주기 없음</span>';
      // 추천 날짜(10-28 원장 새 문구): 줄마다 원장이 적는다. 권한 주기를 옆에 보여 고르는 데 쓴다
      const pick = Store.preBookPickOf(state, pb.month, r.key);
      const pickBox = !needPickSlot ? '' : st.sent || st.booked
        ? (pick ? `<span class="pb-pick-done">추천 ${esc(pick)}</span>` : '')
        : `<label class="pb-pick-lb">추천 날짜 <input type="text" class="pb-pick ${pick ? '' : 'empty'}" data-key="${r.key}" value="${esc(pick)}" placeholder="예: 12월 3일 2시" maxlength="30" autocomplete="off"></label>`;
      const acts = st.booked
        ? `<span class="chip done">예약함 ${hhmm(st.booked)}</span><button type="button" class="link small" data-pb="unbook" data-key="${r.key}">되돌리기</button>`
        : st.sent
          ? `<span class="chip sent">보냄 ${hhmm(st.sent)}</span><button type="button" class="small secondary" data-pb="book" data-key="${r.key}">예약함</button><button type="button" class="link small" data-pb="unsend" data-key="${r.key}">되돌리기</button>`
          : `<button type="button" class="small" data-pb="copy" data-key="${r.key}">문구 복사</button>${phone && r.customer.phone ? `<a class="btn-sms" href="${esc(smsHref(r.customer.phone, msg))}" data-pb-sms="${r.key}">문자</a>` : ''}<button type="button" class="small secondary" data-pb="sent" data-key="${r.key}">보냄 ✓</button>`;
      return `
        <div class="pb-row">
          <div class="who"><span class="nm" data-open="${r.customer.id}">${r.members.map((m) => esc(m.name)).join(' · ')}</span>${r.members.length > 1 ? ' <small>가족</small>' : ''}${r.why === 'in' ? ' <small class="tag-in">직접 넣음</small>' : ''}
            <div class="sub">${r.balance > 0 ? `정액권 ${Store.formatWon(r.balance)} · ` : ''}${cyc}${manage ? ` · <button type="button" class="link small" data-pb="out" data-id="${r.customer.id}">대상에서 빼기</button>` : ''}</div></div>
          <div class="acts">${pickBox}${acts}</div>
        </div>`;
    };
    const outIds = (state.settings?.preBookMarks?.out ?? []).filter((id) => customerOf(id));
    const sample = rows[0] ? rows[0].customer.id : null;
    return `
      <div class="pb" ${manage ? 'id="cm-prebook"' : ''}>
        <div class="pb-top"><div>${head}</div><span>${manage ? '<button type="button" class="link small" data-pb="manage">접기</button> ' : ''}<button type="button" class="small secondary" data-pb="edit">${preBook.edit ? '문구 닫기' : '문구 고치기'}</button></span></div>
        ${rows.length ? `<div class="pb-bar"><i style="width:${Math.round((sent / rows.length) * 100)}%"></i></div>
        <div class="muted">${rows.length}명 중 <b>${sent}명 보냄</b> · ${booked}명 예약함 · ${rows.length - sent}명 아직</div>` : '<div class="empty">선예약 대상이 없습니다. 정액권이 남은 고객이 생기거나 아래에서 직접 넣으면 여기에 뜹니다.</div>'}
        ${!needPickSlot ? `<div class="pb-old">지금 쓰는 문구는 예전에 고친 문구라 추천 날짜 자리가 없습니다. <button type="button" class="small secondary" data-pb="reset-text">새 문구(추천 날짜 들어감)로 바꾸기</button></div>` : ''}
        ${preBook.edit ? `
          <div class="pb-edit">
            <div class="muted">아래 낱말은 고객마다 바뀌어 들어갑니다: <code>{이름}</code> <code>{예약월}</code> <code>{추천일}</code>(줄마다 적은 추천 날짜) <code>{회신일}</code> <code>{오픈일}</code> <code>{선예약일}</code></div>
            <textarea id="pb-text" rows="5">${esc(state.settings?.preBookText || Store.PREBOOK_TEXT)}</textarea>
            <div class="row"><button type="button" class="link small" data-pb="reset-text">기본 문구로</button><span class="muted">칸을 벗어나면 저장됩니다</span></div>
            ${sample ? `<div class="muted" style="margin-top:6px">${esc(customerOf(sample).name)} 님에게 갈 글</div><pre class="pb-preview" id="pb-preview">${esc(Store.preBookMessage(state, sample, d))}</pre>` : ''}
          </div>` : ''}
        <div class="pb-rows">${rows.map(row).join('')}</div>
        <div class="msg" id="pb-msg"></div>
        ${manage ? `
          <div class="pb-add">
            <input type="text" id="pb-q" value="${esc(preBook.q)}" placeholder="정액권이 없어도 선예약 받을 고객 이름으로 찾아 넣기 (예약권 고객 등)" autocomplete="off">
            <ul class="list" id="pb-hits"></ul>
          </div>
          ${outIds.length ? `<div class="muted" style="margin-top:8px">뺀 고객: ${outIds.map((id) => `${esc(customerOf(id).name)} <button type="button" class="link small" data-pb="auto" data-id="${id}">다시 넣기</button>`).join(' · ')}</div>` : ''}
          <p class="note">PC는 [문구 복사] 뒤 카카오 채널 대화방에 붙여 넣고, 핸드폰은 [문자]를 누르면 번호와 글이 채워진 문자 앱이 열립니다. 보낸 뒤 [보냄 ✓]을 눌러 두세요.</p>` : ''}
      </div>`;
  }
  // 대상 찾기 칸: 치는 대로 목록만 다시 그린다(커서가 날아가지 않게)
  function renderPreBookHits() {
    const box = $('#pb-hits');
    if (!box) return;
    const q = preBook.q.trim();
    if (!q) { box.innerHTML = ''; return; }
    const inKeys = new Set(Store.preBookTargets(state, today()).flatMap((r) => r.members.map((m) => m.id)));
    const found = Store.findCustomers(state, q).slice(0, 8);
    box.innerHTML = found.length === 0 ? '<li class="empty">찾는 고객이 없습니다.</li>' : found.map((c) => `
      <li><span>${esc(c.name)} <small>${esc(Store.maskPhone(c.phone))}</small></span>${inKeys.has(c.id) ? '<small>이미 대상</small>' : `<button type="button" class="small secondary" data-pb="in" data-id="${c.id}">넣기</button>`}</li>`).join('');
  }
  function preBookAction(a, btn) {
    const d = today();
    const month = Store.preBookDates(d).month;
    const key = Number(btn.dataset.key), id = Number(btn.dataset.id);
    if (a === 'manage') { preBook = { ...preBook, manage: !preBook.manage, edit: false }; render(); $('#cm-prebook')?.scrollIntoView({ block: 'start' }); return; }
    if (a === 'open') { preBook = { ...preBook, open: true }; render(); return; }
    if (a === 'edit') { preBook = { ...preBook, edit: !preBook.edit }; render(); if (preBook.edit) $('#pb-text')?.focus(); return; }
    if (a === 'reset-text') { commit(Store.setPreBookText(state, '').state); render(); return; }
    if (a === 'copy') {
      const r = Store.preBookTargets(state, d).find((x) => x.key === key);
      if (Store.preBookNeedsPick(state, r.customer.id, d)) { showMsg($('#pb-msg'), `${r.customer.name} 님 추천 날짜를 먼저 적어 주세요 (예: 12월 3일 2시)`, 'error'); $(`.pb-pick[data-key="${key}"]`)?.focus(); return; }
      copyText(Store.preBookMessage(state, r.customer.id, d)).then((ok) => showMsg($('#pb-msg'), ok ? `${r.customer.name} 님 문구를 복사했습니다. 카카오 채널 대화방에 붙여 넣고 보낸 뒤 [보냄 ✓]을 누르세요.` : '복사가 안 됐습니다. 다시 눌러 주세요.', ok ? 'ok' : 'error'));
      return;
    }
    if (a === 'sent') { commit(Store.markPreBook(state, month, key, 'sent', now()).state); render(); return; }
    if (a === 'unsend') { commit(Store.markPreBook(state, month, key, 'sent', null).state); render(); return; }
    if (a === 'book') { commit(Store.markPreBook(state, month, key, 'booked', now()).state); render(); return; }
    if (a === 'unbook') { commit(Store.markPreBook(state, month, key, 'booked', null).state); render(); return; }
    if (a === 'out') { commit(Store.setPreBookMark(state, id, 'out').state); render(); return; }
    if (a === 'auto') { commit(Store.setPreBookMark(state, id, null).state); render(); return; }
    if (a === 'in') { commit(Store.setPreBookMark(state, id, 'in').state); preBook = { ...preBook, q: '' }; render(); $('#cm-prebook')?.scrollIntoView({ block: 'start' }); return; }
  }

  // ---- 고객 관리 (10-08 원장): 찾기 → 등록(늘 펼침) → 고객 동향. 동향은 기록에서 그때그때 센다 ----
  function renderCustomerManage() {
    const d = today();
    const cc = Store.customerCounts(state);
    const m = Store.monthlyStats(state, d.slice(0, 7));
    const over = Store.overdueCustomers(state, d, state.settings.overdueFactor ?? 1.5);
    const trend = Store.trendMonths(state, d, 6);
    const fresh = Store.recentNewCustomers(state, d, 60);
    const due = Store.dueCustomers(state, d, 7);
    const duePast = due.filter((x) => x.days > 0);
    const pass = Store.passHolders(state, d);
    const passSum = pass.reduce((n, p) => n + p.balance, 0);
    const lateIds = new Set(duePast.map((x) => x.customer.id).concat(over.map((o) => o.customer.id)));
    const top = Math.max(1, ...trend.map((t) => t.customers));
    const day = (x) => x.replace(/-/g, '.');
    return `
      <div class="cm">
        <h2 class="card-title">고객 관리 <small>찾기 · 등록 · 고객 동향</small></h2>
        <div class="cm-find">
          <input type="text" id="cm-search" value="${esc(custQ)}" placeholder="이름이나 전화번호 뒤 4자리로 찾기" autocomplete="off">
          <ul class="list" id="cm-list"></ul>
        </div>
        ${renderRegister()}

        ${renderPreBook('manage')}

        <h3>고객 동향</h3>
        <div class="dash">
          <div class="tile"><b>전체 고객</b><span>${cc.total}</span><small>명 · 예전 고객 ${cc.legacy}</small></div>
          <div class="tile" data-monthly="1"><b>이번 달 신규 · 재방문</b><span>${m.newCustomers} · ${m.returning}</span><small>명</small></div>
          <div class="tile" data-go="cm-due"><b>다시 올 때 지남</b><span>${duePast.length}</span><small>명 · 권한 주기 기준</small></div>
          <div class="tile" data-go="cm-pass"><b>정액권 남은 고객</b><span>${pass.length}</span><small>명 · ${Store.formatWon(passSum)}</small></div>
        </div>

        <h4 id="cm-due">다시 올 때 된 고객 <small>기록에 말한 권한 주기 기준 · 지난 ${duePast.length}명 · 7일 안 ${due.length - duePast.length}명</small></h4>
        ${due.length === 0 ? '<div class="empty">지금은 없습니다. 기록에 "주기: 5주"처럼 숫자로 말한 고객만 잡힙니다.</div>' : `<ul class="list cm-rows">${due.map((x) => `
          <li data-open="${x.customer.id}"><span>${esc(x.customer.name)} <small>권한 ${esc(x.text)} · 지난 방문 ${day(x.lastDate)}${x.onToday ? ' · <b>오늘 명단</b>' : ''}</small></span><span class="status ${x.days > 0 ? 'todo' : 'pass'}">${x.days > 0 ? `${x.days}일 지남` : x.days === 0 ? '오늘' : `${-x.days}일 남음`}</span></li>`).join('')}</ul>`}

        <h4 id="cm-pass">정액권 남은 고객 <small>잔액 큰 순 · ${pass.length}명 · 합계 ${Store.formatWon(passSum)} · 원본은 핸드SOS</small></h4>
        ${pass.length === 0 ? '<div class="empty">정액권이 남은 고객이 없습니다.</div>' : `<ul class="list cm-rows">${pass.map((p) => `
          <li data-open="${p.customer.id}"><span>${p.members.map((x) => esc(x.name)).join(' · ')}${p.members.length > 1 ? ' <small>가족</small>' : ''} <small>${p.lastDate ? `마지막 방문 ${day(p.lastDate)} (${p.sinceLast}일 전)` : '방문 기록 없음'}</small>${p.members.some((x) => lateIds.has(x.id)) ? ' <span class="status todo">올 때 지남</span>' : ''}</span><b class="won">${Store.formatWon(p.balance)}</b></li>`).join('')}</ul>`}

        <h4>최근 ${trend.length || 6}달 흐름 <small>방문한 고객 수 · 기록이 있는 달부터</small></h4>
        ${trend.length === 0 ? '<div class="empty">아직 방문 기록이 없습니다.</div>' : `<table class="cm-trend">
          <tr><th>달</th><th>방문 고객</th><th style="text-align:right">신규</th><th style="text-align:right">재방문</th><th style="text-align:right">방문 건수</th></tr>
          ${trend.map((t) => `<tr><td>${Number(t.month.slice(5, 7))}월</td><td><span class="bar" style="width:${Math.round((t.customers / top) * 100)}%"></span><b>${t.customers}</b></td><td class="num">${t.newCustomers}</td><td class="num">${t.returning}</td><td class="num">${t.visits}</td></tr>`).join('')}
        </table>`}

        <h4>최근 60일 신규 고객 <small>${fresh.length}명 중 ${fresh.filter((f) => f.returned).length}명 다시 옴</small></h4>
        ${fresh.length === 0 ? '<div class="empty">최근 60일 안에 처음 온 고객이 없습니다.</div>' : `<ul class="list cm-rows">${fresh.map((f) => `
          <li data-open="${f.customer.id}"><span>${esc(f.customer.name)} <small>처음 ${day(f.firstDate)} · ${f.visits}회</small></span>${f.returned ? '<span class="status done">다시 옴</span>' : '<span class="status pass">아직</span>'}</li>`).join('')}</ul>`}

        <h4 id="cm-over">오래 안 온 고객 <small>평소 주기의 ${state.settings.overdueFactor ?? 1.5}배를 넘김 · ${over.length}명</small></h4>
        ${over.length === 0 ? '<div class="empty">지금은 없습니다.</div>' : `<ul class="list cm-rows">${over.slice(0, 10).map((o) => `
          <li data-open="${o.customer.id}"><span>${esc(o.customer.name)} <small>지난 방문 ${day(o.lastDate)} · 평소 ${o.average}일마다</small></span><span class="status pass">${o.sinceLast}일째</span></li>`).join('')}</ul>${over.length > 10 ? `<p class="note">${over.length - 10}명 더 있습니다. <button type="button" class="link small" data-monthly="over">결산에서 전부 보기</button></p>` : ''}`}
      </div>`;
  }

  // ---- V3 메인: 왼쪽 메뉴 단추 다섯 (원장이 정한 순서 10-02, 고객 관리는 10-08 맨 위에). 예약관리·고객 채팅은 연결 전이라 자리만 ----
  function renderMenu() {
    const m = $('#menu');
    if (!m) return;
    const d = today();
    const ready = stockReady();
    const short = ready ? Store.shortProducts(state) : [];
    const ordered = ready ? Store.orderedProducts(state, d) : [];
    const n = Store.liveProducts(state).length;
    const stockCap = !ready ? '표 아직 없음 (schema.sql)' : n === 0 ? '제품 목록이 비어 있음' : (short.length || ordered.length) ? `주문 ${short.length} · 도착 대기 ${ordered.length}` : `제품 ${n} · 주문할 것 없음`;
    const cc = Store.customerCounts(state);
    const cs = cancelReady() ? Store.cancelSummary(state) : { total: 0, unknown: 0 };
    const items = [
      { key: 'customers', icon: '👥', name: '고객 관리', cap: `고객 ${cc.total}명 · 찾기 · 등록 · 동향`, on: view.kind === 'customers' },
      { key: 'reserve', icon: '📅', name: '예약관리', cap: cancelCap(), tag: cs.unknown ? `채워졌나? ${cs.unknown}` : '', todo: cs.unknown > 0, on: view.kind === 'reserve' },
      { key: 'monthly', icon: '📊', name: '결산', cap: '월별 · 재방문 · 정착', tag: `${Number(d.slice(5, 7))}월`, on: view.kind === 'monthly' },
      { key: 'stock', icon: '📦', name: '재고관리', cap: stockCap, tag: short.length ? `주문 ${short.length}` : '', todo: short.length > 0, on: view.kind === 'stock' },
      { key: 'chat', icon: '💬', name: '고객 채팅', cap: '카카오 · 네이버 톡톡', tag: '연결 전', on: view.kind === 'soon' && view.what === 'chat' },
    ];
    m.innerHTML = '<button type="button" class="home-btn" data-menu="home"><span class="ic">🏠</span><span><b>처음 화면</b><small>분류별 할 일 한눈에</small></span></button><div class="t">메뉴</div>' + items.map((it) => `<button type="button" class="${it.on ? 'active' : ''}" data-menu="${it.key}"><span class="ic">${it.icon}</span><span><b>${esc(it.name)}</b><small>${esc(it.cap)}</small></span>${it.tag ? `<span class="tag${it.todo ? ' todo' : ''}">${esc(it.tag)}</span>` : ''}</button>`).join('');
  }
  // 연결 전인 메뉴를 누르면 그 기능이 생길 자리를 보여 준다(원장: 레이아웃 먼저, 연결은 하나씩)
  function renderSoon(what) {
    const p = what === 'reserve'
      ? { title: '예약관리', hint: SOON_HINTS['soon-reserve'], rows: ['핸드SOS 예약을 오늘 명단으로 가져오기', '네이버 예약을 오늘 명단으로 가져오기', '예약 결과 적기 (정상 · 노쇼 · 취소)'], foot: '오늘 명단은 오른쪽에 있습니다. 지금은 아침에 손으로 올립니다.' }
      : { title: '고객 채팅', hint: SOON_HINTS['soon-inbox'], rows: ['카카오 채널 새 문의', '네이버 톡톡 새 문의', '한곳에서 답하기'], foot: '' };
    return `
      <div class="soon-panel">
        <div class="head"><b>${esc(p.title)}</b><span class="tag">연결 전</span></div>
        <p class="hint">${esc(p.hint)}</p>
        <ul>${p.rows.map((r) => `<li><span>${esc(r)}</span><span class="tag">연결 전</span></li>`).join('')}</ul>
        ${p.foot ? `<p class="hint">${esc(p.foot)}</p>` : ''}
      </div>`;
  }

  // ---- V4 첫 걸음: 예약관리 = 취소 적기 + 시술 시간표 (10-11 원장) ------------
  // 10/11~21 열흘은 대기 시스템을 만들기 전에 "취소가 나면 그 자리가 채워지는지"를 센다. 원장은 말하듯 한 줄만 적고(10초),
  // 카드가 네 가지(언제·시술·며칠 전·채워짐)를 읽어 밑에 미리 보여 준다. 적는 칸의 회색 글(placeholder)이 안내다.
  const TEN_DAYS = ['2026-10-11', '2026-10-21'];   // 젬마 선생님 코칭(10/22) 전 재는 기간
  const FILLED_LABEL = { yes: '채워짐', no: '비었음', unknown: '아직 모름' };
  const cancelReady = () => USE_LOCAL || !DB.missingTables().includes('card_cancels');
  const waitReady = () => USE_LOCAL || !DB.missingTables().includes('card_waitlist');
  const waitPageUrl = () => `${location.origin}/wait.html`;
  const waitUrlFor = (w) => `${waitPageUrl()}?w=${w.id}&c=${encodeURIComponent(w.code)}`;
  // 취소 한 줄로 읽은 것(또는 적힌 기록)에 맞는 대기 손님. 문자는 먼저 건 순으로 NOTIFY_LIMIT명까지
  const matchesFor = (cancelLike) => Store.matchWaiters(state, cancelLike).slice(0, Store.NOTIFY_LIMIT);
  const cancelCap = () => { if (!cancelReady()) return '취소 표 아직 없음 (schema.sql)'; const c = Store.cancelSummary(state); const w = (state.waitlist ?? []).filter((x) => x.status === 'waiting').length; return `${c.total ? `취소 ${c.total} · 채워짐 ${c.filled} · 비었음 ${c.empty}` : '취소 적기'} · 대기 ${w}명`; };
  const CANCEL_PLACEHOLDER = [
    '말하듯 한 줄 — 네 가지만 들어가면 됩니다',
    '1. 언제 예약이었나 … 10월 15일 2시',
    '2. 무슨 시술 … 열펌 (커트 · 콜드펌 · 열펌 · 매직세팅 · 클리닉 · 뿌리 · 전체 염색)',
    '3. 며칠 전에 취소했나 … 3일 전 (그날이면 "당일")',
    '4. 자리가 채워졌나 … 다음 날 채워짐 / 아직 비어 있음 / 모르면 안 적어도 됨',
    '',
    '예) 10월 15일 2시 열펌, 3일 전 취소, 다음 날 채워짐',
  ].join('\n');
  const daysBeforeText = (n) => (n === null || n === undefined ? '' : n === 0 ? '당일 취소' : `${n}일 전 취소`);
  const cancelTime = (t) => (t ? ' ' + (Number(t.slice(0, 2)) > 12 ? `오후 ${Number(t.slice(0, 2)) - 12}시` : `${Number(t.slice(0, 2))}시`) + (t.slice(3) !== '00' ? ` ${Number(t.slice(3))}분` : '') : '');
  // 글자를 칠 때마다 "이렇게 읽었습니다" 네 줄만 다시 그린다 (칸 전체를 다시 그리면 커서가 날아간다)
  function renderCancelPreview(textId, boxId) {
    const box = $('#' + boxId);
    if (!box) return;
    const text = $('#' + textId)?.value ?? '';
    if (!text.trim()) { box.innerHTML = ''; return; }
    const r = Store.parseCancelText(text, state, today());
    const row = (lb, ok, tx, miss) => `<span class="lb">${lb}</span>${ok ? `<span class="tx">${tx}</span>` : `<span class="tx unsaid">아직 · ${miss}</span>`}`;
    box.innerHTML = [
      row('언제', !!r.date, r.date ? `${esc(shortDay(r.date))}${esc(cancelTime(r.time))}` : '', '"10월 15일 2시"처럼 날짜를 적어야 저장됩니다'),
      row('시술', !!r.service, `${esc(r.service)}${r.minutes ? ` <small>${r.minutes}분</small>` : ''}`, '커트 · 콜드펌 · 열펌 · 매직세팅 · 클리닉 · 뿌리 · 전체 염색 중 하나 (없어도 저장됩니다)'),
      row('며칠 전', r.daysBefore !== null, esc(daysBeforeText(r.daysBefore)), '"3일 전" "당일"처럼 (없어도 저장됩니다)'),
      row('채워짐', r.filled !== 'unknown', r.filled === 'yes' ? `채워짐${r.filledIn ? ` · ${esc(r.filledIn)}` : ''}` : '비었음', '모르면 비워 두고, 나중에 기록 옆 단추로 표시'),
      smsRow(r),
    ].join('');
    const btn = $('#' + (textId === 'cancel-text' ? 'cancel-save-btn' : 'x'));
    if (btn) { const n = r.filled === 'yes' ? 0 : matchesFor({ ...r, id: null }).length; btn.textContent = n ? `취소 적고 문자 ${n}건 보내기` : '취소 적기'; }
  }
  // 다섯째 줄: 이 취소로 문자가 갈 대기 손님. 이미 채워진 자리면 안 보낸다. 시술을 모르면 못 보낸다
  function smsRow(r) {
    const lb = '<span class="lb">문자</span>';
    if (r.filled === 'yes') return lb + '<span class="tx unsaid">이미 채워진 자리라 문자는 안 갑니다</span>';
    if (!r.date) return lb + '<span class="tx unsaid">날짜가 있어야 맞는 대기 손님을 찾습니다</span>';
    if (!r.minutes) return lb + '<span class="tx unsaid">시술을 적어야 문자가 나갑니다 (어느 시술이 들어갈 자리인지 알아야 해서)</span>';
    const m = matchesFor({ ...r, id: null });
    if (!m.length) return lb + '<span class="tx unsaid">이 날짜·시간·시술에 맞는 대기 손님이 없습니다</span>';
    return lb + `<span class="tx"><b>${m.length}명</b>에게 "자리 났어요" 문자 · ${esc(m.map((w) => w.name).join(', '))}</span>`;
  }
  function renderReserve() {
    const ready = cancelReady();
    const d = today();
    const list = Store.cancelList(state);
    const ten = Store.cancelSummary(state, TEN_DAYS[0], TEN_DAYS[1]);
    const month = Store.cancelSummary(state, d.slice(0, 7) + '-01', d.slice(0, 7) + '-31');
    const sumBox = (c) => `<div class="cancel-sum"><span class="k"><b>${c.total}</b><small>취소</small></span><span class="k"><b class="ok">${c.filled}</b><small>채워짐</small></span><span class="k"><b class="bad">${c.empty}</b><small>비었음</small></span><span class="k"><b class="mute">${c.unknown}</b><small>아직 모름</small></span></div>`;
    const services = Store.serviceList(state);
    const cancelRow = (c) => reserve.editId === c.id ? `
      <div class="cancel-row editing" data-cid="${c.id}">
        <textarea id="cancel-edit-text" placeholder="${esc(CANCEL_PLACEHOLDER)}">${esc(c.note)}</textarea>
        <div class="split-preview" id="cancel-edit-preview"></div>
        <div class="row"><div class="msg" id="cancel-edit-msg"></div><button type="button" class="small" data-action="cancel-edit-save" data-id="${c.id}">저장</button><button type="button" class="link small" data-action="cancel-edit-cancel">취소</button></div>
      </div>` : `
      <div class="cancel-row ${c.filled}" data-cid="${c.id}">
        <span class="when"><b>${esc(shortDay(c.date))}</b>${esc(cancelTime(c.time))}</span>
        <span class="nm">${c.service ? esc(c.service) : '시술 ?'}${c.minutes ? ` <small>${c.minutes}분</small>` : ''}<small class="note" title="${esc(c.note)}">${esc(c.note)}</small></span>
        <span class="before">${esc(daysBeforeText(c.daysBefore)) || '며칠 전 ?'}</span>
        <span class="acts">
          <span class="status ${c.filled === 'yes' ? 'done' : c.filled === 'no' ? 'empty' : 'unknown'}">${FILLED_LABEL[c.filled]}${c.filled === 'yes' && c.filledIn ? ` · ${esc(c.filledIn)}` : ''}</span>
          ${c.filled !== 'yes' ? `<button type="button" class="small secondary" data-action="cancel-filled" data-id="${c.id}" data-filled="yes">채워짐</button>` : ''}
          ${c.filled !== 'no' ? `<button type="button" class="small secondary" data-action="cancel-filled" data-id="${c.id}" data-filled="no">비었음</button>` : ''}
          <button type="button" class="link small" data-action="cancel-edit" data-id="${c.id}">고치기</button>
          <button type="button" class="link small" data-action="cancel-delete" data-id="${c.id}">지우기</button>
        </span>
      </div>`;
    // 10-23 원장: 한 화면에 다 있으면 스크롤이 길다 → 위 아이콘 단추로 한 칸씩 본다(재고 화면 탭과 같은 방식)
    const waitingN = (state.waitlist ?? []).filter((w) => w.status === 'waiting' && w.dateTo >= d).length;
    const tomorrowN = Store.reminderList(state, shiftDay(d, 1)).send.length;
    const TILES = [
      { key: 'cancel', icon: '✏️', name: '취소 적기', cap: `기록 ${list.length}건`, tag: Store.cancelSummary(state).unknown ? `채워졌나? ${Store.cancelSummary(state).unknown}` : '' },
      { key: 'remind', icon: '🔔', name: '예약 알림톡', cap: `내일 ${tomorrowN}명` },
      { key: 'wait', icon: '🙋', name: '대기 손님', cap: `${waitingN}명 기다림` },
      { key: 'numbers', icon: '📊', name: '취소 숫자', cap: `이번 달 ${month.total}건` },
      { key: 'more', icon: '⏱️', name: '시술 시간표', cap: `${services.length}개` },
    ];
    const tab = TILES.some((t) => t.key === reserve.tab) ? reserve.tab : 'cancel';
    const tiles = `<div class="reserve-tiles">${TILES.map((t) => `<button type="button" data-reserve-tab="${t.key}" class="${tab === t.key ? 'on' : ''}"><span class="ic">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.cap)}</small>${t.tag ? `<span class="tag todo">${esc(t.tag)}</span>` : ''}</button>`).join('')}</div>`;
    const cancelSection = `
        <div class="stock-box entry cancel-box">
          <h3>취소 적기 <small>취소가 날 때마다 한 줄 · 10초</small></h3>
          <textarea id="cancel-text" placeholder="${esc(CANCEL_PLACEHOLDER)}">${esc(reserve.text)}</textarea>
          <div class="split-preview" id="cancel-preview"></div>
          <div class="row" style="margin-top:8px">
            <div class="msg ${reserve.msg ? 'ok' : ''}" id="cancel-msg">${esc(reserve.msg)}</div>
            ${reserve.pendingSms?.length ? `<button type="button" class="small secondary" data-action="sms-copy">문자 글 복사 (${reserve.pendingSms.length}건)</button><button type="button" class="link small" data-action="sms-mark">보낸 것으로 표시</button>` : ''}
            <button type="button" id="cancel-save-btn" data-action="cancel-save" ${ready ? '' : 'disabled'}>취소 적기</button>
          </div>
        </div>
        <h3>취소 기록 <small>${list.length}건</small></h3>
        ${list.length ? list.map(cancelRow).join('') : '<div class="empty">아직 없습니다. 다음 취소가 나면 위 칸에 한 줄 적으세요.</div>'}`;
    const numbersSection = `
        <div class="stock-box">
          <h3>열흘 숫자 <small>${shortDay(TEN_DAYS[0])} ~ ${shortDay(TEN_DAYS[1])} · 젬마 선생님 코칭 전에 잰 것</small></h3>
          ${sumBox(ten)}
          <p class="hint">취소 자리가 비어서 넘어가면 "따로 세울" 값어치가 있고, 새로고침 손님이 거의 다 채우면 지금 방식이 이미 선착순 대기입니다.</p>
        </div>
        <div class="stock-box">
          <h3>이번 달 <small>${Number(d.slice(5, 7))}월 전체</small></h3>
          ${sumBox(month)}
        </div>`;
    const moreSection = `
        <div class="stock-box svc-pointer">
          <h3>시술 시간표 <small>${services.length}개 · 대기 손님에게 맞는 자리를 고를 때 쓰는 "걸리는 시간"</small></h3>
          <p class="hint">더하기 · 고치기 · 지우기는 한곳(타임테이블 밑 [시술항목 관리])에서 합니다.</p>
          <button type="button" class="small secondary" data-action="svc-mgr-open">시술항목 관리 열기</button>
        </div>
        <div class="soon-panel">
          <div class="head"><b>예약 가져오기</b><span class="tag">연결 전</span></div>
          <ul>${['핸드SOS 예약을 오늘 명단으로 가져오기', '네이버 예약을 오늘 명단으로 가져오기'].map((r) => `<li><span>${esc(r)}</span><span class="tag">연결 전</span></li>`).join('')}</ul>
          <p class="hint">오늘 명단은 위 타임테이블입니다. 지금은 손으로 올립니다.</p>
        </div>`;
    const section = { cancel: () => cancelSection, remind: renderRemind, wait: renderWaits, numbers: () => numbersSection, more: () => moreSection }[tab]();
    return `
      <div class="reserve">
        <h2 class="card-title">예약관리 <small>예약 자체는 네이버 · 핸드SOS</small></h2>
        ${!ready ? `<div class="pending"><div class="pending-title">서버에 취소 표가 아직 없습니다</div><p class="hint">Supabase → SQL Editor에서 <code>supabase/schema.sql</code>을 다시 Run 하면 생깁니다. 그 전엔 여기 적어도 저장이 안 됩니다.</p></div>` : ''}
        ${tiles}
        ${section}
      </div>`;
  }
  // ---- 예약 알림톡 (10-21 원장: 발송킹, 전날 오후 6시) ----
  // 보내는 일은 서버(api/remind.js)가 매일 한다. 여기는 내일 보낼 손님 미리 보기·설정 상태·잔액·최근 결과, 멈추기와 [지금 보내기].
  let remindSt = { loading: false, data: null, error: '', at: 0, msg: '' };
  const REMIND_ENV_KO = { BALSONGKING_ID: '카드 전용 아이디', BALSONGKING_PW: '암호', BALSONGKING_CHANNEL: '카톡 채널 아이디', BALSONGKING_CALLBACK: '발신번호', BALSONGKING_TEMPLATE: '템플릿 고유번호', CRON_SECRET: '매일 부르는 열쇠' };
  async function remindCall(method) {
    const session = await DB.session();
    const r = await fetch('/api/remind', { method, headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `알림톡 서버 오류 (${r.status})`);
    return data;
  }
  async function loadRemindStatus(force) {
    if (USE_LOCAL || remindSt.loading || (!force && Date.now() - remindSt.at < 60000)) return;
    remindSt = { ...remindSt, loading: true, error: '' };
    try { remindSt = { ...remindSt, data: await remindCall('GET'), at: Date.now() }; }
    catch (err) { remindSt = { ...remindSt, error: err.message, at: Date.now() }; }
    remindSt = { ...remindSt, loading: false };
    if (view.kind === 'reserve') render();
    else if (view.kind === 'card' && $('#remind-lines')) $('#remind-lines').innerHTML = renderRemindLines(customerOf(view.id));
    else if (view.kind === 'today' && $('.home-grid')) $('#card').innerHTML = renderCenterEmpty();   // 처음 화면은 가운데만(타임테이블 칸에 치던 글이 안 날아가게)   // 카드는 적던 글이 안 날아가게 그 줄만
  }
  function renderRemind() {
    const tm = shiftDay(today(), 1);
    const { send, skip } = Store.reminderList(state, tm);
    const off = !!state.settings?.remindOff;
    const d = remindSt.data;
    const head = USE_LOCAL ? '<span class="tag">시험 모드 · 실제로 보내지 않습니다</span>'
      : remindSt.loading && !d ? '<span class="muted">확인 중…</span>'
      : remindSt.error ? `<span class="bad">상태를 못 읽었습니다: ${esc(remindSt.error)}</span>`
      : !d ? '' : d.missing?.length ? `<span class="tag todo">설정 전</span> <span class="muted">아직 아무것도 나가지 않습니다 · 남은 설정: ${d.missing.map((k) => esc(REMIND_ENV_KO[k] || k)).join(', ')}</span>`
      : `${off ? '<span class="tag todo">멈춤</span>' : '<span class="tag ok">켜짐</span>'} <span class="muted">${d.cash !== undefined ? `발송킹 잔액 ${Number(d.cash).toLocaleString('ko-KR')}원` : ''}</span>`;
    const jobs = (d?.jobs ?? []).slice(0, 5).map((j) => `<li><b>${esc(String(j.subject).replace('예약 알림 ', '').slice(5).replace('-', '.'))} 예약분</b> ${esc(j.sendDate || '')} · ${j.total}명 · <span class="ok">성공 ${j.sent}</span> · <span class="${j.fail ? 'bad' : ''}">실패 ${j.fail}</span>${j.sending ? ` · 보내는 중 ${j.sending}` : ''} <small class="muted">${esc(j.status || '')}</small></li>`).join('');
    // 손님마다 알림이 실제로 갔는지(10-26 원장: "3명만 뜨고 실제로 갔는지 모르겠다"). 내일 예약분(오늘 6시 발송)과 오늘 예약분(어제 발송)
    const resultBlock = (date, title, isToday) => {
      const r = Store.remindReport(state, date, d?.people?.[date] ?? null, now());
      if (isToday) { r.rows = r.rows.filter((x) => x.status.state !== 'warn'); r.count.warn = 0; }   // 오늘 바로 올린 손님은 알릴 일이 없었다(카드 줄과 같게)
      if (!r.rows.length) return '';
      const c = r.count;
      const chips = [c.ok ? `<span class="chip st-ok">✓ 성공 ${c.ok}</span>` : '', c.pending ? `<span class="chip st-pending">⏳ 보낼 예정 ${c.pending}</span>` : '', c.bad ? `<span class="chip st-bad">✕ 실패·안 감 ${c.bad}</span>` : '', c.warn ? `<span class="chip st-warn">! 확인 ${c.warn}</span>` : ''].join('');
      return `
        <div class="remind-result">
          <div class="rr-head"><b>${esc(title)}</b>${chips}</div>
          ${!USE_LOCAL && r.overdue ? `<p class="rr-alarm">오후 6시가 지났는데 발송킹에 이 날 예약분을 보낸 기록이 없습니다. 아래 [지금 보내기]를 누르거나 손님께 직접 연락하세요.</p>` : ''}
          <ul>${r.rows.map((x) => `<li class="st-${x.status.state}" data-open="${x.customer.id}"><span class="nm">${esc(x.customer.name)}</span><span class="tm">${x.at ? esc(Store.timeKo(x.at)) : '시간 없음'}</span><span class="st">${esc(x.status.text)}</span></li>`).join('')}</ul>
        </div>`;
    };
    const results = !USE_LOCAL && remindSt.loading && !d ? '<p class="muted">보낸 결과 확인 중…</p>'
      : `${resultBlock(tm, `내일 ${Store.dateKo(tm)} 예약 · 오늘 오후 6시 발송`)}${resultBlock(today(), `오늘 ${Store.dateKo(today())} 예약 · 어제 오후 6시 발송`, true)}`;
    return `
      <div class="stock-box remind">
        <h3>예약 알림톡 <small>전날 오후 6시 · 발송킹 · 카드에 올린 내일 예약 그대로 나갑니다</small></h3>
        <div class="remind-head">${head}</div>
        <p><b>내일 ${esc(Store.dateKo(tm))}</b> ${off ? '— 멈춤 중이라 안 나갑니다' : `보낼 손님 ${send.length}명`}${send.length ? `: ${send.map((x) => `${esc(x.name)} ${esc(Store.timeKo(x.at))}${x.family ? ` <small class="muted">(${esc(x.family.filter((f) => f.id !== x.customerId).map((f) => f.name).join('·'))} ${x.family.some((f) => f.id === x.customerId) ? '함께' : '대신 받음'})</small>` : ''}`).join(', ')}` : ''}</p>
        ${send.some((x) => !x.service) ? `<p class="muted">시술을 안 고른 손님: ${send.filter((x) => !x.service).map((x) => esc(x.name)).join(', ')} — "예약하신 시술"로 나갑니다. 타임테이블에서 막대를 누르면 밑에서 시술을 고를 수 있어요.</p>` : ''}
        ${skip.length ? `<p class="bad">안 가는 손님 ${skip.length}명: ${skip.map((x) => `${esc(x.name)}(${esc(x.reason)})`).join(', ')} <small class="muted">— 카드에서 번호·시간을 채우면 갑니다</small></p>` : ''}
        ${send.length ? `<details class="remind-preview"><summary>손님이 받는 글 미리 보기 (${esc(send[0].name)})</summary><pre>${esc(Store.reminderText(send[0].vars))}</pre></details>` : ''}
        ${results ? `<h4>손님별로 갔는지 <small class="muted">이름을 누르면 카드</small></h4>${results}` : ''}
        ${jobs ? `<details class="remind-jobs-wrap"><summary>최근 7일 발송 기록 ${(d?.jobs ?? []).length}건</summary><ul class="remind-jobs">${jobs}</ul></details>` : ''}
        <div class="row">
          <div class="msg" id="remind-msg">${esc(remindSt.msg)}</div>
          <button type="button" class="link small" data-action="remind-refresh">새로고침</button>
          <button type="button" class="small secondary" data-action="remind-toggle">${off ? '다시 켜기' : '알림 멈추기'}</button>
          ${!USE_LOCAL && d && !d.missing?.length && !off ? '<button type="button" class="small" data-action="remind-now">지금 보내기</button>' : ''}
        </div>
        <p class="hint">매일 오후 5시대에 내일 명단을 읽어 오후 6시에 나가도록 맡깁니다. 그 뒤에 바꾼 시간·취소는 다시 안 가니 손님께 직접 알려 주세요. 휴가 때는 [알림 멈추기].</p>
      </div>`;
  }

  // ---- 대기 손님 (C안) ----
  // 손님이 wait.html에서 직접 건 줄. 원장은 보기만 하고, 취소를 적으면 맞는 사람에게 문자가 간다. 단추는 주소 복사·네이버 예약 주소 저장·빼기뿐.
  function renderWaits() {
    const d = today();
    const all = Store.expireWaits(state, d).waitlist ?? [];
    const waiting = Store.waitQueue({ ...state, waitlist: all });   // 줄 순서: 먼저 건 순, 문자 받은 사람은 맨 뒤
    const rest = all.filter((w) => w.status !== 'waiting' && w.status !== 'left').slice(-10);
    const row = (w) => `
      <div class="cancel-row wait ${w.status}" data-wid="${w.id}">
        <span class="when"><b>${esc(Store.monthLabel(w.dateTo.slice(0, 7)))}</b><small class="win">${esc(Store.dayLabels(w.days))} ${esc(Store.windowLabels(w.windows))}</small></span>
        <span class="nm">${esc(w.name)} <small>${esc(Store.maskPhone(w.phone))}</small><small class="note">${esc(w.service)}${w.minutes ? ` ${w.minutes}분` : ''}${w.note ? ` · ${esc(w.note)}` : ''} · ${esc(shortDay(w.createdAt.slice(0, 10)))} 걸음</small></span>
        <span class="before">${w.status === 'waiting' ? `같은 조건 ${Store.waitPosition(state, w.id)}번째` : w.status === 'expired' ? '기간 지남' : w.status === 'booked' ? '예약됨' : ''}${(w.notified ?? []).length ? ` · 문자 ${w.notified.length}번` : ''}</span>
        <span class="acts"><button type="button" class="link small" data-action="wait-leave" data-id="${w.id}">빼기</button></span>
      </div>`;
    return `
      <div class="stock-box waits">
        <h3>대기 손님 <small>${waiting.length}명 기다리는 중 · 줄 순서대로 · 취소를 적으면 맞는 사람 중 앞 ${Store.NOTIFY_LIMIT}명에게 한꺼번에 문자, 받은 사람은 맨 뒤로</small></h3>
        ${!waitReady() ? `<div class="pending"><div class="pending-title">서버에 대기 표가 아직 없습니다</div><p class="hint">schema.sql을 다시 Run 하면 생깁니다. 그 전엔 손님 페이지에서 대기를 걸 수 없습니다.</p></div>` : ''}
        <div class="wait-link"><span class="lb">손님 페이지</span><code id="wait-url">${esc(waitPageUrl())}</code><button type="button" class="small secondary" data-action="wait-copy">주소 복사</button><a class="small" href="${esc(waitPageUrl())}" target="_blank" rel="noopener">열어 보기</a></div>
        <p class="hint">"왜 예약이 안 돼요?" 전화가 오면 이 주소를 문자로 보내세요. 손님이 걸고 바꾸고 빼는 건 전부 손님이 합니다.</p>
        <div class="wait-link"><span class="lb">네이버 예약 주소</span><input type="text" id="booking-url" value="${esc(Store.bookingUrlOf(state))}" placeholder="https://booking.naver.com/… (자리 났어요 문자에 들어갑니다)"><button type="button" class="small" data-action="booking-save">저장</button></div>
        <div class="msg" id="wait-msg"></div>
        ${waiting.length ? waiting.map(row).join('') : '<div class="empty">아직 대기 손님이 없습니다.</div>'}
        ${rest.length ? `<details class="trash"><summary>끝난 대기 ${rest.length}건</summary>${rest.map(row).join('')}</details>` : ''}
      </div>`;
  }
  // 취소를 적은 뒤: 맞는 대기 손님에게 문자. 시험 모드는 보낸 것으로만 표시. 실패하면 글을 복사할 수 있게 남긴다
  async function sendNotices(cancel) {
    const targets = matchesFor(cancel);
    if (!targets.length) return;
    const items = targets.map((w) => ({ id: w.id, cancelId: cancel.id, to: w.phone, text: Store.noticeText(state, cancel, waitUrlFor(w)) }));
    const names = targets.map((w) => w.name).join(', ');
    if (USE_LOCAL) { commit(Store.markNotified(state, items.map((i) => i.id), cancel.id, now())); reserve = { ...reserve, msg: `${reserve.msg} · 시험 모드: ${names}에게 문자 보낸 것으로 표시` }; render(); return; }
    try {
      const session = await DB.session();
      const r = await fetch('/api/sms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` }, body: JSON.stringify({ messages: items.map(({ to, text }) => ({ to, text })) }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `문자 보내기 실패 (${r.status})`);
      const failedTo = new Set((data.failed ?? []).map((f) => String(f.to)));
      const okIds = items.filter((i) => !failedTo.has(i.to)).map((i) => i.id);
      if (okIds.length) commit(Store.markNotified(state, okIds, cancel.id, now()));
      reserve = { ...reserve, msg: `${reserve.msg} · 문자 ${okIds.length}건 보냄 (${names})${failedTo.size ? ` · 실패 ${failedTo.size}건` : ''}`, pendingSms: failedTo.size ? items.filter((i) => failedTo.has(i.to)) : null };
    } catch (err) {
      reserve = { ...reserve, msg: `${reserve.msg} · 문자를 못 보냈습니다: ${err.message}`, pendingSms: items };
    }
    render();
  }
  function reserveAction(a, btn) {
    const id = Number(btn.dataset.id);
    if (a === 'cancel-save') {
      const r = Store.addCancel(state, { text: $('#cancel-text').value }, now(), today());
      commit(r.state);
      reserve = { ...reserve, text: '', pendingSms: null, msg: `적었습니다: ${shortDay(r.cancel.date)}${cancelTime(r.cancel.time)} ${r.cancel.service || ''} · ${FILLED_LABEL[r.cancel.filled]}${r.cancel.filled === 'unknown' ? ' (채워지면 기록 옆 단추로)' : ''}` };
      render(); $('#cancel-text')?.focus();
      if (r.cancel.filled !== 'yes') sendNotices(r.cancel);
      return;
    }
    if (a === 'remind-refresh') { loadRemindStatus(true); return; }
    if (a === 'remind-toggle') { commit(Store.setRemindOff(state, !state.settings?.remindOff)); remindSt = { ...remindSt, msg: state.settings?.remindOff ? '알림을 멈췄습니다. [다시 켜기]를 누를 때까지 안 나갑니다' : '알림을 다시 켰습니다' }; render(); return; }
    if (a === 'remind-now') {
      const n = Store.reminderList(state, shiftDay(today(), 1)).send.length;
      if (!confirm(`내일 예약 ${n}명에게 알림톡을 지금 보냅니다. (오후 6시 전이면 6시에 나가도록 맡깁니다. 이미 맡긴 날이면 다시 보내지 않습니다)\n\n보낼까요?`)) return;
      remindSt = { ...remindSt, msg: '보내는 중…' }; render();
      remindCall('POST').then((r) => {
        remindSt = { ...remindSt, msg: r.skipped ? `안 보냄: ${r.skipped}` : r.sent ? `${r.sent}명 맡김 (${r.sendAt})` : '보낼 손님이 없습니다' };
        loadRemindStatus(true); render();
      }).catch((err) => { remindSt = { ...remindSt, msg: `못 보냈습니다: ${err.message}` }; render(); });
      return;
    }
    if (a === 'sms-copy') {
      const text = (reserve.pendingSms ?? []).map((i) => `${i.to}\n${i.text}`).join('\n\n');
      navigator.clipboard?.writeText(text).then(() => showMsg($('#cancel-msg'), '문자 글을 복사했습니다. 핸드폰 문자 앱에 붙여 보내세요', 'ok'));
      return;
    }
    if (a === 'sms-mark') { commit(Store.markNotified(state, (reserve.pendingSms ?? []).map((i) => i.id), (reserve.pendingSms ?? [])[0]?.cancelId ?? null, now())); reserve = { ...reserve, pendingSms: null, msg: '보낸 것으로 표시했습니다' }; render(); return; }
    if (a === 'wait-copy') { navigator.clipboard?.writeText(waitPageUrl()).then(() => showMsg($('#wait-msg'), '주소를 복사했습니다. 문자에 붙여 보내세요', 'ok')); return; }
    if (a === 'booking-save') { commit(Store.setBookingUrl(state, $('#booking-url').value)); showMsg($('#wait-msg'), Store.bookingUrlOf(state) ? '네이버 예약 주소를 저장했습니다. 자리 났어요 문자에 들어갑니다' : '비웠습니다. 문자에는 주소 없이 "네이버 예약에서"만 들어갑니다', 'ok'); return; }
    if (a === 'wait-leave') {
      const w = state.waitlist.find((x) => x.id === id);
      if (!confirm(`${w?.name ?? ''}님의 대기를 뺄까요? 자리 안내 문자가 더 가지 않습니다.`)) return;
      commit(Store.leaveWait(state, id)); render(); return;
    }
    if (a === 'cancel-filled') { commit(Store.setCancelFilled(state, id, btn.dataset.filled)); reserve = { ...reserve, msg: '' }; render(); return; }
    if (a === 'cancel-edit') { reserve = { ...reserve, editId: id, msg: '' }; render(); $('#cancel-edit-text')?.focus(); return; }
    if (a === 'cancel-edit-cancel') { reserve = { ...reserve, editId: null }; render(); return; }
    if (a === 'cancel-edit-save') {
      const r = Store.editCancel(state, id, { text: $('#cancel-edit-text').value }, today());
      commit(r.state); reserve = { ...reserve, editId: null, msg: '고쳤습니다' }; render(); return;
    }
    if (a === 'cancel-delete') {
      const c = state.cancels.find((x) => x.id === id);
      if (!confirm(`이 취소 기록을 지울까요?\n${c?.note ?? ''}\n\n(휴지통 없이 바로 지워집니다)`)) return;
      commit(Store.deleteCancel(state, id)); reserve = { ...reserve, msg: '지웠습니다' }; render(); return;
    }
    if (a === 'svc-mgr-open') { openSvcMgr(); redrawSvcMgr(); bringIntoView('#timeline'); $('#svc-mgr')?.scrollIntoView({ block: 'nearest' }); return; }
  }

  // ---- V3: 오늘 확인할 것 ------------------------------------------------
  // DK님 홈 화면 방식: 할 일은 빨간 딱지, 끝난 것은 초록 체크, 아직 연결 전인 것은 회색 "연결 전".
  // 할 일이 위, 끝난 것이 가운데, 연결 전이 맨 아래. 숫자는 전부 카드 기록에서 그때그때 센다.
  const stockReady = () => USE_LOCAL || !DB.missingTables().some((t) => t === 'card_products' || t === 'card_stock_logs');
  function checkRows() {
    const d = today();
    const list = Store.todayList(state, d);
    const pending = Store.pendingList(state, d);
    const notYet = list.filter((t) => !t.recorded).length;
    const over = Store.overdueCustomers(state, d, state.settings.overdueFactor ?? 1.5).length;
    const short = Store.shortProducts(state);
    const ordered = Store.orderedProducts(state, d);
    const rows = [];
    if (pending.length) rows.push({ icon: '📝', text: `아직 안 적은 지난 명단 ${pending.length}명`, state: 'todo', badge: '적기', go: 'today' });
    else rows.push({ icon: '📝', text: '지난 명단은 다 적었습니다', state: 'ok', badge: '완료', go: 'today' });
    if (list.length === 0) rows.push({ icon: '📅', text: '오늘 명단이 비어 있습니다. 예약 명단을 보고 올리세요', state: 'todo', badge: '올리기', go: 'today' });
    else if (notYet) rows.push({ icon: '📅', text: `오늘 ${list.length}명 중 ${notYet}명 아직 안 적음`, state: 'todo', badge: '보기', go: 'today' });
    else rows.push({ icon: '📅', text: `오늘 ${list.length}명 모두 기록 남김`, state: 'ok', badge: '완료', go: 'today' });
    if (over) rows.push({ icon: '🔔', text: `평소 주기보다 오래 안 온 고객 ${over}명`, state: 'todo', badge: '보기', go: 'monthly' });
    else rows.push({ icon: '🔔', text: '평소 주기를 넘긴 고객 없음', state: 'ok', badge: '정상', go: 'monthly' });
    if (!stockReady()) rows.push({ icon: '📦', text: '재고 표를 아직 안 만들었습니다 (schema.sql Run)', state: 'todo', badge: '보기', go: 'stock' });
    else if (Store.liveProducts(state).length === 0) rows.push({ icon: '📦', text: '제품 목록이 비어 있습니다. 떨어지면 곤란한 제품부터 넣으세요', state: 'todo', badge: '넣기', go: 'stock' });
    else {
      if (short.length) rows.push({ icon: '📦', text: `주문할 제품 ${short.length}개 · ${short.slice(0, 3).map((p) => p.name).join(', ')}${short.length > 3 ? ' …' : ''}`, state: 'todo', badge: '보기', go: 'stock' });
      else rows.push({ icon: '📦', text: '주문할 제품 없음', state: 'ok', badge: '정상', go: 'stock' });
      if (ordered.length) rows.push({ icon: '🚚', text: `도착 기다리는 제품 ${ordered.length}개 · 가장 오래된 것 ${ordered[0].days}일째`, state: 'todo', badge: '보기', go: 'stock' });
      const fs = Store.fillSuggestions(state).length;
      if (fs) rows.push({ icon: '📈', text: `채워 둘 개수 제안 ${fs}개 (최근 3달 사용량 기준)`, state: 'todo', badge: '보기', go: 'stock-usage' });
      if (Store.countDue(state, d)) rows.push({ icon: '🔢', text: `이번 달 재고 세기 아직 · 매달 1일에 세면 지난달 사용량이 나옵니다 (마지막 ${Store.lastCountDate(state) ? shortDay(Store.lastCountDate(state)) : '없음'})`, state: 'todo', badge: '세기', go: 'stock-count' });
      else rows.push({ icon: '🔢', text: `이번 달 재고 셈 (${shortDay(Store.lastCountDate(state))})`, state: 'ok', badge: '완료', go: 'stock-count' });
    }
    // 내일 예약 (10-14 원장): 미리 올려 두면 알림톡을 이으면 그대로 쓴다. 번호 없는 손님은 알림톡이 못 간다
    const tm = Store.bookingSummary(state, shiftDay(d, 1));
    const rm = Store.reminderList(state, shiftDay(d, 1));   // 10-21: 오후 6시 알림톡에 안 가는 손님(번호·시간 없음)
    let rmText = state.settings?.remindOff ? '알림톡 멈춤' : `오늘 오후 6시 알림톡 ${rm.send.length}명`;
    // 보낸 결과(10-26): 발송킹 결과를 받아 왔으면 성공·실패 수, 6시가 지났는데 기록이 없으면 할 일
    const rd = remindSt.data;
    if (!USE_LOCAL && rd && !state.settings?.remindOff) {
      const r = Store.remindReport(state, shiftDay(d, 1), rd.people?.[shiftDay(d, 1)] ?? null, now());
      if (r.overdue) rows.push({ icon: '🔔', text: `오후 6시가 지났는데 내일 예약 알림톡을 보낸 기록이 없습니다 (${r.rows.length}명)`, state: 'todo', badge: '확인', go: 'reserve-remind' });
      else if (r.sent) rows.push({ icon: '🔔', text: `내일 예약 알림톡 결과 · 성공 ${r.count.ok}${r.count.bad ? ` · 실패·안 감 ${r.count.bad}` : ''}${r.count.pending ? ` · 보내는 중 ${r.count.pending}` : ''}`, state: r.count.bad ? 'todo' : 'ok', badge: '보기', go: 'reserve-remind' });
      const t = Store.remindReport(state, d, rd.people?.[d] ?? null, now());
      const miss = t.rows.filter((x) => x.status.state === 'bad');
      if (miss.length) rows.push({ icon: '🔔', text: `오늘 예약 중 알림을 못 받은 손님 ${miss.length}명 · ${miss.slice(0, 3).map((x) => x.customer.name).join(', ')}`, state: 'todo', badge: '보기', go: 'reserve-remind' });
    }
    if (tm.total && rm.skip.length) rows.push({ icon: '🗒️', text: `내일 예약 ${tm.total}명 · ${rmText} · 안 가는 손님 ${rm.skip.length}명 (${rm.skip.slice(0, 3).map((x) => `${x.name} ${x.reason}`).join(', ')})`, state: 'todo', badge: '보기', go: 'tomorrow' });
    else if (tm.total) rows.push({ icon: '🗒️', text: `내일 예약 ${tm.total}명 올려 둠 · ${rmText}`, state: 'ok', badge: '보기', go: 'tomorrow' });
    else rows.push({ icon: '🗒️', text: '내일 예약을 아직 안 올렸습니다 (타임테이블 ▶로 내일을 열어 올리기)', state: 'ok', badge: '올리기', go: 'tomorrow' });
    const pb = Store.preBookDates(d);
    if (pb.phase === 'eve') rows.push({ icon: '📨', text: `내일은 ${Number(pb.month.slice(5, 7))}월 선예약 연락일 · 대상 ${Store.preBookTargets(state, d).length}명 · 문구 확인`, state: 'todo', badge: '보기', go: 'prebook' });
    const duePast = Store.dueCustomers(state, d, 0).length;
    if (duePast) rows.push({ icon: '📞', text: `권한 주기가 지난 고객 ${duePast}명 (연락할 손님)`, state: 'todo', badge: '보기', go: 'cm-due' });
    else rows.push({ icon: '📞', text: '권한 주기가 지난 고객 없음', state: 'ok', badge: '정상', go: 'cm-due' });
    // 취소 적기 (10-11): 채워졌는지 아직 모르는 기록이 있으면 할 일, 아니면 열흘 숫자
    if (!cancelReady()) rows.push({ icon: '🗓️', text: '취소 표를 아직 안 만들었습니다 (schema.sql Run)', state: 'todo', badge: '보기', go: 'reserve' });
    else {
      const cs = Store.cancelSummary(state, TEN_DAYS[0], TEN_DAYS[1]);
      const un = Store.cancelSummary(state).unknown;
      if (un) rows.push({ icon: '🗓️', text: `취소 자리가 채워졌는지 아직 안 적은 것 ${un}건`, state: 'todo', badge: '표시', go: 'reserve' });
      else rows.push({ icon: '🗓️', text: cs.total ? `열흘 취소 ${cs.total}건 · 채워짐 ${cs.filled} · 비었음 ${cs.empty}` : '취소 기록 없음 · 취소가 나면 [예약관리]에 한 줄', state: 'ok', badge: cs.total ? '보기' : '정상', go: 'reserve' });
      const waiting = (state.waitlist ?? []).filter((w) => w.status === 'waiting' && w.dateTo >= d).length;
      if (waiting) rows.push({ icon: '🙋', text: `대기 손님 ${waiting}명 (취소를 적으면 맞는 사람에게 문자)`, state: 'ok', badge: '보기', go: 'reserve-wait' });
    }
    rows.push({ icon: '💌', text: '시술 뒤 안부 (펌·염색 며칠 뒤)', state: 'soon', badge: '연결 전', go: 'soon-contact' });
    rows.push({ icon: '📥', text: '예약 가져오기 (핸드SOS → 오늘 명단)', state: 'soon', badge: '연결 전', go: 'soon-reserve' });
    rows.push({ icon: '💬', text: '새 문의 (네이버 톡톡 · 카카오 채널)', state: 'soon', badge: '연결 전', go: 'soon-inbox' });
    const rank = { todo: 0, ok: 1, soon: 2 };
    return rows.sort((a, b) => rank[a.state] - rank[b.state]);
  }
  const SOON_HINTS = {
    'soon-contact': '펌·염색 며칠 뒤 안부를 챙길 손님 목록은 아직 연결 전입니다. 권한 주기가 지난 손님은 [고객 관리]에 있습니다.',
    'soon-reserve': '핸드SOS 예약을 카드 명단으로 가져오는 기능은 아직 연결 전입니다. 지금은 아침에 손으로 올립니다.',
    'soon-inbox': '네이버 톡톡·카카오 채널 문의를 한곳에 모아 답하는 기능은 나중에 만듭니다 (원장 결정 10-01).',
  };
  // ---- 처음 화면 = 분류 상자 (10-26 원장: 왼쪽 메뉴와 "오늘 확인할 것" 줄글을 가운데 큰 네모 상자로 합침) ----
  // 상자마다 큰 아이콘·이름·할 일 수, 안에 그 분류의 확인할 것(checkRows를 go로 나눔). 상자 머리를 누르면 그 화면, 줄을 누르면 그 일로.
  // 처음 화면에서는 왼쪽 메뉴를 감추고(body.home), 다른 화면에서는 왼쪽 메뉴 맨 위 [처음 화면]으로 돌아온다.
  const HOME_CATS = [
    { key: 'today', icon: '✂️', name: '오늘 손님', sub: '기록 남기기' },
    { key: 'customers', icon: '👥', name: '고객 관리', sub: '찾기 · 등록 · 연락할 손님' },
    { key: 'reserve', icon: '📅', name: '예약관리', sub: '내일 예약 · 알림톡 · 취소 · 대기' },
    { key: 'stock', icon: '📦', name: '재고관리', sub: '주문 · 도착 · 세기' },
    { key: 'monthly', icon: '📊', name: '결산', sub: '월별 · 재방문 · 주기' },
    { key: 'chat', icon: '💬', name: '고객 채팅', sub: '카카오 · 네이버 톡톡' },
  ];
  const catOfGo = (go) => (go === 'today' ? 'today' : go === 'monthly' ? 'monthly' : go.startsWith('stock') ? 'stock'
    : ['prebook', 'cm-due', 'soon-contact', 'trash'].includes(go) ? 'customers' : go === 'soon-inbox' ? 'chat' : 'reserve');
  function renderHome() {
    if (!USE_LOCAL && !remindSt.loading && !remindSt.error && (!remindSt.data || Date.now() - remindSt.at > 5 * 60000)) loadRemindStatus();   // 알림톡 결과(10-26)
    const rows = checkRows();
    const gone = Store.deletedCustomers(state).length;
    if (gone) rows.push({ icon: '🗑️', text: `지운 고객 ${gone}명 (되살리기·완전히 지우기)`, state: 'ok', badge: '보기', go: 'trash' });
    const todo = rows.filter((r) => r.state === 'todo').length;
    const rank = { todo: 0, ok: 1, soon: 2 };
    return `
      <div class="home-top"><b>오늘 확인할 것</b><span class="count ${todo ? 'todo' : 'ok'}">${todo ? `할 일 ${todo}건` : '모두 확인함'}</span><small>${today().replace(/-/g, '.')}</small></div>
      <div class="home-grid">
        ${HOME_CATS.map((c) => {
          const mine = rows.filter((r) => catOfGo(r.go) === c.key).sort((a, b) => rank[a.state] - rank[b.state]);
          const n = mine.filter((r) => r.state === 'todo').length;
          const soonOnly = mine.length && mine.every((r) => r.state === 'soon');
          return `
          <section class="home-tile ${n ? 'todo' : soonOnly ? 'soon' : 'ok'}">
            <button type="button" class="home-head" data-home-open="${c.key}" title="${esc(c.name)} 열기">
              <span class="big">${c.icon}</span>
              <span class="nm"><b>${esc(c.name)}</b><small>${esc(c.sub)}</small></span>
              <span class="cnt">${n ? `할 일 ${n}` : soonOnly ? '연결 전' : '✓ 다 됨'}</span>
            </button>
            <ul>${mine.map((r) => `<li class="${r.state}" data-go="${r.go}"><span class="ic">${r.icon}</span><span class="tx">${esc(r.text)}</span><span class="badge">${r.state === 'ok' ? '✓ ' : ''}${r.badge}</span></li>`).join('')}</ul>
          </section>`;
        }).join('')}
      </div>
      ${checksHint ? `<p class="hint">${esc(checksHint)}</p>` : ''}`;
  }
  function goCheck(go) {
    checksHint = '';
    if (go === 'today') { tlDate = today(); render(); bringIntoView('#timeline'); $('#add-name')?.focus(); return; }
    if (go === 'tomorrow') { tlDate = shiftDay(today(), 1); render(); bringIntoView('#timeline'); $('#add-name')?.focus(); return; }
    if (go === 'monthly') { view = { kind: 'monthly', month: today().slice(0, 7) }; monthTab = 'over'; render(); bringIntoView('#card'); return; }
    if (go === 'stock-usage') { stock = { ...stock, tab: 'usage', editId: null, arriveId: null, msg: '' }; view = { kind: 'stock' }; render(); bringIntoView('#card'); return; }
    if (go === 'stock' || go === 'stock-count') {
      const empty = Store.liveProducts(state).length === 0;
      stock = { ...stock, mode: 'count', addOpen: go === 'stock' && empty, tab: go === 'stock-count' ? 'entry' : empty ? 'list' : 'order', editId: null, arriveId: null }; view = { kind: 'stock' }; render(); bringIntoView('#card'); if (go === 'stock-count') $('#stock-text')?.focus(); return; }
    if (go === 'prebook') { view = { kind: 'customers' }; custQ = ''; preBook = { ...preBook, manage: true }; render(); bringIntoView('#card'); $('#cm-prebook')?.scrollIntoView({ block: 'start' }); return; }
    if (go === 'cm-due') { view = { kind: 'customers' }; custQ = ''; render(); bringIntoView('#card'); $('#cm-due')?.scrollIntoView({ block: 'start' }); return; }
    if (go === 'reserve') { view = { kind: 'reserve' }; reserve = { ...reserve, editId: null, msg: '', tab: 'cancel' }; loadRemindStatus(); render(); bringIntoView('#card'); $('#cancel-text')?.focus(); return; }
    if (go === 'reserve-remind') { view = { kind: 'reserve' }; reserve = { ...reserve, editId: null, msg: '', tab: 'remind' }; loadRemindStatus(true); render(); bringIntoView('#card'); return; }
    if (go === 'reserve-wait') { view = { kind: 'reserve' }; reserve = { ...reserve, editId: null, msg: '', tab: 'wait' }; render(); bringIntoView('#card'); return; }
    if (go === 'trash') { trashOpen = true; openMenu('customers'); return; }
    if (SOON_HINTS[go]) { checksHint = SOON_HINTS[go]; render(); }
  }

  // ---- V3: 재고 ------------------------------------------------------------
  // 도착 기다리는 제품(10-15 원장): 주문한 개수를 보고, 온 것만 체크해 맨 위 [도착함]으로 한꺼번에 넣는다.
  // 체크하면 "들어온 개수" 칸이 주문한 개수로 채워져 열리고, 덜 왔으면 그 수만 고친다. 체크·개수는 stock.arrive에 둔다(다시 그려도 남게).
  function renderArriving(ordered) {
    const sel = stock.arrive;
    const n = ordered.filter(({ product: p }) => p.id in sel).length;
    const all = n === ordered.length;
    const guessed = ordered.some((o) => !o.recorded);
    return `
      <div class="arrive-box">
        <div class="arrive-head">
          <h3>도착 기다리는 제품 <small>${ordered.length}개</small></h3>
          <label class="inline arrive-all"><input type="checkbox" data-arrive-all ${all ? 'checked' : ''}> 전부 체크</label>
          <button type="button" class="small" data-action="stock-arrive-many" ${n ? '' : 'disabled'}>${n ? `체크한 ${n}개 도착함` : '도착함'}</button>
        </div>
        <p class="hint">온 것만 체크하고 [도착함]을 누르세요. 체크하면 들어온 개수가 주문한 개수로 채워지고, 덜 왔으면 그 수만 고치면 됩니다.${guessed ? ' <b>(계산)</b>이 붙은 것은 보낸 개수를 남기기 전에 주문해서, 채워 둘 개수 − 지금 재고로 계산한 수입니다.' : ''}</p>
        ${ordered.map(({ product: p, days, ordered: q, recorded }) => {
          const on = p.id in sel;
          return `
          <div class="stock-row arrive-row ${on ? 'on' : ''}" data-pid="${p.id}">
            <label class="nm"><input type="checkbox" data-arrive-chk="${p.id}" ${on ? 'checked' : ''}> ${esc(p.name)} <small>${days === 0 ? '오늘 주문' : `${days}일째`}</small></label>
            <span class="ordq">주문 <b>${q || '?'}</b>개${recorded ? '' : ' <small>(계산)</small>'}</span>
            <span class="inq">${on ? `들어온 <input type="text" class="num arrive-qty" inputmode="numeric" data-arrive-qty="${p.id}" value="${esc(sel[p.id])}" placeholder="?">개` : ''}</span>
            <span class="min">지금 재고 ${p.qty}개</span>
            <span class="acts"><button type="button" class="link small" data-action="stock-unorder" data-id="${p.id}">주문 취소</button></span>
          </div>`;
        }).join('')}
      </div>`;
  }

  // 위에서 아래로: 주문할 제품 → 도착 기다리는 제품 → 세기·입고 적는 칸 → 제품 목록 → 기록.
  // ---- 거래처별 주문 (10-06 원장 결정) ----
  // 주문할 제품을 카톡 보낼 상대별로 묶고, 묶음마다 보낼 글을 미리 보여 준다. 개인 카톡은 바로 보내는 길이 없어서
  // PC는 [주문 글 복사] → PC 카카오톡에 붙여 넣기, 핸드폰은 [카톡으로 보내기] → 공유 창 → 카카오톡 → 대화방.
  // 보낸 뒤 [보냈어요 · 전부 주문함]으로 묶음 전체를 도착 대기로 넘긴다. 이번만 바꾼 수량은 저장하지 않는다.
  const canShare = () => !!navigator.share && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const supplierReady = () => USE_LOCAL || !DB.missingTables().includes('card_products.supplier');
  function renderOrderGroups(groups) {
    const share = canShare();
    return groups.map((g, gi) => `
      <div class="order-group" data-gi="${gi}">
        <div class="og-head"><b>${g.supplier ? esc(g.supplier) : '거래처 미정'}</b><small>${g.items.length}개 제품</small></div>
        ${g.items.map((p) => `
          <div class="stock-row short" data-pid="${p.id}">
            <span class="nm">${esc(p.name)}</span>
            <span class="qty"><b>${p.qty}</b><small>개</small></span>
            <span class="min">기준 ${p.min}</span>
            <label class="inline oq-l">이번 주문 <input type="text" class="num oq" inputmode="numeric" data-pid="${p.id}" value="${esc(String(stock.orderQtys[p.id] ?? (Store.orderAmount(p) || '')))}" placeholder="?">개${p.fillTo ? `<small> (${p.fillTo}개까지)</small>` : ''}</label>
            <span class="acts">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="link">주문처</a>` : ''}<button type="button" class="link small" data-action="stock-ordered" data-id="${p.id}" title="이 제품만 도착 대기로">주문함</button><button type="button" class="link small" data-action="stock-mute" data-id="${p.id}" title="이 제품은 부족해도 알리지 않습니다">알림 끄기</button></span>
          </div>`).join('')}
        <pre class="order-msg" data-gi="${gi}">${esc(Store.orderMessage(state, g.supplier, stock.orderQtys) || '이번엔 보낼 제품이 없습니다 (이번 주문을 전부 0으로 했습니다)')}</pre>
        <div class="row og-acts">
          <div class="msg" id="og-msg-${gi}"></div>
          ${share ? `<button type="button" class="small" data-action="stock-order-share" data-gi="${gi}">카톡으로 보내기</button>` : ''}
          <button type="button" class="${share ? 'secondary ' : ''}small" data-action="stock-order-copy" data-gi="${gi}">주문 글 복사</button>
          <button type="button" class="secondary small" data-action="stock-order-done" data-gi="${gi}">보냈어요 · 전부 주문함</button>
        </div>
        ${g.supplier ? '' : '<p class="hint">제품 [고치기]에서 거래처와 채워 둘 개수를 적어 두면 다음부터 그 거래처로 묶이고, 모자란 만큼 주문 개수가 채워집니다.</p>'}
      </div>`).join('');
  }
  const orderGroupAt = (gi) => Store.orderGroups(state)[Number(gi)];
  const orderMsgOf = (g) => Store.orderMessage(state, g.supplier, stock.orderQtys);
  function sendOrder(gi, how) {
    const g = orderGroupAt(gi);
    const box = $(`#og-msg-${gi}`);
    const text = g ? orderMsgOf(g) : '';
    if (!text) { showMsg(box, '보낼 제품이 없습니다', 'error'); return; }
    const who = g.supplier || '거래처';
    const after = '보냈으면 [보냈어요 · 전부 주문함]을 누르세요';
    if (how === 'share') {
      navigator.share({ text }).then(() => showMsg(box, after, 'ok'))
        .catch((err) => { if (err && err.name === 'AbortError') return; sendOrder(gi, 'copy'); });
      return;
    }
    copyText(text).then((ok) => showMsg(box, ok ? `복사했습니다. 카카오톡에서 ${who} 대화방을 열고 붙여 넣으세요(PC는 Ctrl+V). ${after}` : '자동 복사가 막혔습니다. 위 글을 길게 눌러 복사하세요', ok ? 'ok' : 'error'));
  }

  // 숫자가 바뀌는 길은 적는 칸 하나뿐이다. 목록에서는 이름·분류·기준·주소만 고친다.
  const CAT_OPTIONS = (sel) => Store.STOCK_CATEGORIES.map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c}</option>`).join('');
  // 거래처는 타자 대신 눌러서 고른다(10-08 원장). [+ 업체]로 더한 이름은 제품을 [저장]/[넣기] 할 때 목록에 남는다.
  const supChip = (nm, n, on) => `<label><input type="radio" name="${nm}" value="${esc(n)}" ${on ? 'checked' : ''}> ${esc(n)}</label>`;
  const supplierPick = (nm, cur = '') => {
    const list = Store.supplierList(state);
    const names = !cur || list.includes(cur) ? list : [...list, cur];
    return `
      <div class="sup-pick" data-sup-name="${nm}">
        <div class="chips"><span class="sup-label">거래처</span>${names.map((n) => supChip(nm, n, n === cur)).join('')}<label><input type="radio" name="${nm}" value="" ${cur ? '' : 'checked'}> 미정</label><button type="button" class="link small" data-action="sup-add-open">+ 업체</button></div>
        <div class="sup-new" hidden><input type="text" class="sup-new-name" placeholder="새 업체 이름 (카톡 보낼 상대)" autocomplete="off"><button type="button" class="small" data-action="sup-add">추가</button></div>
      </div>`;
  };
  const pickedSupplier = (nm) => $(`input[name="${nm}"]:checked`)?.value ?? '';
  // 새로 더한 업체면 거래처 목록에도 남긴다(이미 있으면 그대로)
  const withSupplier = (st, sup) => (sup ? Store.addSupplier(st, sup).state : st);
  // ---- 월별 재고표 (10-09 원장): 제품마다 달별 1일 재고 · 입고 · 사용(카드 계산) + 채워 둘 개수 제안 ----
  // 석 달씩 보이고 ◀ ▶로 넘긴다(stock.sheetEnd = 맨 오른쪽 달, null이면 가장 최근). 제안은 원장이 [적용]해야 바뀐다.
  const monthShort = (m) => `${Number(m.slice(5, 7))}월`;
  const addMonth = (m, n) => { const d = new Date(m + '-01T00:00:00'); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  function renderUsage(products, sugg) {
    const sheets = products.map((p) => ({ p, sh: Store.stockSheet(state, p.id) }));
    const all = [...new Set(sheets.flatMap((r) => Object.keys(r.sh)))].sort();
    const last = all.length ? all[all.length - 1] : today().slice(0, 7);
    const first = all.length ? all[0] : last;
    const end = stock.sheetEnd && stock.sheetEnd >= first && stock.sheetEnd <= last ? stock.sheetEnd : last;
    const months = [addMonth(end, -2), addMonth(end, -1), end];
    const md = (d) => `${Number(d.slice(5, 7))}.${d.slice(8, 10)}`;
    const cells = (sh, m) => {
      const x = sh[m];
      if (!x) return '<td class="num muted"></td><td class="in muted"></td><td class="use muted"></td>';
      const startNote = x.startAt.slice(8, 10) !== '01' ? ` <small title="${x.startAt.replace(/-/g, '.')}에 셈">${md(x.startAt)}</small>` : '';
      const ins = x.ins.length ? x.ins.map((i) => `${md(i.date)} · ${i.qty}`).join('<br>') : '<span class="muted">—</span>';
      const use = x.used === null ? '<td class="use open" title="다음 달 1일에 세면 나옵니다">—</td>'
        : x.used < 0 ? `<td class="use neg" title="센 개수가 더 많았습니다. 들어온 것을 안 적었거나 잘못 셌을 수 있어 평균에서 뺍니다">${x.used} 확인</td>`
        : `<td class="use">${x.used}</td>`;
      return `<td class="num" title="${x.startAt.replace(/-/g, '.')}에 셈">${x.start}${startNote}</td><td class="in">${ins}</td>${use}`;
    };
    return `
      <p class="hint">달마다 <b>1일 재고</b>(그 달 처음 센 개수) · <b>입고</b>(날짜·수량) · <b>사용</b>(1일 재고 + 입고 − 다음 달 1일 재고, 카드가 계산)이 쌓입니다. 매달 1일에 세고, 들어온 것을 빠짐없이 적어야 정확합니다.</p>
      ${sugg.length ? `
        <div class="stock-box usage-sugg">
          <h3>채워 둘 개수 제안 <small>${sugg.length}개 · 최근 3달 평균 + 부족 기준 · 누르기 전엔 안 바뀝니다</small> <button type="button" class="small" data-action="fill-apply-all">전부 적용</button></h3>
          ${sugg.map((x) => `
            <div class="stock-row" data-pid="${x.product.id}">
              <span class="nm">${esc(x.product.name)}<small class="sup">${x.months.map(monthShort).join('·')} ${x.used.join('·')}개 → 평균 ${x.avg} + 기준 ${x.product.min}${x.warn ? ` · ${monthShort(x.warn)}은 센 개수가 더 많아 뺌` : ''}</small></span>
              <span class="qty"><small>지금</small> <b>${x.product.fillTo || '?'}</b> → <b class="new">${x.fillTo}</b><small>개</small></span>
              <span class="acts"><button type="button" class="small secondary" data-action="fill-apply" data-id="${x.product.id}">적용</button></span>
            </div>`).join('')}
        </div>` : ''}
      <div class="sheet-nav">
        <button type="button" class="small secondary" data-action="sheet-prev" ${months[0] <= first ? 'disabled' : ''}>◀ 이전 달</button>
        <b>${monthShort(months[0])} ~ ${monthShort(months[2])}</b>
        <button type="button" class="small secondary" data-action="sheet-next" ${end >= last ? 'disabled' : ''}>다음 달 ▶</button>
        <span class="muted">석 달씩</span>
      </div>
      ${products.length === 0 ? '<div class="empty">아직 제품이 없습니다.</div>' : `
      <div class="sheet-wrap"><table class="sheet">
        <tr><th class="nm" rowspan="2">제품</th>${months.map((m) => `<th class="m" colspan="3">${monthShort(m)}${m === last ? ' <small>(지금)</small>' : ''}</th>`).join('')}<th rowspan="2">채워 둘<br>개수</th></tr>
        <tr>${months.map(() => '<th>1일 재고</th><th>입고</th><th class="use">사용</th>').join('')}</tr>
        ${sheets.map((r) => `<tr><td class="nm">${esc(r.p.name)} <small>${esc(r.p.category)}</small></td>${months.map((m) => cells(r.sh, m)).join('')}<td class="num">${r.p.fillTo || '?'}</td></tr>`).join('')}
      </table></div>
      ${sheets.some((r) => Object.values(r.sh).some((x) => x.used !== null && x.used < 0)) ? '<p class="note">빨간 "확인"은 센 개수가 장부보다 많았던 달입니다. 들어온 것을 안 적었거나 잘못 센 것일 수 있어 평균에서 뺍니다.</p>' : ''}`}`;
  }

  function renderStock() {
    const d = today();
    const products = Store.liveProducts(state);
    const short = Store.shortProducts(state);
    const groups = Store.orderGroups(state);
    const ordered = Store.orderedProducts(state, d);
    const logs = Store.stockLogsOf(state);
    const gone = Store.deletedProducts(state);
    const nameOf = (id) => (state.products.find((p) => p.id === id) ?? { name: '(지운 제품)' }).name;
    const notReady = !stockReady();
    const byCat = Store.STOCK_CATEGORIES.map((c) => ({ c, items: products.filter((p) => p.category === c) })).filter((g) => g.items.length);
    const productRow = (p) => stock.editId === p.id ? `
        <div class="stock-row editing" data-pid="${p.id}">
          <div class="stock-edit">
            <input type="text" id="pe-name" value="${esc(p.name)}" placeholder="이름">
            <select id="pe-cat">${CAT_OPTIONS(p.category)}</select>
            <label class="inline">부족 기준 <input type="text" id="pe-min" class="num" inputmode="numeric" value="${p.min}"></label>
            ${supplierPick('pe-sup', p.supplier ?? '')}
            <label class="inline" title="늘 이 개수로 맞춰 둡니다. 주문할 때 모자란 만큼만 시킵니다">채워 둘 개수 <input type="text" id="pe-oq" class="num" inputmode="numeric" value="${p.fillTo || ''}" placeholder="?"> 개까지</label>
            <input type="text" id="pe-link" value="${esc(p.link)}" placeholder="주문하는 곳 주소 (비워도 됨)">
            <label class="inline"><input type="checkbox" id="pe-alarm" ${p.alarm ? 'checked' : ''}> 부족하면 알리기</label>
            <div class="row">
              <button type="button" class="link danger" data-action="stock-del" data-id="${p.id}">지우기</button>
              <span style="flex:1"></span>
              <button type="button" class="secondary small" data-action="stock-cancel-edit">취소</button>
              <button type="button" class="small" data-action="stock-save-edit" data-id="${p.id}">저장</button>
            </div>
            <div class="msg" id="stock-edit-msg"></div>
          </div>
        </div>` : `
        <div class="stock-row ${p.qty <= p.min && p.alarm ? 'short' : ''}" data-pid="${p.id}">
          <span class="nm">${esc(p.name)}${p.orderedAt ? ' <span class="status pass">도착 대기</span>' : ''}${!p.alarm ? ' <small>알림 끔</small>' : ''}${p.supplier || p.fillTo ? `<small class="sup">${esc(p.supplier || '거래처 미정')}${p.fillTo ? ` · ${p.fillTo}개까지 채움` : ''}</small>` : ''}</span>
          <span class="qty"><b>${p.qty}</b><small>개</small></span>
          <span class="min">기준 ${p.min}</span>
          <span class="acts">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="link">주문처</a>` : ''}<button type="button" class="link small" data-action="stock-edit" data-id="${p.id}">고치기</button></span>
        </div>`;
    // 탭 넷(10-08 원장): 한 번에 한 가지 일만 보이게. 처음엔 할 일(주문·도착 대기)이 있으면 [주문], 없으면 [넣기·세기].
    const tab = stock.tab || (short.length || ordered.length ? 'order' : 'entry');
    const cat = byCat.some((g) => g.c === stock.cat) ? stock.cat : '';
    const sugg = Store.fillSuggestions(state);
    const TABS = [
      ['order', `주문${short.length ? ` <b>${short.length}</b>` : ''}${ordered.length ? ` <small>· 도착 대기 ${ordered.length}</small>` : ''}`],
      ['entry', '넣기·세기'],
      ['list', `제품 목록 <small>${products.length}</small>`],
      ['usage', `월별 재고표${sugg.length ? ` <small>· 제안 ${sugg.length}</small>` : ''}`],
      ['more', '기록·정리'],
    ];
    const body = {
      order: () => `
        <div class="stock-box order">
          <h3>주문할 제품 <small>${short.length ? `${short.length}개 · 거래처 ${groups.length}곳` : '없음'}</small></h3>
          ${supplierReady() ? '' : '<div class="pending"><div class="pending-title">거래처·채워 둘 개수 칸이 서버에 아직 없습니다</div><p class="hint">Supabase → SQL Editor에서 <code>supabase/schema.sql</code>을 다시 Run 하면 생깁니다. 그 전에는 적어도 새로고침하면 사라집니다.</p></div>'}
          ${short.length === 0 ? '<div class="empty">지금은 없습니다. 재고를 세면 다시 계산됩니다.</div>' : renderOrderGroups(groups)}
          ${short.length ? `<label class="inline order-head">주문 글 첫 줄 <input type="text" id="order-head" value="${esc(state.settings?.orderHead || Store.ORDER_HEAD)}"></label>` : ''}
          ${ordered.length ? renderArriving(ordered) : ''}
          <div class="msg" id="stock-arrive-msg"></div>
        </div>
`,
      entry: () => `
        <div class="stock-box entry">
          <div class="tabs">
            <button type="button" data-stock-mode="count" class="${stock.mode === 'count' ? 'on' : ''}">재고 세기</button>
            <button type="button" data-stock-mode="in" class="${stock.mode === 'in' ? 'on' : ''}">들어온 것 (입고)</button>
          </div>
          ${stock.mode === 'in' ? `<div class="date-row"><label style="margin:0">들어온 날</label><input type="date" id="stock-date" value="${stock.date || d}" max="${d}"><small>택배가 온 날. 안 고치면 오늘</small></div>` : ''}
          <textarea id="stock-text" placeholder="${stock.mode === 'count' ? '말하듯 적으세요. 예) 6N 염색약 3개, 펌제 1제 2개, 트리트먼트 다섯 개 — 세어 본 지금 개수로 맞춥니다' : '예) 6N 염색약 6개, 수건 10개 — 들어온 개수만큼 더합니다'}">${esc(stock.text)}</textarea>
          <div id="stock-preview" class="stock-preview"></div>
          <div class="row" style="margin-top:8px">
            <div class="msg ${stock.msg ? 'ok' : ''}" id="stock-msg">${esc(stock.msg)}</div>
            <button type="button" data-action="stock-apply" ${notReady ? 'disabled' : ''}>${stock.mode === 'count' ? '센 개수로 맞추기' : '들어온 개수 더하기'}</button>
          </div>
        </div>
`,
      list: () => `
        <h3>제품 목록 <small>${products.length}개</small> <button type="button" class="link small" data-action="stock-add-open">${stock.addOpen ? '닫기' : '+ 제품 넣기'}</button></h3>
        ${stock.addOpen ? `
          <div class="stock-box add">
            <div class="stock-edit">
              <input type="text" id="pa-name" placeholder="이름 (예: 6N 염색약)" autocomplete="off">
              <select id="pa-cat">${CAT_OPTIONS('염색약')}</select>
              <label class="inline">지금 개수 <input type="text" id="pa-qty" class="num" inputmode="numeric" placeholder="0"></label>
              <label class="inline">부족 기준 <input type="text" id="pa-min" class="num" inputmode="numeric" placeholder="1"></label>
              ${supplierPick('pa-sup')}
              <label class="inline" title="늘 이 개수로 맞춰 둡니다. 주문할 때 모자란 만큼만 시킵니다">채워 둘 개수 <input type="text" id="pa-oq" class="num" inputmode="numeric" placeholder="?"> 개까지</label>
              <input type="text" id="pa-link" placeholder="주문하는 곳 주소 (비워도 됨)" autocomplete="off">
              <div class="row"><div class="msg" id="stock-add-msg"></div><button type="button" class="small" data-action="stock-add" ${notReady ? 'disabled' : ''}>넣기</button></div>
              <p class="hint">여러 개를 한 번에 넣으려면 [넣기·세기] 탭의 [재고 세기] 칸에 "이름 개수"로 쭉 적으세요. 목록에 없는 이름은 새 제품으로 넣을 수 있습니다.</p>
            </div>
          </div>` : ''}
        ${byCat.length > 1 ? `<div class="tabs stock-cats"><button type="button" data-stock-cat="" class="${cat ? '' : 'on'}">전체 <small>${products.length}</small></button>${byCat.map((g) => `<button type="button" data-stock-cat="${g.c}" class="${cat === g.c ? 'on' : ''}">${g.c} <small>${g.items.length}</small></button>`).join('')}</div>` : ''}
        ${products.length === 0 ? '<div class="empty">아직 제품이 없습니다. 떨어지면 곤란한 제품 10~20개부터 넣으세요.</div>' : byCat.filter((g) => !cat || g.c === cat).map((g) => `
          <div class="stock-cat"><b>${g.c}</b> <small>${g.items.length}</small></div>
          ${g.items.map(productRow).join('')}`).join('')}
`,
      usage: () => renderUsage(products, sugg),
      more: () => `
        <details class="logs-detail">
          <summary>자세한 기록 <small>센 시각 · 전 → 후 · ${logs.length}건 — 숫자가 이상할 때 확인용</small></summary>
          ${logs.length === 0 ? '<p class="note">아직 없습니다.</p>' : `<table class="stock-logs">
            <tr><th>날짜</th><th>제품</th><th>무엇</th><th style="text-align:right">개수</th><th style="text-align:right">전 → 후</th><th>메모</th></tr>
            ${logs.slice(0, 200).map((l) => `<tr><td>${fmt(l.at)}</td><td>${esc(nameOf(l.productId))}</td><td>${l.kind === 'in' ? '<span class="status done">들어옴</span>' : l.before === l.after ? '<span class="status">세어 봄 · 같음</span>' : '<span class="status pass">세어 맞춤</span>'}</td><td class="num">${l.kind === 'in' ? '+' : ''}${l.qty}</td><td class="num">${l.before} → ${l.after}</td><td><small>${esc(l.note)}</small></td></tr>`).join('')}
          </table>${logs.length > 200 ? '<p class="note">최근 200건만 보입니다.</p>' : ''}`}
        </details>
        <div class="sup-manage">
          <h3>거래처 단추 정리</h3>
          <p class="hint">제품 [고치기]에서 눌러 고르는 업체 단추입니다. 잘못 넣은 업체는 ×로 뺍니다(그 업체로 적힌 제품은 고치기 전까지 그대로).</p>
          <div class="chips sup-list">${Store.supplierList(state).map((n) => `<span class="sup-item">${esc(n)} <button type="button" class="link small" data-action="sup-remove" data-name="${esc(n)}" title="빼기">×</button></span>`).join('')}</div>
          <div class="sup-new"><input type="text" class="sup-new-name" placeholder="새 업체 이름" autocomplete="off"><button type="button" class="small" data-action="sup-save">+ 업체 추가</button></div>
          <div class="msg" id="sup-msg"></div>
        </div>
        ${gone.length ? `<details class="trash"><summary>지운 제품 ${gone.length}개</summary><ul class="list">${gone.map((p) => `<li><span>${esc(p.name)} <small>${p.qty}개</small></span><span class="actions"><button type="button" class="small secondary" data-action="stock-restore" data-id="${p.id}">되살리기</button></span></li>`).join('')}</ul></details>` : ''}
`,
    };
    return `
      <div class="stock">
        <h2 class="card-title">재고 <small>개수만 셉니다 · 들어오면 더하고, 한 달에 한 번 세어 맞춥니다 · 돈은 핸드SOS</small></h2>
        ${notReady ? `<div class="pending"><div class="pending-title">서버에 재고 표가 아직 없습니다</div><p class="hint">Supabase → SQL Editor에서 <code>supabase/schema.sql</code>을 다시 Run 하면 생깁니다. 그 전엔 여기 적어도 저장이 안 됩니다.</p></div>` : ''}
        <div class="tabs stock-tabs">${TABS.map(([k, label]) => `<button type="button" data-stock-tab="${k}" class="${tab === k ? 'on' : ''}">${label}</button>`).join('')}</div>
        ${tab !== 'entry' ? `<div class="msg ${stock.msg ? 'ok' : ''}" id="stock-msg">${esc(stock.msg)}</div>` : ''}
        ${body[tab]()}
      </div>`;
  }

  // 글자를 칠 때마다 "이렇게 읽었습니다"만 다시 그린다 (칸 전체를 다시 그리면 커서가 날아간다).
  function renderStockPreview() {
    const box = $('#stock-preview');
    if (!box) return;
    const text = $('#stock-text')?.value ?? '';
    if (!text.trim()) { box.innerHTML = ''; return; }
    const r = Store.parseStockText(text, state);
    const verb = stock.mode === 'count' ? (m) => `${m.product.qty} → <b>${m.qty}</b>개${m.qty === m.product.qty ? ' <small>(그대로)</small>' : ''}` : (m) => `${m.product.qty} + ${m.qty} → <b>${m.product.qty + m.qty}</b>개`;
    box.innerHTML = `
      ${r.matched.map((m) => `<div class="pv ok"><span class="nm">${esc(m.product.name)}</span><span>${verb(m)}</span></div>`).join('')}
      ${r.unknown.map((u, i) => `<div class="pv new"><span class="nm">${esc(u.name)} <small>목록에 없음</small></span><span><label class="inline"><input type="checkbox" class="new-ok" data-i="${i}" checked> 새 제품으로 넣기 (${u.qty}개)</label> <select class="new-cat" data-i="${i}">${CAT_OPTIONS('기타')}</select></span></div>`).join('')}
      ${r.noNumber.map((n) => `<div class="pv warn"><span class="nm">${esc(n)}</span><span>개수가 없어 건너뜁니다</span></div>`).join('')}
      ${r.matched.length + r.unknown.length === 0 ? '<div class="pv warn"><span class="nm">아직 읽은 것이 없습니다</span><span>"이름 개수" 꼴로 적으세요</span></div>' : ''}`;
  }

  function applyStock() {
    const text = $('#stock-text').value;
    const r = Store.parseStockText(text, state);
    const wantNew = r.unknown.map((u, i) => ({ ...u, on: $(`.new-ok[data-i="${i}"]`)?.checked, category: $(`.new-cat[data-i="${i}"]`)?.value ?? '기타' })).filter((u) => u.on);
    if (r.matched.length + wantNew.length === 0) throw new Error('읽은 것이 없습니다. "6N 염색약 3개"처럼 이름과 개수를 적으세요');
    let next = state;
    const n = now();
    // 새 제품은 센 개수 그대로(세기) 또는 들어온 개수 그대로(입고) 시작한다
    for (const u of wantNew) next = Store.addProduct(next, { name: u.name, category: u.category, qty: u.qty }, n).state;
    const items = r.matched.map((m) => ({ productId: m.product.id, qty: m.qty }));
    let changed = 0;
    if (stock.mode === 'count') { const c = Store.stockCount(next, items, n); next = c.state; changed = c.logs.filter((l) => l.before !== l.after).length; }
    else { const c = Store.stockIn(next, items, $('#stock-date')?.value || today(), n, ''); next = c.state; changed = c.logs.length; }
    commit(next);
    const parts = [];
    if (changed) parts.push(stock.mode === 'count' ? `${changed}개 제품 숫자를 맞췄습니다` : `${changed}개 제품에 더했습니다`);
    if (r.matched.length - changed > 0 && stock.mode === 'count') parts.push(`${r.matched.length - changed}개는 그대로`);
    if (wantNew.length) parts.push(`새 제품 ${wantNew.length}개 넣음`);
    const sg = stock.mode === 'count' ? Store.fillSuggestions(state).length : 0;
    if (sg) parts.push(`[월별 재고표] 탭에 채워 둘 개수 제안 ${sg}개`);
    stock = { ...stock, text: '', date: '', msg: parts.join(' · ') };
    render();
  }

  function stockAction(a, btn) {
    const id = Number(btn.dataset.id);
    const n = now();
    if (a === 'stock-apply') { applyStock(); return; }
    if (a === 'sheet-prev' || a === 'sheet-next') {
      const all = [...new Set(Store.liveProducts(state).flatMap((p) => Object.keys(Store.stockSheet(state, p.id))))].sort();
      const cur = stock.sheetEnd || all[all.length - 1] || today().slice(0, 7);
      stock = { ...stock, sheetEnd: addMonth(cur, a === 'sheet-prev' ? -1 : 1) }; render(); return;
    }
    if (a === 'fill-apply' || a === 'fill-apply-all') {
      const list = Store.fillSuggestions(state).filter((x) => a === 'fill-apply-all' || x.product.id === id);
      let next = state;
      for (const x of list) next = Store.editProduct(next, x.product.id, { fillTo: x.fillTo }).state;
      commit(next);
      stock = { ...stock, msg: list.length === 1 ? `${list[0].product.name} 채워 둘 개수를 ${list[0].fillTo}개로 바꿨습니다` : `${list.length}개 제품의 채워 둘 개수를 바꿨습니다` };
      render(); return;
    }
    // 제품 칸 안의 [+ 업체]: 다시 그리지 않고(적던 칸이 날아가므로) 단추만 하나 더해 골라 둔다
    if (a === 'sup-add-open') { const box = btn.closest('.sup-pick').querySelector('.sup-new'); box.hidden = !box.hidden; if (!box.hidden) box.querySelector('input').focus(); return; }
    if (a === 'sup-add') {
      const pick = btn.closest('.sup-pick'), nm = pick.dataset.supName, input = pick.querySelector('.sup-new-name');
      const name = Store.addSupplier(state, input.value).name;
      let radio = [...pick.querySelectorAll(`input[name="${nm}"]`)].find((x) => x.value === name);
      if (!radio) {
        pick.querySelector('[data-action=sup-add-open]').insertAdjacentHTML('beforebegin', supChip(nm, name, false));
        radio = [...pick.querySelectorAll(`input[name="${nm}"]`)].find((x) => x.value === name);
      }
      radio.checked = true; input.value = ''; pick.querySelector('.sup-new').hidden = true; return;
    }
    // 아래 [거래처 단추 정리]: 바로 저장한다
    if (a === 'sup-save') {
      const input = btn.closest('.sup-new').querySelector('.sup-new-name');
      const r = Store.addSupplier(state, input.value);
      commit(r.state); render(); showMsg($('#sup-msg'), `${r.name} 단추를 더했습니다`, 'ok'); return;
    }
    if (a === 'sup-remove') { commit(Store.removeSupplier(state, btn.dataset.name).state); render(); return; }
    if (a === 'stock-add-open') { stock = { ...stock, addOpen: !stock.addOpen }; render(); $('#pa-name')?.focus(); return; }
    if (a === 'stock-add') {
      const r = Store.addProduct(state, { name: $('#pa-name').value, category: $('#pa-cat').value, qty: $('#pa-qty').value, min: $('#pa-min').value, link: $('#pa-link').value, supplier: pickedSupplier('pa-sup'), fillTo: $('#pa-oq').value }, n);
      commit(withSupplier(r.state, r.product.supplier));
      stock = { ...stock, cat: stock.cat && stock.cat !== r.product.category ? '' : stock.cat, msg: `${r.product.name}을(를) 넣었습니다` }; render(); $('#pa-name')?.focus(); return;
    }
    if (a === 'stock-edit') { stock = { ...stock, editId: id }; render(); $('#pe-name')?.focus(); return; }
    if (a === 'stock-cancel-edit') { stock = { ...stock, editId: null }; render(); return; }
    if (a === 'stock-save-edit') {
      const r = Store.editProduct(state, id, { name: $('#pe-name').value, category: $('#pe-cat').value, min: $('#pe-min').value, link: $('#pe-link').value, alarm: $('#pe-alarm').checked, supplier: pickedSupplier('pe-sup'), fillTo: $('#pe-oq').value });
      commit(withSupplier(r.state, r.product.supplier));
      stock = { ...stock, editId: null }; render(); return;
    }
    if (a === 'stock-del') {
      const p = state.products.find((x) => x.id === id);
      if (!confirm(`${p.name}을(를) 목록에서 지웁니다. 기록은 남고, 아래 [지운 제품]에서 되살릴 수 있습니다.\n\n지울까요?`)) return;
      commit(Store.deleteProduct(state, id, n).state); stock = { ...stock, editId: null }; render(); return;
    }
    if (a === 'stock-restore') { commit(Store.restoreProduct(state, id).state); render(); return; }
    if (a === 'stock-ordered') { commit(Store.markOrderedMany(state, [id], n, stock.orderQtys).state); render(); return; }
    if (a === 'stock-unorder') { const { [id]: _, ...rest } = stock.arrive; stock = { ...stock, arrive: rest }; commit(Store.unmarkOrdered(state, id).state); render(); return; }
    if (a === 'stock-mute') { commit(Store.editProduct(state, id, { alarm: false }).state); render(); return; }
    if (a === 'stock-arrive-many') {
      const ordered = Store.orderedProducts(state, today());
      const items = ordered.filter(({ product: p }) => p.id in stock.arrive).map(({ product: p }) => ({ productId: p.id, qty: stock.arrive[p.id] }));
      try {
        const r = Store.markArrivedMany(state, items, today(), n);
        commit(r.state);
        stock = { ...stock, arrive: {}, msg: `${r.logs.length}개 제품 도착 · ${r.logs.map((l) => `${state.products.find((x) => x.id === l.productId).name} +${l.qty}`).join(', ')}` };
        render();
      } catch (err) { showMsg($('#stock-arrive-msg'), err.message, 'error'); }
      return;
    }
    if (a === 'stock-arrive') { stock = { ...stock, arriveId: id }; render(); $('#arrive-qty')?.focus(); return; }
    if (a === 'stock-arrive-cancel') { stock = { ...stock, arriveId: null }; render(); return; }
    if (a === 'stock-arrive-save') {
      const r = Store.markArrived(state, id, $('#arrive-qty').value, today(), n);
      commit(r.state); stock = { ...stock, arriveId: null, msg: `${state.products.find((x) => x.id === id).name} ${r.log.qty}개 더했습니다 (지금 ${r.log.after}개)` }; render(); return;
    }
    if (a === 'stock-order-copy') { sendOrder(btn.dataset.gi, 'copy'); return; }
    if (a === 'stock-order-share') { sendOrder(btn.dataset.gi, 'share'); return; }
    if (a === 'stock-order-done') {
      const g = orderGroupAt(btn.dataset.gi);
      if (!g) return;
      // 이번 주문을 0으로 한 제품은 빼고 넘긴다
      const ids = g.items.filter((p) => String(stock.orderQtys[p.id] ?? '') !== '0').map((p) => p.id);
      if (!ids.length) { showMsg($(`#og-msg-${btn.dataset.gi}`), '넘길 제품이 없습니다', 'error'); return; }
      commit(Store.markOrderedMany(state, ids, n, stock.orderQtys).state);   // 보낸 개수를 남긴다(10-15, 도착 때 맞춰 봄)
      const qtys = { ...stock.orderQtys }; for (const pid of ids) delete qtys[pid];
      stock = { ...stock, orderQtys: qtys, msg: `${g.supplier || '거래처 미정'} ${ids.length}개 제품을 도착 대기로 넘겼습니다` };
      render(); return;
    }
  }

  // 이름을 칠 때마다 후보만 다시 그린다. 화면 전체를 다시 그리면 글자를 치던 자리가 날아간다.
  function renderAddHits() {
    const box = $('#add-hits');
    if (!box) return;
    const q = $('#add-name').value.trim();
    if (!q) { box.innerHTML = ''; return; }
    const onList = new Set(Store.todayList(state, tlDate).map((t) => t.customer.id));
    const hits = Store.findCustomers(state, q).filter((c) => !onList.has(c.id)).slice(0, 8);
    const looksLikeName = /[^\d\s-]/.test(q);
    box.innerHTML = `
      <div class="hits">
        ${hits.map((c) => `<button type="button" class="secondary small" data-add="${c.id}">${esc(c.name)} <small>${esc(Store.maskPhone(c.phone))}</small></button>`).join('')}
        ${looksLikeName ? (() => { const np = Store.splitNamePhone(q); return `<button type="button" class="small" data-add-new="1">+ ${esc(np.name)}${np.phone ? ` <small>${esc(Store.maskPhone(np.phone))}</small>` : ''} 새 고객으로 올리기</button>${np.phone ? '' : '<small class="muted">번호도 함께 치면(예: 홍길동 010-1234-5678) 같이 저장됩니다</small>'}`; })() : ''}
      </div>
      ${hits.length === 0 && !looksLikeName ? '<div class="hint">그 번호를 쓰는 고객이 없습니다. 이름으로 찾아보세요.</div>' : ''}`;
  }

  // 명단에 한 명 올리기. newName을 주면 그 이름으로 새 고객을 만들어 올린다.
  // 가족 중 한 사람을 올리면 "가족 N명도 같은 시간에 올릴까요?"(10-24 원장: 한 사람이 가족 예약을 다 한다). 넘어가면 사라진다
  let famPrompt = null;   // {date, at, ids, names, who}
  function renderFamPrompt() {
    if (!famPrompt || famPrompt.date !== tlDate) return '';
    return `<div class="fam-ask">${esc(famPrompt.who)}님 가족 ${famPrompt.ids.length}명(${esc(famPrompt.names)})도 ${famPrompt.at ? `${esc(famPrompt.at)}에 ` : ''}같이 올릴까요?
      <button type="button" class="small" data-fam-all="1">같이 올리기</button><button type="button" class="link small" data-fam-all="0">아니요</button></div>`;
  }
  function addFamilyToo() {
    let next = state;
    for (const id of famPrompt.ids) next = Store.markToday(next, id, famPrompt.date, famPrompt.at, '', today()).state;
    const n = famPrompt.ids.length;
    famPrompt = null; commit(next); render();
    showMsg($('#today-msg'), `가족 ${n}명도 올렸습니다. 시술은 각자 막대를 눌러 고르세요`, 'ok');
  }
  function addToToday(customerId, newName) {
    const at = $('#add-at').value;
    const svc = $('#add-grp')?.value && $('#add-svc')?.value !== ADD_SVC ? ($('#add-svc')?.value ?? '') : '';
    try {
      let next = state;
      let id = customerId;
      if (newName) {
        const np = Store.splitNamePhone(newName);   // "이름 010-…"이면 번호도 함께 (알림톡은 번호가 있어야 간다)
        const made = Store.addCustomer(state, { name: np.name, phone: np.phone, referrer: '' });
        next = made.state; id = made.customer.id;
      }
      commit(Store.markToday(next, id, tlDate, at, svc, today()).state);
      const onList = new Set(state.today.entries.filter((e) => e.date === tlDate).map((e) => e.customerId));
      const fam = Store.familyOf(state, id).filter((x) => x.id !== id && !onList.has(x.id));
      famPrompt = fam.length ? { date: tlDate, at, ids: fam.map((x) => x.id), names: fam.map((x) => Store.familyRoleOf(state, x.id) || x.name).join('·'), who: nameOfCustomer(id) } : null;
      $('#add-at').value = ''; $('#add-grp').value = ''; $('#add-svc').innerHTML = ''; $('#add-svc').hidden = true; $('#add-name').value = '';   // 올렸으니 칸을 비운다
      render();
      $('#add-name').focus();
    } catch (err) { showMsg($('#today-msg'), err.message, 'error'); }
  }

  // ---- 가운데: 고객 카드 ---------------------------------------------------
  // 위에서 아래로: [오늘] [지난 방문] 탭 → 누구인지 한 줄 → 기억할 것 한 줄 → 오늘 적기.
  // 지난 방문은 탭 뒤에 두어 카드가 길어지지 않는다.
  // 카드 첫 줄 오른쪽: 이 손님이 그날 명단에 있으면 시간·시술 바꾸기와 [명단에서 빼기]. 오른쪽 명단 칸이 없어져 여기로 왔다(10-13)
  function renderEntryCtl(c) {
    const ed = pendingDate || tlDate;
    const entry = state.today.entries.find((e) => e.customerId === c.id && e.date === ed);
    if (!entry) return '';
    return `<span class="entry-ctl"><small>${ed === today() ? '오늘' : fmtDay(ed).slice(5)} 명단</small><select class="at" data-at="${c.id}" data-date="${ed}" title="예약 시간">${timeOptions(entry.at)}</select><select class="svc" data-svc="${c.id}" data-date="${ed}" title="시술">${svcOptions(entry.service)}</select><button type="button" class="link small" data-drop="${c.id}" data-drop-date="${ed}">명단에서 빼기</button></span>`;
  }
  // 이 손님의 오늘·앞날 예약마다 알림톡이 갔는지(10-26 원장). 발송킹 결과는 api/remind.js 원장 GET의 people(오늘·내일 예약분)
  function renderRemindLines(c) {
    const d = today();
    const entries = state.today.entries.filter((e) => e.customerId === c.id && e.date >= d).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!entries.length) return '';
    if (!USE_LOCAL && !remindSt.data && !remindSt.error) loadRemindStatus();
    return entries.map((e) => {
      const st = Store.remindStatusOf(state, c.id, e.date, remindSt.data?.people?.[e.date] ?? null, now());
      if (!st || (e.date === d && st.state === 'warn')) return '';   // 오늘 바로 올린 손님(보낸 뒤 들어온 예약)은 알릴 일이 없다
      const label = `${e.date === d ? '오늘' : Store.dateKo(e.date)}${e.at ? ' ' + Store.timeKo(e.at) : ''} 예약`;
      const text = USE_LOCAL ? `${st.text} (시험 모드: 실제로는 안 보냄)` : !remindSt.data && remindSt.loading && st.state !== 'bad' ? '알림톡 결과 확인 중…' : st.text;
      return `<div class="remind-line st-${st.state}"><span class="ic">🔔</span><b>${esc(label)}</b><span>${esc(text)}</span></div>`;
    }).join('');
  }
  function renderCard(c) {
    const visits = Store.visitsWithGaps(state, c.id);
    return `
      <div class="tabs">
        <button type="button" data-tab="today" class="${cardTab === 'today' ? 'on' : ''}">오늘</button>
        <button type="button" data-tab="history" class="${cardTab === 'history' ? 'on' : ''}">지난 방문 ${visits.length}건</button>
        ${renderEntryCtl(c)}
        <button type="button" class="to-today" data-to-today="1" title="다음 손님을 고르러 타임테이블로 올라갑니다">↑ 타임테이블</button>
      </div>
      ${renderFamilyBar(c)}
      ${renderStandIn(c)}
      ${renderIdentity(c, Store.visitCycle(state, c.id, today()))}
      <div id="remind-lines">${renderRemindLines(c)}</div>
      ${cardTab === 'history' ? renderHistoryTab(c, visits) : renderTodayTab(c, visits)}`;
  }

  // 적는 동안 "저장하면 이렇게 나뉩니다"를 칸 밑에 보여 준다. 항목 이름을 안 넣었으면(전부 시술) 아무것도 안 보인다.
  // 말할 순서 안내(원장 요청 10-01): 빈 칸에는 회색 글씨로, 말을 시작하면(회색 글씨가 사라지면) 칸 밑에 같은 다섯 항목이
  // 순서(Store.SECTIONS: 고민 → 진단 → 시술 → 주기 → 다음 계획)대로 서서 채워진다(안 말한 것은 .unsaid).
  const GUIDE_SAY = { concern: '고민은', diagnosis: '진단은', done: '시술은', cycle: '주기는', next: '다음은' };
  const GUIDE_HINT = { concern: '손님이 말한 불편·바람', diagnosis: '모질·두상·원인', done: '오늘 한 것과 이유', cycle: '다음 예약까지 (예: 5주)', next: '다음에 할 시술·상담' };
  const GUIDE_PLACEHOLDER = ['말할 순서 — 앞에 항목 이름을 붙여 말하세요', ...Store.SECTIONS.map((x, i) => `${i + 1}. ${GUIDE_SAY[x.key]} … ${GUIDE_HINT[x.key]}`)].join('\n');
  function renderSplitPreview(text) {
    if (!String(text ?? '').trim()) return '';
    const sec = Store.splitSections(text);
    return Store.SECTIONS.map((x) => `<span class="lb">${esc(x.name)}</span>` + (sec[x.key]
      ? `<span class="tx">${esc(shorten(sec[x.key].replace(/\s*\n\s*/g, ' / '), 70))}</span>`
      : `<span class="tx unsaid">아직 · "${GUIDE_SAY[x.key]} …" 하고 말하면 여기에</span>`)).join('');
  }

  function renderTodayTab(c, visits) {
    // '지난번'은 오늘 것을 뺀 직전 방문. 오늘 기록을 남겨도 이 줄은 흔들리지 않는다.
    const prev = visits.find((v) => !v.createdAt.startsWith(today()));
    const d = draftOf(c.id);   // 적다 만 글이 있으면 칸에 그대로 채워 둔다
    return `
      ${renderMemo(c, prev)}
      <form id="visit-form">
        <div class="date-row">
          <label style="margin:0">날짜</label>
          <input type="date" id="visit-date" value="${d?.date || pendingDate || today()}" max="${today()}">
          <small>${pendingDate && !d ? `지난 명단 ${fmtDay(pendingDate)}에서 열어 날짜를 그날로 맞춰 두었습니다` : '못 적고 지나간 날 것은 날짜를 그날로 바꿔 적으세요'}</small>
        </div>
        <label style="margin-top:0">오늘 기록 (필수) <small>회색 글씨 순서대로 항목 이름을 붙여 말하면 저장할 때 다섯 항목으로 나뉩니다</small></label>
        <textarea id="visit-done" placeholder="${esc(GUIDE_PLACEHOLDER)}">${esc(d?.done ?? '')}</textarea>
        <div class="split-preview" id="split-preview">${renderSplitPreview(d?.done ?? '')}</div>
        <label>시술 종류 (여러 개 가능, 안 골라도 됨)</label>
        ${renderChips('visit-kind', d?.kinds ?? bookedKinds(c))}
        ${renderPendingPhotos(c)}
        <div class="row" style="margin-top:8px">
          <div class="msg ${d ? 'draft' : ''}" id="visit-msg">${d ? '적다 만 글입니다. 아직 저장 안 됨 · <button type="button" class="link" data-action="discard-draft">지우고 새로 적기</button>' : ''}</div>
          <button type="submit">방문 기록 저장</button></div>
        <div class="to-today-row"><button type="button" class="link to-today" data-to-today="1">↑ 타임테이블로 · 다음 손님 고르기</button></div>
      </form>
      ${renderPhotoPointer(visits)}
      ${renderPass(c)}
      ${renderNotice(c)}`;
  }


  function renderHistoryTab(c, visits) {
    return `
      ${visits.length === 0 ? '<div class="empty">아직 기록이 없습니다.</div>' : visits.map(renderVisit).join('')}
      ${renderDeletedVisits(c)}`;
  }

  const fmtDay = (iso) => iso.slice(0, 10).replace(/-/g, '.');
  const shorten = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  // 기억할 것 한 줄(고정 정보를 합친 것) + 지난번 시술 한 줄. 고칠 때만 두 칸으로 펼쳐진다.
  function renderMemo(c, prev) {
    if (editingProfile) return renderProfile(c);
    const p = c.profile;
    const memo = [p.hair, p.talk].filter(Boolean).join(' · ');
    const kinds = prev && (prev.kinds ?? []).length ? `<span class="kinds-inline">${prev.kinds.map((k) => `<span>${esc(k)}</span>`).join('')}</span>` : '';
    // 지난번은 시술 항목 앞 두 조각과 다음 항목만. 고민·진단과 전체는 [지난 방문] 탭에 있다. 이름표가 있으면 굵게.
    const sec = prev ? Store.splitSections(prev.done) : null;
    const items = prev ? noteItems(sec.done || sec.concern || sec.diagnosis) : [];
    const labeled = items.some((it) => it.label);
    const piece = (it) => (it.label ? `<b>${esc(it.label)}</b> ` : '') + esc(shorten(it.label ? dots(it.text) : it.text, 60));
    const gist = items.slice(0, 2).map(piece).join(labeled ? ' &nbsp; ' : ' · ') + (items.length > 2 ? `${labeled ? ' &nbsp; ' : ' · '}외 ${items.length - 2}개` : '');
    const nextOf = prev ? (Store.noteLines(sec.next)[0] || legacyNext(prev)) : '';
    const last = prev
      ? `${fmtDay(prev.createdAt)} · ${kinds}${gist}${nextOf ? ` → <b>다음</b> ${esc(shorten(Store.noteTidy(nextOf), 60))}` : ''}`
      : '<i>첫 방문 — 오늘이 첫 기록입니다</i>';
    // 고치기 전 내용(profileHistory)은 기록에는 남지만 화면에는 안 보인다. 원장이 볼 일이 없다고 해서(09-23).
    return `
      <div class="remember">
        <div class="line"><span class="k">메모</span><span class="v">${esc(memo) || '<i>아직 없음</i>'}</span>
          <button type="button" class="link" data-action="edit-profile">${memo ? '고치기' : '적기'}</button></div>
        <div class="line"><span class="k">지난번</span><span class="v">${last}</span></div>
      </div>`;
  }

  // 실수로 두 번 적은 기록을 치우는 자리. 지운 게 없으면 아예 안 보인다.
  function renderDeletedVisits(c) {
    const gone = Store.deletedVisitsOf(state, c.id);
    if (gone.length === 0) return '';
    return `
      <details class="trash" ${visitTrashOpen ? 'open' : ''}>
        <summary>지운 기록 ${gone.length}건</summary>
        <p class="note">지운 지 일주일이 지나면 저절로 없어집니다. 되살리면 방문 목록과 주기 계산에 다시 들어갑니다.</p>
        ${gone.map((v) => `
          <div class="visit">
            <div class="meta"><span>${fmt(v.createdAt)} · <b class="left">${leftText(Store.daysLeftInTrash(v, now()))}</b></span>
              <span class="acts">
                <button type="button" class="small secondary" data-action="restore-visit" data-id="${v.id}">되살리기</button>
                <button type="button" class="small danger" data-action="purge-visit" data-id="${v.id}">완전히 지우기</button>
              </span></div>
            <div class="field"><p>${esc(v.done)}</p></div>
          </div>`).join('')}
        <div class="msg" id="visit-trash-msg"></div>
      </details>`;
  }

  const fmtPhone = (p) => (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p);

  // ---- 가족 (10-07 원장 결정: 정액권을 가족이 잔액 하나로 함께 쓴다. 묶을 때 잔액은 합친다) ----
  const nameOfCustomer = (id) => (state.customers.find((x) => x.id === id) ?? { name: '' }).name;
  const isFamily = (id) => Store.familyOf(state, id).length > 1;
  // 함께 오는 가족(10-24 원장): 가족 누구 카드를 열어도 맨 위에 가족 탭 줄. 누르면 그 사람 카드로, 기록 날짜도 같은 날로.
  // 점: 그날 기록을 남겼으면 초록, 아직이면 빨강. 대표(문자·알림톡을 받는 사람)에 딱지. [+ 가족 추가]로 이름·관계만 적어 바로 묶는다.
  const recDate = () => { const v = $('#visit-date')?.value; return v || pendingDate || today(); };
  const ROLE_CHIPS = ['남편', '아내', '아들', '딸', '엄마', '아빠', '언니', '누나', '형', '오빠', '동생'];   // 10-28 원장: 엄마·아빠·동생·언니 등. 없는 말은 직접 적기
  function renderFamAdd() {
    if (!famAdd) return '';
    const custom = famAdd.role && !ROLE_CHIPS.includes(famAdd.role);
    return `
      <div class="fam-add" id="fam-add">
        <input type="text" id="fam-add-name" value="${esc(famAdd.name)}" placeholder="이름" autocomplete="off">
        <span class="rel">${ROLE_CHIPS.map((r) => `<button type="button" class="${famAdd.role === r ? 'on' : ''}" data-action="fam-role" data-role="${r}">${r}</button>`).join('')}<input type="text" id="fam-add-role" value="${custom ? esc(famAdd.role) : ''}" placeholder="직접 적기" autocomplete="off"></span>
        <button type="button" class="small" data-action="fam-add-save">만들고 가족에 넣기</button>
        <button type="button" class="link small" data-action="fam-add-close">닫기</button>
        <div class="msg" id="fam-msg"></div>
      </div>`;
  }
  // 가족 이름으로 잡힌 예약에 이 손님이 대신 왔을 때(10-27 원장: 엄마가 아들 커트를 자기 이름으로 예약 → 엄마 막대가 '아직'으로 남음).
  // 이 손님이 그날 기록을 남겼고 명단에는 없으며, 명단의 가족은 아직 기록이 없으면 그 자리를 넘길지 묻는다.
  function renderStandIn(c) {
    const d = pendingDate || today();
    const e = Store.standInFor(state, c.id, d);
    if (!e || !Store.visitsOf(state, c.id).some((v) => v.createdAt.startsWith(d))) return '';
    const who = nameOfCustomer(e.customerId);
    return `<div class="stand-in">${esc(who)}님 이름으로 잡힌 ${d === today() ? '오늘' : esc(fmtDay(d))}${e.at ? ` ${esc(e.at)}` : ''} 예약에 ${esc(c.name)}님이 오셨나요?
      <button type="button" class="small" data-action="swap-entry" data-from="${e.customerId}" data-to="${c.id}" data-date="${d}">예약을 ${esc(c.name)}님으로 바꾸기</button>
      <small class="muted">바꾸면 타임테이블 막대가 ${esc(c.name)}님(기록 남김)으로 바뀝니다</small></div>`;
  }
  function renderFamilyBar(c) {
    if (!familyReady()) return '';
    const fam = Store.familyOf(state, c.id);
    if (fam.length < 2) return famAdd ? `<div class="fam-bar"><span class="lb">가족</span><small class="muted">이 손님과 함께 오는 가족을 더합니다</small></div>${renderFamAdd()}` : '';
    const d = recDate();
    const rep = Store.familyRep(state, c.id);
    const done = (id) => Store.visitsOf(state, id).some((v) => v.createdAt.slice(0, 10) === d);
    const listed = (id) => state.today.entries.some((e) => e.customerId === id && e.date === d);
    const dot = (id) => (done(id) ? 'done' : listed(id) ? 'todo' : 'none');   // 그날 예약도 기록도 없는 가족은 빨강이 아니다(10-27)
    return `
      <div class="fam-bar">
        <span class="lb">가족</span>
        ${fam.map((x) => `<button type="button" class="ft ${x.id === c.id ? 'on' : ''}" data-action="fam-open" data-id="${x.id}" title="${esc(fmtDay(d))} ${{ done: '기록 남김', todo: '예약 있음 · 기록 아직', none: '예약 없음' }[dot(x.id)]}"><span class="dot ${dot(x.id)}"></span>${esc(x.name)}${Store.familyRoleOf(state, x.id) ? `<small>${esc(Store.familyRoleOf(state, x.id))}</small>` : ''}${rep && rep.id === x.id ? '<span class="rep">대표</span>' : ''}</button>`).join('')}
        <button type="button" class="link small add" data-action="fam-roles-open">관계 고치기</button>
        <button type="button" class="link small add" data-action="fam-add-open">${famAdd ? '' : '+ 가족 추가'}</button>
      </div>
      ${renderFamAdd()}`;
  }
  function renderFamilyEdit(c) {
    if (!familyReady()) return '<p class="hint family-edit">가족 묶기는 서버에 가족 칸이 생긴 뒤에 됩니다. Supabase → SQL Editor에서 <code>supabase/schema.sql</code>을 다시 Run 하세요.</p>';
    const others = Store.familyOf(state, c.id).filter((x) => x.id !== c.id);
    return `
      <div class="family-edit">
        <div class="row"><b>가족</b><small>정액권을 잔액 하나로 함께 씁니다</small>
          ${others.length ? `<span class="fam-names">${others.map((x) => esc(x.name)).join(' · ')}</span><button type="button" class="link danger small" data-action="family-leave">이 고객을 가족에서 빼기</button>` : '<span class="fam-names muted">없음</span>'}</div>
        ${others.length ? `<div class="row fam-rep-row"><small>대표(문자·알림톡 받는 사람): <b>${esc(Store.familyRep(state, c.id)?.name ?? '')}</b></small>${Store.familyRep(state, c.id)?.id !== c.id ? '<button type="button" class="secondary small" data-action="fam-rep">이 고객을 대표로</button>' : ''}</div>
        ${renderFamilyRoles(c)}` : ''}
        <input type="text" id="family-q" placeholder="가족으로 묶을 고객 이름이나 뒤 4자리" autocomplete="off">
        <div id="family-hits" class="hits"></div>
      </div>`;
  }
  // 가족 관계는 묶은 뒤에도 사람마다 정하고 바꾸고 지운다(10-28 원장: 부부를 따로 등록해 묶은 뒤 남편을 '남편'으로).
  // 단추를 누르면 바로 저장, 같은 단추를 다시 누르거나 [지우기]로 비운다. 목록에 없는 말은 직접 적고 Enter·[저장].
  function renderFamilyRoles(c) {
    const rep = Store.familyRep(state, c.id);
    return `
      <div class="fam-roles" id="fam-roles">
        <small>가족 관계 — 누르면 바로 저장됩니다</small>
        ${Store.familyOf(state, c.id).map((x) => {
          const role = Store.familyRoleOf(state, x.id);
          const custom = role && !ROLE_CHIPS.includes(role);
          return `<div class="fr-row">
            <b>${esc(x.name)}</b>${rep && rep.id === x.id ? '<span class="rep">대표</span>' : ''}
            <span class="rel">${ROLE_CHIPS.map((r) => `<button type="button" class="${role === r ? 'on' : ''}" data-action="fam-set-role" data-id="${x.id}" data-role="${r}">${r}</button>`).join('')}
              <input type="text" class="fr-custom ${custom ? 'on' : ''}" data-id="${x.id}" value="${custom ? esc(role) : ''}" placeholder="직접 적기" maxlength="10" autocomplete="off"><button type="button" class="link small" data-action="fam-set-role" data-id="${x.id}" data-custom="1">저장</button></span>
            ${role ? `<button type="button" class="link small danger" data-action="fam-set-role" data-id="${x.id}" data-role="">관계 지우기</button>` : '<small class="muted">관계 없음</small>'}
          </div>`;
        }).join('')}
      </div>`;
  }
  function setRoleOf(id, role) {
    commit(Store.setFamilyRole(state, id, role));
    // 고치는 칸(이름·번호)에 적던 글이 날아가지 않게 관계 칸과 가족 탭 줄만 다시 그린다
    const c = customerOf(view.id);
    const box = $('#fam-roles'); if (box) box.outerHTML = renderFamilyRoles(c);
    const bar = $('.fam-bar'); if (bar) { const t = document.createElement('div'); t.innerHTML = renderFamilyBar(c); const nb = t.querySelector('.fam-bar'); if (nb) bar.replaceWith(nb); }
    const who = nameOfCustomer(id);
    showMsg($('#identity-msg'), role.trim() ? `${who}님 관계를 '${role.trim()}'(으)로 저장했습니다` : `${who}님 관계를 지웠습니다`, 'ok');
  }
  // 이름을 칠 때마다 후보만 다시 그린다(커서 유지). 이미 같은 가족인 사람은 빼고 보인다.
  function renderFamilyHits() {
    const box = $('#family-hits');
    if (!box) return;
    const q = $('#family-q').value.trim();
    if (!q) { box.innerHTML = ''; return; }
    const mine = new Set(Store.familyOf(state, view.id).map((x) => x.id));
    const hits = Store.findCustomers(state, q).filter((x) => !mine.has(x.id)).slice(0, 6);
    box.innerHTML = hits.length ? hits.map((x) => `<button type="button" class="secondary small" data-action="family-join" data-id="${x.id}">${esc(x.name)} <small>${esc(Store.maskPhone(x.phone))}${Store.passBalance(state, x.id) ? ` · 정액권 ${Store.formatWon(Store.passBalance(state, x.id))}` : ''}${isFamily(x.id) ? ' · 가족 있음' : ''}</small></button>`).join('')
      : '<small class="muted">찾는 고객이 없습니다</small>';
  }

  function renderIdentity(c, cycle) {
    if (editingIdentity) {
      return `
        <div class="identity">
          <div><label style="margin-top:0">이름</label><input type="text" id="id-name" value="${esc(c.name)}"></div>
          <div><label style="margin-top:0">전화번호</label><input type="text" id="id-phone" inputmode="tel" value="${esc(fmtPhone(c.phone))}" placeholder="010-1234-5678"></div>
          <div><label style="margin-top:0">소개해 준 분</label><input type="text" id="id-referrer" value="${esc(c.referrer)}" placeholder="없으면 비움"></div>
          <label style="margin:0;display:flex;gap:6px;align-items:center;font-size:14px;align-self:center"><input type="checkbox" id="id-legacy" ${c.isLegacy ? 'checked' : ''}> 예전부터 오던 고객</label>
          <label style="margin:0;display:flex;gap:6px;align-items:center;font-size:14px;align-self:center" title="${photosReady() ? '손님에게 사진을 남겨도 되는지 물어 동의를 받았을 때만 체크' : '서버에 schema.sql을 다시 실행한 뒤에 쓸 수 있습니다'}"><input type="checkbox" id="id-photo" ${c.photoConsent ? 'checked' : ''} ${photosReady() ? '' : 'disabled'}> 사진 동의${c.photoConsent ? ` (${fmtDay(c.photoConsent.at)})` : ''}</label>
          <button type="button" class="secondary" data-action="cancel-identity">취소</button>
          <button type="button" data-action="save-identity">저장</button>
        </div>
        ${renderFamilyEdit(c)}
        <div class="row" style="margin-top:4px">
          <div class="msg" id="identity-msg"></div>
          <button type="button" class="link danger" data-action="delete-customer">이 고객 지우기</button>
        </div>`;
    }
    const phoneText = !c.phone ? '번호 없음' : c.phone.length <= 4 ? `뒤 4자리만 있음 ${esc(c.phone)}` : esc(fmtPhone(c.phone));
    return `
      <div class="head-line">
        <span class="name">${esc(c.name)}</span>
        <span class="phone">${phoneText}</span>
        <span class="ref">${c.referrer ? '소개: ' + esc(c.referrer) : '소개 없음'}${c.isLegacy ? ' · 예전부터 오던 고객' : ''}${c.photoConsent ? ' · 사진 동의' : ''}</span>
        ${familyReady() && !isFamily(c.id) && !famAdd ? '<button type="button" class="link small" data-action="fam-add-open">+ 가족 추가</button>' : ''}
        <button type="button" class="link" data-action="edit-identity">고치기</button>
        <span class="cycle">${cycleText(cycle)}${recommendedText(c.id) ? ' · ' + recommendedText(c.id) : ''}</span>
      </div>`;
  }

  function renderProfile(c) {
    const p = c.profile;
    if (editingProfile) {
      return `
        <div class="profile">
          <div class="grid">
            <div><label style="margin-top:0">고객이 한 말 · 생활 습관 · 직업이나 상황</label><textarea id="profile-talk">${esc(p.talk)}</textarea></div>
            <div><label style="margin-top:0">얼굴형 · 모질 · 두상</label><textarea id="profile-hair">${esc(p.hair)}</textarea></div>
          </div>
          <div class="row" style="margin-top:8px"><div class="msg" id="profile-msg"></div>
            <button type="button" class="secondary" data-action="cancel-profile">취소</button>
            <button type="button" data-action="save-profile">고정 정보 저장</button></div>
        </div>`;
    }
    return '';
  }

  // 예약한 시술이 있으면 기록의 시술 종류 칩을 미리 체크해 둔다(10-24 원장). 적다 만 글이 있으면 그쪽이 먼저
  const bookedKinds = (c) => { const sv = Store.bookedService(state, c.id, pendingDate || today()); const k = sv && Store.kindOfService(state, sv.name); return k ? [k] : []; };
  function renderChips(name, selected) {
    return `<div class="chips">${Store.KINDS.map((k) => `<label><input type="checkbox" name="${name}" value="${k}" ${selected.includes(k) ? 'checked' : ''}> ${k}</label>`).join('')}</div>`;
  }
  const readChips = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

  // 저장은 그대로, 보여줄 때만 항목으로. 조각마다 앞의 이름표(시술·고민·다음…)를 떼고 끝말을 차트 말투로.
  // 이름표가 하나라도 있으면 왼쪽 이름표·오른쪽 내용의 표로, 없으면 점 목록, 한 조각이면 문장 그대로.
  const noteItems = (text) => Store.noteLines(text).map((it) => { const { label, text: t } = Store.noteLabel(it); return { label, text: Store.noteTidy(t) }; });
  const dots = (s) => s.replace(/,\s+/g, ' · ');   // 이름표 줄 안의 "가, 나, 다"는 "가 · 나 · 다"로
  function renderLines(text) {
    const outline = Store.noteOutline(text);
    if (outline.length === 0) return '<p class="text"></p>';
    // 글에 제목·번호·표시가 이미 있으면 그 구조 그대로. 점은 항목에만 하나.
    if (outline.some((o) => o.kind !== 'item')) {
      // 항목 안의 "옆머리: 13mm"는 이름을 굵게
      const item = (o) => { const { key, text } = Store.noteInline(o.text); return `<div class="i l${o.level}${Store.noteNumbered(o.text) ? ' num' : ''}">${key ? `<b>${esc(key)}</b>` : ''}${esc(Store.noteTidy(text))}</div>`; };
      return `<div class="outline text">${outline.map((o) => o.kind === 'item' ? item(o)
        : `<div class="${o.kind === 'heading' ? 'h' : 's'} l${o.level}">${esc(o.text)}</div>`).join('')}</div>`;
    }
    const items = outline.map((o) => { const { label, text: t } = Store.noteLabel(o.text); return { label, text: Store.noteTidy(t) }; });
    if (items.some((it) => it.label)) {
      return `<div class="chart text">${items.map((it) => `<span class="lb">${esc(it.label ?? '')}</span><span class="tx">${esc(it.label ? dots(it.text) : it.text)}</span>`).join('')}</div>`;
    }
    if (items.length === 1) return `<p class="text">${esc(items[0].text)}</p>`;
    // 번호로 시작하는 조각은 번호가 표시 역할이라 점을 안 찍는다
    return `<ul class="lines text">${items.map((it) => `<li${Store.noteNumbered(it.text) ? ' class="num"' : ''}>${esc(it.text)}</li>`).join('')}</ul>`;
  }

  // 기록은 네 항목(시술·고민·진단·다음)으로 보인다. 없는 항목은 안 보이고, 옛 기록의 '다음 방향' 칸은 '다음'에 붙는다.
  // 시술 종류 칩은 시술 항목 제목 옆에 (시술 항목이 비어 있으면 칩만).
  // 옛 기록의 '다음 방향' 칸 글은 "다음엔 볼륨펌"처럼 이름을 되풀이하기도 해서, 한 번 항목 규칙에 태워 이름을 뗀다.
  const legacyNext = (v) => (v.next ? Store.splitSections(`다음: ${v.next}`).next : '');
  function renderSections(v) {
    const sec = Store.splitSections(v.done);
    const next = [sec.next, legacyNext(v)].filter(Boolean).join('\n');
    const kinds = (v.kinds ?? []).length ? `<span class="kinds-inline">${v.kinds.map((k) => `<span>${esc(k)}</span>`).join('')}</span>` : '';
    return Store.SECTIONS.map((x) => {
      const body = x.key === 'next' ? next : sec[x.key];
      if (!body && !(x.key === 'done' && kinds)) return '';
      const due = x.key === 'cycle' ? dueText(Store.cycleDue(v.createdAt.slice(0, 10), body)) : '';
      return `<div class="field"><b>${esc(x.name)}${x.key === 'done' ? kinds : ''}${due ? `<span class="due">${due.trim()}</span>` : ''}</b>${body ? renderLines(body) : ''}</div>`;
    }).join('');
  }

  function renderVisit(v) {
    if (v.id === editingVisitId) {
      return `
        <div class="visit">
          <div class="meta"><span class="date-row"><label style="margin:0">날짜</label><input type="date" id="edit-date" value="${v.createdAt.slice(0, 10)}" max="${today()}"> ${v.createdAt.slice(11, 16)}</span><span>고치는 중</span></div>
          <label style="margin-top:0">기록 <small>"고민:", "진단:", "시술:", "주기:", "다음:" 줄로 나뉘어 있습니다. 줄을 옮겨 적으면 항목이 바뀝니다</small></label><textarea id="edit-done">${esc(v.done)}</textarea>
          <label>시술 종류</label>${renderChips('edit-kind', v.kinds ?? [])}
          ${v.next ? `<label>다음에 하기로 한 방향 <small>(옛 기록에만 있는 칸)</small></label><textarea id="edit-next" style="min-height:60px">${esc(v.next)}</textarea>` : ''}
          <div class="row" style="margin-top:8px"><div class="msg" id="edit-msg"></div>
            <button type="button" class="secondary" data-action="cancel-edit">취소</button>
            <button type="button" data-action="save-edit" data-id="${v.id}">고친 내용 저장</button></div>
        </div>`;
    }
    // 고치기 전 내용(v.history)은 기록에는 남지만 화면에는 안 보인다. 원장이 볼 일이 없다고 해서(09-23).
    return `
      <div class="visit">
        <div class="meta"><span>${fmt(v.createdAt)}${v.sincePrev === null ? ' · 첫 방문' : ` · 이전 방문에서 ${v.sincePrev}일 만`}</span>
          <span class="acts">
            <button type="button" class="link" data-action="edit" data-id="${v.id}">고치기</button>
            <button type="button" class="link danger" data-action="del-visit" data-id="${v.id}">지우기</button>
          </span></div>
        ${renderSections(v)}
        ${renderPhotos(v)}
      </div>`;
  }

  // ---- 저장 전에 고른 사진 -------------------------------------------------
  // 사진은 기록에 붙는다. 그래서 적는 칸 안, 저장 단추 바로 위에서 고르고, [방문 기록 저장]을 누를 때 그 기록에 함께 붙인다.
  // 저장 전까지는 이 컴퓨터 메모리에만 있다(새로고침하면 사라짐). 다른 카드로 옮기면 비운다.
  let pendingPhotos = [];   // [{ blob, w, h, url }]
  function clearPending() { pendingPhotos.forEach((p) => URL.revokeObjectURL(p.url)); pendingPhotos = []; }
  function renderPendingPhotos(c) {
    if (!photosReady()) return '<div class="photos form-photos"><small class="hint">서버에 사진 표가 아직 없습니다. Supabase → SQL Editor에서 schema.sql을 다시 실행하면 사진을 쓸 수 있습니다</small></div>';
    if (!c.photoConsent) return '<div class="photos form-photos"><small class="hint">사진은 첫 줄 [고치기]에서 사진 동의를 체크하면 여기서 바로 찍을 수 있습니다</small></div>';
    const room = Store.PHOTO_LIMIT - pendingPhotos.length;
    return `
      <div class="photos form-photos">
        ${pendingPhotos.map((p, i) => `<figure class="photo"><img src="${p.url}" alt="저장할 사진" title="누르면 크게"><button type="button" class="link danger" data-action="pending-del" data-i="${i}" title="빼기">×</button></figure>`).join('')}
        ${room > 0 ? `<label class="photo-add" title="휴대폰이면 카메라가 바로 열립니다. 저장할 때 이 기록에 함께 붙습니다"><input type="file" class="photo-input pending" accept="image/*" capture="environment" multiple hidden><span>+ 사진<br><small>${pendingPhotos.length ? `${pendingPhotos.length}/${Store.PHOTO_LIMIT}<br>` : ''}저장할 때 붙음</small></span></label>` : ''}
        <div class="msg" id="pending-msg"></div>
      </div>`;
  }
  async function addPendingPhotos(files) {
    for (const file of files) {
      if (pendingPhotos.length >= Store.PHOTO_LIMIT) { showMsg($('#pending-msg'), `한 방문에 사진은 ${Store.PHOTO_LIMIT}장까지입니다`, 'error'); break; }
      try {
        const { blob, w, h } = await shrinkImage(file);
        pendingPhotos.push({ blob, w, h, url: URL.createObjectURL(blob) });
      } catch (err) { render(); showMsg($('#pending-msg'), err.message, 'error'); return; }
    }
    render();
  }
  // 저장된 기록에 고른 사진을 하나씩 붙인다. 하나가 실패하면 거기서 멈추고 알린다(기록은 이미 저장돼 있다).
  async function attachPending(visitId) {
    const list = pendingPhotos; pendingPhotos = [];
    let done = 0;
    for (const p of list) {
      try {
        const { state: next, photo } = Store.addPhoto(state, visitId, { w: p.w, h: p.h, bytes: p.blob.size }, now());
        await storage.putPhoto(photo.path, p.blob);
        commit(next); done += 1;
      } catch (err) { list.forEach((q) => URL.revokeObjectURL(q.url)); render(); showMsg($('#visit-msg'), `기록은 저장했지만 사진 ${done + 1}번째에서 멈췄습니다: ${err.message}`, 'error'); return done; }
      URL.revokeObjectURL(p.url);
    }
    return done;
  }

  // [오늘] 탭 아래 한 줄: 오늘 기록이 있으면 사진이 몇 장 붙었는지와 그 기록으로 가는 길.
  function renderPhotoPointer(visits) {
    const v = visits.find((x) => x.createdAt.startsWith(today()));
    if (!v) return '';
    const n = Store.photosOf(state, v.id).length;
    return `<p class="hint photo-pointer">오늘 기록 ${v.createdAt.slice(11, 16)}${n ? ` · 사진 ${n}장` : ''} · <button type="button" class="link" data-action="go-history">${n ? '사진 보기·더 붙이기' : '이 기록에 사진 붙이기'}</button></p>`;
  }

  // ---- 사진 ------------------------------------------------------------------
  // 방문 기록마다 사진 줄. 동의가 없으면 안내만. 파일은 창고에, 여기서는 자리(path)로 주소를 받아 보인다.
  const photosReady = () => USE_LOCAL || !DB.missingTables().some((t) => t === 'card_photos' || t === 'card_customers.photo_consent');
  const familyReady = () => USE_LOCAL || !DB.missingTables().includes('card_customers.family_id');
  function renderPhotos(v) {
    const c = customerOf(v.customerId);
    const list = Store.photosOf(state, v.id);
    if (!c) return '';
    if (!photosReady()) return `<div class="photos"><small class="hint">서버에 사진 표가 아직 없습니다. Supabase → SQL Editor에서 schema.sql을 다시 실행하면 사진을 쓸 수 있습니다</small></div>`;
    if (!c.photoConsent && list.length === 0) return `<div class="photos"><small class="hint">사진은 첫 줄 [고치기]에서 사진 동의를 체크하면 붙일 수 있습니다</small></div>`;
    const canAdd = c.photoConsent && list.length < Store.PHOTO_LIMIT;
    return `
      <div class="photos">
        ${list.map((p) => `<figure class="photo"><img alt="사진" data-path="${esc(p.path)}" title="누르면 크게"><button type="button" class="link danger" data-action="photo-del" data-id="${p.id}" title="이 사진 지우기">×</button></figure>`).join('')}
        ${canAdd ? `<label class="photo-add" title="휴대폰이면 카메라가 바로 열립니다"><input type="file" class="photo-input" accept="image/*" capture="environment" multiple data-visit="${v.id}" hidden><span>+ 사진<br><small>${list.length}/${Store.PHOTO_LIMIT}</small></span></label>` : ''}
        <div class="msg" id="photo-msg-${v.id}"></div>
      </div>`;
  }
  // 사진을 누르면 화면 위에 크게. 아무 데나 누르면 닫힌다.
  function openLightbox(src) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${src}" alt="사진 크게 보기">`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }
  // 그린 뒤 사진마다 주소를 받아 채운다. 창고는 비공개라 한 시간짜리 주소를 쓴다.
  function loadPhotos() {
    document.querySelectorAll('.photo img[data-path]:not([src])').forEach((img) => {
      storage.photoUrl(img.dataset.path).then((url) => { img.src = url; }).catch(() => { img.alt = '사진을 못 불러왔습니다'; });
    });
  }
  // 찍은 그대로는 3~5MB라 올리기 전에 긴 쪽 1600픽셀로 줄인다(300~500KB). 원본은 서버로 안 간다.
  async function shrinkImage(file, max = 1600, quality = 0.82) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { throw new Error('이 사진 형식은 읽을 수 없습니다. 휴대폰 카메라 설정을 "호환성 우선(JPEG)"으로 바꿔 보세요'); }
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * r)), h = Math.max(1, Math.round(bmp.height * r));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('사진을 줄이지 못했습니다');
    return { blob, w, h };
  }
  async function uploadPhotos(visitId, files) {
    const msg = () => $(`#photo-msg-${visitId}`);
    for (const file of files) {
      try {
        showMsg(msg(), '사진 줄이는 중…', 'ok');
        const { blob, w, h } = await shrinkImage(file);
        // 규칙(동의·장수)을 먼저 확인하고, 파일을 올린 뒤에 기록한다. 올리기가 실패하면 기록도 안 남는다.
        const { state: next, photo } = Store.addPhoto(state, visitId, { w, h, bytes: blob.size }, now());
        showMsg(msg(), '올리는 중…', 'ok');
        await storage.putPhoto(photo.path, blob);
        commit(next);
      } catch (err) { render(); loadPhotos(); showMsg(msg(), err.message, 'error'); return; }
    }
    render(); loadPhotos();
  }

  // 안내문 칸을 그린 직후 첫 줄과 미리보기를 채운다.
  function setupNotice() {
    const box = $('#notice-items');
    if (!box) return;
    if (!box.firstElementChild) {
      // 오늘 예약에 올린 시술이 있으면 첫 줄에 미리 채운다(10-24 원장). 보내기·잔액 반영은 원장이 누른다
      const sv = view.kind === 'card' ? Store.bookedService(state, view.id, today()) : null;
      box.appendChild(sv ? noticeRow(sv.name, sv.price ? Store.comma(sv.price) : '') : noticeRow());
    }
    refreshNotice();
  }

  function render() {
    if (view.kind === 'card' && !customerOf(view.id)) view = { kind: 'today' };
    for (const id of Object.keys(drafts)) if (!customerOf(Number(id))) clearDraft(id);
    renderCustomers();
    renderTrash();
    renderAddHits();
    const card = $('#card');
    document.body.classList.toggle('home', !['card', 'monthly', 'stock', 'soon', 'reserve', 'customers'].includes(view.kind));   // 처음 화면엔 왼쪽 메뉴를 감춘다(10-26)
    renderMenu();
    const tlBox = $('#timeline'); if (tlBox) tlBox.innerHTML = renderTimeline();
    const dl = $('#service-list'); if (dl) dl.innerHTML = Store.serviceList(state).map((x) => `<option value="${esc(x.name)}"></option>`).join('');   // 안내문 시술명 칸 자동완성도 같은 목록
    if (view.kind === 'card') { card.innerHTML = renderCard(customerOf(view.id)); setupNotice(); loadPhotos(); }
    else if (view.kind === 'monthly') { card.innerHTML = renderMonthly(view.month ?? today().slice(0, 7)); }
    else if (view.kind === 'stock') { card.innerHTML = renderStock(); renderStockPreview(); }
    else if (view.kind === 'soon') { card.innerHTML = renderSoon(view.what); }
    else if (view.kind === 'reserve') { card.innerHTML = renderReserve(); renderCancelPreview('cancel-text', 'cancel-preview'); renderCancelPreview('cancel-edit-text', 'cancel-edit-preview'); }
    else if (view.kind === 'customers') { card.innerHTML = renderCustomerManage(); renderCustomers(); renderPreBookHits(); }
    else card.innerHTML = renderCenterEmpty();
  }

  // ---- 대시보드 -----------------------------------------------------------
  const monthLabel = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
  const prevMonth = (m) => { const d = new Date(m + '-01T00:00:00'); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const nextMonth = (m) => { const d = new Date(m + '-01T00:00:00'); d.setMonth(d.getMonth() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const topKind = (kinds) => { const e = Object.entries(kinds).filter(([k]) => k !== '미분류').sort((a, b) => b[1] - a[1])[0]; return e && e[1] > 0 ? `${e[0]} ${e[1]}` : '—'; };

  // 오늘 화면 맨 위 한 줄. 누르면 월별로 간다.
  // 결산(10-26 원장: 줄글 표가 눈에 안 들어온다 → 분류 상자. 처음 화면에 있던 숫자 줄도 여기로). 상자에 큰 그림·큰 숫자·지난달 비교,
  // 누르면 그 상자의 자세한 표만 아래에 보인다(monthTab). 메뉴로 들어오면 요약, 처음 화면의 "오래 안 온 고객" 줄은 그 칸으로.
  let monthTab = 'summary';
  function renderMonthly(month) {
    const m = Store.monthlyStats(state, month);
    const p = Store.monthlyStats(state, prevMonth(month));
    const cell = (a, b) => `<td class="num">${a}</td><td class="num" style="color:var(--muted)">${b}</td>`;
    const head3 = '<tr><th>항목</th><th style="text-align:right">이 달</th><th style="text-align:right">지난달</th></tr>';
    const ret = Store.retention(state, { days: state.settings.retentionDays ?? 150, today: today() });
    const over = Store.overdueCustomers(state, today(), state.settings.overdueFactor ?? 1.5);
    const fresh = Store.newCustomersInMonth(state, month);
    const isFuture = month >= today().slice(0, 7);
    const diff = (a, b) => (a === b ? '<small class="same">지난달과 같음</small>' : `<small class="${a > b ? 'up' : 'down'}">지난달보다 ${a > b ? '▲' : '▼'} ${Math.abs(a - b)}</small>`);
    const settled = ret.filter((r) => !r.pending).at(-1);
    const top = topKind(m.kinds);
    const TILES = [
      { key: 'summary', icon: '📋', name: '한 달 요약', big: `${m.visits}건`, sub: `방문 · 고객 ${m.customers}명`, cmp: diff(m.visits, p.visits) },
      { key: 'new', icon: '🌟', name: '신규 고객', big: `${m.newCustomers}명`, sub: '이 달 처음 온 손님', cmp: diff(m.newCustomers, p.newCustomers) },
      { key: 'return', icon: '🔁', name: '재방문', big: `${m.returning}명`, sub: `구성비 ${Math.round(m.returningRatio * 100)}%`, cmp: diff(m.returning, p.returning) },
      { key: 'kinds', icon: '✂️', name: '시술별', big: esc(top), sub: '가장 많이 한 시술', cmp: '' },
      { key: 'settle', icon: '🌱', name: '신규 정착률', big: settled ? `${Math.round(settled.rate * 100)}%` : '집계 중', sub: settled ? `${monthLabel(settled.month)} 신규 기준` : `${state.settings.retentionDays ?? 150}일이 지나야 확정`, cmp: '' },
      { key: 'over', icon: '⏰', name: '오래 안 온 고객', big: `${over.length}명`, sub: '평소 주기를 넘김 · 지금 기준', cmp: '', todo: over.length > 0 },
    ];
    const tab = TILES.some((t) => t.key === monthTab) ? monthTab : 'summary';
    const detail = {
      summary: () => `<h3>📋 한 달 요약</h3><table>${head3}
          <tr><td>방문 건수 (실제로 한 시술 횟수)</td>${cell(m.visits, p.visits)}</tr>
          <tr><td>방문 고객 수 (한 번이라도 온 사람)</td>${cell(m.customers, p.customers)}</tr>
          <tr><td>&nbsp;&nbsp;신규 고객</td>${cell(m.newCustomers, p.newCustomers)}</tr>
          <tr><td>&nbsp;&nbsp;재방문 고객</td>${cell(m.returning, p.returning)}</tr>
          <tr><td>1인당 방문 횟수</td>${cell(m.perCustomer, p.perCustomer)}</tr>
          <tr><td>재방문 고객 비율 (그 달 구성)</td>${cell(Math.round(m.returningRatio * 100) + '%', Math.round(p.returningRatio * 100) + '%')}</tr></table>`,
      new: () => `<h3>🌟 ${monthLabel(month)} 신규 고객 <small>${fresh.length}명 · 누르면 카드</small></h3>
        ${fresh.length ? `<table><tr><th>고객</th><th style="text-align:right">처음 온 날</th><th style="text-align:right">방문</th><th>다시 왔나</th></tr>
          ${fresh.map((f) => `<tr style="cursor:pointer" data-open="${f.customer.id}"><td>${esc(f.customer.name)} <small style="color:var(--muted)">${esc(Store.maskPhone(f.customer.phone))}</small></td><td class="num">${f.firstDate.replace(/-/g, '.')}</td><td class="num">${f.visits}번</td><td>${f.returned ? '<span class="ok">다시 옴</span>' : '<span style="color:var(--muted)">아직</span>'}</td></tr>`).join('')}</table>` : '<div class="empty">이 달 신규 고객이 없습니다.</div>'}`,
      return: () => `<h3>🔁 재방문 · 회차 분포 <small>이 달 온 고객이 몇 번째 방문인지</small></h3>
        <table><tr><th>회차</th><th style="text-align:right">이 달</th><th style="text-align:right">지난달</th></tr>
          <tr><td>1회차 (처음)</td>${cell(m.rounds.first, p.rounds.first)}</tr>
          <tr><td>2~3회차</td>${cell(m.rounds.two3, p.rounds.two3)}</tr>
          <tr><td>4회차 이상 (단골)</td>${cell(m.rounds.fourPlus, p.rounds.fourPlus)}</tr>
          <tr><td>예전부터 오던 고객</td>${cell(m.rounds.legacy, p.rounds.legacy)}</tr></table>`,
      kinds: () => `<h3>✂️ 시술별 카운팅 <small>건수</small></h3>
        <table><tr><th>시술</th><th style="text-align:right">이 달</th><th style="text-align:right">지난달</th></tr>${Object.entries(m.kinds).map(([k, n]) => `<tr><td>${esc(k)}</td>${cell(n, p.kinds[k] ?? 0)}</tr>`).join('')}</table>`,
      settle: () => `<h3>🌱 신규 정착률 <small>처음 온 달별로, ${state.settings.retentionDays ?? 150}일 안에 두 번째 방문한 비율</small></h3>
        ${ret.length === 0 ? '<div class="empty">아직 신규 고객 기록이 없습니다.</div>' : `<table>
          <tr><th>처음 온 달</th><th style="text-align:right">신규</th><th style="text-align:right">돌아옴</th><th style="text-align:right">정착률</th><th>상태</th></tr>
          ${ret.slice().reverse().map((r) => `<tr><td>${monthLabel(r.month)}</td><td class="num">${r.total}</td><td class="num">${r.returned}</td><td class="num">${Math.round(r.rate * 100)}%</td><td style="color:var(--muted)">${r.pending ? '집계 중' : '확정'}</td></tr>`).join('')}
        </table>`}`,
      over: () => `<h3>⏰ 평소 주기보다 오래 안 온 고객 <small>평소 주기의 ${state.settings.overdueFactor ?? 1.5}배를 넘김 · ${over.length}명 · 누르면 카드</small></h3>
        ${over.length === 0 ? '<div class="empty">지금은 없습니다.</div>' : `<table>
          <tr><th>고객</th><th style="text-align:right">지난 방문</th><th style="text-align:right">평소 주기</th><th style="text-align:right">지난 지</th></tr>
          ${over.map((o) => `<tr style="cursor:pointer" data-open="${o.customer.id}"><td>${esc(o.customer.name)} <small style="color:var(--muted)">${esc(Store.maskPhone(o.customer.phone))}</small></td><td class="num">${o.lastDate.replace(/-/g, '.')}</td><td class="num">${o.average}일</td><td class="num">${o.sinceLast}일</td></tr>`).join('')}
        </table>`}`,
    }[tab]();
    return `
      <div class="monthly">
        <h2 class="card-title">결산 <small>기록은 매일 쌓이고, 여기서는 달 단위로 봅니다 · 상자를 누르면 자세히</small></h2>
        <div class="month-pick">
          <button type="button" class="small secondary" data-month="${prevMonth(month)}">◀</button>
          <b style="font-size:18px">${monthLabel(month)}</b>
          <button type="button" class="small secondary" data-month="${nextMonth(month)}" ${isFuture ? 'disabled' : ''}>▶</button>
        </div>
        <div class="mon-tiles">${TILES.map((t) => `
          <button type="button" class="mon-tile ${tab === t.key ? 'on' : ''} ${t.todo ? 'todo' : ''}" data-month-tab="${t.key}">
            <span class="ic">${t.icon}</span>
            <span class="nm">${t.name}</span>
            <span class="big">${t.big}</span>
            <small class="sub">${esc(t.sub)}</small>
            ${t.cmp}
          </button>`).join('')}</div>
        <div class="mon-detail">${detail}</div>
      </div>`;
  }

  // ---- 이벤트 --------------------------------------------------------------
  $('#home').addEventListener('click', () => { view = { kind: 'today' }; render(); });
  // 타임테이블의 손님 막대를 누르면 카드가 열린다
  $('#timeline')?.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { openCard(Number(b.dataset.open)); bringIntoView('#card'); } });
  function openMenu(k) {
    if (k === 'home') view = { kind: 'today' };
    else if (k === 'today') { goCheck('today'); return; }
    else if (k === 'customers') { view = { kind: 'customers' }; custQ = ''; }
    else if (k === 'monthly') { view = { kind: 'monthly', month: today().slice(0, 7) }; monthTab = 'summary'; }
    else if (k === 'stock') { view = { kind: 'stock' }; stock = { ...stock, tab: null, editId: null, arriveId: null, msg: '', arrive: {} }; }
    else if (k === 'reserve') { view = { kind: 'reserve' }; reserve = { ...reserve, editId: null, msg: '', tab: 'cancel' }; loadRemindStatus(); }
    else view = { kind: 'soon', what: k };
    render(); bringIntoView('#card');
  }
  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-menu]');
    if (b) openMenu(b.dataset.menu);
  });
  $('#logout').addEventListener('click', async () => { await storage.logout(); location.reload(); });


  // 타임테이블 (명단): 날짜 넘기기, 빈 칸 누르면 시간 채우기, 올리기, 막대 누르면 카드
  $('#timeline').addEventListener('click', (e) => {
    if (e.target.closest('input, select')) return;
    const mg = e.target.closest('button[data-mgr]');
    if (mg) {
      const act = mg.dataset.mgr;
      if (act === 'open') { if (svcMgr) { svcMgr = null; redrawSvcMgr(); } else { openSvcMgr(); redrawSvcMgr(); } return; }
      if (act === 'cancel') { svcMgr = null; redrawSvcMgr(); return; }
      if (act === 'save') { saveSvcMgr(); return; }
      if (act === 'add') { openSvcMgr(mg.dataset.grp); redrawSvcMgr(); return; }
      if (act === 'add-group') { openSvcMgr(''); redrawSvcMgr(); return; }
      // 순서 바꾸기(10-16 원장): 같은 분류 안에서 한 칸씩, 분류는 통째로 한 칸씩. 저장하면 이 순서대로 고르는 칸에 나온다
      if (act === 'up' || act === 'down') {
        const rows = svcMgr.rows, i = rows.findIndex((r) => r.k === Number(mg.dataset.k));
        const step = act === 'up' ? -1 : 1;
        let j = i + step; while (j >= 0 && j < rows.length && rows[j].group !== rows[i].group) j += step;
        if (i >= 0 && j >= 0 && j < rows.length) { [rows[i], rows[j]] = [rows[j], rows[i]]; svcMgr.focus = null; redrawSvcMgr(); $(`[data-mgr="${act}"][data-k="${mg.dataset.k}"]:not([disabled])`)?.focus(); }
        return;
      }
      if (act === 'g-up' || act === 'g-down') {
        const order = [...new Set(svcMgr.rows.map((r) => r.group))];
        const i = order.indexOf(mg.dataset.grp), j = i + (act === 'g-up' ? -1 : 1);
        if (i >= 0 && j >= 0 && j < order.length) { [order[i], order[j]] = [order[j], order[i]]; svcMgr.rows = order.flatMap((g) => svcMgr.rows.filter((r) => r.group === g)); redrawSvcMgr(); }
        return;
      }
      if (act === 'del') { svcMgr.rows = svcMgr.rows.filter((r) => r.k !== Number(mg.dataset.k)); redrawSvcMgr(); return; }
      if (act === 'del-group') {
        const g = mg.dataset.grp, n = svcMgr.rows.filter((r) => r.group === g).length;
        if (n > 1 && !confirm(`${g} 분류의 시술 ${n}개를 모두 지웁니다. ([저장]을 눌러야 실제로 지워집니다)`)) return;
        svcMgr.rows = svcMgr.rows.filter((r) => r.group !== g); redrawSvcMgr(); return;
      }
      return;
    }
    const famAll = e.target.closest('button[data-fam-all]');
    if (famAll) { if (famAll.dataset.famAll === '1' && famPrompt) addFamilyToo(); else { famPrompt = null; render(); } return; }
    const tdrop = e.target.closest('.tl-sel button[data-drop]');
    if (tdrop) { commit(Store.unmarkToday(state, Number(tdrop.dataset.drop), tdrop.dataset.dropDate).state); view = { kind: 'today' }; render(); return; }
    const nav = e.target.closest('button[data-tl]');
    if (nav) { tlDate = nav.dataset.tl === 'prev' ? shiftDay(tlDate, -1) : nav.dataset.tl === 'next' ? shiftDay(tlDate, 1) : today(); render(); return; }
    const add = e.target.closest('button[data-add]');
    if (add) { addToToday(Number(add.dataset.add)); return; }
    const addNew = e.target.closest('button[data-add-new]');
    if (addNew) { addToToday(null, $('#add-name').value.trim()); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openCard(Number(open.dataset.open), open.dataset.openDate); bringIntoView('#card'); return; }
    const cell = e.target.closest('.tl-cell');
    if (cell) { $('#add-at').value = cell.dataset.at; $('#add-name').focus(); showMsg($('#today-msg'), `${cell.dataset.at}에 올립니다 — 이름을 치고 Enter`, 'draft'); return; }
  });
  $('#timeline').addEventListener('input', (e) => {
    if (e.target.id === 'add-name') renderAddHits();
    if (svcMgr && e.target.matches('.svc-m-name, .svc-m-price')) { const r = svcMgr.rows.find((x) => x.k === Number(e.target.dataset.k)); if (r) r[e.target.classList.contains('svc-m-name') ? 'name' : 'price'] = e.target.value; }
  });
  // 시간 → 시술 → 이름 → Enter 로 한 명씩 빠르게 올린다
  $('#timeline').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('#svc-mgr')) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); saveSvcMgr(); return; }
    if (e.target.id !== 'add-name' || e.key !== 'Enter') return;
    e.preventDefault();
    const first = $('#add-hits button[data-add]') || $('#add-hits button[data-add-new]');
    if (first) first.click();
  });
  $('#timeline').addEventListener('change', (e) => {
    if (e.target.id === 'tl-date' && e.target.value) { tlDate = e.target.value; render(); }
    const swap = e.target.closest('.tl-sel [data-swap]');
    if (swap && swap.value) {
      const to = Number(swap.value), d = swap.dataset.date;
      try { commit(Store.swapTodayEntry(state, Number(swap.dataset.swap), to, d)); openCard(to, d === today() || d > today() ? undefined : d); showMsg($('#today-msg'), `예약을 ${nameOfCustomer(to)}님으로 바꿨습니다`, 'ok'); }
      catch (err) { showMsg($('#today-msg'), err.message, 'error'); }
      return;
    }
    const selCtl = e.target.closest('.tl-sel [data-at], .tl-sel [data-svc]');
    if (selCtl) { entryChange(selCtl); return; }
    // 시술항목 관리 칸(10-16): 시간·분류 옮기기·분류 이름 고치기
    if (svcMgr && e.target.closest('#svc-mgr')) {
      const r = svcMgr.rows.find((x) => x.k === Number(e.target.dataset.k));
      if (e.target.classList.contains('svc-m-min') && r) { r.minutes = e.target.value; return; }
      if (e.target.classList.contains('svc-m-grp') && r) { const rest = svcMgr.rows.filter((x) => x !== r); const last = rest.map((x) => x.group).lastIndexOf(e.target.value); r.group = e.target.value; rest.splice(last + 1, 0, r); svcMgr.rows = rest; redrawSvcMgr(); return; }
      if (e.target.classList.contains('svc-g-name')) {
        const from = e.target.dataset.grp, to = e.target.value.trim().replace(/\s+/g, ' ');
        if (!to) { e.target.value = from; return; }
        if (to !== from) { for (const x of svcMgr.rows) if (x.group === from) x.group = to; redrawSvcMgr(); }
        return;
      }
      return;
    }
    // 둘째 칸 맨 아래 [+ (분류)에 추가]·첫 칸 [+ 새 분류 추가]: 시술항목 관리 칸을 열고 새 줄에 커서 (10-16, 더하기도 한곳에서)
    if (e.target.id === 'add-svc' && e.target.value === ADD_SVC) {
      const g = $('#add-grp').value;
      e.target.value = e.target.options[0]?.value ?? '';
      openSvcMgr(g); redrawSvcMgr();
      return;
    }
    if (e.target.id === 'add-grp') {
      const sub = $('#add-svc');
      if (e.target.value === ADD_SVC) {
        e.target.value = ''; sub.innerHTML = ''; sub.hidden = true;
        openSvcMgr(''); redrawSvcMgr();
        return;
      }
      sub.innerHTML = subOptions(e.target.value, '');
      sub.hidden = !e.target.value;
      if (e.target.value && sub.options.length > 1) sub.focus();
    }
  });
  // 카드 첫 줄의 명단 조절(시간·시술·빼기)
  function entryChange(el) {
    const date = el.dataset.date || today();
    if (el.dataset.svc) { commit(Store.setTodayService(state, Number(el.dataset.svc), date, el.value)); render(); return; }
    const id = Number(el.dataset.at);
    try { commit(Store.setTodayTime(state, id, date, el.value).state); render(); }
    catch (err) { const kept = Store.todayList(state, date).find((t) => t.customer.id === id); el.value = kept ? kept.at : ''; showMsg($('#visit-msg'), err.message, 'error'); }
  }

  // 가운데 카드 (월별 화면의 고객 줄·달 넘기기도 여기)
  $('#card').addEventListener('click', (e) => {
    const drop = e.target.closest('button[data-drop]');
    if (drop) { commit(Store.unmarkToday(state, Number(drop.dataset.drop), drop.dataset.dropDate || today()).state); view = { kind: 'today' }; render(); bringIntoView('#timeline'); return; }
    if (e.target.closest('[data-action=create-only]')) { createCustomer(false); return; }   // 고객 등록 칸: 명단에 안 올리고 만들기만
    if (e.target.matches('.photo img') && e.target.src) { openLightbox(e.target.src); return; }
    if (e.target.closest('input, textarea, select')) return;
    const svcBtn = e.target.closest('.svc-box button[data-svc], .svc-box button[data-svc-act], .svc-box button[data-svc-cat]');
    if (svcBtn) {
      if (svcBtn.dataset.svc !== undefined) { useService(Store.serviceList(state)[Number(svcBtn.dataset.svc)]); return; }
      if (svcBtn.dataset.svcCat !== undefined) { svcCat = svcCat === svcBtn.dataset.svcCat ? null : svcBtn.dataset.svcCat; refreshServices(); return; }
      if (svcBtn.dataset.svcAct === 'manage') { openSvcMgr(); redrawSvcMgr(); bringIntoView('#timeline'); $('#svc-mgr')?.scrollIntoView({ block: 'start' }); return; }
      return;
    }
    const pbBtn = e.target.closest('button[data-pb]');
    if (pbBtn) { try { preBookAction(pbBtn.dataset.pb, pbBtn); } catch (err) { showMsg($('#pb-msg'), err.message, 'error'); } return; }
    const pbSms = e.target.closest('a[data-pb-sms]');
    if (pbSms) {
      const r = Store.preBookTargets(state, today()).find((x) => x.key === Number(pbSms.dataset.pbSms));
      if (r && Store.preBookNeedsPick(state, r.customer.id, today())) { e.preventDefault(); showMsg($('#pb-msg'), `${r.customer.name} 님 추천 날짜를 먼저 적어 주세요 (예: 12월 3일 2시)`, 'error'); $(`.pb-pick[data-key="${r.key}"]`)?.focus(); return; }
      showMsg($('#pb-msg'), '문자 앱에서 보낸 뒤 [보냄 ✓]을 누르세요.', 'ok'); return;
    }
    // 고객 관리: 찾은 고객의 [오늘], 못 찾은 이름으로 등록, 오래 안 온 고객 칸
    const todayBtn = e.target.closest('#cm-list button[data-today]');
    if (todayBtn) { commit(Store.markToday(state, Number(todayBtn.dataset.today), today(), '', '', today()).state); render(); return; }
    const regName = e.target.closest('button[data-reg-name]');
    if (regName) { $('#new-name').value = regName.dataset.regName; $('#new-phone').focus(); return; }
    const goTile = e.target.closest('.cm [data-go]');
    if (goTile) { $('#' + goTile.dataset.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const open = e.target.closest('[data-open]');
    if (open) { openCard(Number(open.dataset.open)); bringIntoView('#card'); return; }
    if (e.target.closest('[data-to-today]')) { bringIntoView('#timeline'); $('#add-name')?.focus(); return; }
    const tab = e.target.closest('button[data-tab]');
    if (tab && view.kind === 'card') { cardTab = tab.dataset.tab; render(); return; }
    const mo = e.target.closest('[data-monthly]');
    if (mo) { view = { kind: 'monthly', month: today().slice(0, 7) }; monthTab = mo.dataset.monthly === 'over' ? 'over' : 'summary'; render(); return; }
    const mt = e.target.closest('button[data-month-tab]');
    if (mt && view.kind === 'monthly') { monthTab = mt.dataset.monthTab; render(); return; }
    const mv = e.target.closest('button[data-month]');
    if (mv) { view = { kind: 'monthly', month: mv.dataset.month }; render(); return; }
    const ho = e.target.closest('button[data-home-open]');
    if (ho && view.kind === 'today') { openMenu(ho.dataset.homeOpen); return; }
    const go = e.target.closest('li[data-go]');
    if (go && view.kind === 'today') { goCheck(go.dataset.go); return; }
    const stab = e.target.closest('button[data-stock-tab]');
    if (stab && view.kind === 'stock') { stock = { ...stock, tab: stab.dataset.stockTab, editId: null, arriveId: null, msg: '' }; render(); return; }
    const scat = e.target.closest('button[data-stock-cat]');
    if (scat && view.kind === 'stock') { stock = { ...stock, cat: scat.dataset.stockCat }; render(); return; }
    const mode = e.target.closest('button[data-stock-mode]');
    if (mode && view.kind === 'stock') { stock = { ...stock, mode: mode.dataset.stockMode, msg: '' }; render(); $('#stock-text')?.focus(); return; }
    const btn = e.target.closest('button[data-action]');
    if (btn && view.kind === 'stock') {
      try { stockAction(btn.dataset.action, btn); }
      catch (err) { showMsg((btn.closest('.sup-manage') && $('#sup-msg')) || $('#stock-edit-msg') || $('#stock-add-msg') || $('#stock-arrive-msg') || $('#stock-msg'), err.message, 'error'); }
      return;
    }
    const rtab = e.target.closest('button[data-reserve-tab]');
    if (rtab && view.kind === 'reserve') {
      reserve = { ...reserve, tab: rtab.dataset.reserveTab, editId: null, msg: '' };
      if (reserve.tab === 'remind') loadRemindStatus();
      render(); return;
    }
    if (btn && view.kind === 'reserve') {
      try { reserveAction(btn.dataset.action, btn); }
      catch (err) { showMsg((btn.closest('.services') && $('#services-msg')) || (btn.closest('.waits') && $('#wait-msg')) || (btn.closest('.cancel-row') && $('#cancel-edit-msg')) || $('#cancel-msg'), err.message, 'error'); }
      return;
    }
    if (!btn || view.kind !== 'card') return;
    const a = btn.dataset.action;
    try {
      if (a === 'notice-kakao') { showMsg($('#notice-msg'), '알림톡은 아직 연결 전입니다 (카카오 채널 인증 → 솔라피 → 문구 심사 뒤). 지금은 복사해서 보냅니다.', 'draft'); return; }
      if (a === 'family-join') {
        const me = customerOf(view.id), other = customerOf(Number(btn.dataset.id));
        const mine = Store.passBalance(state, me.id), theirs = Store.passBalance(state, other.id);
        const next = Store.joinFamily(state, me.id, other.id).state;
        const names = Store.familyOf(next, me.id).map((x) => x.name).join(' · ');
        const w = Store.formatWon;
        if (!confirm(`${me.name}님을 ${other.name}님과 가족으로 묶습니다.\n\n가족: ${names}\n정액권 잔액이 합쳐집니다: ${w(mine)} + ${w(theirs)} = ${w(Store.passBalance(next, me.id))}\n\n묶을까요?`)) return;
        commit(next); render(); showMsg($('#identity-msg'), `가족으로 묶었습니다: ${names}`, 'ok');
      }
      else if (a === 'family-leave') {
        const me = customerOf(view.id);
        const rest = Store.familyOf(state, me.id).filter((x) => x.id !== me.id);
        const next = Store.leaveFamily(state, me.id).state;
        const w = Store.formatWon;
        const restLine = rest.length ? `\n남는 가족(${rest.map((x) => x.name).join(' · ')}): ${w(Store.passBalance(next, rest[0].id))}` : '';
        if (!confirm(`${me.name}님을 가족에서 뺍니다.\n\n${me.name}님 이름으로 적힌 충전·사용만 따라 나갑니다.\n${me.name}: ${w(Store.passBalance(next, me.id))}${restLine}\n\n뺄까요?`)) return;
        commit(next); render(); showMsg($('#identity-msg'), '가족에서 뺐습니다', 'ok');
      }
      else if (a === 'swap-entry') {
        try { commit(Store.swapTodayEntry(state, Number(btn.dataset.from), Number(btn.dataset.to), btn.dataset.date)); render(); showMsg($('#today-msg'), '예약을 바꿨습니다 — 막대가 바뀐 손님으로 보입니다', 'ok'); }
        catch (err) { showMsg($('#today-msg'), err.message, 'error'); }
      }
      else if (a === 'fam-open') {
        const d = $('#visit-date')?.value;
        const id = Number(btn.dataset.id);
        if (id !== view.id) { famAdd = null; openCard(id, d && d !== today() ? d : pendingDate); }
      }
      else if (a === 'fam-add-open') { famAdd = { name: '', role: '' }; render(); $('#fam-add-name')?.focus(); }
      else if (a === 'fam-add-close') { famAdd = null; render(); }
      else if (a === 'fam-role') { famAdd = { ...famAdd, role: famAdd.role === btn.dataset.role ? '' : btn.dataset.role }; render(); }
      else if (a === 'fam-add-save') {
        try {
          const r = Store.addFamilyMember(state, view.id, { name: famAdd.name, role: famAdd.role });
          commit(r.state); famAdd = null; render();
          showMsg($('#identity-msg'), `${r.customer.name}님을 가족으로 더했습니다`, 'ok');
        } catch (err) { showMsg($('#fam-msg'), err.message, 'error'); }
      }
      else if (a === 'fam-rep') { commit(Store.setFamilyRep(state, view.id)); render(); showMsg($('#identity-msg'), '대표를 바꿨습니다. 같은 날 가족 알림톡은 이 고객에게 갑니다', 'ok'); }
      else if (a === 'fam-set-role') {
        const id = Number(btn.dataset.id);
        if (btn.dataset.custom) setRoleOf(id, $(`.fr-custom[data-id="${id}"]`)?.value ?? '');
        else setRoleOf(id, btn.dataset.role && Store.familyRoleOf(state, id) === btn.dataset.role ? '' : btn.dataset.role);   // 같은 단추를 다시 누르면 지움
      }
      else if (a === 'fam-roles-open') { editingIdentity = true; render(); $('#fam-roles')?.scrollIntoView({ block: 'center' }); }
      else if (a === 'edit-identity') { editingIdentity = true; render(); $('#id-name').focus(); }
      else if (a === 'cancel-identity') { editingIdentity = false; render(); }
      else if (a === 'save-identity') {
        let next = Store.editCustomer(state, view.id, { name: $('#id-name').value, phone: $('#id-phone').value, referrer: $('#id-referrer').value, isLegacy: $('#id-legacy').checked }).state;
        const had = !!customerOf(view.id).photoConsent, want = $('#id-photo').checked;
        if (had !== want) next = Store.setPhotoConsent(next, view.id, want, today()).state;
        commit(next);
        editingIdentity = false; render();
      }
      else if (a === 'photo-del') {
        const p = state.photos.find((x) => x.id === Number(btn.dataset.id));
        if (p && confirm('이 사진을 지웁니다. 되살릴 수 없습니다. 계속할까요?')) { commit(Store.removePhoto(state, p.id).state); render(); }
      }
      else if (a === 'delete-customer') {
        const c = customerOf(view.id);
        const n = Store.visitsOf(state, view.id).length;
        if (!confirm(`${c.name} 고객을 목록에서 지웁니다.\n\n방문 기록 ${n}건도 함께 감춰집니다.\n왼쪽 아래 [지운 고객]에서 되살릴 수 있습니다.\n\n지울까요?`)) return;
        commit(Store.deleteCustomer(state, view.id, now()).state);
        editingIdentity = false; trashOpen = true; view = { kind: 'today' }; render();
      }
      else if (a === 'edit-profile') { editingProfile = true; render(); $('#profile-talk').focus(); }
      else if (a === 'cancel-profile') { editingProfile = false; render(); }
      else if (a === 'save-profile') {
        commit(Store.setProfile(state, view.id, { talk: $('#profile-talk').value, hair: $('#profile-hair').value }, now()).state);
        editingProfile = false; render();
      }
      else if (a === 'notice-add') {
        $('#notice-items').appendChild(noticeRow());
        $('#notice-items').lastElementChild.querySelector('.it-name').focus();
        refreshNotice();
      }
      else if (a === 'notice-row-del') {
        btn.closest('.notice-item').remove();
        if (!document.querySelector('.notice-item')) $('#notice-items').appendChild(noticeRow());
        refreshNotice();
      }
      else if (a === 'notice-copy' || a === 'notice-apply') {
        const f = readNotice();
        const used = Store.noticeUsed(f.items);
        if (!used && !f.topup) { showMsg($('#notice-msg'), '오늘 시술이나 충전 내역을 먼저 적으세요', 'error'); return; }

        // 반영은 저장까지 하므로 먼저 계산해 본다. 잔액이 모자라면 여기서 막혀
        // 문자만 나가고 숫자는 안 맞는 일이 생기지 않는다.
        let next = state;
        try {
          // 문자에 적는 날짜로 정액권 내역도 남긴다. 시각은 지금 것 (뒤 날짜는 cleanDate가 막는다).
          const day = Store.cleanDate(f.date, now());
          const at = day ? day + now().slice(10) : now();
          if (a === 'notice-apply') {
            // 원장이 적은 잔액이 카드 잔액과 다르면 먼저 그 금액으로 맞춘다 (차이만큼 내역 한 줄).
            if (f.prevTyped) next = Store.setPassBalance(next, view.id, f.prev, at).state;
            if (f.topup) {
              next = Store.chargePass(next, view.id, { amount: f.topup.amount, note: f.topup.name || '정액권 충전' }, at).state;
              next = Store.rememberProduct(next, f.topup).state;
            }
            if (used) {
              const what = f.items.map((it) => it.name).filter(Boolean).join(' · ') || '시술';
              next = Store.usePass(next, view.id, { amount: used, note: what }, at).state;
            }
          }
        } catch (err) { showMsg($('#notice-msg'), err.message, 'error'); return; }
        const text = Store.buildNotice(f);
        commit(next);
        const remain = Store.passBalance(state, view.id);
        copyText(text).then((ok) => {
          if (a === 'notice-copy') { noticeOpen = true; render(); }
          showMsg($('#notice-msg'),
            ok ? (a === 'notice-apply' ? `복사했습니다 · 잔액 ${Store.formatWon(remain)}` : '복사했습니다')
               : '자동 복사가 막혔습니다. 아래 글을 직접 복사하세요',
            ok ? 'ok' : 'error');
        });
        if (a === 'notice-apply') { noticeOpen = true; render(); showMsg($('#notice-msg'), `정액권에 반영했습니다 · 잔액 ${Store.formatWon(remain)}`, 'ok'); }
      }
      else if (a === 'pass-charge') {
        passForm = 'charge'; render(); $('#pass-amount').focus();
      }
      else if (a === 'pass-cancel') { passForm = null; render(); }
      else if (a === 'pass-save') {
        const fields = { amount: $('#pass-amount').value, note: $('#pass-note').value };
        commit(Store.chargePass(state, view.id, fields, now()).state);
        passForm = null; passOpen = true; render();
      }
      else if (a === 'pass-del') {
        const e = Store.passEntriesOf(state, view.id).find((x) => x.id === Number(btn.dataset.id));
        const label = `${e.kind === 'charge' ? '충전' : '사용'} ${e.kind === 'charge' ? '+' : '-'}${Store.formatWon(e.amount)}`;
        if (!confirm(`${fmt(e.at)} 정액권 내역을 지웁니다.\n\n${label}${e.note ? ' · ' + e.note : ''}\n\n지우면 잔액이 바로 바뀝니다. 되돌릴 수 없습니다.\n\n지울까요?`)) return;
        commit(Store.deletePass(state, e.id).state);
        passOpen = true; render();
      }
      else if (a === 'del-visit') {
        const v = Store.visitsOf(state, view.id).find((x) => x.id === Number(btn.dataset.id));
        const head = v.done.length > 40 ? v.done.slice(0, 40) + '…' : v.done;
        const linked = Store.passEntriesOf(state, view.id).filter((x) => x.visitId === v.id);
        const note = linked.length
          ? `\n\n이 방문과 함께 넣은 정액권 차감 ${Store.formatWon(linked.reduce((n, x) => n + x.amount, 0))}은 그대로 남습니다.\n필요하면 정액권 내역에서 따로 지우세요.`
          : '';
        if (!confirm(`${fmt(v.createdAt)} 방문 기록을 지웁니다.\n\n${head}${note}\n\n[지난 방문] 아래 [지운 기록]에서 되살릴 수 있습니다.\n\n지울까요?`)) return;
        commit(Store.deleteVisit(state, v.id, now()).state);
        visitTrashOpen = true; editingVisitId = null; render();
      }
      else if (a === 'restore-visit') {
        commit(Store.restoreVisit(state, Number(btn.dataset.id)).state);
        visitTrashOpen = true; render();
      }
      else if (a === 'purge-visit') {
        const v = Store.deletedVisitsOf(state, view.id).find((x) => x.id === Number(btn.dataset.id));
        const head = v.done.length > 40 ? v.done.slice(0, 40) + '…' : v.done;
        if (!confirm(`${fmt(v.createdAt)} 기록을 완전히 지웁니다.\n\n${head}\n\n이건 되돌릴 수 없습니다.\n\n계속할까요?`)) return;
        if (!confirm('마지막 확인입니다.\n\n이 기록이 영영 사라집니다.')) return;
        commit(Store.purgeVisit(state, v.id).state);
        visitTrashOpen = true; render();
      }
      else if (a === 'edit') { editingVisitId = Number(btn.dataset.id); render(); $('#edit-done').focus(); }
      else if (a === 'cancel-edit') { editingVisitId = null; render(); }
      else if (a === 'discard-draft') { clearDraft(view.id); render(); }
      else if (a === 'go-history') { cardTab = 'history'; render(); }
      else if (a === 'pending-del') { const [p] = pendingPhotos.splice(Number(btn.dataset.i), 1); if (p) URL.revokeObjectURL(p.url); render(); }
      else if (a === 'save-edit') {
        commit(Store.editVisit(state, Number(btn.dataset.id), { done: $('#edit-done').value, next: $('#edit-next')?.value ?? '', kinds: readChips('edit-kind'), date: $('#edit-date').value }, now()).state);
        editingVisitId = null; render();
      }
    } catch (err) { showMsg($('#pass-msg') || $('#identity-msg') || $('#edit-msg') || $('#profile-msg') || $('#visit-trash-msg'), err.message, 'error'); }
  });

  $('#trash').addEventListener('click', (e) => {
    if (e.target.closest('summary')) { trashOpen = !trashOpen; return; }

    const restore = e.target.closest('button[data-restore]');
    if (restore) {
      try {
        const { state: next, customer } = Store.restoreCustomer(state, Number(restore.dataset.restore));
        commit(next); trashOpen = true; render();
        showMsg($('#trash-msg'), `${customer.name} 고객을 되살렸습니다`, 'ok');
      } catch (err) { showMsg($('#trash-msg'), err.message, 'error'); }
      return;
    }

    // 완전히 지우기는 되돌릴 수 없으므로 두 번 묻는다.
    const purge = e.target.closest('button[data-purge]');
    if (purge) {
      const id = Number(purge.dataset.purge);
      const c = customerOf(id);
      const n = Store.visitsOf(state, id).length;
      if (!confirm(`${c.name} 고객과 방문 기록 ${n}건을 완전히 지웁니다.\n\n이건 되돌릴 수 없습니다.\n\n계속할까요?`)) return;
      if (!confirm(`마지막 확인입니다.\n\n${c.name} 고객의 기록이 영영 사라집니다.`)) return;
      commit(Store.purgeCustomer(state, id).state);
      trashOpen = true;
      if (view.kind === 'card' && view.id === id) view = { kind: 'today' };
      render();
    }
  });

  // 업체 이름 칸에서 Enter = 옆 [추가]. 고객 찾기 칸에서 Enter = 첫 고객 열기
  $('#card').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.target.classList.contains('pb-pick')) { e.preventDefault(); e.target.blur(); return; }
    if (e.key === 'Enter' && !e.isComposing && e.target.classList.contains('fr-custom')) { e.preventDefault(); setRoleOf(Number(e.target.dataset.id), e.target.value); return; }
    if (e.key === 'Enter' && e.target.closest('#fam-add')) { e.preventDefault(); $('[data-action=fam-add-save]')?.click(); return; }
    if (e.key === 'Enter' && e.target.id === 'cm-search') { e.preventDefault(); $('#cm-list [data-open]')?.click(); return; }
    if (e.key !== 'Enter' || !e.target.matches('.sup-new-name')) return;
    e.preventDefault();
    e.target.parentElement.querySelector('button')?.click();
  });
  $('#card').addEventListener('click', (e) => {
    if (e.target.closest('details.trash summary') && view.kind !== 'stock') visitTrashOpen = !visitTrashOpen;
    if (e.target.closest('details.pass-list summary')) passOpen = !passOpen;
    if (e.target.closest('details.notice > summary')) {
      noticeOpen = !noticeOpen;
      if (noticeOpen) setTimeout(setupNotice, 0);
    }
  });

  $('#card').addEventListener('input', (e) => {
    if (famAdd && e.target.id === 'fam-add-name') { famAdd.name = e.target.value; return; }
    if (famAdd && e.target.id === 'fam-add-role') { famAdd.role = e.target.value; return; }
    if (e.target.id === 'cm-search') { custQ = e.target.value; renderCustomers(); return; }
    if (e.target.id === 'pb-q') { preBook = { ...preBook, q: e.target.value }; renderPreBookHits(); return; }
    if (e.target.id === 'pb-text') { const pv = $('#pb-preview'); if (pv) { const first = Store.preBookTargets(state, today())[0]; if (first) pv.textContent = Store.preBookMessage(Store.setPreBookText(state, e.target.value).state, first.customer.id, today()); } return; }
    if (e.target.id === 'family-q') { renderFamilyHits(); return; }
    if (e.target.id === 'stock-text') { stock = { ...stock, text: e.target.value, msg: '' }; renderStockPreview(); return; }
    if (e.target.classList.contains('oq')) {
      const v = e.target.value.replace(/[^\d]/g, '');
      if (v !== e.target.value) e.target.value = v;
      stock = { ...stock, orderQtys: { ...stock.orderQtys, [e.target.dataset.pid]: v } };
      const gEl = e.target.closest('.order-group');
      const g = gEl && orderGroupAt(gEl.dataset.gi);
      if (g) gEl.querySelector('.order-msg').textContent = orderMsgOf(g) || '이번엔 보낼 제품이 없습니다 (이번 주문을 전부 0으로 했습니다)';
      return;
    }
    if (e.target.dataset.arriveQty) {
      const v = e.target.value.replace(/[^\d]/g, '');
      if (v !== e.target.value) e.target.value = v;
      stock = { ...stock, arrive: { ...stock.arrive, [e.target.dataset.arriveQty]: v } };
      return;
    }
    if (e.target.id === 'stock-date') { stock = { ...stock, date: e.target.value }; return; }
    if (e.target.id === 'cancel-text') { reserve = { ...reserve, text: e.target.value }; renderCancelPreview('cancel-text', 'cancel-preview'); return; }
    if (e.target.id === 'cancel-edit-text') { renderCancelPreview('cancel-edit-text', 'cancel-edit-preview'); return; }
    if (e.target.id === 'visit-done') { const p = $('#split-preview'); if (p) p.innerHTML = renderSplitPreview(e.target.value); }
    if (e.target.closest('#visit-form')) { saveDraft(); return; }
    if (e.target.closest('.notice')) refreshNotice();
  });

  $('#card').addEventListener('change', (e) => {
    // 선예약 추천 날짜: 칸을 벗어나면 저장. 다시 그리지 않는다(바로 누른 [문구 복사]가 사라지지 않게) — 문자 링크 글만 새로
    if (e.target.classList.contains('pb-pick')) {
      const key = Number(e.target.dataset.key), d = today();
      commit(Store.setPreBookPick(state, Store.preBookDates(d).month, key, e.target.value).state);
      e.target.value = Store.preBookPickOf(state, Store.preBookDates(d).month, key);
      e.target.classList.toggle('empty', !e.target.value);
      const r = Store.preBookTargets(state, d).find((x) => x.key === key);
      const a = $(`a[data-pb-sms="${key}"]`);
      if (a && r) a.href = smsHref(r.customer.phone, Store.preBookMessage(state, r.customer.id, d));
      return;
    }
    const ctl = e.target.closest('.entry-ctl [data-at], .entry-ctl [data-svc]');
    if (ctl) { entryChange(ctl); return; }
    if (e.target.classList.contains('photo-input')) {
      if (e.target.classList.contains('pending')) addPendingPhotos([...e.target.files]);
      else uploadPhotos(Number(e.target.dataset.visit), [...e.target.files]);
      return;
    }
    if (e.target.closest('#visit-form')) { saveDraft(); return; }   // 칩·날짜
    if (e.target.id === 'notice-topup-on') { $('#notice-topup').hidden = !e.target.checked; refreshNotice(); return; }
    if (e.target.id === 'notice-date') { refreshNotice(); return; }
    // 다시 그리지 않는다. 그리면 지금 치던 칸에서 커서가 날아간다.
    if (e.target.id === 'pb-text') { commit(Store.setPreBookText(state, e.target.value).state); showMsg($('#pb-msg'), '문구를 저장했습니다', 'ok'); return; }
    if (e.target.dataset.arriveChk || e.target.hasAttribute('data-arrive-all')) {
      // 체크하면 들어온 개수를 주문한 개수로 채워 둔다. 전부 체크는 다 넣거나 다 뺀다
      const ordered = Store.orderedProducts(state, today());
      const fill = (o) => [o.product.id, o.ordered ? String(o.ordered) : ''];
      let arrive = { ...stock.arrive };
      if (e.target.hasAttribute('data-arrive-all')) arrive = e.target.checked ? Object.fromEntries(ordered.map((o) => (o.product.id in arrive ? [o.product.id, arrive[o.product.id]] : fill(o)))) : {};
      else {
        const id = Number(e.target.dataset.arriveChk);
        if (e.target.checked) { const o = ordered.find((x) => x.product.id === id); if (o) arrive[id] = fill(o)[1]; }
        else delete arrive[id];
      }
      stock = { ...stock, arrive };
      render();
      if (e.target.dataset.arriveChk && e.target.checked && !arrive[e.target.dataset.arriveChk]) $(`[data-arrive-qty="${e.target.dataset.arriveChk}"]`)?.focus();
      return;
    }
    if (e.target.id === 'order-head') { commit(Store.setOrderHead(state, e.target.value).state); render(); return; }
    if (e.target.id === 'notice-head' || e.target.id === 'notice-tail') {
      commit(Store.setSettings(state, { head: $('#notice-head').value, tail: $('#notice-tail').value }).state);
      return;
    }
    // 기억해 둔 상품을 고르면 금액·조건·선물을 채워 준다
    if (e.target.id === 'notice-topup-name') {
      const p = Store.findProduct(state, e.target.value);
      if (p) {
        $('#notice-topup-amt').value = Store.comma(p.amount);
        $('#notice-topup-terms').value = p.terms;
        $('#notice-topup-gift').value = p.gift;
      }
      refreshNotice();
      return;
    }
    // 금액 칸은 손을 뗄 때 쉼표를 찍는다. 글자 치는 중에 찍으면 커서가 튄다.
    if (e.target.classList.contains('won')) {
      const n = digitsOf(e.target.value);
      e.target.value = n ? Store.comma(n) : '';
      refreshNotice();
      return;
    }
  });

  $('#card').addEventListener('submit', (e) => {
    if (e.target.id === 'new-customer-form') { e.preventDefault(); createCustomer(true); return; }
    if (e.target.id !== 'visit-form') return;
    e.preventDefault();
    (async () => {
      let saved;
      try {
        const date = $('#visit-date').value;
        // '다음에 하기로 한 방향'은 따로 칸이 없다. 글 안에 "다음, …"으로 적으면 이름표로 보인다 (원장 결정, 09-29)
        const made = Store.addVisit(state, view.id, { done: $('#visit-done').value, next: '', kinds: readChips('visit-kind'), date }, now());
        commit(made.state); saved = { visit: made.visit, date };
        clearDraft(view.id);   // 저장됐으니 임시 글은 비운다
      } catch (err) { showMsg($('#visit-msg'), err.message, 'error'); return; }
      const wanted = pendingPhotos.length;
      const attached = wanted ? await attachPending(saved.visit.id) : 0;
      if (wanted && attached < wanted) return;   // 사진에서 멈췄으면 그 메시지를 남긴다
      render();
      const m = $('#visit-msg'); m.className = 'msg ok';
      const when = saved.date && saved.date !== today() ? `${fmtDay(saved.date)} 기록으로 저장했습니다` : '저장했습니다';
      const sec = Store.splitSections(saved.visit.done);
      const parts = Store.SECTIONS.filter((x) => sec[x.key]).map((x) => x.label);
      m.innerHTML = `${when}${parts.length > 1 ? ` · ${parts.join('·')} 항목으로 나눔` : ''}${attached ? ` · 사진 ${attached}장 붙임` : ''} · <button type="button" class="link" data-action="go-history">기록 보기</button>`;
    })();
  });

  // ---- 파일 백업 -----------------------------------------------------------
  $('#export').addEventListener('click', () => {
    const blob = new Blob([Store.serialize(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `상담카드-백업-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const loaded = Store.deserialize(text);
    const summary = (st) => `고객 ${st.customers.length}명 · 방문 기록 ${st.visits.length}건 · 정액권 잔액 합계 ${Store.formatWon(Store.totalPassBalance(st))}`;
    if (loaded.customers.length === 0 && state.customers.length > 0 && !confirm('이 백업 파일에는 고객이 없습니다. 지금 서버 기록을 비우고 이 파일로 되돌릴까요?')) { e.target.value = ''; return; }
    if (state.customers.length > 0 && !confirm(`지금 서버 기록(${summary(state)})을\n이 백업 파일의 내용(${summary(loaded)})으로 통째로 되돌립니다.\n지금 기록 중 백업 이후에 적은 것은 사라집니다.\n\n계속할까요?`)) { e.target.value = ''; return; }
    e.target.value = '';
    showSync('백업 파일로 되돌리는 중…');
    try {
      const cleaned = Store.sweepDeletedVisits(loaded, now()).state;
      await storage.replaceAll(cleaned);
      state = await storage.load(today());
      view = { kind: 'today' }; render();
      showSync('');
      alert(`되돌렸습니다.\n\n백업 파일: ${summary(cleaned)}\n서버: ${summary(state)}\n\n두 줄이 같으면 잘 된 것입니다.`);
    } catch (err) { showSync(`되돌리기 실패: ${err.message}`, 'error'); }
  });

  // ---- 시작: 로그인 → 서버에서 읽기 → 그리기 -------------------------------
  async function boot() {
    if (USE_LOCAL) { $('#subtitle').textContent = '시험 모드 · 이 브라우저에만 저장됩니다 · 실제 기록과 무관'; $('#logout').hidden = true; $('#sample').hidden = false; }
    else DB.init(CONFIG, window.supabase);
    if (!(await storage.session())) { $('#login').hidden = false; $('#login-password').focus(); return; }
    await start();
  }
  async function start() {
    $('#login').hidden = true;
    showSync('불러오는 중…');
    try {
      state = await storage.load(today());
      showSync('');
    } catch (err) { showSync(`불러오기 실패: ${err.message}`, 'error'); return; }
    // 지운 지 일주일이 지난 방문 기록을 치운다.
    const swept = Store.sweepDeletedVisits(state, now());
    if (swept.removed > 0) commit(swept.state);
    // 그 달이 끝난 예약 대기를 지운다(손님에게 "대기가 끝나면 지워요"라고 했다).
    if (waitReady()) { const sw = Store.sweepWaits(state, today()); if (sw.removed > 0) commit(sw.state); }
    // 날이 바뀌었으면 명단을 넘긴다: 적은 사람은 빠지고, 안 적은 사람은 지난 명단으로 남는다.
    const rolled = Store.rollToday(state, today());
    if (rolled.state !== state) commit(rolled.state);
    render();
  }
  // 시험 모드: 로그인 없이 둘러보는 사람이 빈 화면 대신 예시 손님을 본다 (이 브라우저에만 저장).
  $('#sample').addEventListener('click', () => {
    if (state.customers.length && !confirm('지금 이 브라우저에 있는 시험 기록을 지우고 예시 손님 여섯 명으로 바꿉니다. 계속할까요?')) return;
    view = { kind: 'today' };
    commit(Store.sampleState(today(), now()));
    render();
  });
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await storage.login(CONFIG.LOGIN_EMAIL, $('#login-password').value); await start(); }
    catch (err) { showMsg($('#login-msg'), err.message, 'error'); }
  });
  // 다른 컴퓨터에서 고친 뒤 이 창을 다시 잡으면 서버에서 다시 읽는다 (고치는 중이면 건너뜀).
  window.addEventListener('focus', async () => {
    if (USE_LOCAL || $('#login').hidden === false || isEditing() || pendingSaves > 0) return;
    // 읽는 동안 손님을 올리거나 고쳤으면 늦게 온 옛 내용으로 덮지 않는다 (10-27 원장: 올린 손님이 사라졌다)
    const before = state;
    try { const fresh = await storage.load(today()); if (state !== before || isEditing() || pendingSaves > 0) return; state = fresh; render(); } catch {}
  });
  boot();
})();
