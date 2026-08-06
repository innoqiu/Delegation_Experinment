import { useRef, useState } from "react";
import { api, jsonBody } from "../api.js";

const TAG_LABELS = {
  important: "重要",
  unexpected: "意外",
  uncomfortable: "不适",
  details_requested: "需要查看详细记录",
};

function pointOffset(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function AnnotationList({ annotations = [], onOpenDetails }) {
  if (!annotations.length) return null;
  return (
    <div className="annotation-list">
      {annotations.map((annotation) => (
        <div className="annotation-record" key={annotation.id}>
          <blockquote>“{annotation.quote}”</blockquote>
          <div className="annotation-record-meta">
            <span>{annotation.author}</span>
            {annotation.tags.map((tag) => <span className={`annotation-tag tag-${tag}`} key={tag}>{TAG_LABELS[tag]}</span>)}
          </div>
          {annotation.note ? <p>{annotation.note}</p> : null}
          {annotation.tags.includes("details_requested") && onOpenDetails ? (
            <button type="button" className="text-link" onClick={onOpenDetails}>查看详细对话记录</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function TextAnnotation({
  sessionId,
  targetType,
  targetId,
  sectionId = "",
  allowedTags = ["important", "unexpected", "uncomfortable"],
  annotations = [],
  onSaved,
  onOpenDetails,
  notify,
  children,
}) {
  const contentRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [tags, setTags] = useState([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function captureSelection() {
    const selected = window.getSelection();
    const root = contentRef.current;
    if (!root || !selected || selected.isCollapsed || !selected.rangeCount) return;
    const range = selected.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const quote = selected.toString().trim();
    if (!quote) return;
    const rect = range.getBoundingClientRect();
    let start = 0;
    let end = quote.length;
    try {
      start = pointOffset(root, range.startContainer, range.startOffset);
      end = pointOffset(root, range.endContainer, range.endOffset);
    } catch { /* Quote remains the durable anchor when DOM offsets are unavailable. */ }
    setSelection({
      quote: quote.slice(0, 3000),
      start,
      end,
      top: Math.min(window.innerHeight - 270, Math.max(12, rect.bottom + 8)),
      left: Math.min(window.innerWidth - 330, Math.max(12, rect.left)),
    });
    setTags([]);
    setNote("");
  }

  function toggleTag(tag) {
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  }

  async function save() {
    if (!selection || (!note.trim() && !tags.length)) return;
    setSaving(true);
    try {
      const result = await api(`/api/sessions/${sessionId}/annotations`, {
        method: "POST",
        body: jsonBody({
          targetType,
          targetId,
          sectionId,
          quote: selection.quote,
          start: selection.start,
          end: selection.end,
          tags,
          note,
        }),
      });
      onSaved(result.annotation);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      notify?.("文字标记已保存");
    } catch (error) {
      notify?.(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="annotatable-shell">
      <div ref={contentRef} className="annotatable-content" onMouseUp={captureSelection} onTouchEnd={captureSelection}>
        {children}
      </div>
      <AnnotationList annotations={annotations} onOpenDetails={onOpenDetails} />
      {selection ? (
        <div className="selection-toolbar" style={{ top: selection.top, left: selection.left }} role="dialog" aria-label="添加文字标记">
          <div className="selection-toolbar-head"><strong>标记所选文字</strong><button type="button" onClick={() => setSelection(null)} aria-label="关闭">×</button></div>
          <div className="selection-quote">“{selection.quote}”</div>
          <div className="selection-tags">
            {allowedTags.map((tag) => (
              <button type="button" key={tag} className={tags.includes(tag) ? "selected" : ""} onClick={() => toggleTag(tag)}>{TAG_LABELS[tag]}</button>
            ))}
          </div>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="添加评论（可选）" maxLength={5000} />
          <button type="button" className="button button-primary button-small" onClick={save} disabled={saving || (!note.trim() && !tags.length)}>{saving ? "保存中…" : "保存标记"}</button>
        </div>
      ) : null}
    </div>
  );
}
