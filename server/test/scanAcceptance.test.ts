import { inventoryPhotoKey } from "../src/modules/inventory/scanIdentity.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyScanAcceptance } from "../src/modules/inventory/scanAcceptance.js";

test("mixed scan acceptance requires traceable complete unambiguous fields, not just confidence", () => {
  const base = { foodName: "鸡蛋", quantity: "6个", suggestedStorageLocation: "冷藏", confidence: 0.99 };
  const result = classifyScanAcceptance("job", [base,
    { ...base, foodName: "米", quantity: "一袋" },
    { ...base, foodName: "苹果", suggestedStorageLocation: "" },
    { ...base, foodName: "牛奶或豆奶" },
    { ...base, foodName: "已有番茄" }], ["已有番茄"]);
  assert.deepEqual(result.map(item => item.acceptance), ["automatic", "review", "review", "review", "review"]);
  assert.equal(result[0].sourceItemId, "job:0");
  assert.equal(result[0].estimatedExpireDays, null);
  assert.equal(result[0].fieldEvidence.expiration_date.status, "unknown");
  assert.equal(result[0].fieldEvidence.quantity.status, "estimated");
  assert.equal(classifyScanAcceptance("", [base], [])[0].acceptance, "review");
  assert(classifyScanAcceptance("job", [base, base], []).every(item => item.acceptance === "review"));
});

test("identical photo bytes share identity independent of base64 framing", () => {
  assert.equal(inventoryPhotoKey("aGVsbG8="), inventoryPhotoKey("data:image/jpeg;base64,aGVs bG8="));
  assert.notEqual(inventoryPhotoKey("aGVsbG8="), inventoryPhotoKey("d29ybGQ="));
});
