import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import CodingAnnotation, { codingLabel, INTERACTION_CODE_GROUPS, PROFILE_CODE_GROUPS } from "../components/CodingAnnotation.jsx";
import { Icon } from "../components/Icons.jsx";
import { legacyRecapToStructured } from "../utils/recapMarkdown.jsx";

const TASK_LABELS = { task1: "Task 1 · 社交计划", task2: "Task 2 · 新关系介绍", task3: "Task 3 · 资源分配", task4: "Task 4 · 单 AI 对齐" };
const RESPONSE_LABELS = {
  mostVisibleDifference: "两种方式最明显的不同",
  stanceVisibility: "哪种方式更能让立场被看见",
  stanceVisibilityReason: "立场可见性原因",
  boundaryProtection: "哪种方式更能维护重要边界",
  boundaryProtectionReason: "边界维护原因",
  disagreementVisibility: "哪种方式更能保留未解决分歧",
  disagreementVisibilityReason: "分歧保留原因",
  systemTrust: "哪种方式更让用户信任系统",
  systemTrustReason: "系统信任原因",
  resultTraceability: "哪种方式更容易理解和追溯结果",
  resultTraceabilityReason: "结果追溯原因",
  reentryConfidence: "哪种方式更有助于返回现实沟通",
  reentryConfidenceReason: "返回现实沟通原因",
  overallPreference: "总体偏好",
  preferenceReason: "总体偏好原因",
};
const CHOICE_LABELS = { dual_proxy: "双代理", single_assistant: "单 AI 助手", depends: "取决于任务或情境", uncertain: "不确定" };
const ALL_CODE_GROUPS = [...PROFILE_CODE_GROUPS, ...INTERACTION_CODE_GROUPS];

const formatDate = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

function annotationTarget(annotations, targetId) {
  return annotations.filter((annotation) => annotation.targetId === targetId);
}

