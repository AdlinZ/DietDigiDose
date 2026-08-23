jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

import { formatCookingReminderTime, getCookingReminderPresets } from "./cookingReminders";

describe("cooking reminders", () => {
  const now = new Date(2026, 7, 23, 17, 45, 0);

  it("builds future reminder presets around the current time", () => {
    const presets = getCookingReminderPresets(now);
    expect(presets).toHaveLength(4);
    expect(presets.every((preset) => preset.date.getTime() > now.getTime())).toBe(true);
    expect(presets.find((preset) => preset.key === "dinner")?.detail).toBe("今天 18:00");
  });

  it("formats today, tomorrow and later dates", () => {
    expect(formatCookingReminderTime(new Date(2026, 7, 23, 20, 5), now)).toBe("今天 20:05");
    expect(formatCookingReminderTime(new Date(2026, 7, 24, 10, 0), now)).toBe("明天 10:00");
    expect(formatCookingReminderTime(new Date(2026, 7, 27, 9, 30), now)).toBe("8月27日 09:30");
  });
});
