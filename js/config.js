/* 핏가이드 설정
   Supabase 프로젝트의 Project URL 과 anon(public) key 를 넣으면 기록이 DB에 저장됩니다.
   비워두면 이 브라우저에만 저장됩니다(localStorage).
   anon key 는 공개용 키라서 웹페이지에 넣어도 됩니다. 데이터는 DB의 RLS 정책으로 본인 기록만 읽고 쓸 수 있습니다.
   (service_role key 는 절대 넣지 마세요.) */
window.FITGUIDE_CONFIG = {
  supabaseUrl: 'https://ihyjlbvlwzwerifkkwsy.supabase.co',
  supabaseAnonKey: 'sb_publishable_pKnY15U8tY3XkOYOj4VUjA_dAiSYn1R'
};