function recapSectionText(section) {
  if (!section.items?.length) return "无额外事项";
  return section.items.map((item) => [
    item.label ? `${item.label}：${item.value}` : item.value,
    item.evidence ? `来源：${item.evidence}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
}

function CodingText({ workspace, targetType, targetId, scheme, text, participantAnnotations = [], onAnnotationSaved, onAnnotationDeleted, notify }) {
  return (
    <CodingAnnotation
      scheme={scheme}
      targetType={targetType}
      targetId={targetId}
      text={text}
      participantAnnotations={participantAnnotations}
      codingAnnotations={annotationTarget(workspace.codingAnnotations, targetId)}
      onSaved={onAnnotationSaved}
      onDeleted={onAnnotationDeleted}
      notify={notify}
    />
  );
}

function IndividualCoding({ workspace, participantId, onParticipantChange, onAnnotationSaved, onAnnotationDeleted, notify }) {
  const participant = workspace.participants.find((item) => item.participantId === participantId) || workspace.participants[0];
  if (!participant) return <div className="empty-state">目前没有 Profile 修改或 Task 4 问卷数据。</div>;
  return (
    <div className="coding-workspace-layout">
      <aside className="coding-index">
        <h2>Participants</h2>
        {workspace.participants.map((item) => <button type="button" className={item.participantId === participant.participantId ? "selected" : ""} onClick={() => onParticipantChange(item.participantId)} key={item.participantId}><strong>{item.participantId}</strong><span>{item.profileChanges.length} changes · {item.task4Responses.length} Task 4</span></button>)}
      </aside>
      <div className="coding-content">
        <header className="coding-page-header"><div><span>INDIVIDUAL CODING</span><h1>{participant.participantId}</h1></div><p>仅呈现 Profile 前后变化与 Task 4 回答；选中文字即可编码。</p></header>
        <section className="coding-section">
          <div className="coding-section-heading"><div><span>01</span><h2>Profile changes</h2></div><small>只保留前后变化，不展示完整 Profile</small></div>
          <div className="profile-change-list">
            {participant.profileChanges.map((change) => {
              const text = `${change.label}\n修改前：${change.before}\n修改后：${change.after}`;
              return (
                <article className="coding-data-card" key={change.id}>
                  <div className="coding-card-meta"><strong>{TASK_LABELS[change.task] || change.task}</strong><span>{change.recordName} · {formatDate(change.createdAt)}</span></div>
                  <CodingText workspace={workspace} scheme="profile" targetType="profile_change" targetId={`profile:${participant.participantId}:${change.id}`} text={text} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} />
                </article>
              );
            })}
            {!participant.profileChanges.length ? <div className="empty-state compact">没有可编码的 Profile 变化。</div> : null}
          </div>
        </section>
        <section className="coding-section">
          <div className="coding-section-heading"><div><span>02</span><h2>Task 4 responses</h2></div><small>Task 4 单 AI／双代理比较问卷</small></div>
          {participant.task4Responses.map((record) => (
            <article className="task4-response-block" key={record.sessionId}>
              <div className="coding-card-meta"><strong>{record.recordName}</strong><span>更新于 {formatDate(record.updatedAt)}</span></div>
              <div className="task4-response-grid">
                {Object.entries(record.responses).map(([key, value]) => (
                  <div className="coding-data-card" key={key}>
                    <h3>{RESPONSE_LABELS[key] || key}</h3>
                    <CodingText workspace={workspace} scheme="interaction" targetType="task4_response" targetId={`task4:${record.sessionId}:${participant.participantId}:${key}`} text={CHOICE_LABELS[value] || String(value || "未填写")} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} />
                  </div>
                ))}
              </div>
            </article>
          ))}
          {!participant.task4Responses.length ? <div className="empty-state compact">尚未提交 Task 4 问卷。</div> : null}
        </section>
      </div>
    </div>
  );
}

function RecapCodingColumn({ workspace, session, participantId, onAnnotationSaved, onAnnotationDeleted, notify }) {
  const recap = session.recaps?.[participantId];
  if (!recap) return <section className="coding-trace-column"><h2>{participantId} Recap</h2><div className="empty-state compact">Recap 缺失。</div></section>;
  const report = recap.structured || legacyRecapToStructured(recap.content, session.task);
  return (
    <section className="coding-trace-column">
      <div className="trace-column-heading"><span>{participantId}</span><h2>Recap</h2></div>
      <div className="trace-summary"><strong>{report.headline}</strong><p>{report.summary}</p></div>
      {report.sections.map((section) => {
        const targetId = `recap:${session.id}:${participantId}:${section.id}`;
        const participantAnnotations = session.participantAnnotations.filter((annotation) => annotation.targetType === "recap" && annotation.targetId === participantId && annotation.sectionId === section.id);
        return <article className="trace-section" key={section.id}><h3>{section.title}</h3><CodingText workspace={workspace} scheme="interaction" targetType="recap" targetId={targetId} text={recapSectionText(section)} participantAnnotations={participantAnnotations} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} /></article>;
      })}
    </section>
  );
}

function TranscriptCodingColumn({ workspace, session, onAnnotationSaved, onAnnotationDeleted, notify }) {
  return (
    <section className="coding-trace-column transcript-column">
      <div className="trace-column-heading"><span>TRACE</span><h2>Transcript</h2></div>
      {session.transcript.map((message) => {
        const targetId = `message:${session.id}:${message.messageId}`;
        const participantAnnotations = session.participantAnnotations.filter((annotation) => annotation.targetType === "message" && annotation.targetId === message.messageId);
        return <article className="coding-message" key={message.messageId}><div><strong>{message.participantId}</strong><span>{message.messageId}</span></div><CodingText workspace={workspace} scheme="interaction" targetType="transcript" targetId={targetId} text={message.text} participantAnnotations={participantAnnotations} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} /></article>;
      })}
    </section>
  );
}

function PairCoding({ workspace, pairKey, sessionId, onPairChange, onSessionChange, onInterviewSaved, onAnnotationSaved, onAnnotationDeleted, notify }) {
  const pair = workspace.pairs.find((item) => item.pairKey === pairKey) || workspace.pairs[0];
  const session = pair?.sessions.find((item) => item.id === sessionId) || pair?.sessions[0];
  const [interviewText, setInterviewText] = useState(pair?.interview?.text || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setInterviewText(pair?.interview?.text || ""), [pair?.pairKey, pair?.interview?.updatedAt]);
  if (!pair || !session) return <div className="empty-state">目前没有包含 Transcript 的双代理会话。</div>;

  async function saveInterview() {
    setSaving(true);
    try {
      const result = await api(`/api/coding/interviews/${encodeURIComponent(pair.pairKey)}`, { method: "PUT", body: jsonBody({ text: interviewText }) });
      onInterviewSaved(pair.pairKey, result.interview);
      notify("采访材料已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pair-coding-page">
      <header className="coding-page-header pair-heading">
        <div><span>PAIR TRACE CODING</span><h1>{pair.participantA} × {pair.participantB}</h1></div>
        <div className="pair-coding-controls">
          <select value={pair.pairKey} onChange={(event) => onPairChange(event.target.value)}>{workspace.pairs.map((item) => <option value={item.pairKey} key={item.pairKey}>{item.participantA} × {item.participantB}</option>)}</select>
          <select value={session.id} onChange={(event) => onSessionChange(event.target.value)}>{pair.sessions.map((item) => <option value={item.id} key={item.id}>{TASK_LABELS[item.task] || item.task} · {formatDate(item.createdAt)}</option>)}</select>
        </div>
      </header>
      <section className="interview-panel">
        <div><span>INTERVIEW MATERIAL</span><h2>采访信息</h2><p>粘贴或录入该 pair 的访谈记录；保存后，下方文本同样支持选择编码。</p></div>
        <textarea value={interviewText} onChange={(event) => setInterviewText(event.target.value)} placeholder="在这里粘贴完整采访记录、现场笔记或整理后的访谈文本……" />
        <button type="button" className="button button-primary" onClick={saveInterview} disabled={saving}>{saving ? "保存中…" : "保存采访材料"}</button>
        {pair.interview?.text ? <div className="interview-coding-preview"><h3>已保存文本 · 可直接编码</h3><CodingText workspace={workspace} scheme="interaction" targetType="interview" targetId={`interview:${pair.pairKey}`} text={pair.interview.text} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} /></div> : null}
      </section>
      <div className="coding-trace-grid">
        <RecapCodingColumn workspace={workspace} session={session} participantId={session.participantA} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} />
        <RecapCodingColumn workspace={workspace} session={session} participantId={session.participantB} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} />
        <TranscriptCodingColumn workspace={workspace} session={session} onAnnotationSaved={onAnnotationSaved} onAnnotationDeleted={onAnnotationDeleted} notify={notify} />
      </div>
    </div>
  );
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function originalExport(workspace, category) {
  if (category === "profile-changes") {
    return workspace.participants.flatMap((participant) => participant.profileChanges.map((change) => ({
      participantId: participant.participantId,
      recordName: change.recordName,
      task: change.task,
      createdAt: change.createdAt,
      field: change.label,
      path: change.path,
      before: change.before,
      after: change.after,
    })));
  }
  if (category === "participant-marks") {
    return (workspace.participantMarks || []).map((annotation) => ({
      pair: [annotation.participantA, annotation.participantB].sort().join("--"),
      sessionId: annotation.sessionId,
      recordName: annotation.recordName,
      task: annotation.task,
      author: annotation.author,
      targetType: annotation.targetType,
      targetId: annotation.targetId,
      sectionId: annotation.sectionId || "",
      quote: annotation.quote,
      tags: annotation.tags || [],
      reason: annotation.note || "",
      createdAt: annotation.createdAt || null,
    }));
  }
  if (category === "task4-responses") {
    return workspace.participants.flatMap((participant) => participant.task4Responses.map((response) => ({
      participantId: participant.participantId,
      sessionId: response.sessionId,
      recordName: response.recordName,
      submittedAt: response.submittedAt,
      updatedAt: response.updatedAt,
      responses: response.responses,
    })));
  }
  return workspace.pairs.flatMap((pair) => pair.sessions.map((session) => ({
    pair: pair.pairKey,
    sessionId: session.id,
    recordName: session.recordName,
    task: session.task,
    createdAt: session.createdAt,
    transcript: session.transcript.map((message) => ({
      messageId: message.messageId,
      participantId: message.participantId,
      round: message.round ?? null,
      text: message.text,
      createdAt: message.createdAt || null,
    })),
  })));
}

function CodingSummary({ workspace, onOpenContext }) {
  const [selectedCode, setSelectedCode] = useState("ALL");
  const annotations = selectedCode === "ALL"
    ? workspace.codingAnnotations
    : workspace.codingAnnotations.filter((annotation) => annotation.codes.includes(selectedCode));
  const exportItems = [
    ["profile-changes", "Profile 修改"],
    ["participant-marks", "参与者标记"],
    ["task4-responses", "Task 4 回复"],
    ["transcripts", "Transcript"],
  ];

  function download(category) {
    const date = new Date().toISOString().slice(0, 10);
    downloadJson("proxylab-" + category + "-original-" + date + ".json", {
      exportedAt: new Date().toISOString(),
      category,
      note: "仅包含原始研究内容，不包含研究者定性编码。",
      records: originalExport(workspace, category),
    });
  }

  return (
    <div className="coding-summary-page">
      <header className="coding-page-header">
        <div><span>CODE OVERVIEW</span><h1>编码汇总与原文导出</h1></div>
        <p>按标签查看全部研究编码；导出文件只保留原始材料，不携带研究者 coding 结果。</p>
      </header>
      <section className="coding-export-panel">
        <div><h2>原文分类导出</h2><p>四类材料分别导出为 JSON，便于后续归档或转换。</p></div>
        <div className="coding-export-actions">
          {exportItems.map(([category, label]) => <button type="button" className="button button-secondary" onClick={() => download(category)} key={category}><Icon name="download" size={15} />{label}</button>)}
        </div>
      </section>
      <section className="coding-summary-panel">
        <div className="coding-section-heading"><div><span>01</span><h2>按 Code 查看</h2></div><small>{workspace.codingAnnotations.length} 条研究编码</small></div>
        <div className="coding-filter-chips">
          <button type="button" className={selectedCode === "ALL" ? "selected" : ""} onClick={() => setSelectedCode("ALL")}>全部 <span>{workspace.codingAnnotations.length}</span></button>
          {ALL_CODE_GROUPS.flatMap((group) => group.codes.map(([code]) => {
            const count = workspace.codingAnnotations.filter((annotation) => annotation.codes.includes(code)).length;
            return <button type="button" className={selectedCode === code ? "selected" : ""} onClick={() => setSelectedCode(code)} key={code}>{code} <span>{count}</span></button>;
          }))}
        </div>
        <div className="coding-summary-list">
          {annotations.map((annotation) => (
            <article key={annotation.id}>
              <div className="coding-summary-meta"><strong>{annotation.targetType}</strong><span>{annotation.targetId}</span><time>{formatDate(annotation.createdAt)}</time></div>
              <blockquote>“{annotation.quote}”</blockquote>
              <div className="coding-summary-codes">{annotation.codes.map((code) => <span title={codingLabel(code)} key={code}>{code}</span>)}</div>
              {annotation.note ? <p>{annotation.note}</p> : null}
              <button type="button" className="coding-context-link" onClick={() => onOpenContext(annotation)}>查看语境 →</button>
            </article>
          ))}
          {!annotations.length ? <div className="empty-state compact">这个标签下还没有编码内容。</div> : null}
        </div>
      </section>
    </div>
  );
}

export default function CodingPage({ notify }) {
  const [workspace, setWorkspace] = useState({ participants: [], pairs: [], participantMarks: [], codingAnnotations: [] });
  const [mode, setMode] = useState("individual");
  const [participantId, setParticipantId] = useState("");
  const [pairKey, setPairKey] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [pendingTarget, setPendingTarget] = useState("");

  useEffect(() => {
    api("/api/coding/workspace").then(({ workspace: data }) => {
      setWorkspace(data);
      setParticipantId((current) => current || data.participants[0]?.participantId || "");
      setPairKey((current) => current || data.pairs[0]?.pairKey || "");
      setSessionId((current) => current || data.pairs[0]?.sessions[0]?.id || "");
    }).catch((error) => notify(error.message, "error"));
  }, []);

  const selectedPair = useMemo(() => workspace.pairs.find((pair) => pair.pairKey === pairKey) || workspace.pairs[0], [pairKey, workspace.pairs]);

  useEffect(() => {
    if (!pendingTarget) return undefined;
    const timer = window.setTimeout(() => {
      const element = [...document.querySelectorAll("[data-coding-target]")]
        .find((node) => node.dataset.codingTarget === pendingTarget);
      if (!element) {
        notify("原始语境目前不可用，相关记录可能已被删除", "error");
        setPendingTarget("");
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("coding-context-focus");
      window.setTimeout(() => element.classList.remove("coding-context-focus"), 2600);
      setPendingTarget("");
    }, 80);
    return () => window.clearTimeout(timer);
  }, [mode, pairKey, participantId, pendingTarget, sessionId]);

  function changePair(nextPairKey) {
    const nextPair = workspace.pairs.find((pair) => pair.pairKey === nextPairKey);
    setPairKey(nextPairKey);
    setSessionId(nextPair?.sessions[0]?.id || "");
  }

  function addAnnotation(annotation) {
    setWorkspace((current) => ({ ...current, codingAnnotations: [...current.codingAnnotations, annotation] }));
  }

  function deleteAnnotation(annotationId) {
    setWorkspace((current) => ({ ...current, codingAnnotations: current.codingAnnotations.filter((annotation) => annotation.id !== annotationId) }));
  }

  function saveInterview(savedPairKey, interview) {
    setWorkspace((current) => ({ ...current, pairs: current.pairs.map((pair) => pair.pairKey === savedPairKey ? { ...pair, interview } : pair) }));
  }

  function openContext(annotation) {
    const parts = annotation.targetId.split(":");
    if (annotation.targetType === "profile_change" && parts[0] === "profile") {
      setParticipantId(parts[1]);
      setMode("individual");
      setPendingTarget(annotation.targetId);
      return;
    }
    if (annotation.targetType === "task4_response" && parts[0] === "task4") {
      setParticipantId(parts[2]);
      setMode("individual");
      setPendingTarget(annotation.targetId);
      return;
    }
    if (annotation.targetType === "interview" && parts[0] === "interview") {
      const targetPair = workspace.pairs.find((pair) => pair.pairKey === parts.slice(1).join(":"));
      if (targetPair) {
        setPairKey(targetPair.pairKey);
        setSessionId(targetPair.sessions[0]?.id || "");
        setMode("pair");
        setPendingTarget(annotation.targetId);
        return;
      }
    }
    const targetSessionId = parts[1];
    const targetPair = workspace.pairs.find((pair) => pair.sessions.some((session) => session.id === targetSessionId));
    if (targetPair) {
      setPairKey(targetPair.pairKey);
      setSessionId(targetSessionId);
      setMode("pair");
      setPendingTarget(annotation.targetId);
      return;
    }
    notify("找不到这条编码对应的原始语境", "error");
  }

  return (
    <div className="coding-page">
      <div className="coding-mode-tabs">
        <button type="button" className={mode === "individual" ? "active" : ""} onClick={() => setMode("individual")}><strong>单人 Coding</strong><span>Profile changes + Task 4 responses</span></button>
        <button type="button" className={mode === "pair" ? "active" : ""} onClick={() => setMode("pair")}><strong>双人对照 Coding</strong><span>2 Recaps + Transcript + Interview</span></button>
        <button type="button" className={mode === "summary" ? "active" : ""} onClick={() => setMode("summary")}><strong>编码汇总</strong><span>Filter by code + Original exports</span></button>
      </div>
      {mode === "individual" ? (
        <IndividualCoding workspace={workspace} participantId={participantId} onParticipantChange={setParticipantId} onAnnotationSaved={addAnnotation} onAnnotationDeleted={deleteAnnotation} notify={notify} />
      ) : mode === "pair" ? (
        <PairCoding workspace={workspace} pairKey={selectedPair?.pairKey || ""} sessionId={sessionId} onPairChange={changePair} onSessionChange={setSessionId} onInterviewSaved={saveInterview} onAnnotationSaved={addAnnotation} onAnnotationDeleted={deleteAnnotation} notify={notify} />
      ) : <CodingSummary workspace={workspace} onOpenContext={openContext} />}
    </div>
  );
}
