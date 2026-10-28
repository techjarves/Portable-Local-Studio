export function readSearchProvider(storage) {
  try {
    return (storage ?? globalThis.localStorage).getItem("webSearchProvider") === "parallel" ? "parallel" : "duckduckgo";
  } catch (_) { return "duckduckgo"; }
}

export function saveSearchProvider(provider, storage) {
  try { (storage ?? globalThis.localStorage).setItem("webSearchProvider", provider); } catch (_) {}
}

// The UI owns conversations; an MCP connection never owns these IDs. Resetting
// a chat discards its search identity without changing the saved chat filename.
export function createSearchSessions() {
  const sessions = new Map();
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // randomUUID requires a secure context. getRandomValues also works when
    // accessing this portable server through an HTTP address on the LAN.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return {
    forConversation(id) {
      if (!sessions.has(id)) sessions.set(id, newId());
      return sessions.get(id);
    },
    reset(id) { sessions.delete(id); },
  };
}
