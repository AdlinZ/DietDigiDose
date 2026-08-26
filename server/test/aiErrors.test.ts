import assert from "node:assert/strict";
import test from "node:test";

import { classifyAIError, sanitizeAIErrorMessage } from "../src/services/aiErrors.js";

test("AI failures are classified into stable diagnostic categories", () => {
  assert.deepEqual(
    { code: classifyAIError(new Error("AI Agent 尚未配置聊天模型 API Key")).code,
      type: classifyAIError(new Error("AI Agent 尚未配置聊天模型 API Key")).type },
    { code: "AI_NOT_CONFIGURED", type: "configuration" },
  );
  assert.equal(classifyAIError(new Error("provider request timed out")).code, "AI_TIMEOUT");
  assert.equal(classifyAIError(new Error("429 rate limit exceeded")).code, "AI_RATE_LIMITED");
  assert.equal(classifyAIError(new Error("fetch failed: ECONNRESET")).code, "AI_NETWORK_ERROR");
});

test("AI diagnostic messages redact credentials before persistence or admin display", () => {
  const message = sanitizeAIErrorMessage(
    "request failed Authorization='Bearer secret-token-value' api_key=sk-supersecret123456789 token=my-token",
  );
  assert.doesNotMatch(message, /secret-token-value|supersecret|my-token/);
  assert.match(message, /REDACTED/);
});
