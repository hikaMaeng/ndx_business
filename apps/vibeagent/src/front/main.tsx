import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { VibeClient } from "vibeagent_domain/front";
import { Auth, type SignedIn } from "./auth/index.js";
import { Sidebar } from "./sidebar/index.js";
import { Conversation } from "./conversation/index.js";
import "./styles.css";

/**
 * The root: layout, bootstrapping, and which surface is showing.
 *
 * It owns no feature state. There is no `handleX` here for a child to call, no
 * socket listener, no form state — those live with the feature that displays
 * them. What the root does own is the one fact the whole app is a projection
 * of: whether anyone is signed in.
 *
 * The client is created once, outside the tree, and outlives every component.
 * Its socket and its models are not React's to own; unmounting a view only
 * unsubscribes.
 */
const TOKEN_KEY = "vibe.session.token";
const token = (): string => sessionStorage.getItem(TOKEN_KEY) ?? "";
const client = new VibeClient({ token });

function App(): React.JSX.Element {
  const [who, setWho] = useState<SignedIn | null>(null);
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState("");

  // A stored token is a claim, not proof. Ask the account service before
  // showing a surface that assumes an identity.
  useEffect(() => {
    if (!token()) { setChecked(true); return; }
    void fetch("/api/auth/me", { headers: { authorization: `Bearer ${token()}` } })
      .then(async (response) => {
        if (!response.ok) {
          sessionStorage.removeItem(TOKEN_KEY);
          setNotice("세션이 만료되었습니다. 다시 로그인하세요.");
          return;
        }
        const user = await response.json() as { id: string; email: string };
        setWho({ userId: user.id, email: user.email, token: token() });
      })
      .catch(() => { setNotice("계정 서비스에 연결하지 못했습니다."); })
      .finally(() => setChecked(true));
  }, []);

  // Signing in is what makes the session surface meaningful, so the work that
  // populates it belongs to that transition rather than to any component.
  useEffect(() => {
    if (!who) return;
    client.setIdentity(who.userId, who.email);
    void Promise.all([client.refreshProjects(), client.refreshSessions()]).then(() => {
      // Land on the most recent conversation, the way a chat client would. With
      // no sessions yet there is nothing to open — the person picks a project.
      const recent = client.sessions.value[0];
      if (recent) void client.openExisting(recent.sessionId);
    });
  }, [who]);

  if (!checked) return <main className="auth-shell" />;

  if (!who) {
    return <Auth initialNotice={notice} onSignedIn={(signed) => {
      sessionStorage.setItem(TOKEN_KEY, signed.token);
      setWho(signed);
    }} />;
  }

  return (
    <div className="vibe-shell">
      <Sidebar client={client} onLogout={() => {
        sessionStorage.removeItem(TOKEN_KEY);
        client.close();
        setWho(null);
      }} />
      <Conversation client={client} />
    </div>
  );
}

createRoot(document.querySelector("#app")!).render(<StrictMode><App /></StrictMode>);
