const { maskPersonalInfo, maskDeep } = require('../src/utils/privacy.utils');

describe('maskPersonalInfo', () => {
  it.each([
    ['엄마 번호 010-1234-5678 입니다', '엄마 번호 [전화번호] 입니다'],
    ['01012345678로 연락', '[전화번호]로 연락'],
    ['집 02-123-4567', '집 [전화번호]'],
    ['031-123-4567', '[전화번호]'],
    ['메일 test.user@example.com 로', '메일 [이메일] 로'],
    ['주민 900101-1234567', '주민 [주민번호]'],
    ['카드 1234-5678-9012-3456', '카드 [카드번호]'],
    ['서울 테헤란로 152 앞', '서울 [주소] 앞'],
    ['세종대로 23-1', '[주소]']
  ])('%s', (input, expected) => {
    expect(maskPersonalInfo(input)).toBe(expected);
  });

  it.each([
    '택배 기사 방문 (신뢰도 0.49)',
    '2026-09-25T07:00:47Z 낙상 감지',
    '이벤트 id 3f2b8c1e-0123-4567-89ab-cdef01234567',
    '타임스탬프 1727600340000',
    '3명이 방문, 5분 뒤 퇴장',
    '긴 길 3명'
  ])('개인정보가 아니면 그대로: %s', (input) => {
    expect(maskPersonalInfo(input)).toBe(input);
  });
});

describe('maskDeep', () => {
  it('중첩 객체·배열의 문자열만 마스킹, 키와 숫자는 유지', () => {
    const out = maskDeep({ id: 'ev-1', n: 3, description: '010-1234-5678 방문', metadata: { notes: ['a@b.co'] } });
    expect(out).toEqual({ id: 'ev-1', n: 3, description: '[전화번호] 방문', metadata: { notes: ['[이메일]'] } });
  });
});
