-- 헤어원네스트 상담 카드 V2·V3 — Supabase 표
-- 투두리스트 프로젝트를 같이 쓰므로 표 이름 앞에 card_ 를 붙인다.
-- Supabase 관리 화면 → SQL Editor 에 이 파일 전체를 붙여넣고 Run.
-- 다시 실행해도 안전하다 (create if not exists / drop policy 후 재생성).
-- card_daily_counts 표는 처음 만들었다가 안 쓰기로 해서 뺐다 (서버에 남아 있어도 무해. 지우려면: drop table card_daily_counts;)

create table if not exists card_customers (
  id bigint primary key,
  name text not null,
  phone text not null default '',
  referrer text not null default '',
  is_legacy boolean not null default false,        -- 예전부터 오던 고객 (신규 집계 제외)
  profile jsonb not null default '{"talk":"","hair":""}',
  profile_history jsonb not null default '[]',
  deleted_at text,                                  -- 지우기(감추기) 시각. null이면 살아 있음
  created_at text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists card_visits (
  id bigint primary key,
  customer_id bigint not null references card_customers(id) on delete cascade,
  done text not null,
  next text not null default '',
  kinds text[] not null default '{}',              -- 시술 종류 칩: 커트·펌·염색·클리닉·기타
  history jsonb not null default '[]',
  created_at text not null,
  deleted_at text,
  updated_at timestamptz not null default now()
);
create index if not exists card_visits_customer on card_visits(customer_id);

create table if not exists card_passes (
  id bigint primary key,
  customer_id bigint not null references card_customers(id) on delete cascade,
  kind text not null,                               -- charge / use
  amount integer not null,
  note text not null default '',
  at text not null default '',                      -- 적은 시각
  visit_id bigint,                                  -- 안내문에서 방문 기록과 함께 넣은 경우
  updated_at timestamptz not null default now()
);
create index if not exists card_passes_customer on card_passes(customer_id);

-- 사진: 방문 기록 하나에 붙는다. 파일은 창고(card-photos 버킷)에, 표에는 자리(path)와 크기만.
alter table card_customers add column if not exists photo_consent jsonb;   -- {"at":"YYYY-MM-DD"} 사진 동의. null이면 동의 없음
alter table card_customers add column if not exists family_id bigint;      -- 가족 묶기(10-07): 같은 가족은 같은 번호(대표 고객 번호). null이면 가족 없음. 정액권을 함께 쓰려고

create table if not exists card_photos (
  id bigint primary key,
  customer_id bigint not null references card_customers(id) on delete cascade,
  visit_id bigint not null references card_visits(id) on delete cascade,
  path text not null,                               -- 창고 안 자리: 고객번호/방문번호/사진번호.jpg
  w integer not null default 0,
  h integer not null default 0,
  bytes integer not null default 0,
  created_at text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists card_photos_visit on card_photos(visit_id);

-- V3 제품 재고: 개수 단위만. 숫자는 들어온 것(in)과 달마다 센 것(count)으로만 움직인다. 돈은 없다(원본은 핸드SOS).
create table if not exists card_products (
  id bigint primary key,
  name text not null,
  category text not null default '기타',             -- 염색약 · 펌제 · 클리닉 · 판매 제품 · 소모품 · 기타
  qty integer not null default 0,                   -- 지금 개수
  min integer not null default 1,                   -- 부족 기준 (이 개수 이하면 "주문할 제품")
  link text not null default '',                    -- 주문하는 곳 주소 (비워도 됨)
  alarm boolean not null default true,              -- 부족 알림 켬/끔
  ordered_at text,                                  -- 주문한 시각. null이면 도착 대기 아님
  deleted_at text,
  updated_at timestamptz not null default now()
);

-- 거래처(카톡 보낼 상대)와 주문 수량 (10-06). 이미 있는 제품 표에 열만 더한다. 여러 번 Run 해도 안전하다
alter table card_products add column if not exists supplier text not null default '';
alter table card_products add column if not exists order_qty integer not null default 0;

create table if not exists card_stock_logs (
  id bigint primary key,
  product_id bigint not null references card_products(id) on delete cascade,
  kind text not null,                               -- in(들어옴) / count(세어서 맞춤)
  qty integer not null,                             -- in이면 들어온 개수, count면 센 개수
  before integer not null default 0,
  after integer not null default 0,
  at text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists card_stock_logs_product on card_stock_logs(product_id);

-- 예약 취소 기록 (V4 첫 걸음, 10-11). 열흘 동안 취소 자리가 채워지는지 세려고 원장이 한 줄씩 적는다.
-- 처음 Run 하거나 10-11 뒤 다시 Run 하면 생긴다. 없어도 카드는 열린다(그때는 취소 적기만 저장이 안 된다).
create table if not exists card_cancels (
  id bigint primary key,
  date text not null,                               -- 취소된 예약의 날짜 (YYYY-MM-DD)
  "time" text not null default '',                  -- 몇 시 (HH:MM, 모르면 빈 글)
  service text not null default '',                 -- 무슨 시술 (시술 시간표의 이름)
  minutes integer,                                  -- 그 시술에 걸리는 분 (적을 때 시간표에서)
  days_before integer,                              -- 며칠 전에 취소했나 (0=당일, 모르면 null)
  filled text not null default 'unknown',           -- yes(채워짐) / no(비었음) / unknown(아직 모름)
  filled_in text not null default '',               -- 얼마 만에 채워졌나 (예: 다음 날, 한 시간 만에)
  note text not null default '',                    -- 원장이 적은 글 그대로
  at text not null default '',                      -- 적은 시각
  updated_at timestamptz not null default now()
);

-- 예약 대기 (C안, 10-11). 손님이 wait.html에서 직접 건다. 쓰는 쪽은 서버 함수 api/wait.js(서비스 키, RLS를 지나침)이고,
-- 원장 앱은 로그인으로 읽고 문자 보낸 표시(notified)와 상태만 고친다. 손님은 자기 것만 본다(번호+확인번호).
create table if not exists card_waitlist (
  id bigint primary key,
  name text not null,
  phone text not null,                              -- 숫자만
  service text not null,                            -- 시술 시간표의 이름
  minutes integer,                                  -- 그 시술에 걸리는 분 (걸 때 시간표에서)
  date_from text not null,                          -- 원하는 날짜 범위 (YYYY-MM-DD)
  date_to text not null,
  windows jsonb not null default '[]',              -- 되는 시간대 ["am","pm","eve"]
  note text not null default '',
  code text not null default '',                    -- 손님 확인번호 (여섯 자리)
  status text not null default 'waiting',           -- waiting / left(손님이 뺌) / expired(기간 지남) / booked
  created_at text not null default '',
  notified jsonb not null default '[]',             -- 문자 보낸 취소 [{cancelId, at}]
  updated_at timestamptz not null default now()
);
create index if not exists card_waitlist_phone on card_waitlist(phone);

create table if not exists card_today (
  date text primary key,                            -- YYYY-MM-DD
  entries jsonb not null default '[]',              -- [{customerId, at, date}] 항목마다 날짜. 안 적은 사람은 다음 날 줄로 넘어간다
  updated_at timestamptz not null default now()
);

create table if not exists card_settings (
  id integer primary key default 1 check (id = 1),
  data jsonb not null default '{}',                 -- 안내문 머리말·맺음말, 정액권 상품, nextId, 정착 기준일, 주기 배수
  updated_at timestamptz not null default now()
);

-- 자물쇠: 로그인한 사용자만 읽고 쓴다. 공개 키만 있는 사람은 아무것도 못 본다.
alter table card_customers    enable row level security;
alter table card_visits       enable row level security;
alter table card_passes       enable row level security;
alter table card_photos       enable row level security;
alter table card_today        enable row level security;
alter table card_settings     enable row level security;
alter table card_products     enable row level security;
alter table card_stock_logs   enable row level security;
alter table card_cancels      enable row level security;
alter table card_waitlist     enable row level security;

drop policy if exists "card_customers_auth"    on card_customers;
drop policy if exists "card_visits_auth"       on card_visits;
drop policy if exists "card_passes_auth"       on card_passes;
drop policy if exists "card_photos_auth"       on card_photos;
drop policy if exists "card_today_auth"        on card_today;
drop policy if exists "card_settings_auth"     on card_settings;
drop policy if exists "card_products_auth"     on card_products;
drop policy if exists "card_stock_logs_auth"   on card_stock_logs;
drop policy if exists "card_cancels_auth"      on card_cancels;
drop policy if exists "card_waitlist_auth"     on card_waitlist;

create policy "card_customers_auth"    on card_customers    for all to authenticated using (true) with check (true);
create policy "card_visits_auth"       on card_visits       for all to authenticated using (true) with check (true);
create policy "card_passes_auth"       on card_passes       for all to authenticated using (true) with check (true);
create policy "card_photos_auth"       on card_photos       for all to authenticated using (true) with check (true);
create policy "card_today_auth"        on card_today        for all to authenticated using (true) with check (true);
create policy "card_settings_auth"     on card_settings     for all to authenticated using (true) with check (true);
create policy "card_products_auth"     on card_products     for all to authenticated using (true) with check (true);
create policy "card_stock_logs_auth"   on card_stock_logs   for all to authenticated using (true) with check (true);
create policy "card_cancels_auth"      on card_cancels      for all to authenticated using (true) with check (true);
create policy "card_waitlist_auth"     on card_waitlist     for all to authenticated using (true) with check (true);

-- 사진 창고: 비공개 버킷 card-photos. 로그인한 사용자만 올리고 보고 지운다. 한 파일 3MB까지.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('card-photos', 'card-photos', false, 3145728)
  on conflict (id) do nothing;
drop policy if exists "card_photos_bucket_auth" on storage.objects;
create policy "card_photos_bucket_auth" on storage.objects
  for all to authenticated
  using (bucket_id = 'card-photos') with check (bucket_id = 'card-photos');
