import { useEffect, useMemo, useRef, useState } from "react";
import { api, jsonBody } from "../api.js";
import { Icon } from "../components/Icons.jsx";
import SessionTranscript from "../components/SessionTranscript.jsx";

const ACTIVE_STATUSES = new Set(["queued", "running", "generating_recaps"]);

function ParticipantSummary({ title, id, profile, schema, combined = false }) {
  const entries = combined ? ["task1", "task2", "task3"].map((task) => {
    const answered = (schema?.[task]?.fields || []).filter((field) => {
      const value = profile?.[task]?.[field.key];
      return Array.isArray(value) ? value.length : String(value ?? "").trim();
    }).length;
    return [schema?.[task]?.title || task, `${answered} 项已填写资料`];
  }) : (schema?.fields || []).flatMap((field) => {
    const value = profile?.[field.key];
    if (Array.isArray(value) ? !value.length : !String(value ?? "").trim()) return [];
    const displayValue = field.type === "multiselect"
      ? value.map((item) => field.options?.find((option) => option.value === item)?.label || item).join("、")
      : value;
    return [[field.label, displayValue]];
  }).slice(0, 5);
  return (
    <section className="agent-summary">
      <h2>{title}</h2>
      <strong className="agent-participant">{id || "尚未选择"}</strong>
      {entries.length ? <dl>{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join("、") : value}</dd></div>)}</dl> : <p>选择参与者与任务后显示Profile摘要。</p>}
    </section>
  );
}

