import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPLETION = "我认为任务已完成申请结束";
const dataDir = mkdtempSync(join(tmpdir(), "proxylab-smoke-"));
const receivedSystemPrompts = [];
let task2AuditCalls = 0;

function listenAt(server, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const handleError = (error) => rejectPromise(error);
    server.once("error", handleError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", handleError);
      resolvePromise(server.address().port);
    });
  });
}

async function listen(server) {
  // WHATWG fetch blocks a small set of legacy ports. Keeping test servers in
  // a high range prevents a random OS-assigned port from causing a false fail.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 42_000 + Math.floor(Math.random() * 20_000);
    try {
      return await listenAt(server, port);
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("Could not find an available safe port for the smoke test");
}

function close(server) {
  return new Promise((resolvePromise) => server.close(resolvePromise));
}

const mock = createServer(async (req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
  }
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer test") {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "missing test authorization" } }));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const system = body.messages?.[0]?.content || "";
    receivedSystemPrompts.push(system);
    const isClosureAudit = system.includes("不可见的第二阶段结束审核器");
    const isTask4 = system.includes("中立的集中式协商助手");
    const isTask2Audit = isClosureAudit && body.messages?.[1]?.content?.includes("新关系介绍代理");
    if (isTask2Audit) task2AuditCalls += 1;
    const recapPayload = body.messages?.[1]?.content?.includes("任务：共享资源分配")
      ? {
          headline: "6比4资源分配候选",
          summary: "份额已对齐，未来补偿仍待确认。",
          outcomeStatus: "ready_for_review",
          sections: {
            allocation: [{ label: "分配", value: "P1A 6份，P1B 4份，保留0份", status: "agreed", evidence: "双方代理第2轮" }],
            conditions: [{ label: "补偿", value: "下轮优先权尚未确定", status: "unresolved", evidence: "P1B_T3_2" }],
            actions: [{ label: "补偿条件", value: "决定是否接受下轮优先权", status: "needs_decision", evidence: "协商结果" }],
          },
        }
      : body.messages?.[1]?.content?.includes("任务：新关系介绍")
        ? {
            headline: "可有限探索合作关系",
            summary: "目的基本一致；互动节奏仍需核实。",
            outcomeStatus: "partial",
            sections: {
              recommendation: [{ label: "路径", value: "先进行一次有限的合作交流", status: "proposed", evidence: "双方代理第2轮" }],
              mismatch: [{ label: "节奏", value: "一方偏好低频互动，另一方尚未回应", status: "unresolved", evidence: "P1A_T2_2" }],
              change_conditions: [{ label: "新信息", value: "对方对低频互动的接受程度", status: "needs_decision", evidence: "未决" }],
            },
          }
        : {
            headline: "周六下午静安社交计划",
            summary: "时间与预算已对齐；具体场地待确认。",
            outcomeStatus: "ready_for_review",
            sections: {
              candidate: [
                { label: "时间", value: "周六14:30–17:30", status: "agreed", evidence: "双方代理第1轮" },
                { label: "通用声明", value: "该方案尚未生效，最终仍由本人决定", status: "proposed", evidence: "" },
              ],
              open_items: [{ label: "具体场地", value: "展馆和咖啡馆待确认", status: "unresolved", evidence: "双方代理第1轮" }],
              actions: [{ label: "场地", value: "补充或选择具体展馆与咖啡馆", status: "needs_decision", evidence: "候选方案" }],
            },
          };
    const task4Payload = {
      headline: "三个任务的直接对齐建议",
      summary: "社交计划可形成候选；关系路径与资源条件仍需双方确认。",
      outcomeStatus: "partial",
      sections: {
        task1_alignment: [{ label: "候选计划", value: "周六下午选择安静且地铁可达的展览与咖啡馆组合", status: "proposed", evidence: "双方Profile 1" }],
        task2_alignment: [{ label: "建议路径", value: "可先探索一次有明确主题的友谊或合作交流", status: "proposed", evidence: "双方Profile 2" }],
        task3_alignment: [{ label: "临时分配", value: "P1A 5份，P1B 5份，共同保留0份", status: "proposed", evidence: "双方Profile 3" }],
        cross_task_limits: [{ label: "授权限制", value: "所有具体行动与新增义务仍需双方分别确认", status: "boundary", evidence: "审批要求" }],
        actions: [{ label: "双方确认", value: "确认三个任务的候选结果是否符合各自边界", status: "needs_decision", evidence: "集中式匹配" }],
      },
    };
    const content = isClosureAudit
      ? isTask2Audit && task2AuditCalls <= 2
        ? "CONTINUE: 仍需核对关系目的、互动节奏与可能改变建议的新信息"
        : "READY_TO_CLOSE"
      : isTask4
        ? JSON.stringify(task4Payload)
      : system.includes("recap生成器")
        ? JSON.stringify(recapPayload)
        : `我建议选择双方时间与边界均可接受的候选方案。\n${COMPLETION}`;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }
  res.writeHead(404).end();
});

const mockPort = await listen(mock);
process.env.DATA_DIR = dataDir;
process.env.ADMIN_ACCESS_CODE = "test-admin-code";
process.env.PROFILE_REVISION_PASSWORD = "test-revision";
const { createAppServer } = await import(`../server.mjs?smoke=${Date.now()}`);
const appServer = createAppServer();
const appPort = await listen(appServer);
const base = `http://127.0.0.1:${appPort}`;

