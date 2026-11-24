import { isOriginAllowed, parseAllowedOrigins } from './video-call-origin';

describe('parseAllowedOrigins', () => {
  it.each<[string, string | undefined, string[]]>([
    ['không khai → mặc định như main.ts', undefined, ['http://localhost:3002']],
    ['1 origin', 'https://lancare.vn', ['https://lancare.vn']],
    [
      'nhiều origin, bỏ khoảng trắng',
      ' https://lancare.vn , http://localhost:3002 ',
      ['https://lancare.vn', 'http://localhost:3002'],
    ],
    ['bỏ phần tử rỗng', 'https://lancare.vn,,', ['https://lancare.vn']],
    ['chuỗi rỗng → không origin nào', '', []],
  ])('%s', (_name, env, expected) => {
    expect(parseAllowedOrigins(env)).toEqual(expected);
  });
});

describe('isOriginAllowed', () => {
  const ALLOWED = ['https://lancare.vn', 'http://localhost:3002'];

  it.each<[string, string | undefined, boolean]>([
    ['không có Origin (app mobile, client Node) → cho qua', undefined, true],
    ['Origin rỗng → coi như không có', '', true],
    ['Origin trong danh sách', 'https://lancare.vn', true],
    ['Origin lạ → từ chối', 'https://evil.example', false],
    ['khác cổng → từ chối', 'http://localhost:3000', false],
    ['khác giao thức → từ chối', 'http://lancare.vn', false],
  ])('%s', (_name, origin, expected) => {
    expect(isOriginAllowed(origin, ALLOWED)).toBe(expected);
  });
});
