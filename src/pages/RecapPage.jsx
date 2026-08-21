import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import SessionTranscript from "../components/SessionTranscript.jsx";
import TextAnnotation from "../components/TextAnnotation.jsx";
import Task4ComparisonQuestionnaire from "../components/Task4ComparisonQuestionnaire.jsx";
import { Icon } from "../components/Icons.jsx";
import { legacyRecapToStructured } from "../utils/recapMarkdown.jsx";

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

function RecapRenderer({ session, participantId, recap, annotations, onAnnotationSaved, onAnnotationCancelled, onOpenTranscript, notify }) {
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
              allowedTags={["important", "unexpected", "uncomfortable", "details_requested", "trust_decreased", "trust_increased", "agent_overreach"]}
              annotations={sectionAnnotations}
              onSaved={onAnnotationSaved}
              onCancelled={onAnnotationCancelled}
              onOpenDetails={onOpenTranscript}
              notify={notify}
            >
              <ReportSectionBody section={section} />
            </TextAnnotation>
          </article>
        );
      })}
      </div>
    </div>
  );
}

function FollowUpFlow({ session, user, onWorkflowSaved, notify }) {
  const savedPreparation = session.workflow?.[user.id]?.discussion_preparation;
  const [preparation, setPreparation] = useState(() => ({
    counterpartExpectations: savedPreparation?.fields?.counterpartExpectations || "",
    counterpartImpression: savedPreparation?.fields?.counterpartImpression || "",
    followUpNotes: savedPreparation?.fields?.followUpNotes || savedPreparation?.note || "",
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPreparation({
      counterpartExpectations: savedPreparation?.fields?.counterpartExpectations || "",
      counterpartImpression: savedPreparation?.fields?.counterpartImpression || "",
      followUpNotes: savedPreparation?.fields?.followUpNotes || savedPreparation?.note || "",
    });
  }, [session.id, savedPreparation?.updatedAt]);

  async function savePreparation() {
    setSaving(true);
    try {
      const result = await api(`/api/sessions/${session.id}/workflow`, {
        method: "POST",
        body: jsonBody({ stage: "discussion_preparation", outcome: "completed", fields: preparation }),
      });
      onWorkflowSaved(result.workflow);
      notify("真人讨论准备已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="follow-up-flow">
      <div className="panel-heading"><div><h2>后续研究流程</h2><p>完成讨论准备后，你将与另一位参与者进行真人讨论，再进入访谈。</p></div></div>
      <div className="follow-up-grid follow-up-grid-single">
        <div className="follow-up-card">
          <h3>为真人讨论做准备</h3>
          <div className="discussion-preparation">
            <p>{session.task === "task4"
              ? "接下来，你将与另一位参与者进行真人讨论；此前，单个协商助手已根据你们的Profile生成共同建议。请先独立记录你希望在讨论中确认或处理的事项，不必现在与对方讨论。"
              : "接下来，你将与另一位参与者进行真人讨论；此前，你们的代理已经彼此沟通过。请先独立记录你希望在讨论中确认或处理的事项，不必现在与对方讨论。"}</p>
            <div className="discussion-preparation-fields">
              <label>
                <span>你觉得对方对于这件事的预期是什么？他期待你做什么？</span>
                <textarea value={preparation.counterpartExpectations} onChange={(event) => setPreparation((current) => ({ ...current, counterpartExpectations: event.target.value }))} placeholder="例如：对方可能期待我确认时间，并对代理提出的候选方案作出回应。" />
              </label>
              <label>
                <span>仅根据这次代理互动，你对对方在本任务中形成了什么第一印象？</span>
                <textarea value={preparation.counterpartImpression} onChange={(event) => setPreparation((current) => ({ ...current, counterpartImpression: event.target.value }))} placeholder="只描述与本任务有关的印象，以及哪些代理行为或信息促成了这一印象。" />
              </label>
              <label>
                <span>后续联系笔记</span>
                <textarea value={preparation.followUpNotes} onChange={(event) => setPreparation((current) => ({ ...current, followUpNotes: event.target.value }))} placeholder="记录未解决问题和准备做或询问的事情，例如：直接接受；澄清代理权限；重新协商；撤回承诺；向对方解释或道歉。" />
              </label>
            </div>
            <div className="discussion-preparation-actions">
              <button type="button" className="button button-primary" onClick={savePreparation} disabled={saving}>{saving ? "保存中…" : "保存讨论准备"}</button>
              {savedPreparation ? <small>上次保存：{formatDate(savedPreparation.updatedAt)}</small> : null}
            </div>
          </div>
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
    if (selected?.task === "task4") return selected.sharedRecap ? [["shared", selected.sharedRecap]] : [];
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
    if (annotation.tags.includes("details_requested") && selected?.task !== "task4") setShowTranscript(true);
  }

  function cancelAnnotations(cancelledAnnotations) {
    const cancelledById = new Map(cancelledAnnotations.map((annotation) => [annotation.id, annotation]));
    setSelected((current) => ({
      ...current,
      annotations: (current.annotations || []).map((annotation) => cancelledById.get(annotation.id) || annotation),
    }));
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
              <div><h1>{selected.recordName}</h1><p>创建于 {formatDate(selected.createdAt)} · {selected.task === "task4" ? "单AI直接对齐" : `${selected.rounds} 回合`} · {selected.status}</p></div>
              {selected.termination ? <span className="termination-badge">{selected.termination.reason === "single_assistant_completed" ? "集中式对齐完成" : selected.termination.reason === "mutual_private_audit" ? "双方私有审核通过" : "达到最大回合"}</span> : null}
            </div>
            <div className="review-instruction"><strong>{selected.task === "task4" ? "这是单AI根据双方三个Profile直接生成的共同Recap。" : "先阅读Recap并作初步判断。"}</strong>{selected.task === "task4" ? "本任务没有代理对话记录；你仍可选中文字进行标记并说明原因。" : "如果某处不能充分解释结果，选中对应文字，标记“需要查看详细记录”，再查看下方对话。"}</div>
            <section className={`recap-document ${user.role === "admin" && selected.task !== "task4" ? "recap-compare" : ""}`}>
              {recapEntries.length ? recapEntries.map(([participantId, recap], index) => (
                <div className="recap-entry" key={participantId}>
                  {user.role === "admin" ? (
                    <div className="recap-column-header"><div><span>{participantId === "shared" ? "单AI协商助手" : `Agent ${index + 1}`}</span><h2>{participantId === "shared" ? "双方共享Recap" : `${participantId} 的Recap`}</h2></div><small className={`recap-status ${recap.status}`}>{recap.status}</small></div>
                  ) : null}
                  {recap.status === "ready" ? (
                    <RecapRenderer
                      session={selected}
                      participantId={participantId}
                      recap={recap}
                      annotations={selected.annotations || []}
                      onAnnotationSaved={addAnnotation}
                      onAnnotationCancelled={cancelAnnotations}
                      onOpenTranscript={selected.task === "task4" ? undefined : openTranscript}
                      notify={notify}
                    />
                  ) : <div className="form-error">{recap.error || "Recap正在生成"}</div>}
                </div>
              )) : <div className="empty-state compact">Recap尚未生成。当前状态：{selected.status}</div>}
            </section>
            {selected.task !== "task4" ? <button className="transcript-toggle" onClick={() => setShowTranscript((value) => !value)}>{showTranscript ? "收起完整对话" : "查看完整对话记录"}<Icon name="chevron" size={16} /></button> : null}
            {selected.task !== "task4" && showTranscript ? (
              <section className="recap-transcript" id="recap-transcript"><div className="panel-heading"><div><h2>完整对话记录</h2><p>选中文字后，可以记录内容反应、信任变化或代理越权，并简述原因。</p></div></div><SessionTranscript session={selected} user={user} notify={notify} onMessageUpdated={updateMessage} annotations={selected.annotations || []} onAnnotationSaved={addAnnotation} onAnnotationCancelled={cancelAnnotations} /></section>
            ) : null}
            {user.role === "participant" && selected.task === "task4" && selected.sharedRecap?.status === "ready" ? (
              <Task4ComparisonQuestionnaire
                session={selected}
                participantId={user.id}
                notify={notify}
                onSaved={(questionnaire) => setSelected((current) => ({
                  ...current,
                  task4Questionnaires: { ...(current.task4Questionnaires || {}), [user.id]: questionnaire },
                }))}
              />
            ) : null}
            {user.role === "participant" && (selected.task === "task4" ? selected.sharedRecap?.status === "ready" : selected.recaps?.[user.id]?.status === "ready") ? (
              <FollowUpFlow
                session={selected}
                user={user}
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