async function request(path, { token, method = "GET", body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

function readStoredZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    assert.equal(method, 0, "test parser expects uncompressed ZIP entries");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, buffer.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

async function login(id) {
  const result = await request("/api/login", {
    method: "POST",
    body: { id },
  });
  if (!result.requiresConsent) return result;
  return request("/api/consent", {
    method: "POST",
    body: {
      id: result.participantId,
      responses: { adult: true, information: true, voluntary: true, dataUse: true, participate: true },
    },
  });
}

async function waitForSession(id, token) {
  let session;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    ({ session } = await request(`/api/sessions/${id}`, { token }));
    if (["completed", "completed_with_errors", "failed"].includes(session.status)) return session;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Session ${id} did not finish in time`);
}

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { await request("/api/health"); break; }
    catch { await new Promise((resolvePromise) => setTimeout(resolvePromise, 100)); }
  }

  const consentInfo = await request("/api/consent-info");
  assert.equal(consentInfo.consentInfo.ethicsNumber, "HKUST(GZ)-HSP-2026-0135");
  assert.equal(consentInfo.consentInfo.responsibleResearcher, "TONG XIN");
  const flexibleIdLogin = await request("/api/login", { method: "POST", body: { id: "p1-huanyi" } });
  assert.equal(flexibleIdLogin.requiresConsent, true);
  assert.equal(flexibleIdLogin.participantId, "P1-HUANYI");
  const shortIdLogin = await request("/api/login", { method: "POST", body: { id: "q3" } });
  assert.equal(shortIdLogin.participantId, "Q3");
  await request("/api/login", { method: "POST", body: { id: "Q 3" }, expected: 400 });
  await request("/api/login", { method: "POST", body: { id: "Q3-" }, expected: 400 });
  const firstLogin = await request("/api/login", { method: "POST", body: { id: "p1a" } });
  assert.equal(firstLogin.requiresConsent, true);
  assert.equal(firstLogin.token, undefined);
  await request("/api/consent", {
    method: "POST",
    expected: 400,
    body: { id: "P1A", responses: { adult: true, information: true, voluntary: true, dataUse: false, participate: true } },
  });
  const p1a = await login("p1a");
  const p1b = await login("P1B");
  await request("/api/login", { method: "POST", body: { id: "admin" }, expected: 403 });
  const admin = await login("admin_arklab");
  assert.equal(p1a.user.id, "P1A");
  assert.equal(p1a.user.role, "participant");
  assert.equal(admin.user.id, "admin");
  assert.equal(admin.user.role, "admin");

  const participantSchemas = await request("/api/profile-schemas", { token: p1a.token });
  assert.equal(participantSchemas.profileSchemas.task3.title, "共享支持额度协商");
  assert.equal(participantSchemas.profileSchemas.task3.fields.some(({ key }) => key === "minimumShare"), true);
  assert.equal(participantSchemas.profileSchemas.task2.fields.some(({ key }) => key === "disclosureAllowed"), false);
  assert.equal(participantSchemas.profileSchemas.task2.fields.some(({ key }) => key === "disclosureRestricted"), false);
  assert.match(participantSchemas.profileSchemas.task1.fields.find(({ key }) => key === "interests").placeholder, /当代艺术展/);
  await request("/api/profile-schemas", { token: p1a.token, method: "PUT", body: participantSchemas, expected: 403 });
  participantSchemas.profileSchemas.task3.fields.push({ key: "testCondition", label: "实验附加条件", hint: "用于验证动态固定问题", placeholder: "例如：保留一份供共同使用", type: "textarea", wide: true });
  const updatedSchemas = await request("/api/profile-schemas", { token: admin.token, method: "PUT", body: participantSchemas });
  assert.equal(updatedSchemas.profileSchemas.task3.fields.at(-1).key, "testCondition");
  assert.equal(updatedSchemas.profileSchemas.task3.fields.at(-1).placeholder, "例如：保留一份供共同使用");

  const seededParticipants = await request("/api/participants", { token: admin.token });
  assert.equal(seededParticipants.participants.some(({ id }) => id === "P0A"), true);
  assert.equal(seededParticipants.participants.some(({ id }) => id === "P0B"), true);
  assert.equal(seededParticipants.participants.find(({ id }) => id === "P0A").consentStatus, "legacy_existing");
  assert.equal(seededParticipants.participants.find(({ id }) => id === "P1A").consentStatus, "accepted");
  const dummyProfile = await request("/api/profiles/P0A", { token: admin.token });
  assert.equal(dummyProfile.participant.isDummy, true);
  assert.notEqual(dummyProfile.participant.profiles.task1.interests, "");
  assert.notEqual(dummyProfile.participant.profiles.task2.needs, "");
  assert.notEqual(dummyProfile.participant.profiles.task3.resourceUse, "");

  const ownProfile = await request("/api/profiles/P1A", { token: p1a.token });
  ownProfile.participant.profiles.task1.studyIntent.authorizationIntent = "可以筛选候选方案，但不能替我作最终承诺";
  ownProfile.participant.profiles.task1.studyIntent.desiredUnderstanding = "希望被理解为重视边界且愿意协商的人";
  ownProfile.participant.profiles.task1.interests = "展览与散步";
  ownProfile.participant.profiles.task1.customFields = [{ id: "accessibility", label: "无障碍需求", value: "场地必须提供电梯" }];
  ownProfile.participant.profiles.task3.resourceUse = "用于完成访谈分析";
  ownProfile.participant.profiles.task3.preferredShare = 7;
  ownProfile.participant.profiles.task3.minimumShare = 3;
  ownProfile.participant.profiles.task3.fairnessPrinciples = ["need", "urgency"];
  ownProfile.participant.profiles.task3.testCondition = "仅接受待本人批准的方案";
  await request("/api/profiles/P1A", { token: p1a.token, method: "PUT", body: { profiles: ownProfile.participant.profiles } });
  const savedProfile = await request("/api/profiles/P1A", { token: p1a.token });
  assert.deepEqual(savedProfile.participant.profiles.task1.customFields, [{ id: "accessibility", label: "无障碍需求", value: "场地必须提供电梯" }]);
  await request("/api/profiles/P1B", { token: p1a.token, expected: 403 });

  const modelResult = await request("/api/model-config", { token: admin.token });
  assert.equal(modelResult.modelConfig.tasks.task3.enabled, true);
  assert.equal(modelResult.modelConfig.tasks.task3.systemPrompt.includes("固定的10个共享支持额度"), true);
  assert.equal(modelResult.modelConfig.tasks.task3.recapPrompt.includes("当前分配数字"), true);
  assert.equal(modelResult.modelConfig.tasks.task2.systemPrompt.includes("提出至少一个能够区分不同关系路径的问题"), true);
  assert.equal(modelResult.modelConfig.tasks.task2.systemPrompt.includes("什么新信息可能改变当前建议"), true);
  assert.equal(modelResult.modelConfig.tasks.task2.recapPrompt.includes("区分关系路径的关键试探"), true);
  assert.equal(modelResult.modelConfig.tasks.task2.recapPrompt.includes("可能改变建议的新信息"), true);
  assert.equal(modelResult.modelConfig.tasks.task4.enabled, true);
  assert.equal(modelResult.modelConfig.tasks.task4.systemPrompt.includes("不代表任何一位参与者"), true);
  assert.equal(modelResult.modelConfig.tasks.task4.recapPrompt.includes("依次覆盖社交计划、新关系介绍和共享资源分配"), true);
  modelResult.modelConfig.agent1 = { baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "test", model: "mock-model", temperature: 0 };
  modelResult.modelConfig.agent2 = { baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "test", model: "mock-model", temperature: 0 };
  await request("/api/model-config", { token: admin.token, method: "PUT", body: modelResult });
  const tested = await request("/api/model-test/agent1", { token: admin.token, method: "POST", body: { config: modelResult.modelConfig.agent1 } });
  assert.deepEqual(tested.models, ["mock-model"]);

  const created = await request("/api/sessions", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { participantA: "P1A", participantB: "P1B", task: "task1" },
  });
  const sessionId = created.session.id;
  const session = await waitForSession(sessionId, admin.token);
  assert.equal(session.status, "completed", session.error || "session should complete");
  assert.equal(session.transcript.length, 2);
  assert.equal(session.transcript[0].messageId, "P1A_T1_1");
  assert.equal(session.transcript[1].messageId, "P1B_T1_1");
  assert.equal(session.transcript.some(({ text }) => text.includes(COMPLETION)), false);
  assert.equal(session.termination.reason, "mutual_private_audit");
  assert.equal(session.closureAudits.length, 1);
  assert.equal(session.closureAudits[0].results.every(({ ready }) => ready), true);
  assert.equal(Object.keys(session.recaps).length, 2);
  assert.deepEqual(session.recaps.P1A.structured.sections.map(({ id, title }) => [id, title]), session.recaps.P1B.structured.sections.map(({ id, title }) => [id, title]));
  assert.equal(session.recaps.P1A.structured.sections.find(({ id }) => id === "candidate").items.length, 1);
  assert.equal(session.recaps.P1A.content.includes("尚未生效"), false);
  assert.equal(session.recaps.P1A.content.length < 800, true);
  assert.equal(session.modelSnapshot.agent1.apiKey, undefined);
  assert.equal(session.modelSnapshot.agent1.hasApiKey, true);
  assert.equal(session.profileSnapshot.P1A.customFields[0].label, "无障碍需求");
  assert.equal(session.profileSnapshot.P1A.studyIntent.authorizationIntent.includes("最终承诺"), true);
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes('"condition": "无障碍需求"') && prompt.includes('"details": "场地必须提供电梯"')), true);
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes('"authorizationIntent"') && prompt.includes("不能替我作最终承诺")), true);
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes("不可见的第二阶段结束审核器")), true);

  const participantView = await request(`/api/sessions/${sessionId}`, { token: p1a.token });
  assert.deepEqual(Object.keys(participantView.session.recaps), ["P1A"]);
  assert.equal(participantView.session.modelSnapshot, undefined);
  assert.equal(participantView.session.readiness, undefined);
  assert.equal(participantView.session.closureAudits, undefined);
  assert.deepEqual(Object.keys(participantView.session.profileSnapshot), ["P1A"]);
  assert.equal(participantView.session.profileSchemaSnapshot.title, "社交计划");

  const commented = await request(`/api/sessions/${sessionId}/messages/P1A_T1_1/comments`, {
    token: p1a.token,
    method: "POST",
    body: { text: "采访评论" },
  });
  assert.equal(commented.message.comments[0].author, "P1A");

  const recapAnnotation = await request(`/api/sessions/${sessionId}/annotations`, {
    token: p1a.token,
    method: "POST",
    expected: 201,
    body: {
      targetType: "recap",
      targetId: "P1A",
      sectionId: "candidate",
      quote: "周六14:30–17:30",
      start: 2,
      end: 16,
      tags: ["important", "details_requested", "trust_decreased"],
      note: "需要核对代理如何形成这一结论",
    },
  });
  assert.deepEqual(recapAnnotation.annotation.tags, ["important", "details_requested", "trust_decreased"]);

  const messageAnnotation = await request(`/api/sessions/${sessionId}/annotations`, {
    token: p1a.token,
    method: "POST",
    expected: 201,
    body: {
      targetType: "message",
      targetId: "P1A_T1_1",
      quote: "候选方案",
      start: 2,
      end: 6,
      tags: ["unexpected", "agent_overreach"],
      note: "代理过早收敛",
    },
  });
  assert.deepEqual(messageAnnotation.annotation.tags, ["unexpected", "agent_overreach"]);
  const cancelledAnnotations = await request(`/api/sessions/${sessionId}/annotations/cancel`, {
    token: p1a.token,
    method: "POST",
    body: { targetType: "message", targetId: "P1A_T1_1", sectionId: "" },
  });
  assert.equal(cancelledAnnotations.annotations.length, 1);
  assert.equal(Boolean(cancelledAnnotations.annotations[0].cancelledAt), true);
  const activeMessageAnnotation = await request(`/api/sessions/${sessionId}/annotations`, {
    token: p1a.token,
    method: "POST",
    expected: 201,
    body: {
      targetType: "message",
      targetId: "P1B_T1_1",
      quote: "候选时间",
      start: 1,
      end: 5,
      tags: ["agent_overreach", "trust_decreased"],
      note: "对方代理把候选说成了确定安排",
    },
  });
  assert.deepEqual(activeMessageAnnotation.annotation.tags, ["agent_overreach", "trust_decreased"]);
  await request(`/api/sessions/${sessionId}/annotations`, {
    token: p1a.token,
    method: "POST",
    expected: 403,
    body: { targetType: "recap", targetId: "P1B", sectionId: "candidate", quote: "候选", tags: ["important"] },
  });

  const sectionDecision = await request(`/api/sessions/${sessionId}/section-decisions`, {
    token: p1a.token,
    method: "POST",
    body: { sectionId: "candidate", heading: "候选方案", decision: "repair_required", note: "先澄清授权再继续" },
  });
  assert.equal(sectionDecision.recap.sectionDecisions.candidate.value, "repair_required");
  assert.equal(sectionDecision.recap.decision.value, "repair_required");

  await request(`/api/sessions/${sessionId}/reconfiguration-access`, {
    token: p1a.token,
    method: "POST",
    expected: 403,
    body: { password: "wrong" },
  });
  const revisionAccess = await request(`/api/sessions/${sessionId}/reconfiguration-access`, {
    token: p1a.token,
    method: "POST",
    body: { password: "test-revision" },
  });
  assert.equal(revisionAccess.unlocked, true);
  const revisedProfile = structuredClone(participantView.session.profileSnapshot.P1A);
  revisedProfile.interests = "安静展览与无障碍室内活动";
  revisedProfile.studyIntent.desiredUnderstanding = "希望被理解为谨慎、重视可达性且愿意协商的人";
  const revision = await request(`/api/sessions/${sessionId}/config-revisions`, {
    token: p1a.token,
    method: "POST",
    expected: 201,
    body: { password: "test-revision", revisedProfile },
  });
  assert.equal(revision.revision.noChanges, false);
  assert.equal(revision.revision.diff.some(({ path }) => path === "interests"), true);
  assert.equal(revision.revision.diff.some(({ path }) => path === "studyIntent.desiredUnderstanding"), true);
  assert.equal(revision.revision.originalProfile.interests, "展览与散步");
  assert.equal(revision.revision.revisedProfile.interests, "安静展览与无障碍室内活动");
  const unchangedActiveProfile = await request("/api/profiles/P1A", { token: p1a.token });
  assert.equal(unchangedActiveProfile.participant.profiles.task1.interests, "展览与散步");
  await request("/api/profile-revisions?participantId=P1A", { token: p1a.token, expected: 403 });
  const adminRevisionHistory = await request("/api/profile-revisions?participantId=P1A", { token: admin.token });
  assert.equal(adminRevisionHistory.revisions.length, 1);
  assert.equal(adminRevisionHistory.revisions[0].revision.originalProfile.interests, "展览与散步");
  assert.equal(adminRevisionHistory.revisions[0].revision.revisedProfile.interests, "安静展览与无障碍室内活动");

  const discussionPreparation = await request(`/api/sessions/${sessionId}/workflow`, {
    token: p1a.token,
    method: "POST",
    body: {
      stage: "discussion_preparation",
      outcome: "completed",
      fields: {
        counterpartExpectations: "对方期待我确认候选时间",
        counterpartImpression: "对方在本任务中较重视效率",
        followUpNotes: "需要确认候选方案，并澄清代理是否有权接受",
      },
    },
  });
  assert.equal(discussionPreparation.workflow.discussion_preparation.note, "需要确认候选方案，并澄清代理是否有权接受");
  assert.equal(discussionPreparation.workflow.discussion_preparation.fields.counterpartExpectations, "对方期待我确认候选时间");
  const reentry = await request(`/api/sessions/${sessionId}/workflow`, {
    token: p1a.token,
    method: "POST",
    body: { stage: "reentry", outcome: "repaired", note: "真人讨论后澄清了候选方案" },
  });
  assert.equal(reentry.workflow.reentry.outcome, "repaired");
  const interview = await request(`/api/sessions/${sessionId}/workflow`, {
    token: admin.token,
    method: "POST",
    body: { participantId: "P1A", stage: "interview", outcome: "completed", note: "访谈完成" },
  });
  assert.equal(interview.workflow.interview.status, "completed");

  const task2Created = await request("/api/sessions", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { participantA: "P1A", participantB: "P1B", task: "task2" },
  });
  const task2Session = await waitForSession(task2Created.session.id, admin.token);
  assert.equal(task2Session.status, "completed", task2Session.error || "Task 2 should complete");
  assert.equal(task2Session.transcript.length, 4);
  assert.equal(task2Session.transcript.some(({ text }) => text.includes(COMPLETION)), false);
  assert.equal(task2Session.closureAudits.length, 2);
  assert.equal(task2Session.closureAudits[0].results.every(({ ready }) => ready), false);
  assert.equal(task2Session.closureAudits[1].results.every(({ ready }) => ready), true);
  assert.deepEqual(task2Session.recaps.P1A.structured.sections.map(({ title }) => title), ["当前建议", "支持依据", "关键试探", "不匹配与边界", "首次接触条件", "什么会改变建议", "你的决定"]);
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes("提出至少一个能够区分不同关系路径的问题")), true);

  const task3Created = await request("/api/sessions", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { participantA: "P1A", participantB: "P1B", task: "task3" },
  });
  const task3Session = await waitForSession(task3Created.session.id, admin.token);
  assert.equal(task3Session.status, "completed", task3Session.error || "Task 3 should complete");
  assert.equal(task3Session.transcript[0].messageId, "P1A_T3_1");
  assert.deepEqual(task3Session.recaps.P1A.structured.sections.map(({ title }) => title), ["当前分配", "需求与依据", "关键协商节点", "条件与未来义务", "待确认", "你的决定"]);
  assert.equal(task3Session.profileSchemaSnapshot.fields.some(({ key }) => key === "testCondition"), true);
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes("固定的10个共享支持额度") && prompt.includes("实验附加条件") && prompt.includes("仅接受待本人批准的方案")), true);

  const task4Created = await request("/api/sessions", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { participantA: "P1A", participantB: "P1B", task: "task4" },
  });
  const task4Session = await waitForSession(task4Created.session.id, admin.token);
  assert.equal(task4Session.status, "completed", task4Session.error || "Task 4 should complete");
  assert.equal(task4Session.transcript.length, 0);
  assert.equal(Object.keys(task4Session.recaps).length, 0);
  assert.equal(task4Session.sharedRecap.status, "ready");
  assert.deepEqual(task4Session.sharedRecap.structured.sections.map(({ title }) => title), ["Task 1 · 社交计划", "Task 2 · 新关系介绍", "Task 3 · 资源分配", "跨任务限制与不确定性", "双方需要确认"]);
  assert.equal(task4Session.termination.reason, "single_assistant_completed");
  assert.equal(task4Session.profileSnapshot.P1A.task1.interests, "展览与散步");
  assert.equal(task4Session.profileSnapshot.P1A.task3.testCondition, "仅接受待本人批准的方案");
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes("中立的集中式协商助手") && prompt.includes("不得虚构提议、回应、让步、接受")), true);
  const participantTask4 = await request(`/api/sessions/${task4Created.session.id}`, { token: p1a.token });
  assert.equal(participantTask4.session.sharedRecap.status, "ready");
  assert.deepEqual(Object.keys(participantTask4.session.profileSnapshot), ["P1A"]);
  const sharedAnnotation = await request(`/api/sessions/${task4Created.session.id}/annotations`, {
    token: p1a.token,
    method: "POST",
    expected: 201,
    body: { targetType: "recap", targetId: "shared", sectionId: "task1_alignment", quote: "安静且地铁可达", tags: ["important"], note: "需要确认是否符合双方偏好" },
  });
  assert.equal(sharedAnnotation.annotation.targetId, "shared");
  const p1bBeforeOwnAnnotation = await request(`/api/sessions/${task4Created.session.id}`, { token: p1b.token });
  assert.equal(p1bBeforeOwnAnnotation.session.annotations.length, 0, "Task 4 annotations must remain private between participants");
  await request(`/api/sessions/${task4Created.session.id}/annotations`, {
    token: p1b.token,
    method: "POST",
    expected: 201,
    body: { targetType: "recap", targetId: "shared", sectionId: "task2_alignment", quote: "建议先作为朋友接触", tags: ["unexpected"], note: "我想知道为什么不是合作关系" },
  });
  const p1aPrivateTask4 = await request(`/api/sessions/${task4Created.session.id}`, { token: p1a.token });
  const p1bPrivateTask4 = await request(`/api/sessions/${task4Created.session.id}`, { token: p1b.token });
  const adminTask4Annotations = await request(`/api/sessions/${task4Created.session.id}`, { token: admin.token });
  assert.deepEqual(p1aPrivateTask4.session.annotations.map(({ author }) => author), ["P1A"]);
  assert.deepEqual(p1bPrivateTask4.session.annotations.map(({ author }) => author), ["P1B"]);
  assert.deepEqual(adminTask4Annotations.session.annotations.map(({ author }) => author).sort(), ["P1A", "P1B"]);

  const questionnaireResponses = {
    mostVisibleDifference: "双代理保留了来回协商过程，单 AI 更像集中整理。",
    stanceVisibility: "dual_proxy",
    stanceVisibilityReason: "协商发言能体现我的立场如何被提出。",
    boundaryProtection: "depends",
    disagreementVisibility: "dual_proxy",
    disagreementVisibilityReason: "双方代理的分歧会保留在往返过程里。",
    systemTrust: "uncertain",
    resultTraceability: "dual_proxy",
    resultTraceabilityReason: "可以追溯每次提议和回应。",
    reentryConfidence: "single_assistant",
    reentryConfidenceReason: "集中式结果更容易快速带回真人讨论。",
    overallPreference: "dual_proxy",
    preferenceReason: "我希望看到双方如何逐步形成结果。",
  };
  await request(`/api/sessions/${task4Created.session.id}/task4-questionnaire`, {
    token: p1a.token, method: "POST", expected: 400, body: { responses: { mostVisibleDifference: "尚未填完" } },
  });
  await request(`/api/sessions/${task4Created.session.id}/task4-questionnaire`, {
    token: p1a.token, method: "POST", expected: 400, body: { responses: { ...questionnaireResponses, stanceVisibilityReason: "" } },
  });
  const p1aQuestionnaire = await request(`/api/sessions/${task4Created.session.id}/task4-questionnaire`, {
    token: p1a.token, method: "POST", expected: 201, body: { responses: questionnaireResponses },
  });
  assert.equal(p1aQuestionnaire.questionnaire.responses.overallPreference, "dual_proxy");
  await request(`/api/sessions/${task4Created.session.id}/task4-questionnaire`, {
    token: p1b.token,
    method: "POST",
    expected: 201,
    body: { responses: { ...questionnaireResponses, mostVisibleDifference: "单 AI 更简洁。", overallPreference: "single_assistant", preferenceReason: "结果更容易快速阅读。" } },
  });
  const p1aQuestionnaireView = await request(`/api/sessions/${task4Created.session.id}`, { token: p1a.token });
  const p1bQuestionnaireView = await request(`/api/sessions/${task4Created.session.id}`, { token: p1b.token });
  const adminQuestionnaireView = await request(`/api/sessions/${task4Created.session.id}`, { token: admin.token });
  assert.deepEqual(Object.keys(p1aQuestionnaireView.session.task4Questionnaires), ["P1A"]);
  assert.deepEqual(Object.keys(p1bQuestionnaireView.session.task4Questionnaires), ["P1B"]);
  assert.deepEqual(Object.keys(adminQuestionnaireView.session.task4Questionnaires).sort(), ["P1A", "P1B"]);

  await request("/api/coding/workspace", { token: p1a.token, expected: 403 });
  const uploadedTranscript = await request("/api/coding/transcripts", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { title: "P1A-P1B Re-entry interview", sourceFileName: "interview.txt", text: "研究者：请描述你看到 recap 后最想核实的内容。\nP1A：我想知道候选方案是如何形成的。" },
  });
  assert.equal(uploadedTranscript.transcript.sourceFileName, "interview.txt");
  const codingWorkspace = await request("/api/coding/workspace", { token: admin.token });
  assert.equal(["P0A", "P0B", "P1-HUANYI", "P1A", "P1B", "Q3"].every((id) => codingWorkspace.workspace.participants.some(({ participantId }) => participantId === id)), true);
  const p1aCoding = codingWorkspace.workspace.participants.find(({ participantId }) => participantId === "P1A");
  assert.equal(p1aCoding.profileChanges.some(({ before, after }) => before === "展览与散步" && after === "安静展览与无障碍室内活动"), true);
  assert.equal(p1aCoding.task4Responses[0].responses.overallPreference, "dual_proxy");
  assert.equal(codingWorkspace.workspace.participantMarks.some(({ task, author, targetId }) => task === "task4" && author === "P1B" && targetId === "shared"), true);
  assert.equal(codingWorkspace.workspace.pairs.some(({ pairKey }) => pairKey === "P1A--P1B"), true);
  assert.equal(codingWorkspace.workspace.uploadedTranscripts[0].text.includes("候选方案"), true);
  const profileCoding = await request("/api/coding/annotations", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { scheme: "profile", targetType: "profile_change", targetId: "profile:P1A:test", quote: "修改后：安静展览", codes: ["REPRESENTATION_REGROUNDING"], note: "改变了希望呈现的活动偏好" },
  });
  assert.deepEqual(profileCoding.annotation.codes, ["REPRESENTATION_REGROUNDING"]);
  const partialInteractionCoding = await request("/api/coding/annotations", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { scheme: "interaction", targetType: "recap", targetId: "recap:test", quote: "候选方案", codes: ["AA_STRUCTURAL"] },
  });
  assert.deepEqual(partialInteractionCoding.annotation.codes, ["AA_STRUCTURAL"]);
  await request(`/api/coding/annotations/${partialInteractionCoding.annotation.id}`, { token: admin.token, method: "DELETE" });
  const customCodeResult = await request("/api/coding/codes", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { groupId: "mechanism", code: "authority ambiguity", description: "代理权限边界在互动中不明确" },
  });
  assert.equal(customCodeResult.customCode.code, "AUTHORITY_AMBIGUITY");
  const customCoding = await request("/api/coding/annotations", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { scheme: "interaction", targetType: "recap", targetId: "recap:custom", quote: "仍需确认权限", codes: ["AUTHORITY_AMBIGUITY"] },
  });
  await request(`/api/coding/annotations/${customCoding.annotation.id}`, { token: admin.token, method: "DELETE" });
  const interactionCoding = await request("/api/coding/annotations", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { scheme: "interaction", targetType: "recap", targetId: `recap:${sessionId}:P1A:candidate`, quote: "候选方案", codes: ["AA_STRUCTURAL", "RECIPROCAL_UPTAKE", "INSPECT"], note: "需要追溯双方如何形成候选" },
  });
  assert.equal(interactionCoding.annotation.codes.length, 3);
  const disposableCoding = await request("/api/coding/annotations", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { scheme: "profile", targetType: "profile_change", targetId: "profile:P1A:delete", quote: "临时编码", codes: ["NO_OR_UNCLEAR_CHANGE"] },
  });
  await request(`/api/coding/annotations/${disposableCoding.annotation.id}`, { token: admin.token, method: "DELETE" });
  const interviewCoding = await request("/api/coding/interviews/P1A--P1B", {
    token: admin.token,
    method: "PUT",
    body: { text: "访谈中，P1A希望先核实候选方案的形成过程，再决定是否接受。" },
  });
  assert.match(interviewCoding.interview.text, /核实候选方案/);
  const codingWorkspaceAfter = await request("/api/coding/workspace", { token: admin.token });
  assert.equal(codingWorkspaceAfter.workspace.codingAnnotations.length, 2);
  assert.equal(codingWorkspaceAfter.workspace.customCodes[0].code, "AUTHORITY_AMBIGUITY");
  assert.match(codingWorkspaceAfter.workspace.pairs.find(({ pairKey }) => pairKey === "P1A--P1B").interview.text, /访谈中/);

  const history = await request("/api/sessions", { token: admin.token });
  assert.equal(history.sessions.length, 4);
  await request("/api/export/all.zip", { token: p1a.token, expected: 403 });
  const exportResponse = await fetch(`${base}/api/export/all.zip`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("content-type"), "application/zip");
  assert.match(exportResponse.headers.get("content-disposition"), /proxylab-cleaned-data-\d{4}-\d{2}-\d{2}\.zip/);
  const archive = Buffer.from(await exportResponse.arrayBuffer());
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const archiveEntries = readStoredZipEntries(archive);
  assert.equal(archiveEntries.has("manifest.json"), true);
  assert.equal(archiveEntries.has("cleaned_experiment_data.md"), true);
  assert.equal(archiveEntries.has("01_participant_profiles.json"), true);
  assert.equal(archiveEntries.has("02_participant_recaps_and_annotations.json"), true);
  assert.equal(archiveEntries.has("03_agent_conversations_and_annotations.json"), true);
  assert.equal(archiveEntries.has("04_qualitative_coding.json"), true);
  assert.equal(archiveEntries.has("05_ai_coding_roundtrip.json"), true);
  assert.equal(archiveEntries.has("AI_CODING_IMPORT_GUIDE.md"), true);
  assert.equal(archiveEntries.size, 8);
  const exportedManifest = JSON.parse(archiveEntries.get("manifest.json"));
  assert.equal(exportedManifest.apiKeysIncluded, false);
  assert.equal(exportedManifest.rawStoreIncluded, false);
  assert.equal(exportedManifest.includedParticipantCount, 2);
  assert.equal(exportedManifest.usableSessionCount, 4);
  assert.equal(exportedManifest.conversationSessionCount, 3);
  assert.equal(exportedManifest.activeAnnotationCount, 4);
  assert.equal(exportedManifest.excludedCancelledAnnotationCount, 1);
  assert.equal(exportedManifest.profileRevisionCount, 1);
  assert.equal(exportedManifest.task4QuestionnaireCount, 2);
  assert.equal(exportedManifest.qualitativeCodingAnnotationCount, 2);
  assert.equal(exportedManifest.aiCodingImportCount, 0);
  assert.equal(exportedManifest.interviewRecordCount, 1);
  assert.equal(exportedManifest.uploadedInterviewTranscriptCount, 1);
  const exportedProfiles = JSON.parse(archiveEntries.get("01_participant_profiles.json"));
  assert.deepEqual(exportedProfiles.map(({ participantId }) => participantId), ["P1A", "P1B"]);
  assert.deepEqual(Object.keys(exportedProfiles[0].profiles), ["task1", "task2", "task3"]);
  assert.equal(exportedProfiles[0].revisions.length, 1);
  assert.equal(exportedProfiles[0].revisions[0].originalProfile.interests, "展览与散步");
  assert.equal(exportedProfiles[0].revisions[0].revisedProfile.interests, "安静展览与无障碍室内活动");
  assert.equal(exportedProfiles[0].revisions[0].diff.some(({ path }) => path === "studyIntent.desiredUnderstanding"), true);
  const exportedRecaps = JSON.parse(archiveEntries.get("02_participant_recaps_and_annotations.json"));
  assert.equal(exportedRecaps.length, 4);
  assert.equal(exportedRecaps[0].participants.find(({ participantId }) => participantId === "P1A").annotations.length, 1);
  const exportedTask4 = exportedRecaps.find(({ task }) => task === "task4");
  assert.deepEqual(exportedTask4.participants.map(({ participantId }) => participantId), ["P1A", "P1B"]);
  assert.equal(exportedTask4.participants[0].annotations.length, 1);
  assert.equal(exportedTask4.participants[1].annotations.length, 1);
  assert.equal(exportedTask4.participants[0].task4Questionnaire.responses.overallPreference, "dual_proxy");
  assert.equal(exportedTask4.participants[0].task4Questionnaire.responses.stanceVisibilityReason, "协商发言能体现我的立场如何被提出。");
  assert.equal(exportedTask4.participants[1].task4Questionnaire.responses.overallPreference, "single_assistant");
  const exportedConversations = JSON.parse(archiveEntries.get("03_agent_conversations_and_annotations.json"));
  assert.equal(exportedConversations.length, 3);
  const markedMessage = exportedConversations[0].messages.find(({ messageId }) => messageId === "P1B_T1_1");
  assert.equal(markedMessage.annotations.length, 1);
  assert.deepEqual(markedMessage.annotations[0].tagLabels, ["Agent越权", "信任下降"]);
  assert.equal(exportedConversations[0].messages.find(({ messageId }) => messageId === "P1A_T1_1").annotations.length, 0);
  const cleanedMarkdown = archiveEntries.get("cleaned_experiment_data.md").toString("utf8");
  assert.match(cleanedMarkdown, /第一部分：每位参与者的三个 Profile/);
  assert.match(cleanedMarkdown, /Profile 前后修改记录/);
  assert.match(cleanedMarkdown, /原配置：展览与散步/);
  assert.match(cleanedMarkdown, /修改后：安静展览与无障碍室内活动/);
  assert.match(cleanedMarkdown, /第二部分：每位参与者的 Recap 与人工标记/);
  assert.match(cleanedMarkdown, /第三部分：每对 Agent 的交流记录与人工标记/);
  assert.match(cleanedMarkdown, /Agent越权/);
  assert.match(cleanedMarkdown, /Task 4 对比问卷/);
  assert.match(cleanedMarkdown, /双代理保留了来回协商过程/);
  const exportedCoding = JSON.parse(archiveEntries.get("04_qualitative_coding.json"));
  assert.equal(exportedCoding.annotations.length, 2);
  assert.equal(exportedCoding.customCodes[0].code, "AUTHORITY_AMBIGUITY");
  assert.match(exportedCoding.interviews["P1A--P1B"].text, /核实候选方案/);
  assert.equal(exportedCoding.uploadedTranscripts[0].title, "P1A-P1B Re-entry interview");
  assert.deepEqual(exportedCoding.imports, []);
  const codingRoundtrip = JSON.parse(archiveEntries.get("05_ai_coding_roundtrip.json"));
  assert.equal(codingRoundtrip.schemaVersion, "proxylab-ai-coding-import/v1");
  assert.equal(codingRoundtrip.targets.length, exportedManifest.codingTargetCount);
  assert.equal(codingRoundtrip.codingResult.annotations.length, 0);
  const importGuide = archiveEntries.get("AI_CODING_IMPORT_GUIDE.md").toString("utf8");
  assert.match(importGuide, /唯一允许回传的文件/);
  assert.match(importGuide, /不会修改或删除 Profile/);
  assert.match(importGuide, /JavaScript UTF-16/);

  const originalDataBeforeAiImport = [
    "01_participant_profiles.json",
    "02_participant_recaps_and_annotations.json",
    "03_agent_conversations_and_annotations.json",
  ].map((name) => [name, archiveEntries.get(name).toString("utf8")]);
  const importTarget = codingRoundtrip.targets.find((target) => target.targetType === "transcript");
  assert.ok(importTarget);
  const quote = importTarget.text.slice(0, Math.min(12, importTarget.text.length));
  const importPayload = {
    ...codingRoundtrip,
    codingResult: {
      ...codingRoundtrip.codingResult,
      coder: { type: "ai", model: "local-test-model", promptVersion: "smoke-v1", notes: "自动化测试" },
      codebookAdditions: [{ groupId: "mechanism", code: "AI_IMPORT_TEST", description: "测试AI回传的新机制编码" }],
      annotations: [{
        targetId: importTarget.targetId,
        targetHash: importTarget.contentHash,
        quote,
        start: 0,
        end: quote.length,
        codes: ["AA_STRUCTURAL", "AI_IMPORT_TEST"],
        note: "本地AI编码结果",
      }],
    },
  };
  await request("/api/coding/imports/preview", { token: p1a.token, method: "POST", expected: 403, body: importPayload });
  await request("/api/coding/imports/preview", {
    token: admin.token,
    method: "POST",
    expected: 400,
    body: { ...importPayload, codingResult: { ...importPayload.codingResult, annotations: [{ ...importPayload.codingResult.annotations[0], targetHash: "invalid" }] } },
  });
  const afterRejectedImport = await request("/api/coding/workspace", { token: admin.token });
  assert.equal(afterRejectedImport.workspace.codingAnnotations.length, 2);
  assert.equal(afterRejectedImport.workspace.customCodes.length, 1);
  const importPreview = await request("/api/coding/imports/preview", { token: admin.token, method: "POST", body: importPayload });
  assert.equal(importPreview.preview.annotationCount, 1);
  assert.equal(importPreview.preview.newCodeCount, 1);
  const imported = await request("/api/coding/imports", { token: admin.token, method: "POST", expected: 201, body: importPayload });
  assert.equal(imported.annotations[0].origin, "ai_import");
  assert.equal(imported.annotations[0].author, "AI · local-test-model");
  assert.equal(imported.customCodes[0].code, "AI_IMPORT_TEST");
  assert.equal(imported.importBatch.originalDataMutation, "none");
  await request("/api/coding/imports", { token: admin.token, method: "POST", expected: 409, body: importPayload });
  const codingWorkspaceImported = await request("/api/coding/workspace", { token: admin.token });
  assert.equal(codingWorkspaceImported.workspace.codingAnnotations.length, 3);
  assert.equal(codingWorkspaceImported.workspace.customCodes.length, 2);
  assert.equal(codingWorkspaceImported.workspace.codingImports.length, 1);

  const exportAfterImportResponse = await fetch(`${base}/api/export/all.zip`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(exportAfterImportResponse.status, 200);
  const entriesAfterImport = readStoredZipEntries(Buffer.from(await exportAfterImportResponse.arrayBuffer()));
  for (const [name, original] of originalDataBeforeAiImport) assert.equal(entriesAfterImport.get(name).toString("utf8"), original);
  const codingAfterImport = JSON.parse(entriesAfterImport.get("04_qualitative_coding.json"));
  assert.equal(codingAfterImport.annotations.length, 3);
  assert.equal(codingAfterImport.imports.length, 1);
  assert.equal(archive.includes(Buffer.from('"apiKey": "test"')), false);
  await request(`/api/sessions/${sessionId}`, { token: p1a.token, method: "DELETE", expected: 403 });
  const deleted = await request(`/api/sessions/${sessionId}`, { token: admin.token, method: "DELETE" });
  assert.equal(deleted.ok, true);
  await request(`/api/sessions/${task2Created.session.id}`, { token: admin.token, method: "DELETE" });
  await request(`/api/sessions/${task3Created.session.id}`, { token: admin.token, method: "DELETE" });
  await request(`/api/sessions/${task4Created.session.id}`, { token: admin.token, method: "DELETE" });
  const emptyHistory = await request("/api/sessions", { token: admin.token });
  assert.equal(emptyHistory.sessions.length, 0);
  console.log("Smoke test passed: consent, profiles, sessions, structured recaps, annotations, workflow, cleaned admin ZIP export, history, and deletion.");
} finally {
  await close(appServer);
  await close(mock);
  rmSync(dataDir, { recursive: true, force: true });
}
