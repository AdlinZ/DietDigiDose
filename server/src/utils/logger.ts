import type { Request, Response } from "express";

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(entry);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};

export function reportError(error: unknown, req: Request, res: Response) {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    requestId: String(res.locals.requestId || ""),
    method: req.method,
    path: req.originalUrl,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  };
  logger.error("api.unhandled_error", payload);

  const webhookUrl = process.env.ERROR_MONITOR_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    void fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "api.unhandled_error", timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(3000),
    }).catch((monitorError) => logger.warn("error_monitor.delivery_failed", {
      requestId: payload.requestId,
      message: monitorError instanceof Error ? monitorError.message : String(monitorError),
    }));
  }
}
