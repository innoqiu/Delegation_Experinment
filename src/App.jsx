import { useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import AppShell from "./components/AppShell.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import AgentConfigPage from "./pages/AgentConfigPage.jsx";
import ModelConfigPage from "./pages/ModelConfigPage.jsx";
import InteractionPage from "./pages/InteractionPage.jsx";
import RecapPage from "./pages/RecapPage.jsx";
import HistoryPage from "./pages/HistoryPage.jsx";

const PARTICIPANT_PAGES = ["profiles", "recaps"];
const ADMIN_PAGES = ["profiles", "models", "interaction", "recaps", "history"];

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [page, setPage] = useState("profiles");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!getToken()) return;
    api("/api/me")
      .then(({ user: current }) => setUser(current))
      .catch(() => setToken(""))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);

  const allowedPages = useMemo(
    () => (user?.role === "admin" ? ADMIN_PAGES : PARTICIPANT_PAGES),
    [user],
  );

  useEffect(() => {
    if (user && !allowedPages.includes(page)) setPage("profiles");
  }, [allowedPages, page, user]);

  async function logout() {
    try { await api("/api/logout", { method: "POST" }); } catch { /* no-op */ }
    setToken("");
    setUser(null);
    setPage("profiles");
  }

  function notify(message, tone = "success") {
    setToast({ message, tone });
  }

  if (checking) {
    return <div className="screen-center"><div className="loader" />正在恢复登录…</div>;
  }

  if (!user) {
    return <LoginPage onLogin={(nextUser) => { setUser(nextUser); setPage("profiles"); }} />;
  }

  const pageProps = { user, notify };
  const content = {
    profiles: <AgentConfigPage {...pageProps} />,
    models: <ModelConfigPage {...pageProps} />,
    interaction: <InteractionPage {...pageProps} />,
    recaps: <RecapPage {...pageProps} />,
    history: <HistoryPage {...pageProps} />,
  }[page];

  return (
    <>
      <AppShell user={user} page={page} onPageChange={setPage} onLogout={logout}>
        {content}
      </AppShell>
      {toast && <div className={`toast toast-${toast.tone}`}>{toast.message}</div>}
    </>
  );
}
