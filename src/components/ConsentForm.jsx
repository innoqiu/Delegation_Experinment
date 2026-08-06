import { useMemo, useState } from "react";
import { api, jsonBody, setToken } from "../api.js";

const CONSENT_ITEMS = [
  { key: "adult", text: "我已年满18周岁。" },
  { key: "information", text: "我已阅读并理解本研究的目的、流程以及可能出现的风险或不适。" },
  { key: "dataUse", text: "我理解研究会记录我的配置、代理对话、Recap判断、文字标记及后续讨论或访谈记录，用于研究分析。" },
  { key: "voluntary", text: "我理解参与完全自愿，可以拒绝回答问题或随时退出，不会因此受到惩罚。" },
  { key: "participate", text: "我同意参加本研究。" },
];

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${year}年${month}月${day}日`;
}

export default function ConsentForm({ participantId, consentInfo, onComplete, onBack }) {
  const [responses, setResponses] = useState(Object.fromEntries(CONSENT_ITEMS.map(({ key }) => [key, false])));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const allChecked = useMemo(() => CONSENT_ITEMS.every(({ key }) => responses[key]), [responses]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api("/api/consent", {
        method: "POST",
        body: jsonBody({ id: participantId, responses }),
      });
      setToken(result.token);
      onComplete(result.user);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="consent-screen">
      <header className="login-header"><div className="wordmark">ProxyLab</div><span>{participantId}</span></header>
      <main className="consent-main">
        <form className="consent-panel" onSubmit={submit}>
          <div className="consent-heading">
            <span className="eyebrow">参与前确认</span>
            <h1>{consentInfo.title}</h1>
            <p>{consentInfo.studyTitle}</p>
          </div>

          <section className="consent-summary">
            <h2>研究概要</h2>
            <p>本研究考察AI代理如何代表用户参与多人协作与沟通。你将配置自己的代理、查看代理互动与Recap，并可能参加后续讨论或访谈。</p>
            <p>代理可能产生不准确、意外或令人不适的表达。请不要填写与研究无关的敏感信息；你可以跳过问题或随时停止参与。</p>
          </section>

          <section className="consent-ethics">
            <dl>
              <div><dt>负责单位</dt><dd>{consentInfo.institution} · {consentInfo.responsibleResearcher}</dd></div>
              <div><dt>伦理编号</dt><dd>{consentInfo.ethicsNumber}</dd></div>
              <div><dt>有效期</dt><dd>{formatDate(consentInfo.validFrom)}—{formatDate(consentInfo.validUntil)}</dd></div>
              <div><dt>主要研究者</dt><dd>{consentInfo.principalInvestigator.name} · <a href={`mailto:${consentInfo.principalInvestigator.email}`}>{consentInfo.principalInvestigator.email}</a></dd></div>
              <div><dt>研究人员</dt><dd>{consentInfo.researchers.join("、")}</dd></div>
            </dl>
          </section>

          <fieldset className="consent-questions">
            <legend>请逐项确认</legend>
            {CONSENT_ITEMS.map((item) => (
              <label className="consent-check" key={item.key}>
                <input
                  type="checkbox"
                  checked={responses[item.key]}
                  onChange={(event) => setResponses((current) => ({ ...current, [item.key]: event.target.checked }))}
                />
                <span>{item.text}</span>
              </label>
            ))}
          </fieldset>

          {error ? <div className="form-error">{error}</div> : null}
          <div className="consent-actions">
            <button type="button" className="button button-ghost" onClick={onBack} disabled={loading}>返回修改编号</button>
            <button type="submit" className="button button-primary" disabled={!allChecked || loading}>{loading ? "正在记录…" : "同意并进入研究"}</button>
          </div>
          <p className="consent-record-note">提交后，系统将以受试者编号记录你的同意时间和同意书版本。</p>
        </form>
      </main>
    </div>
  );
}
