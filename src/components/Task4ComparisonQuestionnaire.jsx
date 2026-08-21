import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";

const COMPARISON_CHOICES = [
  { value: "dual_proxy", label: "双代理", detail: "双方各自拥有代理并进行交互" },
  { value: "single_assistant", label: "单 AI 助手", detail: "读取 profile 后进行总结/协调" },
  { value: "depends", label: "取决于任务或情境" },
  { value: "uncertain", label: "不确定" },
];

const COMPARISON_QUESTIONS = [
  { key: "stanceVisibility", label: "哪种方式更能让你的立场被看见？" },
  { key: "boundaryProtection", label: "哪种方式更能维护你的重要边界？" },
  { key: "disagreementVisibility", label: "哪种方式更能明显保留双方尚未解决的分歧？" },
  { key: "systemTrust", label: "哪种方式更让你信任系统？" },
  { key: "resultTraceability", label: "哪种方式更容易理解和追溯结果如何形成？" },
  { key: "reentryConfidence", label: "哪种方式让你更有信心返回现实沟通？" },
];

const EMPTY_RESPONSES = {
  mostVisibleDifference: "",
  stanceVisibility: "",
  stanceVisibilityReason: "",
  boundaryProtection: "",
  boundaryProtectionReason: "",
  disagreementVisibility: "",
  disagreementVisibilityReason: "",
  systemTrust: "",
  systemTrustReason: "",
  resultTraceability: "",
  resultTraceabilityReason: "",
  reentryConfidence: "",
  reentryConfidenceReason: "",
  overallPreference: "",
  preferenceReason: "",
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function ChoiceQuestion({ question, value, reason, onChange }) {
  const needsReason = value === "dual_proxy" || value === "single_assistant";
  return (
    <fieldset className="task4-choice-question">
      <legend>{question.label}</legend>
      <div className="task4-choice-grid">
        {COMPARISON_CHOICES.map((choice) => (
          <label className={value === choice.value ? "selected" : ""} key={choice.value}>
            <input
              type="radio"
              name={question.key}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => onChange(question.key, choice.value)}
            />
            <span><strong>{choice.label}</strong>{choice.detail ? <small>{choice.detail}</small> : null}</span>
          </label>
        ))}
      </div>
      {needsReason ? (
        <label className="task4-choice-reason">
          <span>为什么选择“{value === "dual_proxy" ? "双代理" : "单 AI 助手"}”？</span>
          <textarea value={reason} onChange={(event) => onChange(`${question.key}Reason`, event.target.value)} placeholder="请简单说明理由（必填）" />
        </label>
      ) : null}
    </fieldset>
  );
}

export default function Task4ComparisonQuestionnaire({ session, participantId, onSaved, notify }) {
  const saved = session.task4Questionnaires?.[participantId];
  const [responses, setResponses] = useState(() => ({ ...EMPTY_RESPONSES, ...(saved?.responses || {}) }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setResponses({ ...EMPTY_RESPONSES, ...(saved?.responses || {}) });
  }, [session.id, participantId, saved?.updatedAt]);

  const complete = useMemo(() => (
    responses.mostVisibleDifference.trim()
    && COMPARISON_QUESTIONS.every(({ key }) => (
      responses[key]
      && (!["dual_proxy", "single_assistant"].includes(responses[key]) || responses[`${key}Reason`].trim())
    ))
    && responses.overallPreference
    && responses.preferenceReason.trim()
  ), [responses]);

  function update(key, value) {
    setResponses((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!complete) {
      notify("请完成全部问题后提交", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await api(`/api/sessions/${session.id}/task4-questionnaire`, {
        method: "POST",
        body: jsonBody({ responses }),
      });
      onSaved(result.questionnaire);
      notify(saved ? "Task 4 对比问卷已更新" : "Task 4 对比问卷已提交");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="task4-questionnaire">
      <div className="panel-heading">
        <div>
          <h2>Task 4 · 方式对比问卷</h2>
          <p>请比较前三个任务中的双代理互动，与本次单 AI 助手直接对齐。你的回答不会向另一位参与者展示。</p>
        </div>
        {saved ? <span className="questionnaire-status">已提交</span> : <span className="questionnaire-status pending">待填写</span>}
      </div>
      <form className="task4-questionnaire-form" onSubmit={submit}>
        <label className="task4-text-question">
          <span>两种方式最明显的不同是什么？</span>
          <textarea value={responses.mostVisibleDifference} onChange={(event) => update("mostVisibleDifference", event.target.value)} placeholder="请结合刚才看到的结果，描述你最直观感受到的差别。" />
        </label>
        <div className="task4-comparison-questions">
          {COMPARISON_QUESTIONS.map((question) => <ChoiceQuestion question={question} value={responses[question.key]} reason={responses[`${question.key}Reason`]} onChange={update} key={question.key} />)}
        </div>
        <fieldset className="task4-preference-question">
          <legend>总体而言，我更喜欢：</legend>
          <div className="task4-preference-options">
            <label className={responses.overallPreference === "dual_proxy" ? "selected" : ""}>
              <input type="radio" name="overallPreference" checked={responses.overallPreference === "dual_proxy"} onChange={() => update("overallPreference", "dual_proxy")} />
              <span><strong>双代理</strong><small>之前的三个任务</small></span>
            </label>
            <label className={responses.overallPreference === "single_assistant" ? "selected" : ""}>
              <input type="radio" name="overallPreference" checked={responses.overallPreference === "single_assistant"} onChange={() => update("overallPreference", "single_assistant")} />
              <span><strong>单 AI 助手</strong><small>这次总结/协调</small></span>
            </label>
          </div>
        </fieldset>
        <label className="task4-text-question">
          <span>因为：</span>
          <textarea className="long-response" value={responses.preferenceReason} onChange={(event) => update("preferenceReason", event.target.value)} placeholder="请说明形成这一偏好的原因，也可以写下它取决于哪些条件。" />
        </label>
        <div className="task4-questionnaire-actions">
          <button type="submit" className="button button-primary" disabled={!complete || saving}>{saving ? "提交中…" : saved ? "更新问卷" : "提交问卷"}</button>
          {saved ? <small>上次更新：{formatDate(saved.updatedAt)}</small> : <small>需要完成全部问题后才能提交。</small>}
        </div>
      </form>
    </section>
  );
}
