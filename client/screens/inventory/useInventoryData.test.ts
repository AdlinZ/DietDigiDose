jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

import { buildRecipePageQuery } from "./useInventoryData";

describe("recipe catalog pagination query", () => {
  it("keeps server count and pages on the same filter scope", () => {
    const query = buildRecipePageQuery({
      category: "减脂",
      search: "鸡胸肉",
      maxCookTime: 15,
    }, "opaque cursor");
    const params = new URLSearchParams(query.slice(1));

    expect(params.get("pageSize")).toBe("24");
    expect(params.get("category")).toBe("减脂");
    expect(params.get("search")).toBe("鸡胸肉");
    expect(params.get("maxCookTime")).toBe("15");
    expect(params.get("cursor")).toBe("opaque cursor");
  });

  it("omits inactive filters rather than changing the server total scope", () => {
    expect(buildRecipePageQuery({})).toBe("?pageSize=24");
  });
});