export default function InteractionPage({ user, notify }) {
  const [participants, setParticipants] = useState([]);
  const [participantA, setParticipantA] = useState("");
  const [participantB, setParticipantB] = useState("");
  const [profiles, setProfiles] = useState({});
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [tasks, setTasks] = useState({});
  const [schemas, setSchemas] = useState({});
  const transcriptEnd = useRef(null);

  useEffect(() => {
    Promise.all([api("/api/participants"), api("/api/model-config"), api("/api/sessions"), api("/api/profile-schemas")])
      .then(([participantResult, configResult, sessionResult, schemaResult]) => {
        const list = participantResult.participants;
        setParticipants(list);
        setParticipantA(list[0]?.id || "");
        setParticipantB(list[1]?.id || "");
        setTasks(configResult.modelConfig.tasks || {});
        setSchemas(schemaResult.profileSchemas || {});
        const recent = sessionResult.sessions.find((item) => ACTIVE_STATUSES.has(item.status)) || sessionResult.sessions[0];
        if (recent) {
          api(`/api/sessions/${recent.id}`).then(({ session: detail }) => {
            setSession(detail);
            setParticipantA(detail.participantA);
            setParticipantB(detail.participantB);
          });
        }
      })
      .catch((error) => notify(error.message, "error"));
  }, [notify]);

  useEffect(() => {
    for (const id of [participantA, participantB]) {
      if (id && !profiles[id]) api(`/api/profiles/${id}`).then(({ participant }) => setProfiles((current) => ({ ...current, [id]: participant.profiles })));
    }
  }, [participantA, participantB, profiles]);

  useEffect(() => {
    if (!session || !ACTIVE_STATUSES.has(session.status)) return undefined;
    const timer = setInterval(() => {
      api(`/api/sessions/${session.id}`)
        .then(({ session: next }) => setSession(next))
        .catch(() => clearInterval(timer));
    }, 1300);
    return () => clearInterval(timer);
  }, [session?.id, session?.status]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.transcript?.length]);

  const selectedTask = session?.task || "task1";
  const directAlignment = selectedTask === "task4";
  const taskProfileA = directAlignment ? profiles[participantA] || {} : profiles[participantA]?.[selectedTask] || {};
  const taskProfileB = directAlignment ? profiles[participantB] || {} : profiles[participantB]?.[selectedTask] || {};
  const active = session && ACTIVE_STATUSES.has(session.status);
  const statusLabel = useMemo(() => ({ queued: "排队中", running: "代理交互中", generating_recaps: "正在生成Recap", completed: "已完成", completed_with_errors: "完成但Recap有错误", failed: "运行失败" }[session?.status] || "等待开始"), [session?.status]);

  async function start(task) {
    if (!participantA || !participantB) return notify("请先选择两个参与者", "error");
    setStarting(true);
    try {
      const result = await api("/api/sessions", { method: "POST", body: jsonBody({ participantA, participantB, task }) });
      setSession(result.session);
      notify(`${result.session.recordName} 已启动`);
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setStarting(false);
    }
  }

  function updateMessage(updated) {
    setSession((current) => ({ ...current, transcript: current.transcript.map((item) => item.messageId === updated.messageId ? updated : item) }));
  }

  return (
    <div className="interaction-page">
      <div className="interaction-top">
        <div className="agent-column">
          <label className="inline-select-label">Agent 1</label>
          <select className="select" value={participantA} disabled={active} onChange={(event) => setParticipantA(event.target.value)}>
            <option value="">选择受试者</option>{participants.map((participant) => <option key={participant.id}>{participant.id}</option>)}
          </select>
          <ParticipantSummary title={directAlignment ? "参与者 A" : "左侧代理"} id={participantA} profile={taskProfileA} schema={directAlignment ? schemas : schemas[selectedTask]} combined={directAlignment} />
        </div>
        <div className="session-status-panel">
          <span className={`status-dot status-${session?.status || "idle"}`} />
          <strong>{statusLabel}</strong>
          <dl>
            <div><dt>记录</dt><dd>{session?.recordName || "—"}</dd></div>
            <div><dt>{directAlignment ? "模式" : "回合"}</dt><dd>{session ? (directAlignment ? "单AI直接生成" : `${session.rounds} / 10`) : "—"}</dd></div>
            <div><dt>Task</dt><dd>{session ? session.task.replace("task", "Task ") : "—"}</dd></div>
          </dl>
          {session?.error && <div className="form-error">{session.error}</div>}
        </div>
        <div className="agent-column">
          <label className="inline-select-label">Agent 2</label>
          <select className="select" value={participantB} disabled={active} onChange={(event) => setParticipantB(event.target.value)}>
            <option value="">选择受试者</option>{participants.filter((participant) => participant.id !== participantA).map((participant) => <option key={participant.id}>{participant.id}</option>)}
          </select>
          <ParticipantSummary title={directAlignment ? "参与者 B" : "右侧代理"} id={participantB} profile={taskProfileB} schema={directAlignment ? schemas : schemas[selectedTask]} combined={directAlignment} />
        </div>
      </div>

      <section className="conversation-panel">
        <div className="panel-heading"><div><h2>{directAlignment ? "单AI直接对齐" : "实时代理对话"}</h2><p>{directAlignment ? "协商助手同时读取两人的三个Profile，直接生成共同Recap；不扮演任何一方，也不生成代理对话。" : "每条代理发言独立保存并生成可评论的消息ID。"}</p></div>{session && <span className="subtle-id">{session.id.slice(0, 8)}</span>}</div>
        <div className="conversation-scroll">
          {session ? (directAlignment
            ? <div className="empty-state"><strong>{active ? "正在根据双方资料生成综合Recap…" : "Task 4 不生成Transcript"}</strong><br />完成后请在Recap页面查看三个任务的共同对齐结果。</div>
            : <SessionTranscript session={session} user={user} notify={notify} onMessageUpdated={updateMessage} allowComments={false} />
          ) : <div className="empty-state">选择两位已登录的受试者，然后执行一个Task。</div>}
          <div ref={transcriptEnd} />
        </div>
      </section>

      <div className="task-controls">
        <div><strong>任务控制</strong><span>Task 1–3运行双代理互动；Task 4由单个中立AI读取双方三个Profile并直接生成共同Recap。</span></div>
        {["task1", "task2", "task3", "task4"].map((key, index) => (
          <button key={key} className={`button ${key === "task1" ? "button-primary" : "button-secondary"}`} disabled={active || starting || !tasks[key]?.enabled} onClick={() => start(key)}>
            <Icon name="play" size={16} />执行 Task {index + 1}{!tasks[key]?.enabled ? " · 未启用" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
