import { useState } from "react";
import { api, jsonBody, setToken } from "../api.js";

export default function LoginPage({ onLogin }) {
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api("/api/login", { method: "POST", body: jsonBody({ id }) });
      setToken(result.token);
      onLogin(result.user);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <header className="login-header"><div className="wordmark">ProxyLab</div></header>
      <main className="login-main">
        <form className="login-panel" onSubmit={submit}>
          <h1>进入实验系统</h1>
          <p className="login-intro">输入研究团队分配给你的受试者编号。</p>
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
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-large" disabled={loading || !id.trim()}>
            {loading ? "正在登录…" : "登录"}
          </button>
          <div className="login-notes">
            <strong>登录说明</strong>
            <ul>
              <li>编号不区分大小写，无需密码。</li>
              <li>管理员可输入 admin 进入管理界面。</li>
            </ul>
          </div>
          <p className="privacy-note">你的配置与实验记录仅用于本次研究，请避免填写不必要的敏感信息。</p>
        </form>
      </main>
    </div>
  );
}
