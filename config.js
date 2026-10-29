// 서버 연결 정보. 공개 키(publishable)는 원래 공개용이라 코드에 둬도 된다.
// 실제 자물쇠는 Supabase 쪽 RLS(로그인한 사용자만 읽고 쓰기)다.
const CONFIG = {
  SUPABASE_URL: 'https://qfkyzaakesqmcokrafcv.supabase.co',
  SUPABASE_KEY: 'sb_publishable_GtL9vX3hUkOzQJTYrhVi_g_KNuXaqka',
  // 로그인 계정. 화면에는 안 보이고 비밀번호만 친다. 실제 이메일이 아니라 앱 전용 주소.
  LOGIN_EMAIL: 'owner@haironenest.local',
};
if (typeof module !== 'undefined') module.exports = CONFIG;
