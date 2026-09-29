/* =================================================================
   핏가이드 · 기록 저장 레이어
   -----------------------------------------------------------------
   · 저장 대상: 체크인(날짜별 1건) · 운동 메모 · 프로필별 설정(시작일, 주 목표, 센터, 알림 시간) · 다크 모드
   · 기본은 이 브라우저(localStorage)에 저장하고, js/config.js 에 Supabase 키가 있으면 DB에도 저장합니다.
     DB는 브라우저마다 익명 사용자로 로그인하므로, 같은 데모 계정을 여러 명이 써도 기록이 섞이지 않습니다.
   · 데모 계정(페르소나)마다 따로 저장합니다. 8주 시뮬레이션 화면은 저장 기록과 별개로 동작합니다.
   · 기존 레이어와 같은 방식(window.X 덮어쓰기)으로 연결합니다.
   ================================================================= */
(function(){
  const CFG = window.FITGUIDE_CONFIG || {};
  const LS_KEY = 'fg_store_v1';
  const DARK_KEY = 'fg_dark';
  const DOW = ['월','화','수','목','금','토','일'];
  const DOW_KEY = ['mon','tue','wed','thu','fri','sat','sun'];
  const CAT_KO = { stretch:'스트레칭', cardio:'유산소', strength:'근력' };
  const $ = id => document.getElementById(id);
  const setT = (id, t) => { const e = $(id); if (e) e.textContent = t; };

  /* ---------- 날짜 ---------- */
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = () => startOfDay(new Date());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const keyOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
  const todayIdx = () => (new Date().getDay() + 6) % 7;                 // 월=0 … 일=6
  const monday = () => addDays(today(), -todayIdx());
  const pid = () => personas[currentPersonaIdx].id;

  /* ---------- 브라우저 저장소 ---------- */
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ cache = {}; }
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch(e){} };
  const slot = id => (cache[id] = cache[id] || { settings:{}, checkins:{}, memos:[] });
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'm' + Date.now() + Math.random().toString(16).slice(2));

  /* ---------- Supabase (선택) ---------- */
  let sb = null, uid = null;
  const remoteReady = (async () => {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return false;
    if (!window.supabase || !window.supabase.createClient){ console.warn('[store] Supabase 라이브러리를 불러오지 못해 이 브라우저에만 저장합니다.'); return false; }
    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      let { data: { session } } = await sb.auth.getSession();
      if (!session){
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw error;
        session = data.session;
      }
      uid = session.user.id;
      return true;
    } catch(e){
      console.warn('[store] DB 연결 실패 — 이 브라우저에만 저장합니다.', e);
      sb = null; return false;
    }
  })();

  const toRow = {
    checkin: (p, date, c) => ({ user_id: uid, persona_id: p, ck_date: date, type: c.type, rpe: c.rpe || 0, cats: c.cats || [],
                               dur: c.dur || null, time_text: c.timeText || null, memo_text: c.memoText || null, updated_at: new Date().toISOString() }),
    memo:    (p, m) => ({ id: m.id, user_id: uid, persona_id: p, text: m.text, created_at: m.created_at }),
    settings:(p, s) => ({ user_id: uid, persona_id: p, start_date: s.start_date || null, week_goal: s.week_goal || null,
                          center_cd: s.center_cd || null, notify_time: s.notify_time || null, updated_at: new Date().toISOString() })
  };
  function remote(label, fn){
    remoteReady.then(ok => ok && fn()).then(res => { if (res && res.error) console.warn('[store] ' + label + ' 실패', res.error); })
                .catch(e => console.warn('[store] ' + label + ' 실패', e));
  }

  // DB 기록을 받아 로컬과 합친다(DB 우선). 로컬에만 있는 기록은 DB로 올린다.
  async function pull(p){
    if (!(await remoteReady)) return false;
    const [ck, mm, st] = await Promise.all([
      sb.from('checkins').select('*').eq('persona_id', p),
      sb.from('memos').select('*').eq('persona_id', p).order('created_at', { ascending: true }),
      sb.from('user_settings').select('*').eq('persona_id', p).maybeSingle()
    ]);
    if (ck.error || mm.error || st.error){ console.warn('[store] 불러오기 실패', ck.error || mm.error || st.error); return false; }
    const s = slot(p);
    const remoteCk = {}; ck.data.forEach(r => remoteCk[r.ck_date] = { type: r.type, rpe: r.rpe, cats: r.cats || [], dur: r.dur, timeText: r.time_text, memoText: r.memo_text });
    const upCk = Object.keys(s.checkins).filter(d => !remoteCk[d]).map(d => toRow.checkin(p, d, s.checkins[d]));
    const remoteIds = new Set(mm.data.map(r => r.id));
    const upMemo = s.memos.filter(m => !remoteIds.has(m.id)).map(m => toRow.memo(p, m));
    s.checkins = Object.assign({}, s.checkins, remoteCk);
    s.memos = mm.data.map(r => ({ id: r.id, text: r.text, created_at: r.created_at }))
              .concat(s.memos.filter(m => !remoteIds.has(m.id)))
              .sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    if (st.data){
      ['start_date','week_goal','center_cd','notify_time'].forEach(k => { if (st.data[k] != null) s.settings[k] = st.data[k]; });
    } else if (Object.keys(s.settings).length){
      remote('설정 올리기', () => sb.from('user_settings').upsert(toRow.settings(p, s.settings)));
    }
    if (upCk.length) remote('체크인 올리기', () => sb.from('checkins').upsert(upCk));
    if (upMemo.length) remote('메모 올리기', () => sb.from('memos').upsert(upMemo));
    persist();
    return true;
  }

  /* ---------- 저장 ---------- */
  function saveSettings(patch){
    const p = pid(), s = slot(p);
    Object.assign(s.settings, patch); persist();
    remote('설정 저장', () => sb.from('user_settings').upsert(toRow.settings(p, s.settings)));
  }
  function saveTodayCheckin(){
    const tk = keyOf(today());
    const c = checkinHistory.length ? checkinHistory[checkinHistory.length - 1] : null;
    if (!c) return;
    const p = pid(), rec = { type: c.type, rpe: c.type === '휴식' ? 0 : (c.rpe || 0), cats: c.cats || [], dur: c.dur || null, timeText: c.timeText || null, memoText: c.memoText || null };
    slot(p).checkins[tk] = rec; persist();
    remote('체크인 저장', () => sb.from('checkins').upsert(toRow.checkin(p, tk, rec)));
  }
  function saveMemoRecord(text){
    const p = pid(), m = { id: newId(), text, created_at: new Date().toISOString() };
    slot(p).memos.push(m); persist();
    remote('메모 저장', () => sb.from('memos').insert(toRow.memo(p, m)));
  }

  /* ---------- 화면에 복원 ---------- */
  const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const EMPTY_MEMO = '<div style="text-align:center; color:var(--ink-faint); padding:10px 0;">작성된 운동 메모가 없습니다.</div>';
  function memoHTML(m){
    const d = new Date(m.created_at), hm = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const when = keyOf(d) === keyOf(today()) ? `오늘 ${hm}` : `${d.getMonth()+1}월 ${d.getDate()}일 ${hm}`;
    return `<div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--line);">
      <div style="color:var(--ink-soft); font-size:11px; margin-bottom:2px;">${when}</div>
      <div style="font-weight:700;">"${esc(m.text)}"</div>
    </div>`;
  }
  // 방금 누른 체크인(앱 상태)을 먼저 보고, 없으면 저장된 기록에서 찾는다
  function checkinOn(date){
    const ds = date.toDateString();
    for (let i = checkinHistory.length - 1; i >= 0; i--) if (checkinHistory[i]._ckDate === ds) return checkinHistory[i];
    return slot(pid()).checkins[keyOf(date)] || null;
  }

  function paintWeek(){
    const t = todayIdx(), mon = monday();
    document.querySelectorAll('.week-strip .d').forEach((box, i) => {
      const pip = box.querySelector('.pip'); if (!pip) return;
      const c = checkinOn(addDays(mon, i));
      let cls = 'pip', mark = '';
      if (c){ if (c.type === '휴식'){ cls = 'pip rest'; mark = '😴'; } else { cls = 'pip on'; mark = '✓'; } }
      if (i === t) cls += ' today active-day';
      pip.style.background = ''; pip.style.color = '';
      pip.className = cls; pip.textContent = mark;
      const bar = $('rpe-bar-' + DOW_KEY[i]); if (bar) bar.style.height = (c && c.type !== '휴식' ? c.rpe * 8 : 0) + 'px';
      setT('rpe-lbl-' + DOW_KEY[i], `${DOW[i]}(${c ? (c.type === '휴식' ? 0 : c.rpe) : '-'})`);
    });
  }

  function apply(){
    const p = pid(), s = slot(p);

    // 프로그램 시작일(1차 측정일 기준) — 날짜 레이어가 읽는 키와 동기화
    const startKey = 'fg_start_' + p;
    try {
      if (s.settings.start_date) localStorage.setItem(startKey, s.settings.start_date);
      else { const v = localStorage.getItem(startKey) || keyOf(today()); localStorage.setItem(startKey, v); saveSettings({ start_date: v }); }
    } catch(e){}

    // 알림 시간 · 센터
    setT('ui-setting-time', s.settings.notify_time || DEFAULT_TIME);
    const rec = KSPO.fitnessRecords[currentPersonaIdx];
    if (s.settings.center_cd && rec.centerCd !== s.settings.center_cd) quietly(() => _saveNewCenter(s.settings.center_cd));

    if (is4WeekDone){ try { fgRefresh(); } catch(e){} return; }   // 시뮬레이션 화면은 시뮬 데이터 그대로

    // 주 목표
    if (s.settings.week_goal) weekGoal = s.settings.week_goal;

    // 체크인 기록 → 앱 상태
    const dates = Object.keys(s.checkins).sort();
    checkinHistory = dates.map(k => {
      const c = s.checkins[k], d = parseKey(k);
      return { type: c.type, rpe: c.rpe, day: DOW[(d.getDay() + 6) % 7], cats: c.cats || [], dur: c.dur,
               timeText: c.timeText, memoText: c.memoText, _ckDate: d.toDateString() };
    });
    rpeRecords = checkinHistory.map(c => c.rpe);
    const mon = keyOf(monday()), tk = keyOf(today());
    thisWeekDone = Math.min(weekGoal, dates.filter(k => k >= mon && k <= tk).length);

    // 이번 주 요일 칸 · 오늘 체크인 카드
    paintWeek();
    const tc = checkinOn(today()), tg = $('btn-toggle');
    if (tg) tg.className = tc ? (tc.type === '휴식' ? 'big-toggle rest' : 'big-toggle done') : 'big-toggle';
    setT('toggle-icon', tc ? (tc.type === '휴식' ? '😴' : '✓') : '🎯');

    // 메모
    const list = s.memos.slice().reverse();
    const pv = $('ui-memo-preview-list'), full = $('ui-full-memo-list');
    if (pv) pv.innerHTML = list.length ? list.slice(0, 3).map(memoHTML).join('') : EMPTY_MEMO;
    if (full) full.innerHTML = list.length ? list.map(memoHTML).join('') : EMPTY_MEMO;

    try { updateDynamicUI(); } catch(e){}
    try { recomputeStats(); } catch(e){}
    try { selectDayDetail(DOW[todayIdx()], $('today-pip') && $('today-pip').closest('.d')); } catch(e){}
    try { fgRefresh(); } catch(e){}
  }

  // 토스트 없이 실행 (복원 중에 '변경되었습니다' 알림이 뜨지 않게)
  function quietly(fn){ const t = window.showToast; window.showToast = function(){}; try { fn(); } finally { window.showToast = t; } }

  // 화면 복원 → DB에서 최신 기록을 받으면 한 번 더 복원
  function restore(){
    const p = pid();
    apply();
    pull(p).then(ok => { if (ok && pid() === p) apply(); }).catch(e => console.warn('[store] 불러오기 실패', e));
  }

  /* ---------- 기존 함수에 연결 ---------- */
  const DEFAULT_TIME = ($('ui-setting-time') && $('ui-setting-time').textContent) || '현재: 오후 7:00';
  const wrap = (name, after, before) => {
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function(){
      const ctx = before ? before.apply(this, arguments) : undefined;
      const r = orig.apply(this, arguments);
      try { after.call(this, ctx, arguments); } catch(e){ console.warn('[store] ' + name, e); }
      return r;
    };
  };
  const _saveNewCenter = window.saveNewCenter;

  wrap('selectPersonaAndLogin', restore);
  wrap('loadPersonaData', restore);
  wrap('finishCheckin', saveTodayCheckin);
  wrap('saveMemo', text => { if (text) saveMemoRecord(text); }, () => ($('memo-input') && $('memo-input').value.trim()) || '');
  wrap('saveNewGoal', () => saveSettings({ week_goal: weekGoal }));
  wrap('enterMain', () => saveSettings({ week_goal: weekGoal }));
  wrap('saveNewCenter', () => saveSettings({ center_cd: KSPO.fitnessRecords[currentPersonaIdx].centerCd }));
  wrap('saveNewTime', () => saveSettings({ notify_time: $('ui-setting-time').textContent }));
  wrap('toggleDarkMode', () => { try { localStorage.setItem(DARK_KEY, document.querySelector('.screen').classList.contains('dark') ? '1' : '0'); } catch(e){} });

  // 시뮬레이션: 켤 때는 오늘 체크인만 넘기고, 끌 때(원본이 전부 초기화함) 내 기록을 다시 복원
  wrap('toggle4WeekSimulation', turningOn => {
    if (!turningOn){ apply(); if (Object.keys(slot(pid()).checkins).length) showToast('🧪 시뮬레이션을 끄고 내 기록으로 돌아왔어요'); }
  }, () => {
    const turningOn = !is4WeekDone;
    if (turningOn){
      const tk = today().toDateString();
      checkinHistory = checkinHistory.filter(c => c._ckDate === tk);
      rpeRecords = checkinHistory.map(c => c.rpe);
    }
    return turningOn;
  });

  // 요일 상세: 시뮬레이션이 꺼져 있으면 저장된 날짜별 기록으로 표시
  const _sdd = window.selectDayDetail;
  window.selectDayDetail = function(day, el){
    const di = DOW.indexOf(day);
    if (is4WeekDone || di < 0) return _sdd.apply(this, arguments);
    document.querySelectorAll('.week-strip .pip').forEach(p => p.classList.remove('active-day'));
    if (el){ const pp = el.querySelector('.pip'); if (pp) pp.classList.add('active-day'); }
    const t = todayIdx(), c = checkinOn(addDays(monday(), di));
    setT('dd-title', `📌 ${day}요일 체크인 상세`);
    if (!c){
      setT('dd-routine', di === t ? '아직 체크인 전입니다. 홈 화면에서 체크인하세요!' : '-');
      setT('dd-rpe', '-'); setT('dd-time', '-'); setT('dd-memo', '-');
      setT('dd-status-tag', di === t ? '오늘' : (di > t ? '예정' : '기록 없음'));
      return;
    }
    let routine = c.type;
    if (c.type === 'KSPO 맞춤 처방 루틴') routine = `KSPO 맞춤 처방 (${routineOptions[selectedOptionIdx].items[0].name})`;
    else if (c.type === '개인 운동'){ const cats = (c.cats || []).map(x => CAT_KO[x] || x); routine = cats.length ? `개인 운동 (${cats.join(', ')})` : '개인 운동'; }
    setT('dd-routine', routine);
    setT('dd-rpe', c.type === '휴식' ? 'RPE 0' : `RPE ${c.rpe}`);
    setT('dd-time', c.timeText || (c.dur === 'under30' ? '30분 미만' : '30분 이상'));
    setT('dd-memo', c.memoText || '목표 운동 정상 완료!');
    setT('dd-status-tag', di === t ? '오늘' : '완료');
  };

  // 설정 탭: 내 기록 초기화
  window.fgResetMyRecords = function(){
    const p = pid(), name = personas[currentPersonaIdx].name;
    if (!confirm(`${name}님 프로필로 남긴 체크인·메모·설정을 모두 지울까요?`)) return;
    delete cache[p]; persist();
    try { localStorage.removeItem('fg_start_' + p); } catch(e){}
    remote('기록 삭제', () => Promise.all([
      sb.from('checkins').delete().eq('persona_id', p),
      sb.from('memos').delete().eq('persona_id', p),
      sb.from('user_settings').delete().eq('persona_id', p)
    ]).then(rs => rs.find(r => r.error)));
    loadPersonaData(currentPersonaIdx);
    showToast('내 기록을 초기화했어요');
  };
  (function addResetRow(){
    const dark = $('dark-toggle'), row = dark && dark.closest('.setting-row');
    if (!row || $('fg-reset-row')) return;
    const r = document.createElement('div');
    r.className = 'setting-row'; r.id = 'fg-reset-row'; r.style.cursor = 'pointer';
    r.setAttribute('onclick', 'fgResetMyRecords()');
    r.innerHTML = '<div><div class="st-name">내 기록 초기화</div><div class="st-val">이 프로필로 남긴 체크인·메모·설정을 지워요</div></div><span class="st-arrow">›</span>';
    row.parentNode.insertBefore(r, row.nextSibling);
  })();

  // 시작: 다크 모드 복원 + 현재 프로필 기록 복원
  try {
    if (localStorage.getItem(DARK_KEY) === '1' && !document.querySelector('.screen').classList.contains('dark')) quietly(() => toggleDarkMode());
  } catch(e){}
  restore();
  remoteReady.then(ok => console.info('[store] 저장 위치:', ok ? 'Supabase DB + 이 브라우저' : '이 브라우저(localStorage)'));
})();
