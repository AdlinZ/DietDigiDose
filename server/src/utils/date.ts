const APP_TIME_ZONE = process.env.APP_TIME_ZONE?.trim() || "Asia/Shanghai";
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const currentDateKey = (date = new Date()) => dateFormatter.format(date);

export const currentTimeKey = (date = new Date()) => timeFormatter.format(date);

export const dateKeyAfterDays = (days: number, date = new Date()) =>
  currentDateKey(new Date(date.getTime() + days * 86_400_000));
