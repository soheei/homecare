/**
 * Date Utility Functions
 * 날짜/시간 관련 유틸리티
 */

/**
 * 한국 시간대로 변환
 */
const toKoreanTime = (date = new Date()) => {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
};

const KST = 'Asia/Seoul';

/**
 * 한국 날짜 문자열 (YYYY-MM-DD) — 서버 시간대(Render=UTC)와 무관하게 KST 기준
 */
const kstDateString = (date = new Date()) => {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: KST });
};

/**
 * 한국 날짜(YYYY-MM-DD) 하루의 시작/끝 (DB timestamptz 비교용)
 */
const kstDayRange = (dateString) => ({
  start: `${dateString}T00:00:00.000+09:00`,
  end: `${dateString}T23:59:59.999+09:00`
});

/**
 * 한국 시간 표시 문자열: "9월 25일 (목) 오후 4:00"
 * (도구 결과에 UTC ISO만 주면 모델이 UTC 시각을 그대로 읽어 9시간 틀리게 답함)
 */
const formatKst = (date) => {
  const d = new Date(date);
  const md = d.toLocaleDateString('ko-KR', { timeZone: KST, month: 'long', day: 'numeric', weekday: 'short' });
  const time = d.toLocaleTimeString('ko-KR', { timeZone: KST, hour: 'numeric', minute: '2-digit' });
  return `${md.replace(/\s*\((.)\)|\s(.)$/, ' ($1$2)')} ${time}`;
};

/**
 * 오늘 날짜 문자열 (YYYY-MM-DD, 한국 기준)
 */
const getTodayString = () => kstDateString();

/**
 * 시간을 한국어로 포맷팅
 * @param {Date|string} date 
 * @returns {string} "오전 10시 30분" 형식
 */
const formatTimeKorean = (date) => {
  const d = new Date(date);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  
  const period = hours < 12 ? '오전' : '오후';
  const hour12 = hours % 12 || 12;
  
  if (minutes === 0) {
    return `${period} ${hour12}시`;
  }
  return `${period} ${hour12}시 ${minutes}분`;
};

/**
 * 날짜를 한국어로 포맷팅
 * @param {Date|string} date 
 * @returns {string} "3월 20일 수요일" 형식
 */
const formatDateKorean = (date) => {
  const d = new Date(date);
  const options = { month: 'long', day: 'numeric', weekday: 'long' };
  return d.toLocaleDateString('ko-KR', options);
};

/**
 * 상대적 시간 표현
 * @param {Date|string} date 
 * @returns {string} "방금 전", "5분 전", "어제" 등
 */
const getRelativeTime = (date) => {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay === 1) return '어제';
  if (diffDay < 7) return `${diffDay}일 전`;
  
  return formatDateKorean(date);
};

/**
 * 하루의 시작/끝 시간
 */
const getDayBounds = (date = new Date()) => {
  const d = new Date(date);
  const startOfDay = new Date(d.setHours(0, 0, 0, 0));
  const endOfDay = new Date(d.setHours(23, 59, 59, 999));
  
  return {
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString()
  };
};

/**
 * N일 전 날짜
 */
const getDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

module.exports = {
  toKoreanTime,
  kstDateString,
  kstDayRange,
  formatKst,
  getTodayString,
  formatTimeKorean,
  formatDateKorean,
  getRelativeTime,
  getDayBounds,
  getDaysAgo
};
