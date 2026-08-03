import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import SessionTranscript from "../components/SessionTranscript.jsx";
import { Icon } from "../components/Icons.jsx";

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

export default function RecapPage({ user, notify }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");

  function loadList() {
    api("/api/sessions").then(({ sessions: list }) => {
      setSessions(list);
      if (!selected && list.length) loadDetail(list[0].id);
    }).catch((error) => notify(error.message, "error"));
  }

  function loadDetail(id) {
    api(`/api/sessions/${id}`).then(({ session }) => {
      setSelected(session);
      const own = session.recaps?.[user.id];
      setDecisionNote(own?.decision?.note || "");
    }).catch((error) => notify(error.message, "error"));
  }

  useEffect(loadList, []);

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
  const primaryRecap = user.role === "participant" ? selected?.recaps?.[user.id] : recapEntries[0]?.[1];

  async function decide(decision) {
    try {
      const result = await api(`/api/sessions/${selected.id}/decision`, { method: "POST", body: jsonBody({ decision, note: decisionNote }) });
      setSelected((current) => ({ ...current, recaps: { ...current.recaps, [user.id]: result.recap } }));
      notify("你的决定已保存");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function updateMessage(updated) {
    setSelected((current) => ({ ...current, transcript: current.transcript.map((item) => item.messageId === updated.messageId ? updated : item) }));
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
              {user.role === "participant" && primaryRecap?.status === "ready" && (
                <div className="decision-buttons">
                  <button className="button button-success" onClick={() => decide("approved")}>批准（暂定）</button>
                  <button className="button button-warning" onClick={() => decide("revision_requested")}>请求修改</button>
                  <button className="button button-danger" onClick={() => decide("rejected")}>拒绝</button>
                </div>
              )}
            </div>
            <section className={`recap-document ${user.role === "admin" ? "recap-compare" : ""}`}>
              {recapEntries.length ? recapEntries.map(([participantId, recap], index) => (
                <div className="recap-entry" key={participantId}>
                  {user.role === "admin" && (
                    <div className="recap-column-header">
                      <div><span>Agent {index + 1}</span><h2>{participantId} 的Recap</h2></div>
                      <small className={`recap-status ${recap.status}`}>{recap.status}</small>
                    </div>
                  )}
                  {recap.status === "ready" ? <div className="recap-content">{recap.content}</div> : <div className="form-error">{recap.error || "Recap正在生成"}</div>}
                  {recap.decision && <div className="decision-record"><strong>参与者决定：</strong>{recap.decision.value}{recap.decision.note ? ` · ${recap.decision.note}` : ""}</div>}
                </div>
              )) : <div className="empty-state compact">Recap尚未生成。当前状态：{selected.status}</div>}
              {user.role === "participant" && primaryRecap?.status === "ready" && (
                <label className="field decision-note"><span className="field-label">批准、修改或拒绝的补充说明</span><textarea className="textarea" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></label>
              )}
            </section>
            <button className="transcript-toggle" onClick={() => setShowTranscript((value) => !value)}>{showTranscript ? "收起完整对话" : "查看完整对话记录"}<Icon name="chevron" size={16} /></button>
            {showTranscript && (
              <section className="recap-transcript"><div className="panel-heading"><div><h2>完整对话记录</h2><p>独立于上方recap展示；点击任意发言添加采访评论。</p></div></div><SessionTranscript session={selected} user={user} notify={notify} onMessageUpdated={updateMessage} /></section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
