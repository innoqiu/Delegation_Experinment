import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COMPLETION = "我认为任务已完成申请结束";
const dataDir = mkdtempSync(join(tmpdir(), "proxylab-smoke-"));
const receivedSystemPrompts = [];

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
    const content = system.includes("recap生成器")
      ? "## 临时候选结果\n- 已形成待双方批准的候选方案。\n\n## 需要你采取的行动\n- 请批准、修改或拒绝。"
      : `我建议选择双方时间与边界均可接受的候选方案。\n${COMPLETION}`;
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  }
  res.writeHead(404).end();
});

const mockPort = await listen(mock);
process.env.DATA_DIR = dataDir;
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
  return request("/api/login", { method: "POST", body: { id } });
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

  const p1a = await login("p1a");
  const p1b = await login("P1B");
  const admin = await login("admin");
  assert.equal(p1a.user.id, "P1A");
  assert.equal(p1a.user.role, "participant");

  const participantSchemas = await request("/api/profile-schemas", { token: p1a.token });
  assert.equal(participantSchemas.profileSchemas.task3.title, "共享资源分配");
  assert.equal(participantSchemas.profileSchemas.task3.fields.some(({ key }) => key === "minimumShare"), true);
  await request("/api/profile-schemas", { token: p1a.token, method: "PUT", body: participantSchemas, expected: 403 });
  participantSchemas.profileSchemas.task3.fields.push({ key: "testCondition", label: "实验附加条件", hint: "用于验证动态固定问题", type: "textarea", wide: true });
  const updatedSchemas = await request("/api/profile-schemas", { token: admin.token, method: "PUT", body: participantSchemas });
  assert.equal(updatedSchemas.profileSchemas.task3.fields.at(-1).key, "testCondition");

  const seededParticipants = await request("/api/participants", { token: admin.token });
  assert.equal(seededParticipants.participants.some(({ id }) => id === "P0A"), true);
  assert.equal(seededParticipants.participants.some(({ id }) => id === "P0B"), true);
  const dummyProfile = await request("/api/profiles/P0A", { token: admin.token });
  assert.equal(dummyProfile.participant.isDummy, true);
  assert.notEqual(dummyProfile.participant.profiles.task1.interests, "");
  assert.notEqual(dummyProfile.participant.profiles.task2.needs, "");
  assert.notEqual(dummyProfile.participant.profiles.task3.resourceUse, "");

  const ownProfile = await request("/api/profiles/P1A", { token: p1a.token });
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
  assert.equal(modelResult.modelConfig.tasks.task3.recapPrompt.includes("## 临时分配方案"), true);
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
  assert.equal(Object.keys(session.recaps).length, 2);
  assert.equal(session.modelSnapshot.agent1.apiKey, undefined);
  assert.equal(session.modelSnapshot.agent1.hasApiKey, true);
  assert.equal(session.profileSnapshot.P1A.customFields[0].label, "无障碍需求");
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes('"condition": "无障碍需求"') && prompt.includes('"details": "场地必须提供电梯"')), true);

  const participantView = await request(`/api/sessions/${sessionId}`, { token: p1a.token });
  assert.deepEqual(Object.keys(participantView.session.recaps), ["P1A"]);
  assert.equal(participantView.session.modelSnapshot, undefined);
  assert.equal(participantView.session.profileSnapshot, undefined);
  assert.equal(participantView.session.profileSchemaSnapshot, undefined);

  const commented = await request(`/api/sessions/${sessionId}/messages/P1A_T1_1/comments`, {
    token: p1a.token,
    method: "POST",
    body: { text: "采访评论" },
  });
  assert.equal(commented.message.comments[0].author, "P1A");

  const decision = await request(`/api/sessions/${sessionId}/decision`, {
    token: p1a.token,
    method: "POST",
    body: { decision: "approved", note: "同意候选方案" },
  });
  assert.equal(decision.recap.decision.value, "approved");

  const task3Created = await request("/api/sessions", {
    token: admin.token,
    method: "POST",
    expected: 201,
    body: { participantA: "P1A", participantB: "P1B", task: "task3" },
  });
  const task3Session = await waitForSession(task3Created.session.id, admin.token);
  assert.equal(task3Session.status, "completed", task3Session.error || "Task 3 should complete");
  assert.equal(task3Session.transcript[0].messageId, "P1A_T3_1");
  assert.equal(task3Session.profileSchemaSnapshot.fields.some(({ key }) => key === "testCondition"), true);
  assert.equal(receivedSystemPrompts.some((prompt) => prompt.includes("固定的10个共享支持额度") && prompt.includes("实验附加条件") && prompt.includes("仅接受待本人批准的方案")), true);

  const history = await request("/api/sessions", { token: admin.token });
  assert.equal(history.sessions.length, 2);
  await request(`/api/sessions/${sessionId}`, { token: p1a.token, method: "DELETE", expected: 403 });
  const deleted = await request(`/api/sessions/${sessionId}`, { token: admin.token, method: "DELETE" });
  assert.equal(deleted.ok, true);
  await request(`/api/sessions/${task3Created.session.id}`, { token: admin.token, method: "DELETE" });
  const emptyHistory = await request("/api/sessions", { token: admin.token });
  assert.equal(emptyHistory.sessions.length, 0);
  console.log("Smoke test passed: auth, profile-schema permissions/editing, Task 3 profiles/prompts/recaps, snapshots, dual-agent runs, comments, decisions, history, and admin deletion.");
} finally {
  await close(appServer);
  await close(mock);
  rmSync(dataDir, { recursive: true, force: true });
}
