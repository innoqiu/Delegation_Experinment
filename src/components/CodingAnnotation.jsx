import { useRef, useState } from "react";
import { api, jsonBody } from "../api.js";

export const PROFILE_CODE_GROUPS = [{
  id: "profile",
  label: "Profile 修改类别",
  codes: [
    ["REPRESENTATION_REGROUNDING", "修改代理如何理解和呈现用户"],
    ["DELEGATION_REGROUNDING", "修改代理可以替用户做什么"],
    ["MIXED_REGROUNDING", "同时改变用户表征与代理权限"],
    ["NO_OR_UNCLEAR_CHANGE", "没有实质修改或意义不明确"],
  ],
}];

export const INTERACTION_CODE_GROUPS = [
  {
    id: "scope",
    label: "Scope",
    codes: [
      ["AA_STRUCTURAL", "依赖双方分别由代理代表的 A–A 结构"],
      ["DELEGATION_GENERAL", "来自 AI 代表用户，单边代理也可能发生"],
      ["IMPLEMENTATION_SPECIFIC", "主要由任务、prompt、模板或模型实现造成"],
      ["UNCLEAR", "现有材料不足以判断"],
    ],
  },
  {
    id: "mechanism",
    label: "Mechanism",
    codes: [
      ["POSITION_ENACTMENT", "代理表达、解释、维护或限定己方立场"],
      ["RECIPROCAL_UPTAKE", "两个代理共同发展或固化 joint state"],
      ["REPRESENTATION_DRIFT", "对方信息改变了代理对己方用户的表述"],
      ["STATUS_COLLAPSE", "候选、接受与承诺等状态区别被消除"],
      ["NONE_OR_UNCLEAR", "未识别出明确互动机制"],
    ],
  },
  {
    id: "response",
    label: "Response",
    codes: [
      ["ENDORSE", "用户认可、认领或愿意保留"],
      ["INSPECT", "需要查看记录或形成过程后判断"],
      ["REGROUND_CONFIRM", "需要本人或对方重新确认"],
      ["REGROUND_EXPLAIN", "需要补充条件、纠正或修复印象"],
      ["REGROUND_WITHDRAW", "拒绝、撤回或重新打开结果"],
      ["RECONFIGURE_DELEGATION", "希望修改 profile、权限或未来规则"],
      ["NO_STATED_ACTION", "进行了标记但未说明后续行动"],
    ],
  },
];

const CODE_LABELS = Object.fromEntries([...PROFILE_CODE_GROUPS, ...INTERACTION_CODE_GROUPS].flatMap((group) => group.codes));

