export type Birthday = { year: number; month: number; day: number };

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function normalizeBirthday(value: Birthday): Birthday {
  return { ...value, day: Math.min(value.day, daysInMonth(value.year, value.month)) };
}

export function ageFromBirthday(value: Birthday, today = new Date()) {
  const birthdayAhead = today.getMonth() + 1 < value.month
    || (today.getMonth() + 1 === value.month && today.getDate() < value.day);
  return today.getFullYear() - value.year - (birthdayAhead ? 1 : 0);
}
