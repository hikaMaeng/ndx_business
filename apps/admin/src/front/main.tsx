import React, { useCallback, useState } from "react";
import ReactDOM from "react-dom/client";
import { AdminShell } from "./shell";
import { Login } from "./auth";
import { direction, resolveLanguage } from "./i18n";
// The scale both apps share, ahead of anything that maps or uses it.
import "admin_domain/front/theme.css";
import "./styles.css";

const language = resolveLanguage();
document.documentElement.lang = language;
document.documentElement.dir = direction(language);

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("admin.session") ?? "");
  // Stable across renders on purpose. As an inline arrow this was a new
  // function every time, and the shell lists it as an effect dependency — so
  // the effect re-ran on every render of this component, for ever.
  const logout = useCallback(() => { sessionStorage.removeItem("admin.session"); setToken(""); }, []);
  if (!token) return <Login onLogin={(value) => { sessionStorage.setItem("admin.session", value); setToken(value); }} onSignup={(message) => window.alert(message)} />;
  return <AdminShell token={token} onLogout={logout} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode><App /></React.StrictMode>);
