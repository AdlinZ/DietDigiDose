import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneBindingSendSchema, phoneBindingVerifySchema, reauthSendSchema } from "../src/account.ts";
test("first binding accepts only a mainland target and current password, with isolated verification shape", () => {
  assert.equal(phoneBindingSendSchema.parse({phone:"+8613800223001",currentPassword:"old-password"}).phone,"13800223001");
  for (const phone of ["+14155550123","123","8613800223001"]) assert.equal(phoneBindingSendSchema.safeParse({phone,currentPassword:"old"}).success,false);
  for (const input of [{phone:"13800223001"},{phone:"13800223001",currentPassword:"old",userId:2}]) assert.equal(phoneBindingSendSchema.safeParse(input).success,false);
  assert.equal(reauthSendSchema.safeParse({purpose:"phone_bind"}).success,false);
  assert.equal(phoneBindingVerifySchema.safeParse({challengeId:"not-a-uuid",code:"123456"}).success,false);
  assert.equal(phoneBindingVerifySchema.safeParse({challengeId:"00000000-0000-4000-8000-000000000001",code:"123456",phone:"13800223001"}).success,false);
});
