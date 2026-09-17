import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Play,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";

const sampleFiles = [
  { name: "app", type: "folder" },
  { name: "scripts", type: "folder" },
  { name: "README.md", type: "file" },
  { name: "mac.sh", type: "file" },
  { name: "linux.sh", type: "file" },
  { name: "windows.bat", type: "file" },
];

function WorkPanel({ onClose }) {
  const [projectPath, setProjectPath] = useState(() => localStorage.getItem("work-project-path") || "");
  const [projectName, setProjectName] = useState(() => localStorage.getItem("work-project-name") || "No project selected");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState(() => localStorage.getItem("work-mode") || "Agent");
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("work-messages") || "[]");
    } catch (_) {
      return [];
    }
  });

  const activeModel = localStorage.getItem("active-model") || "No local model loaded";

  useEffect(() => {
    localStorage.setItem("work-mode", mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem("work-messages", JSON.stringify(messages));
  }, [messages]);

  const displayFiles = useMemo(() => sampleFiles, []);

  const connectProject = () => {
    const cleaned = projectPath.trim();
    if (!cleaned) return;
    const parts = cleaned.split(/[\\/]/).filter(Boolean);
    const name = parts[parts.length - 1] || cleaned;
    setProjectName(name);
    localStorage.setItem("work-project-path", cleaned);
    localStorage.setItem("work-project-name", name);
  };

  const sendPrompt = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: "user", text },
      {
        id: `${Date.now()}-system`,
        role: "system",
        text: "Work UI is ready. Local agent execution will be connected to the Studio backend in the next integration step.",
      },
    ]);
    setDraft("");
  };

  return (
    <div style={{
      position: "absolute",
      inset: "68px 0 0 0",
      zIndex: 50,
      display: "flex",
      flexDirection: "column",
      background: "var(--md-sys-color-surface, #101116)",
      color: "var(--md-sys-color-on-surface, #f2f2f5)",
      borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)",
    }}>
      <div style={{
        height: 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 18px",
        borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)",
        background: "var(--md-sys-color-surface-container-low, #15161c)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Code2 size={20} />
          <strong style={{ fontSize: 15 }}>Work</strong>
          <span style={{ opacity: 0.45 }}>•</span>
          <span style={{ opacity: 0.82, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant, #343640)", fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: activeModel === "No local model loaded" ? "#777" : "#55cf7a" }} />
            <span style={{ maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeModel}</span>
          </div>
          <button className="m3-btn m3-btn-outlined" onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) 270px" }}>
        <aside style={{ minWidth: 0, borderRight: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", flexDirection: "column", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", opacity: 0.6, marginBottom: 8 }}>Project</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && connectProject()}
                placeholder="/Volumes/.../MyProject"
                style={{ flex: 1, minWidth: 0, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", borderRadius: 8, padding: "8px 9px", fontSize: 12 }}
              />
              <button onClick={connectProject} title="Open project" style={{ width: 34, border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 8, background: "transparent", color: "inherit", cursor: "pointer" }}>
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          <div style={{ padding: "10px 8px", flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px 8px" }}>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", opacity: 0.6 }}>Explorer</span>
              <Plus size={14} style={{ opacity: 0.65 }} />
            </div>
            {displayFiles.map((file) => (
              <div key={file.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 7, fontSize: 13, opacity: 0.88 }}>
                {file.type === "folder" ? <Folder size={15} /> : <FileCode2 size={15} />}
                <span>{file.name}</span>
              </div>
            ))}
          </div>

          <div style={{ padding: 10, borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)", fontSize: 12, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><GitBranch size={14} /> main</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.72 }}><ShieldCheck size={14} /> Project sandbox</div>
          </div>
        </aside>

        <main style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "28px max(24px, 7vw)" }}>
            {messages.length === 0 ? (
              <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
                <div style={{ maxWidth: 620, width: "100%", textAlign: "center" }}>
                  <div style={{ width: 58, height: 58, margin: "0 auto 18px", borderRadius: 18, display: "grid", placeItems: "center", background: "var(--md-sys-color-primary-container, #302d58)", color: "var(--md-sys-color-on-primary-container, #eeeaff)" }}>
                    <Bot size={28} />
                  </div>
                  <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>Local Coding Work</h2>
                  <p style={{ margin: "0 auto 20px", opacity: 0.68, lineHeight: 1.55 }}>
                    Connect a project and ask the local coding agent to inspect code, edit files, run tests, and review changes.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, textAlign: "left" }}>
                    {["Explain this project", "Find and fix a bug", "Build a new feature"].map((item) => (
                      <button key={item} onClick={() => setDraft(item)} style={{ padding: 13, borderRadius: 10, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "var(--md-sys-color-surface-container-low, #15161c)", color: "inherit", cursor: "pointer", textAlign: "left" }}>{item}</button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 16 }}>
                {messages.map((message) => (
                  <div key={message.id} style={{ display: "flex", justifyContent: message.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "82%", padding: "12px 14px", borderRadius: 13, background: message.role === "user" ? "var(--md-sys-color-primary-container, #302d58)" : "var(--md-sys-color-surface-container, #1b1c22)", lineHeight: 1.5, fontSize: 14 }}>
                      {message.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: "12px max(20px, 6vw) 16px", borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <div style={{ maxWidth: 820, margin: "0 auto", border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 14, background: "var(--md-sys-color-surface-container-low, #15161c)", overflow: "hidden" }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendPrompt();
                  }
                }}
                placeholder="Ask the local coding agent to work on this project..."
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", resize: "none", border: 0, outline: 0, background: "transparent", color: "inherit", padding: "13px 14px 6px", font: "inherit" }}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 9px 9px" }}>
                <div style={{ display: "flex", gap: 7 }}>
                  {["Ask", "Edit", "Agent"].map((item) => (
                    <button key={item} onClick={() => setMode(item)} style={{ border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 8, padding: "6px 9px", background: mode === item ? "var(--md-sys-color-secondary-container, #34324a)" : "transparent", color: "inherit", cursor: "pointer", fontSize: 12 }}>{item}</button>
                  ))}
                </div>
                <button onClick={sendPrompt} style={{ border: 0, borderRadius: 9, padding: "8px 11px", background: "var(--md-sys-color-primary, #c5c1ff)", color: "var(--md-sys-color-on-primary, #292653)", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, fontWeight: 650 }}>
                  <Send size={15} /> Send
                </button>
              </div>
            </div>
          </div>
        </main>

        <aside style={{ borderLeft: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", flexDirection: "column", minWidth: 0, background: "var(--md-sys-color-surface-container-lowest, #0d0e12)" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 650, fontSize: 13 }}><SquareTerminal size={16} /> Activity</div>
          </div>
          <div style={{ padding: 13, display: "grid", gap: 10, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><CheckCircle2 size={15} style={{ marginTop: 1, opacity: 0.75 }} /><span>Work workspace mounted</span></div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: 0.7 }}><FolderOpen size={15} style={{ marginTop: 1 }} /><span>{projectPath ? `Project: ${projectPath}` : "Choose a project folder"}</span></div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: 0.7 }}><Bot size={15} style={{ marginTop: 1 }} /><span>{activeModel}</span></div>
          </div>

          <div style={{ marginTop: "auto", borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)", padding: 12, display: "grid", gap: 8 }}>
            <button disabled style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 9, borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", opacity: 0.45 }}><Play size={14} /> Run Tests</button>
            <button disabled style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 9, borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", opacity: 0.45 }}><Settings2 size={14} /> Review Changes</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function WorkIntegration() {
  const [navMount, setNavMount] = useState(null);
  const [mainMount, setMainMount] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ensureMounts = () => {
      const nav = document.querySelector(".nav-list");
      const main = document.querySelector(".main-content");
      if (!nav || !main) return false;

      let navHost = document.getElementById("local-work-nav-host");
      if (!navHost) {
        navHost = document.createElement("div");
        navHost.id = "local-work-nav-host";
        const afterChat = nav.children[1];
        if (afterChat?.nextSibling) nav.insertBefore(navHost, afterChat.nextSibling);
        else nav.appendChild(navHost);
      }

      let mainHost = document.getElementById("local-work-main-host");
      if (!mainHost) {
        mainHost = document.createElement("div");
        mainHost.id = "local-work-main-host";
        main.appendChild(mainHost);
      }
      if (getComputedStyle(main).position === "static") main.style.position = "relative";

      if (!cancelled) {
        setNavMount(navHost);
        setMainMount(mainHost);
      }
      return true;
    };

    if (!ensureMounts()) {
      const timer = setInterval(() => {
        if (ensureMounts()) clearInterval(timer);
      }, 100);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const nav = document.querySelector(".nav-list");
    if (!nav) return;
    const handler = (event) => {
      const clickedWork = event.target.closest("#local-work-nav-host");
      if (!clickedWork) setOpen(false);
    };
    nav.addEventListener("click", handler);
    return () => nav.removeEventListener("click", handler);
  }, []);

  const navItem = navMount ? createPortal(
    <div
      className={`nav-item ${open ? "active" : ""}`}
      onClick={() => setOpen(true)}
      title="Local coding workspace"
    >
      <Code2 size={20} />
      <span>Work</span>
    </div>,
    navMount,
  ) : null;

  const workspace = open && mainMount ? createPortal(
    <WorkPanel onClose={() => setOpen(false)} />,
    mainMount,
  ) : null;

  return <>{navItem}{workspace}</>;
}
