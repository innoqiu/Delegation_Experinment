import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import { ChoiceGrid, Field, TextArea, TextInput } from "../components/FormControls.jsx";
import { Icon } from "../components/Icons.jsx";

const TASK_KEYS = ["task1", "task2", "task3"];

function emptyProfiles(schemas = {}) {
  return Object.fromEntries(TASK_KEYS.map((task) => [task, {
    ...Object.fromEntries((schemas[task]?.fields || []).map((field) => [field.key, field.type === "multiselect" ? [] : ""])),
    studyIntent: { authorizationIntent: "", desiredUnderstanding: "" },
    customFields: [],
  }]));
}

function Section({ number, schema, children }) {
  return (
    <section className="profile-section">
      <div className="section-heading">
        <div><h2>Profile {number}：{schema.title}</h2><p>{schema.description}</p></div>
      </div>
      {children}
    </section>
  );
}

function SchemaField({ field, value, readOnly, onChange }) {
  const common = { value: value ?? "", readOnly, onChange: (event) => onChange(event.target.value) };
  let control;
  if (field.type === "multiselect") {
    control = <ChoiceGrid options={field.options || []} values={Array.isArray(value) ? value : []} onChange={onChange} disabled={readOnly} />;
  } else if (field.type === "number") {
    control = <TextInput {...common} type="number" min={field.min} max={field.max} />;
  } else if (field.type === "text") {
    control = <TextInput {...common} maxLength={5000} />;
  } else {
    control = <TextArea {...common} maxLength={5000} />;
  }
  return <Field label={field.label} hint={field.hint} className={field.wide ? "span-two" : ""}>{control}</Field>;
}

