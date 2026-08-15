import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import { ChoiceGrid, Field, TextArea, TextInput } from "../components/FormControls.jsx";
import { Icon } from "../components/Icons.jsx";

const TASK_KEYS = ["task1", "task2", "task3"];
const PROFILE_DRAFT_VERSION = 1;
const NOOP = () => {};
const formatRevisionDate = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

function profileDraftKey(participantId, revisionSessionId = "") {
  const scope = revisionSessionId ? `revision:${revisionSessionId}` : "base";
  return `proxylab_profile_draft_v${PROFILE_DRAFT_VERSION}:${participantId}:${scope}`;
}

function readProfileDraft(participantId, revisionSessionId = "") {
  try {
    const stored = localStorage.getItem(profileDraftKey(participantId, revisionSessionId))
      || (!revisionSessionId ? localStorage.getItem(`proxylab_profile_draft_v${PROFILE_DRAFT_VERSION}:${participantId}`) : null);
    const draft = JSON.parse(stored || "null");
    return draft?.profiles && typeof draft.profiles === "object" ? draft.profiles : null;
  } catch {
    return null;
  }
}

function writeProfileDraft(participantId, profiles, revisionSessionId = "") {
  try {
    localStorage.setItem(profileDraftKey(participantId, revisionSessionId), JSON.stringify({
      savedAt: new Date().toISOString(),
      profiles,
    }));
  } catch {
    // The form remains usable if private browsing or storage policy blocks drafts.
  }
}

function clearProfileDraft(participantId, revisionSessionId = "") {
  try {
    localStorage.removeItem(profileDraftKey(participantId, revisionSessionId));
    if (!revisionSessionId) localStorage.removeItem(`proxylab_profile_draft_v${PROFILE_DRAFT_VERSION}:${participantId}`);
  } catch { /* no-op */ }
}
const STUDY_INTENT_PLACEHOLDERS = {
  task1: {
    authorizationIntent: "例如：可以替我筛选和比较计划，但最终地点、费用与预订必须由我确认。",
    desiredUnderstanding: "例如：希望朋友理解我愿意参加活动，但比较在意安静环境和时间边界。",
  },
  task2: {
    authorizationIntent: "例如：可以初步判断是否值得认识，但不能替我交换联系方式、答应见面或确定关系。",
    desiredUnderstanding: "例如：希望对方理解我比较慢热，但愿意从共同兴趣开始逐步了解。",
  },
  task3: {
    authorizationIntent: "例如：可以在不少于3个额度的前提下协商，但补偿或未来承诺必须由我确认。",
    desiredUnderstanding: "例如：希望对方理解我的截止时间和最低需要，也知道我愿意讨论共同保留额度。",
  },
};

function emptyProfiles(schemas = {}) {
  return Object.fromEntries(TASK_KEYS.map((task) => [task, {
    ...Object.fromEntries((schemas[task]?.fields || []).map((field) => [field.key, field.type === "multiselect" ? [] : ""])),
    studyIntent: { authorizationIntent: "", desiredUnderstanding: "" },
    customFields: [],
  }]));
}

