-- =================================================================
-- 핏가이드 DB 스키마 (Supabase / PostgreSQL)
-- Supabase 대시보드 → SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- · 사용자는 브라우저마다 익명 로그인(Anonymous Sign-in)으로 발급된 auth.uid() 로 구분합니다.
-- · 모든 테이블은 RLS 로 "본인 행만" 읽기/쓰기/삭제할 수 있습니다.
-- · persona_id 는 데모 계정(국민체력100 회원 ID, 예: dajim1004@gmail.com)입니다.
-- =================================================================

-- 체크인: 사용자 · 프로필 · 날짜별 1건
create table if not exists public.checkins (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  persona_id text        not null,
  ck_date    date        not null,
  type       text        not null check (type in ('KSPO 맞춤 처방 루틴', '개인 운동', '휴식')),
  rpe        smallint    not null default 0 check (rpe between 0 and 10),
  cats       text[]      not null default '{}',
  dur        text,
  time_text  text,
  memo_text  text,
  updated_at timestamptz not null default now(),
  primary key (user_id, persona_id, ck_date)
);

-- 운동 메모
create table if not exists public.memos (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  persona_id text        not null,
  text       text        not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists memos_owner_idx on public.memos (user_id, persona_id, created_at);

-- 프로필별 설정
create table if not exists public.user_settings (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  persona_id  text        not null,
  start_date  date,                                   -- 프로그램 시작일(= 1차 측정일 표시 기준)
  week_goal   smallint    check (week_goal between 1 and 7),
  center_cd   text,                                   -- 체력인증센터 코드
  notify_time text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, persona_id)
);

-- RLS: 본인 행만
alter table public.checkins      enable row level security;
alter table public.memos         enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "own checkins" on public.checkins;
create policy "own checkins" on public.checkins for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own memos" on public.memos;
create policy "own memos" on public.memos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.checkins, public.memos, public.user_settings to authenticated;

-- =================================================================
-- [참고] 공단 API 연동 시 KSPO 영역 설계 (현재는 api/kspo/*.json 정적 파일로 대체)
--   kspo_members        (member_id PK, login_id, name, sex, age, age_group, center_cd, measure_date, grade, target_grade, weakness)
--   kspo_body_measures  (member_id FK, height, weight, bmi, body_fat, waist, sbp, dbp, grip_l, grip_r)
--   kspo_fitness_items  (member_id FK, key, item, unit, current, peer, target, percentile, grade, peer_improvement, n_pair)
--   kspo_centers        (center_cd PK, name, sido, sigungu, addr, addr2, tel, homepage)
--   kspo_videos         (exercise_name PK, youtube_id)
-- =================================================================
