import { useEffect, useMemo, useState } from "react";
import { api, downloadApi } from "../api.js";
import SessionTranscript from "../components/SessionTranscript.jsx";
import { Icon } from "../components/Icons.jsx";

const formatDate = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

export default function HistoryPage({ user, notify }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("all");
  const [status, setStatus] = useState("all");
  const [exporting, setExporting] = useState(false);

  function load() {
    api("/api/sessions").then(({ sessions: list }) => setSessions(list)).catch((error) => notify(error.message, "error"));
  }
  useEffect(load, []);

  const filtered = useMemo(() => sessions.filter((session) => {
    const matchesSearch = !search || `${session.recordName} ${session.participantA} ${session.participantB}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (task === "all" || session.task === task) && (status === "all" || session.status === status);
  }), [search, sessions, status, task]);

  async function open(id) {
    try { const result = await api(`/api/sessions/${id}`); setSelected(result.session); }
    catch (error) { notify(error.message, "error"); }
  }

  function download() {
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selected.recordName.replaceAll(" ", "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadAll() {
    setExporting(true);
    try {
      const { blob, filename } = await downloadApi("/api/export/all.zip");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify("全部记录 ZIP 已下载");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setExporting(false);
    }
  }

  function updateMessage(updated) {
    setSelected((current) => ({ ...current, transcript: current.transcript.map((item) => item.messageId === updated.messageId ? updated : item) }));
  }

  async function removeSelected() {
    if (!selected) return;
    const confirmed = window.confirm(`确认永久删除记录“${selected.recordName}”？\n\n该记录的 transcript、recap 和评论会一并删除，且无法撤销。`);
    if (!confirmed) return;
    try {
      await api(`/api/sessions/${selected.id}`, { method: "DELETE" });
      const deletedId = selected.id;
      setSelected(null);
      setSessions((current) => current.filter((session) => session.id !== deletedId));
      notify("记录已删除");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  const selectedIsActive = selected && ["queued", "running", "generating_recaps"].includes(selected.status);

  return (
    <div className={`history-layout ${selected ? "with-detail" : ""}`}>
      <div className="history-main">
        <div className="history-toolbar">
          <label className="search-box"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索记录名称或受试者" /></label>
          <select className="select" value={task} onChange={(event) => setTask(event.target.value)}><option value="all">全部任务</option><option value="task1">Task 1</option><option value="task2">Task 2</option><option value="task3">Task 3</option></select>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="running">运行中</option><option value="completed">已完成</option><option value="failed">失败</option></select>
          <button className="button button-secondary history-export" onClick={downloadAll} disabled={exporting}><Icon name="download" size={16} />{exporting ? "正在打包…" : "下载全部记录"}</button>
          <button className="icon-button" onClick={load}><Icon name="refresh" size={17} /></button>
        </div>
        <div className="table-wrap">
          <table className="history-table">
            <thead><tr><th>记录名称</th><th>双方</th><th>任务</th><th>创建时间</th><th>状态</th><th>回合</th><th>Recap</th><th>评论</th><th /></tr></thead>
            <tbody>
              {filtered.map((session) => {
                const commentCount = session.transcript?.reduce((sum, item) => sum + (item.comments?.length || 0), 0) || 0;
                return <tr key={session.id} className={selected?.id === session.id ? "selected" : ""} onClick={() => open(session.id)}><td><strong>{session.recordName}</strong></td><td>{session.participantA} ↔ {session.participantB}</td><td>{session.task.replace("task", "Task ")}</td><td>{formatDate(session.createdAt)}</td><td><span className={`table-status ${session.status}`}>{session.status}</span></td><td>{session.rounds}/10</td><td>{Object.keys(session.recaps || {}).length}/2</td><td>{commentCount}</td><td><button className="icon-button"><Icon name="eye" size={16} /></button></td></tr>;
              })}
            </tbody>
          </table>
          {!filtered.length && <div className="empty-state compact">没有符合条件的记录。</div>}
        </div>
      </div>
      {selected && (
        <aside className="history-detail">
          <div className="detail-header"><div><h2>{selected.recordName}</h2><p>{selected.id}</p></div><button className="icon-button" onClick={() => setSelected(null)}><Icon name="close" size={18} /></button></div>
          <div className="detail-actions">
            <button className="button button-secondary" onClick={download}><Icon name="download" size={16} />导出完整JSON</button>
            <button className="button button-danger" onClick={removeSelected} disabled={selectedIsActive} title={selectedIsActive ? "运行中的记录不能删除" : "永久删除此记录"}><Icon name="trash" size={16} />删除记录</button>
          </div>
          <section className="detail-section"><h3>基本信息</h3><dl><div><dt>状态</dt><dd>{selected.status}</dd></div><div><dt>创建</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>完成</dt><dd>{formatDate(selected.completedAt)}</dd></div><div><dt>回合</dt><dd>{selected.rounds}/10</dd></div></dl>{selected.error && <div className="form-error">{selected.error}</div>}</section>
          <section className="detail-section"><h3>模型快照</h3><p>Agent 1：{selected.modelSnapshot?.agent1?.model || "—"}</p><p>Agent 2：{selected.modelSnapshot?.agent2?.model || "—"}</p></section>
          <section className="detail-section"><h3>双方Recap</h3>{Object.entries(selected.recaps || {}).map(([id, recap]) => <div className="detail-recap" key={id}><strong>{id}</strong><span>{recap.status}</span><div>{recap.content || recap.error}</div></div>)}</section>
          <section className="detail-section"><h3>Transcript与评论</h3><SessionTranscript session={selected} user={user} notify={notify} onMessageUpdated={updateMessage} /></section>
        </aside>
      )}
    </div>
  );
}
