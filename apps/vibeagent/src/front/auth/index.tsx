import { useRef, useState } from "react";

/**
 * The account service answers in English, and deliberately does not say which
 * half was wrong — that ambiguity is an anti-enumeration measure, so the
 * translation keeps it.
 */
function authErrorText(raw: string): string {
  if (/invalid credentials|not active/i.test(raw)) return "이메일 또는 비밀번호가 맞지 않거나, 아직 활성화되지 않은 계정입니다.";
  if (/already|exists|registered/i.test(raw)) return "이미 등록된 이메일입니다. 로그인하세요.";
  return raw || "요청이 실패했습니다.";
}

export interface SignedIn { userId: string; email: string; token: string }

/**
 * Sign in, or make an account.
 *
 * Everything here is local: the typed email, the notice, which button was
 * pressed. None of it outlives the form or is read anywhere else, so none of it
 * belongs in a model. The one thing that does — who is signed in — leaves
 * through `onSignedIn` and is owned by the root.
 */
export function Auth({ onSignedIn, initialNotice = "" }: { onSignedIn: (who: SignedIn) => void; initialNotice?: string }): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const password = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const mode = String((event.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement
      ? ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement).value
      : "login");
    const typed = String(data.get("email") ?? "");
    const secret = String(data.get("password") ?? "");

    setNotice("");
    try {
      const response = await fetch(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: typed, password: secret }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setNotice(authErrorText(String(body.error ?? "")));
        // Retyping the email after a typo in the password is pure friction, so
        // the field keeps what was typed and the cursor goes where the mistake is.
        setEmail(typed);
        password.current?.focus();
        return;
      }
      if (mode === "signup") {
        setNotice(body.status === "active" ? "계정이 만들어졌습니다. 로그인하세요." : "계정이 만들어졌고 관리자 승인을 기다립니다.");
        setEmail(typed);
        return;
      }
      onSignedIn({ userId: String(body.user?.id ?? ""), email: String(body.user?.email ?? typed), token: String(body.sessionToken ?? "") });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "요청이 실패했습니다.");
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card panel">
        <h1>Vibe coding</h1>
        <p className="auth-copy">계정으로 로그인하세요. 신규 계정은 관리자의 가입 정책에 따라 즉시 활성화되거나 승인을 기다립니다.</p>
        {notice ? <p className="notice" role="status" data-testid="auth-notice">{notice}</p> : null}
        <form className="auth-form" onSubmit={(event) => { void submit(event); }}>
          <label>이메일
            <input name="email" type="email" autoComplete="username" required aria-label="Email"
              value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>비밀번호
            <input ref={password} name="password" type="password" autoComplete="current-password" required aria-label="Password" />
          </label>
          <div className="auth-actions">
            <button className="primary-button" type="submit" name="mode" value="login" data-testid="login-submit">로그인</button>
            <button className="secondary-button" type="submit" name="mode" value="signup" data-testid="signup-submit">계정 만들기</button>
          </div>
        </form>
      </section>
    </main>
  );
}
