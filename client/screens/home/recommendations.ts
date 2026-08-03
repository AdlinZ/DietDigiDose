export const getRecommendationPeriod = (hour: number) => {
  if (hour >= 11 && hour < 14) return "午间";
  if (hour >= 14 && hour < 18) return "下午茶";
  if (hour >= 18 && hour < 22) return "晚间";
  if (hour >= 22 || hour < 5) return "深夜";
  return "晨间";
};
