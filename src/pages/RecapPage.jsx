import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import SessionTranscript from "../components/SessionTranscript.jsx";
import TextAnnotation from "../components/TextAnnotation.jsx";
import { Icon } from "../components/Icons.jsx";
import { legacyRecapToStructured } from "../utils/recapMarkdown.jsx";

const DECISIONS = [
  { value: "approved", label: "批准", className: "button-success" },
  { value: "revision_requested", label: "要求修改", className: "button-warning" },
  { value: "rejected", label: "拒绝", className: "button-danger" },
  { value: "repair_required", label: "需要修复", className: "button-secondary" },
];

const DECISION_LABELS = Object.fromEntries([...DECISIONS.map((item) => [item.value, item.label]), ["partial", "部分已判断"]]);
const OUTCOME_LABELS = { ready_for_review: "待审核", partial: "部分结果", no_agreement: "未达成方案" };
const ITEM_STATUS_LABELS = {
  agreed: "已对齐",
  proposed: "候选",
  changed: "已调整",
  preference: "偏好",
  unresolved: "待确认",
  boundary: "边界",
  needs_decision: "需决定",
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function SectionDecision({ sessionId, section, recap, onSaved, notify }) {
  const saved = recap.sectionDecisions?.[section.id];
  const sectionTitle = section.title || section.heading;
  const [note, setNote] = useState(saved?.note || "");
  const [saving, setSaving] = useState("");

  async function decide(decision) {
    setSaving(decision);
    try {
      const result = await api(`/api/sessions/${sessionId}/section-decisions`, {
        method: "POST",
        body: jsonBody({ sectionId: section.id, heading: sectionTitle, decision, note }),
      });
      onSaved(result.recap);
      notify(`“${sectionTitle}”的决定已保存`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="section-decision">
      <div className="section-decision-head">
        <strong>对此部分作出判断</strong>
        {saved ? <span className={`decision-pill decision-${saved.value}`}>{DECISION_LABELS[saved.value]}</span> : <span>尚未判断</span>}
      </div>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明需要修改、拒绝或修复的内容（可选）" />
      <div className="section-decision-buttons">
        {DECISIONS.map((item) => (
          <button type="button" key={item.value} className={`button button-small ${item.className}`} disabled={Boolean(saving)} onClick={() => decide(item.value)}>
            {saving === item.value ? "保存中…" : item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReportSectionBody({ section }) {
  if (!section.items.length) return <p className="report-empty">无额外事项</p>;
  return (
    <div className="report-items">
      {section.items.map((item, index) => (
        <div className="report-item" key={`${item.label}-${item.value}-${index}`}>
          <div className="report-item-head">
            {item.label ? <strong>{item.label}</strong> : <span />}
            <span className={`report-status status-${item.status}`}>{ITEM_STATUS_LABELS[item.status] || "记录"}</span>
          </div>
          <p>{item.value}</p>
          {item.evidence ? <small>来源：{item.evidence}</small> : null}
        </div>
      ))}
    </div>
  );
}

function RecapRenderer({ session, participantId, recap, user, annotations, onAnnotationSaved, onRecapUpdated, onOpenTranscript, notify }) {
  const report = useMemo(() => recap.structured || legacyRecapToStructured(recap.content, session.task), [recap.content, recap.structured, session.task]);
  return (
    <div className="structured-recap">
      <div className="report-overview">
        <div className="report-overview-top">
          <span className={`outcome-status outcome-${report.outcomeStatus}`}>{OUTCOME_LABELS[report.outcomeStatus] || "待审核"}</span>
          {report.legacy ? <small>旧记录 · 已压缩显示</small> : null}
        </div>
        <h2>{report.headline}</h2>
        {report.summary ? <p>{report.summary}</p> : null}
      </div>
      <div className="recap-sections">
      {report.sections.map((section, sectionIndex) => {
        const sectionAnnotations = annotations.filter((annotation) => (
          annotation.targetType === "recap"
          && annotation.targetId === participantId
          && annotation.sectionId === section.id
        ));
        return (
          <article className="recap-section-card" key={`${session.id}-${section.id}`}>
            <div className="recap-section-heading"><span>{sectionIndex + 1}</span><h3>{section.title}</h3><small>{section.items.length}项</small></div>
            <TextAnnotation
              sessionId={session.id}
              targetType="recap"
              targetId={participantId}
              sectionId={section.id}
              allowedTags={["important", "unexpected", "uncomfortable", "details_requested"]}
              annotations={sectionAnnotations}
              onSaved={onAnnotationSaved}
              onOpenDetails={onOpenTranscript}
              notify={notify}
            >
              <ReportSectionBody section={section} />
            </TextAnnotation>
            {user.role === "participant" ? (
              <SectionDecision sessionId={session.id} section={section} recap={recap} onSaved={onRecapUpdated} notify={notify} />
            ) : recap.sectionDecisions?.[section.id] ? (
              <div className="admin-section-decision"><strong>{DECISION_LABELS[recap.sectionDecisions[section.id].value]}</strong>{recap.sectionDecisions[section.id].note || "无补充说明"}</div>
            ) : null}
          </article>
        );
      })}
      </div>
    </div>
  );
}

function RevisionSummary({ revision }) {
  if (!revision) return <p>尚未返回配置阶段记录修改。</p>;
  if (revision.noChanges) return <p>已完成配置回看，本次未修改任何字段。</p>;
  return (
    <div className="revision-diff-list">
      {revision.diff.map((item) => (
        <div className="revision-diff-row" key={item.path}>
          <strong>{item.label}</strong>
          <div><span>原配置</span><p>{typeof item.before === "object" ? JSON.stringify(item.before) : String(item.before || "（空）")}</p></div>
          <div><span>修改后</span><p>{typeof item.after === "object" ? JSON.stringify(item.after) : String(item.after || "（空）")}</p></div>
        </div>
      ))}
    </div>
  );
}

function FollowUpFlow({ session, user, onNavigate, onWorkflowSaved, notify }) {
  const revisions = session.configurationRevisions?.[user.id] || [];
  const latestRevision = revisions.at(-1);
  const savedReentry = session.workflow?.[user.id]?.reentry;
  const savedInterview = session.workflow?.[user.id]?.interview;
  const [outcome, setOutcome] = useState(savedReentry?.outcome || "ratified");
  const [note, setNote] = useState(savedReentry?.note || "");
  const [interviewNote, setInterviewNote] = useState(savedInterview?.note || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOutcome(savedReentry?.outcome || "ratified");
    setNote(savedReentry?.note || "");
    setInterviewNote(savedInterview?.note || "");
  }, [session.id, savedReentry?.updatedAt, savedInterview?.updatedAt]);

  async function saveReentry() {
    setSaving(true);
    try {
      const result = await api(`/api/sessions/${session.id}/workflow`, {
        method: "POST",
        body: jsonBody({ stage: "reentry", outcome, note }),
      });
      onWorkflowSaved(result.workflow);
      notify("真人re-entry讨论结果已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveInterview() {
    setSaving(true);
    try {
      const result = await api(`/api/sessions/${session.id}/workflow`, {
        method: "POST",
        body: jsonBody({ stage: "interview", outcome: "completed", note: interviewNote }),
      });
      onWorkflowSaved(result.workflow);
      notify("访谈记录已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="follow-up-flow">
      <div className="panel-heading"><div><h2>后续研究流程</h2><p>完成配置回看后，由两位principal进行真人讨论，再进入访谈。</p></div></div>
      <div className="follow-up-grid">
        <div className="follow-up-card">
          <span className="step-number">1</span><h3>返回配置并记录差异</h3>
          <RevisionSummary revision={latestRevision} />
          <button type="button" className="button button-secondary" onClick={() => onNavigate("profiles", { revisionSessionId: session.id, task: session.task })}>返回本任务配置</button>
        </div>
        <div className="follow-up-card">
          <span className="step-number">2</span><h3>真人re-entry讨论</h3>
          <select className="select" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
            <option value="ratified">共同批准代理结果</option>
            <option value="revised">共同修改结果</option>
            <option value="rejected">拒绝代理结果</option>
            <option value="repaired">进行了澄清或关系修复</option>
            <option value="unresolved">仍未解决</option>
          </select>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录讨论中出现的澄清、修改、拒绝、修复或重新承诺" />
          <button type="button" className="button button-primary" onClick={saveReentry} disabled={saving}>{saving ? "保存中…" : "保存讨论结果"}</button>
          {savedReentry ? <small>上次保存：{formatDate(savedReentry.updatedAt)}</small> : null}
        </div>
        <div className="follow-up-card">
          <span className="step-number">3</span><h3>访谈</h3><p>使用文字标记、section决定、配置diff和re-entry记录进行刺激回忆访谈。</p>
          <textarea value={interviewNote} onChange={(event) => setInterviewNote(event.target.value)} placeholder="记录访谈备注或关键反思" />
          <button type="button" className="button button-secondary" onClick={saveInterview} disabled={saving}>{saving ? "保存中…" : "保存访谈记录"}</button>
          {savedInterview ? <small>上次保存：{formatDate(savedInterview.updatedAt)}</small> : null}
        </div>
      </div>
    </section>
  );
}

export default function RecapPage({ user, notify, onNavigate, pageContext }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);

  function loadList() {
    api("/api/sessions").then(({ sessions: list }) => {
      setSessions(list);
      const requestedId = pageContext?.selectedSessionId;
      if (requestedId) loadDetail(requestedId);
      else if (!selected && list.length) loadDetail(list[0].id);
    }).catch((error) => notify(error.message, "error"));
  }

  function loadDetail(id) {
    api(`/api/sessions/${id}`).then(({ session }) => {
      setSelected(session);
      setShowTranscript(false);
    }).catch((error) => notify(error.message, "error"));
  }

  useEffect(loadList, [pageContext?.selectedSessionId]);

  useEffect(() => {
    if (!selected || !["queued", "running", "generating_recaps"].includes(selected.status)) return undefined;
    const timer = setInterval(() => loadDetail(selected.id), 1500);
    return () => clearInterval(timer);
  }, [selected?.id, selected?.status]);

  const recapEntries = useMemo(() => {
    const recaps = selected?.recaps || {};
    if (user.role !== "admin") return Object.entries(recaps);
    return [selected?.participantA, selected?.participantB]
      .filter((participantId) => participantId && recaps[participantId])
      .map((participantId) => [participantId, recaps[participantId]]);
  }, [selected, user.role]);

  function updateMessage(updated) {
    setSelected((current) => ({ ...current, transcript: current.transcript.map((item) => item.messageId === updated.messageId ? updated : item) }));
  }

  function addAnnotation(annotation) {
    setSelected((current) => ({ ...current, annotations: [...(current.annotations || []), annotation] }));
    if (annotation.tags.includes("details_requested")) setShowTranscript(true);
  }

  function updateRecap(participantId, recap) {
    setSelected((current) => ({ ...current, recaps: { ...current.recaps, [participantId]: recap } }));
  }

  function openTranscript() {
    setShowTranscript(true);
    setTimeout(() => document.getElementById("recap-transcript")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  return (
    <div className="recap-layout">
      <aside className="session-list-panel">
        <div className="panel-heading"><div><h2>会话列表</h2><p>{sessions.length} 条与你相关的记录</p></div><button className="icon-button" onClick={loadList}><Icon name="refresh" size={17} /></button></div>
        <div className="session-list">
          {sessions.map((session) => (
            <button key={session.id} className={`session-list-item ${selected?.id === session.id ? "selected" : ""}`} onClick={() => loadDetail(session.id)}>
              <strong>{session.recordName}</strong><span>{formatDate(session.createdAt)}</span><small>{session.status}</small>
            </button>
          ))}
          {!sessions.length && <div className="empty-state compact">暂无会话记录。</div>}
        </div>
      </aside>
      <div className="recap-main">
        {!selected ? <div className="empty-state">选择一条会话查看recap。</div> : (
          <>
            <div className="recap-header">
              <div><h1>{selected.recordName}</h1><p>创建于 {formatDate(selected.createdAt)} · {selected.rounds} 回合 · {selected.status}</p></div>
              {selected.termination ? <span className="termination-badge">{selected.termination.reason === "mutual_private_audit" ? "双方私有审核通过" : "达到最大回合"}</span> : null}
            </div>
            <div className="review-instruction"><strong>先阅读Recap并作初步判断。</strong>如果某处不能充分解释结果，选中对应文字，标记“需要查看详细记录”，再查看下方对话。</div>
            <section className={`recap-document ${user.role === "admin" ? "recap-compare" : ""}`}>
              {recapEntries.length ? recapEntries.map(([participantId, recap], index) => (
                <div className="recap-entry" key={participantId}>
                  {user.role === "admin" ? (
                    <div className="recap-column-header"><div><span>Agent {index + 1}</span><h2>{participantId} 的Recap</h2></div><small className={`recap-status ${recap.status}`}>{recap.status}</small></div>
                  ) : null}
                  {recap.status === "ready" ? (
                    <RecapRenderer
                      session={selected}
                      participantId={participantId}
                      recap={recap}
                      user={user}
                      annotations={selected.annotations || []}
                      onAnnotationSaved={addAnnotation}
                      onRecapUpdated={(updated) => updateRecap(participantId, updated)}
                      onOpenTranscript={openTranscript}
                      notify={notify}
                    />
                  ) : <div className="form-error">{recap.error || "Recap正在生成"}</div>}
                  {recap.decision ? <div className="decision-record"><strong>当前汇总：</strong>{DECISION_LABELS[recap.decision.value] || recap.decision.value}</div> : null}
                </div>
              )) : <div className="empty-state compact">Recap尚未生成。当前状态：{selected.status}</div>}
            </section>
            <button className="transcript-toggle" onClick={() => setShowTranscript((value) => !value)}>{showTranscript ? "收起完整对话" : "查看完整对话记录"}<Icon name="chevron" size={16} /></button>
            {showTranscript ? (
              <section className="recap-transcript" id="recap-transcript"><div className="panel-heading"><div><h2>完整对话记录</h2><p>选中任意文字后，可添加评论并标记为重要、意外或不适。</p></div></div><SessionTranscript session={selected} user={user} notify={notify} onMessageUpdated={updateMessage} annotations={selected.annotations || []} onAnnotationSaved={addAnnotation} /></section>
            ) : null}
            {user.role === "participant" && selected.recaps?.[user.id]?.status === "ready" ? (
              <FollowUpFlow
                session={selected}
                user={user}
                onNavigate={onNavigate}
                notify={notify}
                onWorkflowSaved={(workflow) => setSelected((current) => ({ ...current, workflow: { ...(current.workflow || {}), [user.id]: workflow } }))}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