function CustomProfileFields({ fields, readOnly, onAdd, onChange, onRemove }) {
  return (
    <div className="custom-profile-fields">
      <div className="custom-fields-heading">
        <div>
          <h3>个人补充条件</h3>
          <p>补充固定问卷未覆盖的授权、偏好或边界；有内容的条目会自动作为资料加入对应 Task 的代理提示词。</p>
        </div>
        {!readOnly && <button type="button" className="button button-secondary button-small" onClick={onAdd} disabled={fields.length >= 20}><Icon name="plus" size={16} />添加输入项</button>}
      </div>
      {fields.length ? (
        <div className="custom-fields-list">
          {fields.map((field, index) => (
            <div className="custom-field-row" key={field.id}>
              <Field label={`条件名称 ${index + 1}`} hint="例如：无障碍需求、沟通方式、费用分担">
                <TextInput value={field.label} maxLength={120} placeholder="输入条件名称" onChange={(event) => onChange(field.id, "label", event.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="具体内容">
                <TextArea value={field.value} maxLength={5000} placeholder="说明代理需要了解或遵守的具体条件" onChange={(event) => onChange(field.id, "value", event.target.value)} readOnly={readOnly} />
              </Field>
              {!readOnly && <button type="button" className="icon-button custom-field-delete" aria-label={`删除补充条件 ${index + 1}`} title="删除此输入项" onClick={() => onRemove(field.id)}><Icon name="trash" size={17} /></button>}
            </div>
          ))}
        </div>
      ) : <div className="custom-fields-empty">尚未添加个人补充条件。</div>}
    </div>
  );
}

function StudyIntentFields({ value = {}, readOnly, onChange }) {
  return (
    <div className="study-intent-card">
      <div><span className="eyebrow">授权意图记录</span><h3>在代理开始交流前，明确你希望它做什么，以及希望对方如何理解你。</h3></div>
      <div className="form-grid two-columns">
        <Field label="本次授权意图" hint="你希望代理实现什么；哪些决定仍必须留给你本人">
          <TextArea value={value.authorizationIntent || ""} onChange={(event) => onChange("authorizationIntent", event.target.value)} readOnly={readOnly} maxLength={5000} />
        </Field>
        <Field label="希望对方如何理解我" hint="经过代理交流后，你希望对方形成怎样的准确理解">
          <TextArea value={value.desiredUnderstanding || ""} onChange={(event) => onChange("desiredUnderstanding", event.target.value)} readOnly={readOnly} maxLength={5000} />
        </Field>
      </div>
    </div>
  );
}

function RevisionResult({ revision }) {
  if (!revision) return null;
  return (
    <div className="revision-result">
      <strong>{revision.noChanges ? "配置回看已记录：没有修改" : `配置回看已记录：${revision.diff.length}项修改`}</strong>
      {revision.diff.map((item) => <span key={item.path}>{item.label}</span>)}
    </div>
  );
}

export default function AgentConfigPage({ user, notify, onNavigate, pageContext }) {
  const [participants, setParticipants] = useState([]);
  const [selectedId, setSelectedId] = useState(user.role === "participant" ? user.id : "");
  const [schemas, setSchemas] = useState(null);
  const [profiles, setProfiles] = useState(emptyProfiles());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revisionSession, setRevisionSession] = useState(null);
  const [lastRevision, setLastRevision] = useState(null);
  const readOnly = user.role === "admin";
  const revisionSessionId = user.role === "participant" ? pageContext?.revisionSessionId : null;

  useEffect(() => {
    api("/api/profile-schemas")
      .then(({ profileSchemas }) => {
        setSchemas(profileSchemas);
        setProfiles((current) => ({ ...emptyProfiles(profileSchemas), ...current }));
      })
      .catch((error) => notify(error.message, "error"));
    if (user.role !== "admin") return;
    api("/api/participants").then(({ participants: list }) => {
      setParticipants(list);
      setSelectedId((current) => current || list[0]?.id || "");
    }).catch((error) => notify(error.message, "error"));
  }, [notify, user.role]);

  useEffect(() => {
    if (!selectedId || !schemas) { if (schemas) setLoading(false); return; }
    setLoading(true);
    api(`/api/profiles/${selectedId}`)
      .then(({ participant }) => setProfiles({ ...emptyProfiles(schemas), ...(participant.profiles || {}) }))
      .catch((error) => notify(error.message, "error"))
      .finally(() => setLoading(false));
  }, [notify, schemas, selectedId]);

  useEffect(() => {
    if (!revisionSessionId) {
      setRevisionSession(null);
      setLastRevision(null);
      return;
    }
    api(`/api/sessions/${revisionSessionId}`)
      .then(({ session }) => setRevisionSession(session))
      .catch((error) => notify(error.message, "error"));
  }, [notify, revisionSessionId]);

  const update = (task, key, value) => setProfiles((current) => ({
    ...current,
    [task]: { ...current[task], [key]: value },
  }));

  const updateStudyIntent = (task, key, value) => setProfiles((current) => ({
    ...current,
    [task]: {
      ...current[task],
      studyIntent: { ...(current[task]?.studyIntent || {}), [key]: value },
    },
  }));

  const addCustomField = (task) => update(task, "customFields", [
    ...(profiles[task]?.customFields || []),
    { id: crypto.randomUUID(), label: "", value: "" },
  ]);

  const updateCustomField = (task, id, key, value) => update(task, "customFields", (profiles[task]?.customFields || []).map((field) => (
    field.id === id ? { ...field, [key]: value } : field
  )));

  const removeCustomField = (task, id) => update(task, "customFields", (profiles[task]?.customFields || []).filter((field) => field.id !== id));

  async function save() {
    setSaving(true);
    try {
      const result = await api(`/api/profiles/${selectedId}`, { method: "PUT", body: jsonBody({ profiles }) });
      setProfiles(result.participant.profiles);
      if (revisionSessionId) {
        const revisionResult = await api(`/api/sessions/${revisionSessionId}/config-revisions`, { method: "POST", body: jsonBody({}) });
        setLastRevision(revisionResult.revision);
        notify("配置已保存，并记录了相对于本次代理互动原始配置的差异");
      } else {
        notify("Agent 配置已保存");
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const title = useMemo(() => readOnly ? `查看受试者 ${selectedId || "—"} 的配置` : `${selectedId} 的 Agent 配置`, [readOnly, selectedId]);
  const visibleTasks = revisionSession ? [revisionSession.task] : TASK_KEYS;

  if (loading || !schemas) return <div className="screen-center"><div className="loader" />正在读取配置…</div>;

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div><h1>{title}</h1><p>{readOnly ? "管理员以只读方式检查参与者已保存的配置。固定问卷请在 Profile 结构页面管理。" : "这些资料将作为代理在三个任务中的授权上下文；代理形成的结果仍需你本人审核。"}</p></div>
        <div className="page-actions">
          {readOnly && <select className="select participant-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{participants.map((participant) => <option key={participant.id}>{participant.id}</option>)}</select>}
          {revisionSession ? <button className="button button-ghost" onClick={() => onNavigate("recaps", { selectedSessionId: revisionSession.id })}>返回Recap</button> : null}
          {!readOnly && <button className="button button-primary" onClick={save} disabled={saving}><Icon name="save" size={17} />{saving ? "保存中…" : revisionSession ? "保存并记录diff" : "保存配置"}</button>}
        </div>
      </div>

      {revisionSession ? (
        <div className="revision-mode-banner"><strong>配置回看模式</strong><span>你正在回看 {revisionSession.recordName} 使用的原始配置。保存后，系统会记录当前配置相对于会话快照的字段级差异。</span></div>
      ) : null}
      <RevisionResult revision={lastRevision} />

      {!selectedId ? <div className="empty-state">还没有参与者登录。</div> : (
        <div className="profile-form">
          {visibleTasks.map((task) => (
            <Section key={task} number={TASK_KEYS.indexOf(task) + 1} schema={schemas[task]}>
              <StudyIntentFields value={profiles[task]?.studyIntent} readOnly={readOnly} onChange={(key, value) => updateStudyIntent(task, key, value)} />
              <div className="form-grid three-columns">
                {schemas[task].fields.map((field) => (
                  <SchemaField key={field.key} field={field} value={profiles[task]?.[field.key]} readOnly={readOnly} onChange={(value) => update(task, field.key, value)} />
                ))}
              </div>
              <CustomProfileFields
                fields={profiles[task]?.customFields || []}
                readOnly={readOnly}
                onAdd={() => addCustomField(task)}
                onChange={(id, key, value) => updateCustomField(task, id, key, value)}
                onRemove={(id) => removeCustomField(task, id)}
              />
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
