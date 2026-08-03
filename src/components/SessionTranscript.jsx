import { useState } from "react";
import { api, jsonBody } from "../api.js";
import { Icon } from "./Icons.jsx";

function CommentEditor({ sessionId, message, user, onSaved, notify }) {
  const ownComment = message.comments?.find((comment) => comment.author === user.id);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(ownComment?.text || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await api(`/api/sessions/${sessionId}/messages/${encodeURIComponent(message.messageId)}/comments`, {
        method: "POST",
        body: jsonBody({ text }),
      });
      onSaved(result.message);
      setEditing(false);
      notify("评论已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="comment-area">
      {message.comments?.map((comment) => (
        <div className="saved-comment" key={comment.id}><strong>{comment.author}：</strong>{comment.text}</div>
      ))}
      {editing ? (
        <div className="comment-editor">
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="记录你对这条发言的看法…" autoFocus />
          <div><button className="button button-small button-primary" onClick={save} disabled={!text.trim() || saving}>{saving ? "保存中" : "保存"}</button><button className="button button-small button-ghost" onClick={() => setEditing(false)}>取消</button></div>
        </div>
      ) : (
        <button className="comment-trigger" onClick={() => setEditing(true)}><Icon name="comment" size={14} />{ownComment ? "修改我的评论" : "添加评论"}</button>
      )}
    </div>
  );
}

export default function SessionTranscript({ session, user, notify, onMessageUpdated, allowComments = true }) {
  if (!session?.transcript?.length) return <div className="empty-state compact">对话尚未产生消息。</div>;
  return (
    <div className="transcript" aria-live="polite">
      {session.transcript.map((message) => {
        const left = message.participantId === session.participantA;
        return (
          <article key={message.messageId} className={`message-row ${left ? "left" : "right"}`}>
            <div className="speaker-label"><strong>{message.participantId}</strong><span>回合 {message.round}</span></div>
            <div className="message-wrap">
              <div className="message-meta"><strong>{message.messageId}</strong><time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</time></div>
              <div className="message-text">{message.text}</div>
              {allowComments && (
                <CommentEditor sessionId={session.id} message={message} user={user} notify={notify} onSaved={onMessageUpdated} />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
