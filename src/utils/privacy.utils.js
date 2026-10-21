/**
 * Privacy Utils - Claude API로 보내기 전 개인정보 마스킹
 *
 * 이벤트 설명·메타데이터에 전화번호나 주소 같은 개인정보가 섞여 들어가도 외부(Claude API)로 나가지 않게
 * 정해진 형식의 값을 [전화번호] 같은 표시로 바꾼다. 이름은 패턴으로 구분할 수 없어 다루지 않는다(한계).
 */

// 앞뒤가 숫자·영문·하이픈이면 다른 값(UUID, 날짜, 타임스탬프)의 일부이므로 건드리지 않는다
const B = String.raw`(?<![\w-])`;
const A = String.raw`(?![\w-])`;
const rx = (source) => new RegExp(source, 'g');

const RULES = [
  // 주민등록번호 900101-1234567
  [rx(String.raw`${B}\d{6}-[1-4]\d{6}${A}`), '[주민번호]'],
  // 카드번호 1234-5678-9012-3456 (구분자는 공백/하이픈/없음)
  [rx(String.raw`${B}(?:\d{4}[- ]?){3}\d{4}${A}`), '[카드번호]'],
  // 이메일
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]'],
  // 한국 전화번호: 휴대폰 010-1234-5678, 지역번호 02-123-4567 / 031-123-4567
  [rx(String.raw`${B}(?:01[016-9]|0[2-6][1-5]?)[-. ]?\d{3,4}[-. ]?\d{4}${A}`), '[전화번호]'],
  // 도로명 주소 "테헤란로 152", "세종대로 23-1", "가온길 7"
  [/[가-힣]{1,10}(?:대로|로|길)\s?\d{1,4}(?:-\d{1,4})?(?![\d명개분시초회건])/g, '[주소]']
];

const maskPersonalInfo = (text) => {
  if (typeof text !== 'string' || text.length === 0) return text;
  return RULES.reduce((acc, [pattern, label]) => acc.replace(pattern, label), text);
};

/**
 * 문자열 값만 마스킹한 복사본 (객체 키·숫자·불리언은 그대로). 배열·중첩 객체도 처리한다.
 */
const maskDeep = (value) => {
  if (typeof value === 'string') return maskPersonalInfo(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
};

module.exports = { maskPersonalInfo, maskDeep };
