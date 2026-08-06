import { useState } from "react";
import { api, jsonBody, setToken } from "../api.js";
import ConsentForm from "../components/ConsentForm.jsx";

export default function LoginPage({ onLogin }) {
  const adminMode = window.location.pathname.replace(/\/+$/, "") === "/admin";
  const [id, setId] = useState("");
  const [adminCode, setAdminCode] = useState("");
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
        body: jsonBody(adminMode ? { id: "admin", adminCode } : { id }),
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
          <h1>{adminMode ? "管理员登录" : "进入实验系统"}</h1>
          <p className="login-intro">{adminMode ? "输入部署环境中配置的管理员访问码。" : "输入研究团队分配给你的受试者编号。首次使用时需要完成知情同意。"}</p>
          {adminMode ? (
            <label className="field">
              <span className="field-label">管理员访问码</span>
              <input className="input input-large" type="password" value={adminCode} onChange={(event) => setAdminCode(event.target.value)} autoFocus autoComplete="current-password" />
            </label>
          ) : (
            <label className="field">
              <span className="field-label">受试者编号</span>
              <input
                className="input input-large"
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="例如 P1A"
                autoFocus
                autoComplete="username"
              />
            </label>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-large" disabled={loading || (adminMode ? !adminCode : !id.trim())}>
            {loading ? "正在登录…" : "登录"}
          </button>
          {!adminMode ? <div className="login-notes">
            <strong>登录说明</strong>
            <ul>
              <li>编号不区分大小写，无需密码。</li>
              <li>首次登录需要阅读并提交知情同意。</li>
            </ul>
          </div> : null}
          <p className="privacy-note">{adminMode ? "管理员访问码不会保存在浏览器或实验数据中。" : "你的配置与实验记录仅用于本次研究，请避免填写不必要的敏感信息。"}</p>
        </form>
      </main>
    </div>
  );
}