function pointOffset(root, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function highlightedSegments(text, participantAnnotations, codingAnnotations) {
  const ranges = [];
  const addRange = (annotation, type, label) => {
    const quote = String(annotation.quote || "");
    if (!quote) return;
    const savedStart = Number(annotation.start);
    const savedEnd = Number(annotation.end);
    const savedRangeMatches = Number.isInteger(savedStart)
      && Number.isInteger(savedEnd)
      && savedStart >= 0
      && savedEnd > savedStart
      && savedEnd <= text.length
      && text.slice(savedStart, savedEnd).trim() === quote;
    const start = savedRangeMatches ? savedStart : text.indexOf(quote);
    const end = savedRangeMatches ? savedEnd : start + quote.length;
    if (start >= 0) ranges.push({ start, end, type, label });
  };
  for (const annotation of participantAnnotations) addRange(annotation, "participant", `${annotation.author}: ${(annotation.tags || []).join(", ")}`);
  for (const annotation of codingAnnotations) addRange(annotation, "coding", (annotation.codes || []).join(" · "));
  if (!ranges.length) return [text];
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(({ start, end }) => [start, end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const covering = ranges.filter((range) => range.start <= start && range.end >= end);
    const value = text.slice(start, end);
    if (!covering.length) return value;
    const types = [...new Set(covering.map((range) => range.type))];
    return <mark className={`coding-highlight ${types.map((type) => `highlight-${type}`).join(" ")}`} title={covering.map(({ label }) => label).join(" | ")} key={`${start}-${end}`}>{value}</mark>;
  });
}

function CodingRecords({ annotations, onDeleted }) {
  if (!annotations.length) return null;
  return (
    <div className="coding-records">
      {annotations.map((annotation) => (
        <div className="coding-record" key={annotation.id}>
          <blockquote>“{annotation.quote}”</blockquote>
          <div>{annotation.codes.map((code) => <span key={code}>{code}</span>)}</div>
          {annotation.note ? <p>{annotation.note}</p> : null}
          <button type="button" onClick={() => onDeleted(annotation.id)}>删除编码</button>
        </div>
      ))}
    </div>
  );
}

export default function CodingAnnotation({
  scheme,
  targetType,
  targetId,
  text,
  participantAnnotations = [],
  codingAnnotations = [],
  onSaved,
  onDeleted,
  notify,
}) {
  const rootRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [codes, setCodes] = useState([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const groups = scheme === "profile" ? PROFILE_CODE_GROUPS : INTERACTION_CODE_GROUPS;

  function captureSelection() {
    const selected = window.getSelection();
    const root = rootRef.current;
    if (!root || !selected || selected.isCollapsed || !selected.rangeCount) return;
    const range = selected.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const quote = selected.toString().trim();
    if (!quote) return;
    const rect = range.getBoundingClientRect();
    const maximumTop = Math.max(12, window.innerHeight - 640);
    setSelection({
      quote: quote.slice(0, 5000),
      start: pointOffset(root, range.startContainer, range.startOffset),
      end: pointOffset(root, range.endContainer, range.endOffset),
      top: Math.min(maximumTop, Math.max(12, rect.bottom + 8)),
      left: Math.min(window.innerWidth - 550, Math.max(12, rect.left)),
    });
    setCodes([]);
    setNote("");
  }

  function choose(group, code) {
    const groupCodes = new Set(group.codes.map(([value]) => value));
    setCodes((current) => [...current.filter((value) => !groupCodes.has(value)), code]);
  }

  const complete = scheme === "profile"
    ? codes.length === 1
    : groups.every((group) => codes.some((code) => group.codes.some(([value]) => value === code)));

  async function save() {
    if (!selection || !complete) return;
    setSaving(true);
    try {
      const result = await api("/api/coding/annotations", {
        method: "POST",
        body: jsonBody({ scheme, targetType, targetId, quote: selection.quote, start: selection.start, end: selection.end, codes, note }),
      });
      onSaved(result.annotation);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      notify("编码已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove(annotationId) {
    try {
      await api(`/api/coding/annotations/${annotationId}`, { method: "DELETE" });
      onDeleted(annotationId);
      notify("编码已删除");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  return (
    <div className="coding-annotatable" data-coding-target={targetId}>
      <div ref={rootRef} className="coding-source-text" onMouseUp={captureSelection} onTouchEnd={captureSelection}>
        {highlightedSegments(String(text || ""), participantAnnotations, codingAnnotations)}
      </div>
      {participantAnnotations.length ? <div className="participant-mark-summary">参与者标记：{participantAnnotations.map((annotation) => `${annotation.author} · ${(annotation.tags || []).join("/")}`).join("；")}</div> : null}
      <CodingRecords annotations={codingAnnotations} onDeleted={remove} />
      {selection ? (
        <div className="coding-toolbar" style={{ top: selection.top, left: selection.left }} role="dialog" aria-label="添加定性编码">
          <div className="coding-toolbar-head"><strong>编码所选文字</strong><button type="button" onClick={() => setSelection(null)}>×</button></div>
          <blockquote>“{selection.quote}”</blockquote>
          <div className="coding-code-groups">
          {groups.map((group, index) => {
            const selectedCode = codes.find((code) => group.codes.some(([value]) => value === code));
            return (
            <details className="coding-code-group" open={scheme === "profile" && index === 0} key={group.id}>
              <summary><strong>{group.label}</strong><span>{selectedCode || "未选择"}</span></summary>
              <div className="coding-code-options">
                {group.codes.map(([code, description]) => (
                  <button type="button" className={codes.includes(code) ? "selected" : ""} onClick={() => choose(group, code)} key={code} title={description}>
                    <strong>{code}</strong><small>{description}</small>
                  </button>
                ))}
              </div>
            </details>
          );})}
          </div>
          <div className="coding-toolbar-actions">
            <label><span>编码备注（可选）</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <button type="button" className="button button-primary button-small" onClick={save} disabled={!complete || saving}>{saving ? "保存中…" : "保存编码"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function codingLabel(code) {
  return CODE_LABELS[code] || code;
}
