import { useState } from "react";
import { api, jsonBody, setToken } from "../api.js";
import ConsentForm from "../components/ConsentForm.jsx";

export default function LoginPage({ onLogin }) {
  const [id, setId] = useState("");
  const [pendingConsent, setPendingConsent] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: jsonBody({ id }),
      });
      if (result.requiresConsent) {
        setPendingConsent({ participantId: result.participantId, consentInfo: result.consentInfo });
        return;
      }
      setToken(result.token);
      onLogin(result.user);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  if (pendingConsent) {
    return (
      <ConsentForm
        {...pendingConsent}
        onComplete={onLogin}
        onBack={() => { setPendingConsent(null); setError(""); }}
      />
    );
  }

  return (
    <div className="login-screen">
      <header className="login-header"><div className="wordmark">ProxyLab</div></header>
      <main className="login-main">
        <form className="login-panel" onSubmit={submit}>
          <h1>进入实验系统</h1>
          <p className="login-intro">输入研究团队分配给你的登录编号。参与者首次使用时需要完成知情同意。</p>
          <label className="field">
            <span className="field-label">登录编号</span>
            <input
              className="input input-large"
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="例如 P1A"
              autoFocus
              autoComplete="username"
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-large" disabled={loading || !id.trim()}>
            {loading ? "正在登录…" : "登录"}
          </button>
          <div className="login-notes">
            <strong>登录说明</strong>
            <ul>
              <li>编号不区分大小写，无需密码。</li>
              <li>参与者首次登录需要阅读并提交知情同意。</li>
            </ul>
          </div>
          <p className="privacy-note">你的配置与实验记录仅用于本次研究，请避免填写不必要的敏感信息。</p>
        </form>
      </main>
    </div>
  );
}
