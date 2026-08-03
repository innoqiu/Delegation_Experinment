import { useEffect, useMemo, useRef, useState } from "react";
import { api, jsonBody } from "../api.js";
import { Icon } from "../components/Icons.jsx";
import SessionTranscript from "../components/SessionTranscript.jsx";

const ACTIVE_STATUSES = new Set(["queued", "running", "generating_recaps"]);

function ParticipantSummary({ title, id, profile }) {
  const entries = Object.entries(profile || {}).filter(([, value]) => Array.isArray(value) ? value.length : String(value || "").trim()).slice(0, 5);
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
  const transcriptEnd = useRef(null);

  useEffect(() => {
    Promise.all([api("/api/participants"), api("/api/model-config"), api("/api/sessions")])
      .then(([participantResult, configResult, sessionResult]) => {
        const list = participantResult.participants;
        setParticipants(list);
        setParticipantA(list[0]?.id || "");
        setParticipantB(list[1]?.id || "");
        setTasks(configResult.modelConfig.tasks || {});
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
  const taskProfileA = profiles[participantA]?.[selectedTask] || {};
  const taskProfileB = profiles[participantB]?.[selectedTask] || {};
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
          <ParticipantSummary title="左侧代理" id={participantA} profile={taskProfileA} />
        </div>
        <div className="session-status-panel">
          <span className={`status-dot status-${session?.status || "idle"}`} />
          <strong>{statusLabel}</strong>
          <dl>
            <div><dt>记录</dt><dd>{session?.recordName || "—"}</dd></div>
            <div><dt>回合</dt><dd>{session ? `${session.rounds} / 10` : "—"}</dd></div>
            <div><dt>Task</dt><dd>{session ? session.task.replace("task", "Task ") : "—"}</dd></div>
          </dl>
          {session?.error && <div className="form-error">{session.error}</div>}
        </div>
        <div className="agent-column">
          <label className="inline-select-label">Agent 2</label>
          <select className="select" value={participantB} disabled={active} onChange={(event) => setParticipantB(event.target.value)}>
            <option value="">选择受试者</option>{participants.filter((participant) => participant.id !== participantA).map((participant) => <option key={participant.id}>{participant.id}</option>)}
          </select>
          <ParticipantSummary title="右侧代理" id={participantB} profile={taskProfileB} />
        </div>
      </div>

      <section className="conversation-panel">
        <div className="panel-heading"><div><h2>实时代理对话</h2><p>每条代理发言独立保存并生成可评论的消息ID。</p></div>{session && <span className="subtle-id">{session.id.slice(0, 8)}</span>}</div>
        <div className="conversation-scroll">
          {session ? <SessionTranscript session={session} user={user} notify={notify} onMessageUpdated={updateMessage} allowComments={false} /> : <div className="empty-state">选择两位已登录的受试者，然后执行一个Task。</div>}
          <div ref={transcriptEnd} />
        </div>
      </section>

      <div className="task-controls">
        <div><strong>任务控制</strong><span>由Agent 1发起；双方完成或达到10回合后自动生成recap。</span></div>
        {["task1", "task2", "task3"].map((key, index) => (
          <button key={key} className={`button ${key === "task1" ? "button-primary" : "button-secondary"}`} disabled={active || starting || !tasks[key]?.enabled} onClick={() => start(key)}>
            <Icon name="play" size={16} />执行 Task {index + 1}{!tasks[key]?.enabled ? " · 未启用" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}
