const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT = "Portable-Local-Studio/1.0 (+https://github.com/techjarves/Portable-Local-Studio)";
const PROTOCOL_VERSION = "2025-03-26";
const { isIP } = require("net");

// A connection belongs to one search operation. Conversation identity is passed
// separately by the caller and survives follow-up turns and retries.
function createClient(options) {
  let nextId = 1;
  let transportSession;
  let protocolVersion = PROTOCOL_VERSION;

  async function request(method, params, notification = false) {
    options.signal?.throwIfAborted();
    const id = notification ? undefined : nextId++;
    const timeout = AbortSignal.timeout(options.timeoutMs || 15000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": USER_AGENT,
      "MCP-Protocol-Version": protocolVersion,
    };
    if (transportSession) headers["Mcp-Session-Id"] = transportSession;
    const response = await fetch(ENDPOINT, {
      method: "POST", headers, signal, redirect: "error",
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Parallel Search returned HTTP ${response.status}.`);
    }
    transportSession = response.headers.get("mcp-session-id") || transportSession;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2_000_000) throw new Error("Parallel Search response too large.");
        body += decoder.decode(value, { stream: true });
        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          const events = body.replace(/\r\n/g, "\n").split("\n\n");
          body = events.pop();
          for (const event of events) {
            const data = event.split("\n").filter(line => line.startsWith("data:"))
              .map(line => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            const message = JSON.parse(data);
            if (message.id === id) return unwrap(message);
          }
        }
      }
      body += decoder.decode();
      return unwrap(JSON.parse(body));
    } finally {
      await reader.cancel();
    }
    function unwrap(message) {
      if (message.id !== id || message.jsonrpc !== "2.0") throw new Error("Invalid Parallel Search response.");
      if (message.error) throw new Error(`Parallel Search: ${message.error.message}`);
      if (!message.result) throw new Error("Missing Parallel Search result.");
      return message.result;
    }
  }

  return {
    async connect() {
      const result = await request("initialize", {
        protocolVersion, capabilities: {},
        clientInfo: { name: "Portable-Local-Studio", version: "1.0" },
      });
      if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error("Unsupported Parallel MCP protocol version.");
      protocolVersion = result.protocolVersion;
      await request("notifications/initialized", {}, true);
      const { tools } = await request("tools/list", {});
      if (!["web_search", "web_fetch"].every(name => tools?.some(tool => tool.name === name))) {
        throw new Error("Parallel Search tools are unavailable.");
      }
    },
    async call(name, args) {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(result.content?.find(item => item.type === "text")?.text || "Parallel Search failed.");
      const data = result.structuredContent || JSON.parse(result.content?.find(item => item.type === "text")?.text || "null");
      if (!Array.isArray(data?.results)) throw new Error("Invalid Parallel Search results.");
      return data.results;
    },
  };
}

function publicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    // Only public web results are eligible for extraction. No local request is
    // made to result URLs; extraction always goes to the fixed MCP endpoint.
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    // Public DNS names and public IPv4 URLs are supported; IPv6 literals and
    // common private/link-local IPv4 ranges are excluded from this web provider.
    if (host.startsWith("[")) return false;
    if (isIP(host) === 4) {
      const [a, b] = host.split(".").map(Number);
      return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
        !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
        !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
    }
    return host.includes(".");
  } catch (_) { return false; }
}

async function parallelSearch(query, options = {}) {
  if (options.sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.sessionId)) {
    throw new Error("Search session ID must be a UUID.");
  }
  const client = createClient(options);
  await client.connect();
  const session_id = options.sessionId;
  if (/^https?:\/\/\S+$/i.test(query)) {
    if (!publicHttpUrl(query)) throw new Error("Only public web URLs can be extracted.");
    const pages = await client.call("web_fetch", { urls: [query], session_id });
    return pages.filter(page => publicHttpUrl(page.url)).map(page => ({
      title: page.title || page.url, url: page.url, snippet: "",
      content: (page.excerpts || []).join("\n"), fetched: Boolean(page.excerpts?.length), provider: "parallel",
    }));
  }
  const search_queries = [query];
  const freshness = { day: "the last day", week: "the last week", month: "the last month", year: "the last year" }[options.timeFilter];
  const objective = freshness ? `${query}\nPrefer sources published in ${freshness}.` : query;
  const results = await client.call("web_search", { objective, search_queries, session_id });
  const sources = results.filter(result => publicHttpUrl(result.url))
    .filter((result, index, all) => all.findIndex(item => item.url === result.url) === index)
    .slice(0, options.resultLimit || 5)
    .map(result => ({
      title: result.title || result.url, url: result.url,
      snippet: (result.excerpts || []).join("\n"), provider: "parallel",
    }));
  // Search excerpts are usually sufficient. Fetch only sources without excerpts.
  const urls = sources.filter(source => !source.snippet.trim()).slice(0, options.fetchLimit ?? 3).map(source => source.url);
  if (urls.length) {
    const pages = await client.call("web_fetch", { urls, objective: query.slice(0, 200), search_queries, session_id });
    for (const source of sources) {
      const page = pages.find(item => item.url === source.url);
      if (page) {
        source.content = (page.excerpts || []).join("\n");
        source.fetched = Boolean(source.content);
      }
    }
  }
  return sources;
}

module.exports = { parallelSearch };
