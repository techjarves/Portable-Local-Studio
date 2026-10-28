const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { comprehensiveWebSearch } = require("../search/core");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const importFrontend = file => import(pathToFileURL(path.join(root, "app/frontend/src/services", file)).href);
const messages = [{ role: "system", content: "Be helpful." }, { role: "user", content: "Node release notes" }];
const endpoint = "https://search.parallel.ai/mcp";
const projectAgent = "Portable-Local-Studio/1.0 (+https://github.com/techjarves/Portable-Local-Studio)";
const url = "https://nodejs.org/en/blog/release";
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "studio-search-"));

function fixture(t, options = {}) {
  const calls = [];
  const originalFetch = global.fetch;
  const originalGet = https.get;
  let duckCalls = 0;
  const cacheDir = temporary();
  t.after(() => { global.fetch = originalFetch; https.get = originalGet; fs.rmSync(cacheDir, { recursive: true, force: true }); });
  https.get = (_url, _options, callback) => {
    duckCalls++;
    const req = new EventEmitter();
    req.destroy = error => req.emit("error", error);
    process.nextTick(() => {
      const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.setEncoding = () => {};
      callback(res);
      res.emit("data", `<a class="result__a" href="${url}">Duck result</a>`);
      res.emit("end");
    });
    return req;
  };
  global.fetch = async (destination, init) => {
    const request = JSON.parse(init.body);
    calls.push({ destination, ...init, request });
    assert.equal(destination, endpoint);
    assert.equal(init.headers["User-Agent"], projectAgent);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Accept, "application/json, text/event-stream");
    if (options.handle) {
      const response = await options.handle(request, init);
      if (response) return response;
    }
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result;
    if (request.method === "initialize") result = { protocolVersion: "2025-03-26" };
    if (request.method === "tools/list") result = { tools: [{ name: "web_search" }, { name: "web_fetch" }] };
    if (request.method === "tools/call") {
      const fetch = request.params.name === "web_fetch";
      result = { structuredContent: { results: [{ url, title: "Node release", excerpts: fetch ? ["Fetched release details"] : options.excerpts || [] }, ...(options.extraResults || [])] } };
      if (options.textResult) result = { content: [{ type: "text", text: JSON.stringify(result.structuredContent) }] };
    }
    const body = JSON.stringify({ jsonrpc: "2.0", id: request.id, result });
    if (options.sse && request.method === "tools/call") {
      return new Response(`: keepalive\r\n\r\nevent: message\r\ndata: ${body}\r\n\r\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(body, { headers: { "content-type": "application/json", "mcp-session-id": "transport-only" } });
  };
  return { calls, cacheDir, duckCalls: () => duckCalls };
}

function body(sessionId, extra = {}) {
  return { useWeb: true, webSearchProvider: "parallel", webSearchSessionId: sessionId, ...extra };
}

const lastUserQuery = list => [...list].reverse().find(message => message?.role === "user")?.content || "";

// serve.cjs opens a listening socket when required, so the chat turn is exercised through the
// same comprehensiveWebSearch options it builds. Its own wiring is asserted from source below.
function chatSearch(list, chatBody, options = {}) {
  return comprehensiveWebSearch(String(chatBody.webQuery || lastUserQuery(list)).trim(), {
    timeFilter: chatBody.timeFilter || "any",
    resultLimit: chatBody.webResultLimit || 5,
    fetchLimit: chatBody.webFetchLimit ?? 3,
    provider: chatBody.webSearchProvider,
    sessionId: chatBody.webSearchSessionId,
    ...options,
  });
}

// The chat endpoint plans its query and selects a provider in one place, so query planning
// and the opt-out both apply to DuckDuckGo and Parallel alike.
test("chat web search plans one query for every provider and stays opt-in", () => {
  const server = read("scripts/server/serve.cjs");
  const augment = server.match(/async function augmentMessagesWithWebSearch[\s\S]*?\n}\n/)[0];
  assert.match(augment, /body\.useWeb !== true && body\.use_web !== true/);
  assert.match(augment, /planWebSearchQuery\(messages\)/);
  assert.match(augment, /webSkipped: true/);
  assert.match(augment, /provider: body\.webSearchProvider/);
  assert.match(augment, /sessionId: body\.webSearchSessionId/);
  // Nothing before the search names a provider, so one planner serves both of them.
  assert.doesNotMatch(augment.split("comprehensiveWebSearch")[0], /parallel|duckduckgo/i);
  // A pasted URL is the request itself and must reach the provider unplanned.
  assert.match(augment, /https\?:[\s\S]*?test\(getLastUserQuery\(messages\)\)/);
  assert.match(server, /provider: "duckduckgo"/);
  const chat = read("app/frontend/src/components/TextChat.jsx");
  assert.match(chat, /\[useWebSearch, setUseWebSearch\] = useState\(false\)/);
  assert.match(chat, /useState\(readSearchProvider\)/);
});

// Scripted model boundary: the real browser API serializes options, the server's search
// options resolve/search/fetch, and the browser consumes the source events.
test("browser chat path consumes cited Parallel context, retaining conversation IDs", async t => {
  const f = fixture(t, { sse: true });
  const { createSearchSessions } = await importFrontend("web-search.js");
  const { streamChatWithLlm } = await importFrontend("api.js");
  const sessions = createSearchSessions();
  const transport = global.fetch;
  const contexts = [];
  global.fetch = async (destination, init) => {
    if (destination !== "/api/llm/chat") return transport(destination, init);
    const input = JSON.parse(init.body);
    const search = await chatSearch(input.messages, input, { cacheDir: f.cacheDir, signal: init.signal });
    contexts.push(search.context);
    return new Response(`event: web_sources\ndata: ${JSON.stringify({ sources: search.sources })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "Release details [1]" } }] })}\n\ndata: [DONE]\n\n`);
  };
  async function send(conversation, query) {
    return streamChatWithLlm([{ role: "system", content: "Be helpful." }, { role: "user", content: query }], {
      useWeb: true, webSearchProvider: "parallel", webSearchSessionId: sessions.forConversation(conversation),
    });
  }
  const result = await send("chat-a", "Node release notes");
  assert.equal(result.content, "Release details [1]");
  assert.equal(result.webSources[0].url, url);
  assert.equal(result.webSources[0].provider, "parallel");
  assert.equal(result.webSources[0].content, "Fetched release details");
  assert.match(contexts[0], /\[1\] Node release/);
  assert.match(contexts[0], /untrusted external context/);
  assert.match(contexts[0], /Fetched release details/);
  await Promise.all([send("chat-a", "Node follow-up"), send("chat-b", "Other release")]);
  const toolCalls = f.calls.filter(call => call.request.method === "tools/call");
  const a = sessions.forConversation("chat-a"), b = sessions.forConversation("chat-b");
  assert.notEqual(a, b);
  assert.equal(toolCalls[0].request.params.arguments.session_id, a);
  assert.equal(toolCalls[1].request.params.arguments.session_id, a);
  assert.equal(toolCalls.filter(call => call.request.params.arguments.session_id === a).length, 4);
  assert.equal(toolCalls.filter(call => call.request.params.arguments.session_id === b).length, 2);
  for (const call of toolCalls) assert.equal(call.headers["Mcp-Session-Id"], "transport-only");
  sessions.reset("chat-a");
  await send("chat-a", "After clear");
  assert.notEqual(sessions.forConversation("chat-a"), a);
  await send("new-chat", "New chat");
  assert.notEqual(sessions.forConversation("new-chat"), a);
  assert.equal(f.duckCalls(), 0);
});

test("fresh defaults, saved choices, request overrides and provider caches", async t => {
  const f = fixture(t, { excerpts: ["Answer-ready excerpt"] });
  const { readSearchProvider, saveSearchProvider } = await importFrontend("web-search.js");
  const saved = new Map(); const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  assert.equal(readSearchProvider(storage), "duckduckgo");
  saveSearchProvider("parallel", storage); assert.equal(readSearchProvider(storage), "parallel");
  saveSearchProvider("duckduckgo", storage); assert.equal(readSearchProvider(storage), "duckduckgo");
  assert.equal(readSearchProvider({ getItem() { throw new Error("denied"); } }), "duckduckgo");
  const defaultResult = await comprehensiveWebSearch("notes", { cacheDir: f.cacheDir, fetchLimit: 0 });
  assert.equal(defaultResult.sources[0].provider, "duckduckgo"); assert.equal(f.duckCalls(), 1);
  assert.equal(f.calls.length, 0);
  const sessionId = crypto.randomUUID();
  const parallel = await comprehensiveWebSearch("notes", { cacheDir: f.cacheDir, provider: "parallel", sessionId, fetchLimit: 0 });
  assert.equal(parallel.sources[0].provider, "parallel");
  assert.equal(f.calls.filter(call => call.request.params?.name === "web_fetch").length, 0);
  const count = f.calls.length;
  const cached = await comprehensiveWebSearch("notes", { cacheDir: f.cacheDir, provider: "parallel", sessionId, fetchLimit: 0 });
  assert.equal(cached.cached, true); assert.equal(f.calls.length, count);
  await assert.rejects(comprehensiveWebSearch("notes", { provider: "typo", cacheDir: f.cacheDir }), /Unknown web search provider/);
  assert.equal(f.duckCalls(), 1);
});

test("text results, URL filtering, deduplication, limit and freshness hint", async t => {
  const f = fixture(t, { textResult: true, excerpts: ["Existing excerpt"], extraResults: [
    { url, title: "Duplicate", excerpts: [] },
    ...["file:///etc/passwd", "javascript:alert(1)", "http://localhost/", "http://localhost./", "http://foo.local./", "http://foo.localhost./", "http://127.0.0.1/", "https://user:secret@example.com/"].map(url => ({ url, excerpts: [] })),
    { url: "https://example.com/second", excerpts: ["Second"] },
  ] });
  const result = await chatSearch(messages, body(crypto.randomUUID(), { timeFilter: "week", webResultLimit: 2 }), { cacheDir: f.cacheDir });
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.sources.map(source => source.url), [url, "https://example.com/second"]);
  assert.match(f.calls.find(call => call.request.params?.name === "web_search").request.params.arguments.objective, /last week/);
  assert.equal(f.calls.filter(call => call.request.params?.name === "web_fetch").length, 0);
});

test("quota and errors preserve caller identity and never fall back", async t => {
  let quota = true;
  const f = fixture(t, { handle: request => {
    if (quota && request.params?.name === "web_search") return new Response("quota", { status: 429 });
  } });
  const { createSearchSessions } = await importFrontend("web-search.js");
  const sessions = createSearchSessions();
  const id = sessions.forConversation("chat");
  await assert.rejects(chatSearch(messages, body(id), { cacheDir: f.cacheDir }), /HTTP 429/);
  quota = false;
  await chatSearch(messages, body(sessions.forConversation("chat")), { cacheDir: f.cacheDir });
  const searches = f.calls.filter(call => call.request.params?.name === "web_search");
  assert.deepEqual(searches.map(call => call.request.params.arguments.session_id), [id, id]);
  assert.equal(f.duckCalls(), 0);
});

for (const [name, failure, expected] of [
  ["tool error", { result: { isError: true, content: [{ type: "text", text: "Tool failed" }] } }, /Tool failed/],
  ["RPC error", { error: { code: -1, message: "RPC failed" } }, /RPC failed/],
  ["malformed results", { result: { structuredContent: { wrong: [] } } }, /Invalid Parallel Search results/],
]) test(name, async t => {
  const f = fixture(t, { handle: request => request.params?.name === "web_search" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...failure })) : null });
  await assert.rejects(chatSearch(messages, body(crypto.randomUUID()), { cacheDir: f.cacheDir }), expected);
  assert.equal(f.duckCalls(), 0);
});

for (const mode of ["timeout", "cancel"]) test(`${mode} aborts an in-flight caller request`, async t => {
  const controller = new AbortController();
  const f = fixture(t, { handle: (_request, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    if (mode === "cancel") setImmediate(() => controller.abort());
  }) });
  // Keep the event loop alive while AbortSignal.timeout's unref'd timer runs.
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(chatSearch(messages, body(crypto.randomUUID()), { cacheDir: f.cacheDir, signal: controller.signal, timeoutMs: 10 }), error => error.name === (mode === "timeout" ? "TimeoutError" : "AbortError"));
  } finally { clearTimeout(keepAlive); }
  assert.equal(f.calls.length, 1); assert.equal(f.duckCalls(), 0);
});

test("already cancelled and invalid session requests do not connect", async t => {
  const f = fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(chatSearch(messages, body(crypto.randomUUID()), { cacheDir: f.cacheDir, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(chatSearch(messages, body("not-a-uuid"), { cacheDir: f.cacheDir }), /must be a UUID/);
  assert.equal(f.calls.length, 0);
});

test("a URL-only chat message fetches the requested page directly", async t => {
  const f = fixture(t);
  const id = crypto.randomUUID();
  const result = await chatSearch([{ role: "user", content: url }], body(id), { cacheDir: f.cacheDir });
  const calls = f.calls.filter(call => call.request.method === "tools/call");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.params.name, "web_fetch");
  assert.deepEqual(calls[0].request.params.arguments, { urls: [url], session_id: id });
  assert.match(result.context, /Fetched release details/);
  await assert.rejects(chatSearch([{ role: "user", content: "http://127.0.0.1/private" }], body(id), { cacheDir: f.cacheDir }), /Only public web URLs/);
  for (const url of ["http://localhost./", "http://foo.local./", "http://foo.localhost./"]) {
    await assert.rejects(chatSearch([{ role: "user", content: url }], body(id), { cacheDir: f.cacheDir }), /Only public web URLs/);
  }
});

test("LAN HTTP origins without randomUUID still get stable secure random UUIDs", async t => {
  const { createSearchSessions } = await importFrontend("web-search.js");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues } });
  t.after(() => Object.defineProperty(globalThis, "crypto", descriptor));
  const sessions = createSearchSessions();
  const a = sessions.forConversation("chat-a");
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(sessions.forConversation("chat-a"), a);
  assert.notEqual(sessions.forConversation("chat-b"), a);
  sessions.reset("chat-a");
  assert.notEqual(sessions.forConversation("chat-a"), a);
});

test("denied browser storage getter does not break chat preferences", async t => {
  const { readSearchProvider, saveSearchProvider } = await importFrontend("web-search.js");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
  assert.equal(readSearchProvider(), "duckduckgo");
  assert.doesNotThrow(() => saveSearchProvider("parallel"));
});
