import express from "express";

export function body(request: express.Request): Record<string, unknown> {
  return request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
}

export function requireInput<T>(value: T | null): T {
  if (!value) throw new Error("Invalid request body");
  return value;
}
