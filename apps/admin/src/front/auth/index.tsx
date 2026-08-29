import { useState } from "react";
import { KeyRound } from "lucide-react";
import { parseLoginResponse, parseSignupResponse } from "admin_domain/common";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { direction, resolveLanguage, texts } from "../i18n";
import { api } from "../api";
import { RSC } from "../resource";

export function Login({ onLogin, onSignup }: { onLogin: (token: string) => void; onSignup: (message: string) => void }) {
  const text = texts(resolveLanguage());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = parseLoginResponse(await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
      if (!result) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
      onLogin(result.sessionToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    }
  }

  async function signupAccount() {
    try {
      const result = parseSignupResponse(await api("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }));
      if (!result) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
      onSignup(result.status === "active" ? text[RSC.AUTH_SIGNUP_ACTIVE_STATUS] : text[RSC.AUTH_SIGNUP_PENDING_STATUS]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    }
  }

  return <main className="auth-layout" aria-labelledby="page-title">
    <Card className="auth-card">
      <CardHeader>
        <div className="eyebrow"><KeyRound aria-hidden="true" />{text[RSC.AUTH_BADGE_TEXT]}</div>
        <CardTitle id="page-title">{text[RSC.AUTH_TITLE_TEXT]}</CardTitle>
        <p>{text[RSC.AUTH_SUBTITLE_TEXT]}</p>
      </CardHeader>
      <CardContent>
        <form className="form-stack" onSubmit={submit}>
          <label>{text[RSC.AUTH_EMAIL_LABEL]}<input required data-testid="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>{text[RSC.AUTH_PASSWORD_LABEL]}<input required data-testid="auth-password" minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p role="alert" className="error-text">{error}</p>}
          <Button type="submit">{text[RSC.AUTH_LOGIN_BUTTON]}</Button>
          <Button type="button" data-testid="auth-signup" variant="outline" onClick={signupAccount}>{text[RSC.AUTH_SIGNUP_BUTTON]}</Button>
        </form>
      </CardContent>
    </Card>
  </main>;
}
