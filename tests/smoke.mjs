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
    const content = isClosureAudit
      ? isTask2Audit && task2AuditCalls <= 2
        ? "CONTINUE: 仍需核对关系目的、互动节奏与可能改变建议的新信息"
        : "READY_TO_CLOSE"
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

async function login(id) {
  const result = await request("/api/login", {
    method: "POST",
    body: id.toLowerCase() === "admin" ? { id, adminCode: "test-admin-code" } : { id },
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
  const admin = await login("admin");
  assert.equal(p1a.user.id, "P1A");
  assert.equal(p1a.user.role, "participant");

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
      tags: ["important", "details_requested"],
      note: "需要核对代理如何形成这一结论",
    },
  });
  assert.deepEqual(recapAnnotation.annotation.tags, ["important", "details_requested"]);

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
      tags: ["unexpected"],
      note: "代理过早收敛",
    },
  });
  assert.deepEqual(messageAnnotation.annotation.tags, ["unexpected"]);
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

  const changedProfile = await request("/api/profiles/P1A", { token: p1a.token });
  changedProfile.participant.profiles.task1.interests = "安静展览与无障碍室内活动";
  changedProfile.participant.profiles.task1.studyIntent.desiredUnderstanding = "希望被理解为谨慎、重视可达性且愿意协商的人";
  await request("/api/profiles/P1A", { token: p1a.token, method: "PUT", body: { profiles: changedProfile.participant.profiles } });
  const revision = await request(`/api/sessions/${sessionId}/config-revisions`, {
    token: p1a.token,
    method: "POST",
    expected: 201,
    body: {},
  });
  assert.equal(revision.revision.noChanges, false);
  assert.equal(revision.revision.diff.some(({ path }) => path === "interests"), true);
  assert.equal(revision.revision.diff.some(({ path }) => path === "studyIntent.desiredUnderstanding"), true);

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

  const history = await request("/api/sessions", { token: admin.token });
  assert.equal(history.sessions.length, 3);
  await request(`/api/sessions/${sessionId}`, { token: p1a.token, method: "DELETE", expected: 403 });
  const deleted = await request(`/api/sessions/${sessionId}`, { token: admin.token, method: "DELETE" });
  assert.equal(deleted.ok, true);
  await request(`/api/sessions/${task2Created.session.id}`, { token: admin.token, method: "DELETE" });
  await request(`/api/sessions/${task3Created.session.id}`, { token: admin.token, method: "DELETE" });
  const emptyHistory = await request("/api/sessions", { token: admin.token });
  assert.equal(emptyHistory.sessions.length, 0);
  console.log("Smoke test passed: first-login consent gate, protected admin login, fixed structured recaps, matching A/B sections, concise filtering, hidden two-stage completion, Task 2 requirements, annotations, decisions, workflow, history, and deletion.");
} finally {
  await close(appServer);
  await close(mock);
  rmSync(dataDir, { recursive: true, force: true });
}
