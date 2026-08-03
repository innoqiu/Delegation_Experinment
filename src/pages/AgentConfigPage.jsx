import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "../api.js";
import { ChoiceGrid, Field, TextArea, TextInput } from "../components/FormControls.jsx";
import { Icon } from "../components/Icons.jsx";

const EMPTY = {
  task1: { interests: "", locations: "", availability: "", boundaries: "", flexibility: "", approvalRequirements: "", customFields: [] },
  task2: { connectionTypes: [], interests: "", socialPace: "", availability: "", needs: "", personality: "", firstMeetingConditions: "", disclosureAllowed: "", disclosureRestricted: "", relationshipBoundaries: "", approvalRequirements: "", customFields: [] },
  task3: { customFields: [] },
};

const CONNECTIONS = [
  { value: "friendship", label: "友谊" },
  { value: "romance", label: "浪漫关系" },
  { value: "mentor", label: "导师关系" },
  { value: "collaboration", label: "合作关系" },
  { value: "open", label: "保持开放" },
];

function Section({ number, title, description, children, muted = false }) {
  return (
    <section className={`profile-section ${muted ? "muted" : ""}`}>
      <div className="section-heading">
        <div><h2>Profile {number}：{title}</h2><p>{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function CustomProfileFields({ fields, readOnly, onAdd, onChange, onRemove }) {
  return (
    <div className="custom-profile-fields">
      <div className="custom-fields-heading">
        <div>
          <h3>自定义实验条件</h3>
          <p>添加本问卷尚未覆盖的授权、偏好或边界；有内容的条目会自动加入该Task的代理提示词。</p>
        </div>
        {!readOnly && <button type="button" className="button button-secondary button-small" onClick={onAdd} disabled={fields.length >= 20} title={fields.length >= 20 ? "每个Profile最多添加20项" : "添加自定义输入项"}><Icon name="plus" size={16} />添加输入项</button>}
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
              {!readOnly && <button type="button" className="icon-button custom-field-delete" aria-label={`删除自定义条件 ${index + 1}`} title="删除此输入项" onClick={() => onRemove(field.id)}><Icon name="trash" size={17} /></button>}
            </div>
          ))}
        </div>
      ) : <div className="custom-fields-empty">尚未添加自定义条件。</div>}
    </div>
  );
}

