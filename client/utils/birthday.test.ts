import { ageFromBirthday, daysInMonth, normalizeBirthday } from "./birthday";

test("calculates completed years around the birthday using the local calendar", () => {
  const birthday = { year: 2000, month: 9, day: 7 };
  expect(ageFromBirthday(birthday, new Date(2026, 8, 6))).toBe(25);
  expect(ageFromBirthday(birthday, new Date(2026, 8, 7))).toBe(26);
  expect(ageFromBirthday(birthday, new Date(2026, 8, 8))).toBe(26);
});

test("clamps the day when changing from a longer month or a leap year", () => {
  expect(daysInMonth(2000, 2)).toBe(29);
  expect(daysInMonth(2100, 2)).toBe(28);
  expect(normalizeBirthday({ year: 2001, month: 2, day: 29 })).toEqual({ year: 2001, month: 2, day: 28 });
  expect(normalizeBirthday({ year: 2000, month: 4, day: 31 })).toEqual({ year: 2000, month: 4, day: 30 });
});
