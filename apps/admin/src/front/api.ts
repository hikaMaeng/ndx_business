import { texts } from "./i18n";
import { resolveLanguage } from "./i18n";
import { RSC } from "./resource";

export type RequestApi = (
  path: string,
  options?: RequestInit,
  token?: string,
) => Promise<unknown>;

export async function api(path: string, options: RequestInit = {}, token?: string): Promise<unknown> {
  const deviceKey = localStorage.getItem("admin.device") ?? (() => {
    const value = crypto.randomUUID();
    localStorage.setItem("admin.device", value);
    return value;
  })();
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "content-type": "application/json",
      "X-Session-Device": deviceKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : texts(resolveLanguage())[RSC.AUTH_ERROR_ALERT];
    throw new Error(message);
  }
  return payload;
}