export default function AgentConfigPage({ user, notify }) {
  const [participants, setParticipants] = useState([]);
  const [selectedId, setSelectedId] = useState(user.role === "participant" ? user.id : "");
  const [profiles, setProfiles] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const readOnly = user.role === "admin";

  useEffect(() => {
    if (user.role !== "admin") return;
    api("/api/participants").then(({ participants: list }) => {
      setParticipants(list);
      setSelectedId((current) => current || list[0]?.id || "");
    });
  }, [user.role]);

  useEffect(() => {
    if (!selectedId) { setLoading(false); return; }
    setLoading(true);
    api(`/api/profiles/${selectedId}`)
      .then(({ participant }) => setProfiles(participant.profiles || EMPTY))
      .catch((error) => notify(error.message, "error"))
      .finally(() => setLoading(false));
  }, [notify, selectedId]);

  const update = (task, key, value) => {
    setProfiles((current) => ({ ...current, [task]: { ...current[task], [key]: value } }));
  };

  const addCustomField = (task) => {
    setProfiles((current) => ({
      ...current,
      [task]: {
        ...current[task],
        customFields: [...(current[task]?.customFields || []), { id: crypto.randomUUID(), label: "", value: "" }],
      },
    }));
  };

  const updateCustomField = (task, id, key, value) => {
    setProfiles((current) => ({
      ...current,
      [task]: {
        ...current[task],
        customFields: (current[task]?.customFields || []).map((field) => field.id === id ? { ...field, [key]: value } : field),
      },
    }));
  };

  const removeCustomField = (task, id) => {
    setProfiles((current) => ({
      ...current,
      [task]: {
        ...current[task],
        customFields: (current[task]?.customFields || []).filter((field) => field.id !== id),
      },
    }));
  };

  async function save() {
    setSaving(true);
    try {
      const result = await api(`/api/profiles/${selectedId}`, {
        method: "PUT",
        body: jsonBody({ profiles }),
      });
      setProfiles(result.participant.profiles);
      notify("Agent配置已保存");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const title = useMemo(
    () => readOnly ? `查看受试者 ${selectedId || "—"} 的配置` : `${selectedId} 的Agent配置`,
    [readOnly, selectedId],
  );

  if (loading) return <div className="screen-center"><div className="loader" />正在读取配置…</div>;

  return (
    <div className="page-stack">
      <div className="page-heading-row">
        <div><h1>{title}</h1><p>{readOnly ? "管理员以只读方式检查已登录参与者的配置。" : "这些资料将作为你的代理在不同任务中的授权上下文。"}</p></div>
        <div className="page-actions">
          {readOnly && (
            <select className="select participant-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {participants.map((participant) => <option key={participant.id}>{participant.id}</option>)}
            </select>
          )}
          {!readOnly && <button className="button button-primary" onClick={save} disabled={saving}><Icon name="save" size={17} />{saving ? "保存中…" : "保存配置"}</button>}
        </div>
      </div>

      {!selectedId ? <div className="empty-state">还没有参与者登录。</div> : (
        <div className="profile-form">
          <Section number="1" title="社交计划" description="描述你愿意参与怎样的社交活动，以及代理必须遵守的时间、地点与边界。">
            <div className="form-grid three-columns">
              <Field label="兴趣与活动偏好" hint="例如展览、运动、桌游、散步">
                <TextArea value={profiles.task1.interests} onChange={(e) => update("task1", "interests", e.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="地点偏好" hint="可接受区域、交通或场地要求">
                <TextArea value={profiles.task1.locations} onChange={(e) => update("task1", "locations", e.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="可用时间" hint="具体日期、时间段及持续时间">
                <TextArea value={profiles.task1.availability} onChange={(e) => update("task1", "availability", e.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="边界与不可接受项" hint="代理不得越过的活动、地点、话题或条件">
                <TextArea value={profiles.task1.boundaries} onChange={(e) => update("task1", "boundaries", e.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="可协商范围" hint="哪些条件可以让步，优先顺序是什么">
                <TextArea value={profiles.task1.flexibility} onChange={(e) => update("task1", "flexibility", e.target.value)} readOnly={readOnly} />
              </Field>
              <Field label="需要本人批准的事项" hint="例如最终时间、预订、费用或出席承诺">
                <TextArea value={profiles.task1.approvalRequirements} onChange={(e) => update("task1", "approvalRequirements", e.target.value)} readOnly={readOnly} />
              </Field>
            </div>
            <CustomProfileFields
              fields={profiles.task1.customFields || []}
              readOnly={readOnly}
              onAdd={() => addCustomField("task1")}
              onChange={(id, key, value) => updateCustomField("task1", id, key, value)}
              onRemove={(id) => removeCustomField("task1", id)}
            />
          </Section>

          <Section number="2" title="新关系介绍" description="定义你希望探索的关系、选择性披露范围，以及第一次直接互动的条件。">
            <Field label="愿意探索的关系路径">
              <ChoiceGrid options={CONNECTIONS} values={profiles.task2.connectionTypes} onChange={(value) => update("task2", "connectionTypes", value)} disabled={readOnly} />
            </Field>
            <div className="form-grid three-columns">
              <Field label="兴趣与匹配方向"><TextArea value={profiles.task2.interests} onChange={(e) => update("task2", "interests", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="社交节奏"><TextArea value={profiles.task2.socialPace} onChange={(e) => update("task2", "socialPace", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="时间与可用性"><TextArea value={profiles.task2.availability} onChange={(e) => update("task2", "availability", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="希望从关系中获得什么"><TextArea value={profiles.task2.needs} onChange={(e) => update("task2", "needs", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="如何描述自己"><TextArea value={profiles.task2.personality} onChange={(e) => update("task2", "personality", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="第一次见面的条件"><TextArea value={profiles.task2.firstMeetingConditions} onChange={(e) => update("task2", "firstMeetingConditions", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="允许代理披露的信息"><TextArea value={profiles.task2.disclosureAllowed} onChange={(e) => update("task2", "disclosureAllowed", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="限制披露的信息"><TextArea value={profiles.task2.disclosureRestricted} onChange={(e) => update("task2", "disclosureRestricted", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="关系边界"><TextArea value={profiles.task2.relationshipBoundaries} onChange={(e) => update("task2", "relationshipBoundaries", e.target.value)} readOnly={readOnly} /></Field>
              <Field label="需要本人批准的事项" className="span-two"><TextInput value={profiles.task2.approvalRequirements} onChange={(e) => update("task2", "approvalRequirements", e.target.value)} readOnly={readOnly} /></Field>
            </div>
            <CustomProfileFields
              fields={profiles.task2.customFields || []}
              readOnly={readOnly}
              onAdd={() => addCustomField("task2")}
              onChange={(id, key, value) => updateCustomField("task2", id, key, value)}
              onRemove={(id) => removeCustomField("task2", id)}
            />
          </Section>

          <Section number="3" title="尚未启用" description="Profile 3将在研究设计确定后开放配置。" muted>
            <div className="disabled-profile"><span>任务定义与问卷结构待补充</span></div>
          </Section>
        </div>
      )}
    </div>
  );
}
