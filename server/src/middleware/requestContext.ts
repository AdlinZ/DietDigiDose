import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incomingId = req.get("x-request-id")?.trim();
  const requestId = incomingId && incomingId.length <= 128 ? incomingId : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
