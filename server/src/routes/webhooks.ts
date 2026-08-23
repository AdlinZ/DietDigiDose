import crypto from "node:crypto";
import { Router } from "express";
import { db } from "../storage/db.js";
import { incrementDailyUsage, recordVerificationEvent } from "../services/authVerification.js";

const router = Router();

function validCallbackToken(received: string) {
  const expected = process.env.ALIYUN_SMS_CALLBACK_TOKEN?.trim() || "";
  if (!expected || received.length !== expected.length) return false;
  const receivedBytes = new TextEncoder().encode(received);
  const expectedBytes = new TextEncoder().encode(expected);
  return crypto.timingSafeEqual(new DataView(receivedBytes.buffer), new DataView(expectedBytes.buffer));
}

router.post("/aliyun/sms-delivery/:token", (req, res) => {
  if (!validCallbackToken(req.params.token)) return res.status(404).json({ code: 404, msg: "Not found" });
  if (!Array.isArray(req.body)) return res.status(400).json({ code: 400, msg: "Invalid payload" });

  try {
    db.transaction(() => {
      for (const report of req.body.slice(0, 1000)) {
        const bizId = typeof report?.biz_id === "string" ? report.biz_id.trim() : "";
        const outId = typeof report?.out_id === "string" ? report.out_id.trim() : "";
        const providerCode = typeof report?.err_code === "string" ? report.err_code.trim() : "";
        const providerMessage = typeof report?.err_msg === "string" ? report.err_msg : "";
        const success = report?.success === true;
        const units = Math.max(1, Math.min(100, Number.parseInt(String(report?.sms_size || "1"), 10) || 1));
        if (!bizId && !outId) continue;
        const challenge = db.prepare(`
          SELECT id, subject_id AS subjectId, biz_id AS bizId, out_id AS outId
          FROM auth_verification_challenges
          WHERE (? != '' AND biz_id = ?) OR (? != '' AND out_id = ?)
          ORDER BY created_at DESC LIMIT 1
        `).get(bizId, bizId, outId, outId) as { id: string; subjectId: number; bizId: string | null; outId: string } | undefined;
        if (!challenge) continue;
        const duplicate = db.prepare(`
          SELECT id FROM auth_verification_events
          WHERE challenge_id = ? AND event_type = 'delivery_report'
            AND outcome = ? AND COALESCE(provider_code, '') = ?
          LIMIT 1
        `).get(challenge.id, success ? "delivered" : "failed", providerCode);
        if (duplicate) continue;
        recordVerificationEvent({
          subjectId: challenge.subjectId,
          challengeId: challenge.id,
          eventType: "delivery_report",
          outcome: success ? "delivered" : "failed",
          providerCode,
          providerMessage,
          bizId: challenge.bizId || bizId || null,
          outId: challenge.outId || outId || null,
          details: {
            sendTime: typeof report?.send_time === "string" ? report.send_time : null,
            reportTime: typeof report?.report_time === "string" ? report.report_time : null,
            smsSize: units,
          },
        });
        incrementDailyUsage(success ? "delivered" : "delivery_failed");
        if (success) incrementDailyUsage("delivery_units", units);
      }
    })();
    return res.json({ code: 0, msg: "接收成功" });
  } catch (error) {
    console.error("[Aliyun SMS Callback Error]", error instanceof Error ? error.name : "UnknownError");
    return res.status(503).json({ code: 503, msg: "处理失败" });
  }
});

export default router;