function Section({ number, schema, action, className = "", children }) {
  return (
    <section className={`profile-section ${className}`}>
      <div className="section-heading">
        <div><h2>Profile {number}：{schema.title}</h2><p>{schema.description}</p></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SchemaField({ field, value, readOnly, onChange }) {
  const common = { value: value ?? "", readOnly, placeholder: field.placeholder || "", onChange: (event) => onChange(event.target.value) };
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

function StudyIntentFields({ task, value = {}, readOnly, onChange }) {
  const placeholders = STUDY_INTENT_PLACEHOLDERS[task] || {};
  return (
    <div className="study-intent-card">
      <div><span className="eyebrow">授权意图记录</span><h3>在代理开始交流前，明确你希望它做什么，以及希望对方如何理解你。</h3></div>
      <div className="form-grid two-columns">
        <Field label="本次授权意图" hint="你希望代理实现什么；哪些决定仍必须留给你本人">
          <TextArea value={value.authorizationIntent || ""} placeholder={placeholders.authorizationIntent} onChange={(event) => onChange("authorizationIntent", event.target.value)} readOnly={readOnly} maxLength={5000} />
        </Field>
        <Field label="希望对方如何理解我" hint="经过代理交流后，你希望对方形成怎样的准确理解">
          <TextArea value={value.desiredUnderstanding || ""} placeholder={placeholders.desiredUnderstanding} onChange={(event) => onChange("desiredUnderstanding", event.target.value)} readOnly={readOnly} maxLength={5000} />
        </Field>
      </div>
    </div>
  );
}

function ProfileFields({ task, schema, profile, readOnly, onUpdate, onStudyIntentUpdate, onAddCustomField, onUpdateCustomField, onRemoveCustomField }) {
  return (
    <>
      <StudyIntentFields task={task} value={profile?.studyIntent} readOnly={readOnly} onChange={onStudyIntentUpdate} />
      <div className="form-grid three-columns">
        {schema.fields.map((field) => (
          <SchemaField key={field.key} field={field} value={profile?.[field.key]} readOnly={readOnly} onChange={(value) => onUpdate(field.key, value)} />
        ))}
      </div>
      <CustomProfileFields
        fields={profile?.customFields || []}
        readOnly={readOnly}
        onAdd={onAddCustomField}
        onChange={onUpdateCustomField}
        onRemove={onRemoveCustomField}
      />
    </>
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

function AdminRevisionHistory({ participantId, records, loading, schemas }) {
  return (
    <section className="admin-profile-revisions">
      <div className="admin-revisions-heading">
        <div><h2>Profile 前后修改记录</h2><p>以下记录来自参与者在真人讨论后保存的会话级修改副本；不会覆盖上方基础 Profile。</p></div>
        <span>{records.length} 次</span>
      </div>
      {loading ? <div className="screen-center compact"><div className="loader" />正在读取修改记录…</div> : null}
      {!loading && !records.length ? <div className="empty-state compact">{participantId} 暂无 Profile 修改记录。</div> : null}
      <div className="admin-revision-list">
        {records.map((record, index) => {
          const revision = record.revision || {};
          const task = record.task || revision.task;
          const schema = record.profileSchemaSnapshot?.fields ? record.profileSchemaSnapshot : schemas?.[task];
          if (!schema) return null;
          return (
            <details className="admin-revision-record" key={revision.id || `${record.sessionId}-${index}`} open={index === 0}>
              <summary>
                <div><strong>{record.recordName}</strong><span>{schema.title || task}</span></div>
                <div><small>{formatRevisionDate(revision.createdAt)}</small><em>{revision.noChanges ? "无修改" : `${revision.diff?.length || 0} 项修改`}</em></div>
              </summary>
              <div className="admin-revision-body">
                {revision.diff?.length ? (
                  <div className="revision-result"><strong>发生变化的字段</strong>{revision.diff.map((item) => <span key={item.path}>{item.label || item.path}</span>)}</div>
                ) : <div className="revision-result"><strong>参与者保留了原配置，没有修改字段。</strong></div>}
                <div className="profile-comparison-grid editing">
                  <div className="profile-version-panel profile-version-original">
                    <div className="profile-version-heading"><span>原配置</span><small>该次代理互动实际使用</small></div>
                    <ProfileFields task={task} schema={schema} profile={revision.originalProfile || {}} readOnly onUpdate={NOOP} onStudyIntentUpdate={NOOP} onAddCustomField={NOOP} onUpdateCustomField={NOOP} onRemoveCustomField={NOOP} />
                  </div>
                  <div className="profile-version-panel profile-version-revised">
                    <div className="profile-version-heading"><span>修改后</span><small>真人讨论后保存的副本</small></div>
                    <ProfileFields task={task} schema={schema} profile={revision.revisedProfile || {}} readOnly onUpdate={NOOP} onStudyIntentUpdate={NOOP} onAddCustomField={NOOP} onUpdateCustomField={NOOP} onRemoveCustomField={NOOP} />
                  </div>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

export default function AgentConfigPage({ user, notify }) {
  const [participants, setParticipants] = useState([]);
  const [selectedId, setSelectedId] = useState(user.role === "participant" ? user.id : "");
  const [schemas, setSchemas] = useState(null);
  const [profiles, setProfiles] = useState(emptyProfiles());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [revisionSession, setRevisionSession] = useState(null);
  const [lastRevision, setLastRevision] = useState(null);
  const [revisionPassword, setRevisionPassword] = useState("");
  const [revisionUnlocked, setRevisionUnlocked] = useState(false);
  const [revisionEnabled, setRevisionEnabled] = useState({});
  const [unlocking, setUnlocking] = useState(false);
  const [revisionSessionId, setRevisionSessionId] = useState(null);
  const [adminRevisions, setAdminRevisions] = useState([]);
  const [adminRevisionsLoading, setAdminRevisionsLoading] = useState(false);
  const readOnly = user.role === "admin";

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
      .then(({ participant }) => {
        const savedProfiles = { ...emptyProfiles(schemas), ...(participant.profiles || {}) };
        const draft = readOnly || revisionSessionId ? null : readProfileDraft(selectedId);
        setProfiles(draft ? { ...savedProfiles, ...draft } : savedProfiles);
        setDraftDirty(Boolean(draft));
      })
      .catch((error) => notify(error.message, "error"))
      .finally(() => setLoading(false));
  }, [notify, readOnly, schemas, selectedId]);

  useEffect(() => {
    if (!readOnly || !selectedId) {
      setAdminRevisions([]);
      setAdminRevisionsLoading(false);
      return;
    }
    let active = true;
    setAdminRevisionsLoading(true);
    api(`/api/profile-revisions?participantId=${encodeURIComponent(selectedId)}`)
      .then(({ revisions }) => { if (active) setAdminRevisions(revisions || []); })
      .catch((error) => { if (active) notify(error.message, "error"); })
      .finally(() => { if (active) setAdminRevisionsLoading(false); });
    return () => { active = false; };
  }, [notify, readOnly, selectedId]);

  useEffect(() => {
    if (!readOnly && selectedId && draftDirty) writeProfileDraft(selectedId, profiles, revisionSessionId || "");
  }, [draftDirty, profiles, readOnly, revisionSessionId, selectedId]);

  useEffect(() => {
    if (!revisionSessionId) {
      setRevisionSession(null);
      setLastRevision(null);
      setRevisionUnlocked(false);
      setRevisionPassword("");
      setRevisionEnabled({});
      return;
    }
    api(`/api/sessions/${revisionSessionId}`)
      .then(({ session }) => {
        setRevisionSession(session);
        const latest = session.configurationRevisions?.[user.id]?.at(-1) || null;
        const original = session.profileSnapshot?.[user.id] || {};
        const draft = readProfileDraft(user.id, revisionSessionId);
        const revised = draft?.[session.task] || latest?.revisedProfile || original;
        setProfiles((current) => ({ ...current, [session.task]: revised }));
        setDraftDirty(Boolean(draft));
        setLastRevision(latest);
      })
      .catch((error) => notify(error.message, "error"));
  }, [notify, revisionSessionId, user.id]);

  async function unlockRevision() {
    if (!revisionPassword || user.role !== "participant") return;
    setUnlocking(true);
    try {
      let targetSessionId = revisionSessionId;
      if (!targetSessionId) {
        const { sessions } = await api("/api/sessions");
        const target = sessions.find((session) => (
          session.status === "completed"
          && session.recaps?.[user.id]?.status === "ready"
        ));
        if (!target) throw new Error("暂无可回看的已完成任务");
        targetSessionId = target.id;
      }
      await api(`/api/sessions/${targetSessionId}/reconfiguration-access`, {
        method: "POST",
        body: jsonBody({ password: revisionPassword }),
      });
      setRevisionSessionId(targetSessionId);
      setRevisionUnlocked(true);
      notify("再配置已解锁；使用卡片右侧开关开始对照修改");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setUnlocking(false);
    }
  }

  const update = (task, key, valueOrUpdater) => {
    setDraftDirty(true);
    setProfiles((current) => ({
      ...current,
      [task]: {
        ...current[task],
        [key]: typeof valueOrUpdater === "function" ? valueOrUpdater(current[task]?.[key]) : valueOrUpdater,
      },
    }));
  };

  const updateStudyIntent = (task, key, value) => {
    setDraftDirty(true);
    setProfiles((current) => ({
      ...current,
      [task]: {
        ...current[task],
        studyIntent: { ...(current[task]?.studyIntent || {}), [key]: value },
      },
    }));
  };

  const addCustomField = (task) => update(task, "customFields", (fields = []) => [
    ...fields,
    { id: crypto.randomUUID(), label: "", value: "" },
  ]);

  const updateCustomField = (task, id, key, value) => update(task, "customFields", (fields = []) => fields.map((field) => (
    field.id === id ? { ...field, [key]: value } : field
  )));

  const removeCustomField = (task, id) => update(task, "customFields", (fields = []) => fields.filter((field) => field.id !== id));

  async function save() {
    setSaving(true);
    try {
      if (revisionSessionId) {
        if (!revisionUnlocked) throw new Error("请先输入再配置密码");
        const revisionResult = await api(`/api/sessions/${revisionSessionId}/config-revisions`, {
          method: "POST",
          body: jsonBody({ password: revisionPassword, revisedProfile: profiles[revisionSession.task] }),
        });
        setLastRevision(revisionResult.revision);
        clearProfileDraft(selectedId, revisionSessionId);
        setDraftDirty(false);
        notify("修改副本已保存；本次会话的原配置保持不变");
      } else {
        const result = await api(`/api/profiles/${selectedId}`, { method: "PUT", body: jsonBody({ profiles }) });
        setProfiles(result.participant.profiles);
        clearProfileDraft(selectedId);
        setDraftDirty(false);
        notify("Agent 配置已保存");
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const title = useMemo(() => readOnly ? `查看受试者 ${selectedId || "—"} 的配置` : `${selectedId} 的 Agent 配置`, [readOnly, selectedId]);
  const visibleTasks = revisionSession ? [revisionSession.task] : revisionSessionId ? [] : TASK_KEYS;
  const effectiveSchemas = revisionSession
    ? { ...(schemas || {}), [revisionSession.task]: revisionSession.profileSchemaSnapshot || schemas?.[revisionSession.task] }
    : schemas;

  if (loading || !schemas) return <div className="screen-center"><div className="loader" />正在读取配置…</div>;

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div><h1>{title}</h1><p>{readOnly ? "管理员以只读方式检查参与者已保存的配置。固定问卷请在 Profile 结构页面管理。" : "这些资料将作为代理在三个任务中的授权上下文；代理形成的结果仍需你本人审核。"}</p></div>
        <div className="page-actions">
          {readOnly && <select className="select participant-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{participants.map((participant) => <option key={participant.id}>{participant.id}</option>)}</select>}
          {!readOnly ? (
            <form className="revision-quick-unlock" onSubmit={(event) => { event.preventDefault(); unlockRevision(); }}>
              <button type="submit" className={`button ${revisionUnlocked ? "button-success" : "button-secondary"}`} disabled={revisionUnlocked || unlocking || !revisionPassword}>
                {revisionUnlocked ? "已解锁" : unlocking ? "验证中…" : "解锁回看"}
              </button>
              <TextInput
                type="text"
                value={revisionPassword}
                onChange={(event) => setRevisionPassword(event.target.value)}
                placeholder="输入 reentry"
                aria-label="再配置密码"
                disabled={revisionUnlocked}
              />
              <small>{revisionSession ? revisionSession.recordName : "真人讨论后由实验员开放"}</small>
            </form>
          ) : null}
        </div>
      </div>

      <RevisionResult revision={lastRevision} />

      {revisionSessionId && !revisionSession ? <div className="screen-center"><div className="loader" />正在准备配置对照…</div> : null}
      {!selectedId ? <div className="empty-state">还没有参与者登录。</div> : (
        <div className="profile-form">
          {visibleTasks.map((task) => (
            <Section
              key={task}
              number={TASK_KEYS.indexOf(task) + 1}
              schema={effectiveSchemas[task]}
              className={revisionSession ? "profile-section-revision" : ""}
              action={revisionSession && revisionUnlocked ? (
                <label className="revision-slide-toggle">
                  <span>{revisionEnabled[task] ? "正在对照修改" : "开启对照修改"}</span>
                  <input type="checkbox" role="switch" checked={Boolean(revisionEnabled[task])} onChange={(event) => setRevisionEnabled((current) => ({ ...current, [task]: event.target.checked }))} />
                  <i aria-hidden="true" />
                </label>
              ) : null}
            >
              {revisionSession ? (
                <div className={`profile-comparison-grid ${revisionEnabled[task] ? "editing" : "locked"}`}>
                  <div className="profile-version-panel profile-version-original">
                    <div className="profile-version-heading"><span>原配置</span><small>本次代理互动实际使用 · 只读</small></div>
                    <ProfileFields
                      task={task}
                      schema={effectiveSchemas[task]}
                      profile={revisionSession.profileSnapshot?.[user.id] || {}}
                      readOnly
                      onUpdate={() => {}}
                      onStudyIntentUpdate={() => {}}
                      onAddCustomField={() => {}}
                      onUpdateCustomField={() => {}}
                      onRemoveCustomField={() => {}}
                    />
                  </div>
                  {revisionEnabled[task] ? (
                    <div className="profile-version-panel profile-version-revised">
                      <div className="profile-version-heading"><span>修改副本</span><small>只记录变化，不覆盖原配置</small></div>
                      <ProfileFields
                        task={task}
                        schema={effectiveSchemas[task]}
                        profile={profiles[task]}
                        readOnly={readOnly}
                        onUpdate={(key, value) => update(task, key, value)}
                        onStudyIntentUpdate={(key, value) => updateStudyIntent(task, key, value)}
                        onAddCustomField={() => addCustomField(task)}
                        onUpdateCustomField={(id, key, value) => updateCustomField(task, id, key, value)}
                        onRemoveCustomField={(id) => removeCustomField(task, id)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <ProfileFields
                  task={task}
                  schema={effectiveSchemas[task]}
                  profile={profiles[task]}
                  readOnly={readOnly}
                  onUpdate={(key, value) => update(task, key, value)}
                  onStudyIntentUpdate={(key, value) => updateStudyIntent(task, key, value)}
                  onAddCustomField={() => addCustomField(task)}
                  onUpdateCustomField={(id, key, value) => updateCustomField(task, id, key, value)}
                  onRemoveCustomField={(id) => removeCustomField(task, id)}
                />
              )}
            </Section>
          ))}
        </div>
      )}
      {readOnly && selectedId ? <AdminRevisionHistory participantId={selectedId} records={adminRevisions} loading={adminRevisionsLoading} schemas={schemas} /> : null}
      {!readOnly && selectedId && (!revisionSessionId || (revisionSession && revisionUnlocked)) ? (
        <div className="profile-save-footer">
          <div className="profile-draft-status" aria-live="polite">
            <Icon name={draftDirty ? "clock" : "check"} size={17} />
            <span>{draftDirty ? "未保存内容已暂存于当前浏览器；切换页面后仍可继续填写。" : "当前配置已保存。"}</span>
          </div>
          <button className="button button-primary" onClick={save} disabled={saving}>
            <Icon name="save" size={17} />
            {saving ? "保存中…" : revisionSession ? "保存修改副本与 diff" : "保存配置"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
