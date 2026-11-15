import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, Trash2, Square, X, ChevronDown, Globe2, Plus, PenLine, Lightbulb, Zap, FileText, ArrowUp, Brain, Mic, AudioLines, Image as ImageIcon, PanelLeft, Copy, Check } from "lucide-react";
import {
  getBackendStatus,
  stopServer,
  getDownloadProgress,
  getLlmStatus,
  listLlmModels,
  streamChatWithLlm,
  startLlm,
  stopLlm,
} from "../services/api";
import katex from "katex";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "katex/dist/katex.min.css";
import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-java";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-markdown";

// Splits model reasoning from the answer. Reasoning is always extracted (and shown collapsed
// when Deep Think is off), because some models think even when it was not requested.
const processMessageContent = (rawText, apiReasoning = "") => {
  if (typeof rawText !== "string") {
    return { content: rawText, reasoning: apiReasoning || "" };
  }
  if (apiReasoning) {
    return { content: rawText.replace(/<\/?think>/g, "").trim(), reasoning: String(apiReasoning).trim() };
  }

  const cleanReasoningControlTags = (value) => String(value || "")
    .replace(/<\|channel\|>thought/g, "")
    .replace(/<\|channel\|>model/g, "")
    .replace(/<\|turn\|>model/g, "")
    .replace(/<\|im_start\|>model/g, "")
    .replace(/<\|think\|>|<\|thought\|>|<think>|<thinking>|<thought>/g, "")
    .replace(/<\|\/think\|>|<\|\/thought\|>|<\/think>|<\/thinking>|<\/thought>/g, "")
    .trim();

  const startTags = ["<|channel|>thought", "<|think|>", "<|thought|>", "<think>", "<thinking>", "<thought>"];
  const endTags = ["<|channel|>model", "<|turn>model", "<|im_start|>model", "</think>", "</thinking>", "</thought>", "<|/think|>", "<|/thought|>"];

  let startIdx = -1;
  let matchedStartTag = "";

  for (const tag of startTags) {
    const idx = rawText.indexOf(tag);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      matchedStartTag = tag;
    }
  }

  if (startIdx === -1) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let endIdx = -1;
  for (const tag of endTags) {
    const idx = rawText.indexOf(tag, startIdx + matchedStartTag.length);
    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) {
      endIdx = idx;
    }
  }

  if (endIdx === -1) {
    const rawReasoning = rawText.substring(startIdx + matchedStartTag.length);
    return { content: "", reasoning: cleanReasoningControlTags(rawReasoning) };
  }

  const rawReasoning = rawText.substring(startIdx + matchedStartTag.length, endIdx);
  const rawContent = rawText.substring(endIdx);

  return {
    content: cleanReasoningControlTags(rawContent),
    reasoning: cleanReasoningControlTags(rawReasoning)
  };
};

function ChatThinkingSection({ reasoning, timeElapsed, isComplete }) {
  const [isExpanded, setIsExpanded] = useState(true);

  const formattedTime = timeElapsed > 0 
    ? ` (${timeElapsed.toFixed(timeElapsed < 10 ? 1 : 0)}s)`
    : "";

  return (
    <div className="chat-thinking-container">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="chat-thinking-header"
      >
        <span className="chat-thinking-title">
          {isComplete ? `Thought process${formattedTime}` : `Thinking...${formattedTime}`}
        </span>
        <ChevronDown
          size={14}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>
      {isExpanded && (
        <div className="chat-thinking-content">
          {reasoning}
        </div>
      )}
    </div>
  );
}

const messageContainsImage = (message) => (
  Array.isArray(message?.content) &&
  message.content.some((item) => item?.type === "image_url" && item?.image_url?.url)
);

function TextChat({ 
  specs, 
  showAlert, 
  showConfirm, 
  textSettings, 
  setTextSettings, 
  setActiveModel, 
  setServerRunning,
  conversations,
  setConversations,
  activeConversationId,
  setActiveConversationId,
  saveConversationState,
  setIsLlmLoaded,
  setActiveTab,
  onThreadChange,
  sidebarVisible = true,
  onToggleSidebar
}) {
  const formatGenerationTime = (seconds) => {
    const value = Number(seconds) || 0;
    if (value < 1) return `${Math.round(value * 1000)} ms`;
    return `${value.toFixed(value < 10 ? 2 : 1)} s`;
  };

  const [models, setModels] = useState([]);
  const [status, setStatus] = useState({ ready: false, running: false, settings: {} });
  const [selectedModel, setSelectedModel] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [webTimeFilter, setWebTimeFilter] = useState("any");
  const [loadingModel, setLoadingModel] = useState(null);
  const [tokenUsage, setTokenUsage] = useState({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  });

  useEffect(() => {
    if (setIsLlmLoaded) {
      setIsLlmLoaded(status.ready ? (status.settings?.model || true) : false);
    }
  }, [status.ready, status.settings?.model, setIsLlmLoaded]);

  const [showModelMenu, setShowModelMenu] = useState(false);
  const modelMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const estimateTokens = (text) => {
    const value = String(text || "").trim();
    if (!value) return 0;
    const wordCount = value.split(/\s+/).filter(Boolean).length;
    return Math.max(wordCount, Math.ceil(value.length / 4));
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getAutoMaxResponseTokens = (promptTokens, thinkingEnabled) => {
    const contextLimit = Number(status.settings?.contextSize || textSettings?.contextSize || 4096);
    const safetyBuffer = thinkingEnabled ? 768 : 512;
    const preferredMinimum = thinkingEnabled ? 512 : 256;
    const available = contextLimit - promptTokens - safetyBuffer;
    if (available <= 0) return 64;
    return clamp(available, Math.min(preferredMinimum, available), 4096);
  };
  
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const completedDownloadRef = useRef("");
  const loadingModelRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const prevMessagesLengthRef = useRef(0);
  const followGenerationRef = useRef(false);
  const abortControllerRef = useRef(null);
  // rAF batching: accumulate token updates and flush once per frame
  const tokenBufferRef = useRef(null);
  const rafRef = useRef(null);
  // Debounced stats: only update stats pill every 250ms
  const statsDebounceRef = useRef(null);

  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const supportsVision = Boolean(status.ready && status.settings?.supportsVision);
  const supportsThinking = Boolean(status.ready && status.settings?.supportsThinking);
  const deepThinkEnabled = status.ready
    ? status.settings?.enableThinking === true
    : textSettings?.enableThinking === true;
  const visionStatus = status.settings?.visionStatus || "Image input requires a matching mmproj projector file.";

  const resizeComposerInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 200;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposerInput();
  }, [input, resizeComposerInput]);

  const isImage = (file) => {
    return /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith("image/");
  };

  const isTextFile = (file) => {
    return /\.(txt|md|csv|js|jsx|ts|tsx|py|json|css|html|java|cpp|c|h|rs|go|sh|bat|xml|yaml|yml)$/i.test(file.name) || file.type.startsWith("text/");
  };

  const optimizeImageForVision = (file, maxSide = 1024, quality = 0.92) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const originalDataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const sendDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          previewDataUrl: originalDataUrl,
          sendDataUrl,
          originalWidth: img.width,
          originalHeight: img.height,
          width,
          height,
        });
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    files.forEach((file) => {
      if (isImage(file)) {
        if (!supportsVision) {
          showAlert({
            title: "Vision Model Required",
            message: "To attach images, please select and load a multimodal/vision model with an mmproj file.",
            danger: true,
          });
          return;
        }
        optimizeImageForVision(file)
          .then((image) => {
            setAttachments((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                file,
                type: "image",
                name: file.name,
                dataUrl: image.previewDataUrl,
                sendDataUrl: image.sendDataUrl,
                width: image.width,
                height: image.height,
                originalWidth: image.originalWidth,
                originalHeight: image.originalHeight,
              },
            ]);
          })
          .catch((err) => {
            showAlert({ title: "Image Error", message: err.message || String(err), danger: true });
          });
      } else if (isTextFile(file)) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "document",
              name: file.name,
              content: event.target.result,
            },
          ]);
        };
        reader.readAsText(file);
      } else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        extractPdfText(file)
          .then((text) => {
            if (!text.trim()) {
              throw new Error(`"${file.name}" has no extractable text (it may be a scanned image). Export the pages as images and attach those to a vision model instead.`);
            }
            setAttachments((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                file,
                type: "document",
                name: file.name,
                content: text,
              },
            ]);
          })
          .catch((err) => {
            showAlert({ title: "PDF Error", message: err.message || String(err), danger: true });
          });
      } else {
        showAlert({
          title: "Unsupported File",
          message: `File "${file.name}" is not supported. Please select an image (JPEG, PNG, WEBP), a PDF, or a text/code file.`,
          danger: true,
        });
      }
    });

    e.target.value = "";
  };

  useEffect(() => {
    loadingModelRef.current = loadingModel;
  }, [loadingModel]);


  const buildTextStartOptions = (settings) => ({
    threads: settings?.threads || specs?.cpu_cores_physical || 4,
    contextSize: settings?.contextSize ?? 0,
    gpuLayers: settings?.gpuLayers ?? -1,
    enableThinking: settings?.enableThinking === true,
    flashAttn: settings?.flashAttn,
    cacheTypeK: settings?.cacheTypeK,
    cacheTypeV: settings?.cacheTypeV,
    mlock: settings?.mlock,
    mmap: settings?.mmap,
    cachePrompt: settings?.cachePrompt,
    defragThold: settings?.defragThold,
    batchSize: settings?.batchSize,
    ubatchSize: settings?.ubatchSize,
    performanceProfile: settings?.performanceProfile,
    preferredBackend: settings?.preferredBackend,
  });

  const handleThinkingToggle = async () => {
    const enabled = !deepThinkEnabled;
    const nextSettings = { ...textSettings, enableThinking: enabled };

    if (!status.ready || !status.settings?.model) {
      setTextSettings(nextSettings);
      return;
    }

    const reload = await showConfirm({
      title: enabled ? "Reload With DeepThink?" : "Reload Without DeepThink?",
      message: "Changing DeepThink requires reloading the text model before it affects new replies. Reload now, or skip and keep the currently loaded model as-is?",
      confirmLabel: "Reload",
      cancelLabel: "Skip",
    });
    if (!reload) return;

    setIsBusy(true);
    try {
      setTextSettings(nextSettings);
      await stopLlm();
      const result = await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
    } catch (err) {
      showAlert({ title: "Text Model Reload Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!supportsVision) {
      setAttachments((current) => current.filter((attachment) => attachment.type !== "image"));
    }
  }, [supportsVision]);

  // Load conversation messages when activeConversationId changes
  useEffect(() => {
    if (isBusy) return;
    if (activeConversationId) {
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) {
        setMessages(conv.messages);
        if (conv.model && models.some(m => m.filename === conv.model)) {
          setSelectedModel(conv.model);
        }
        const total = conv.messages.reduce((sum, m) => {
          const text = Array.isArray(m.content)
            ? m.content.map(c => c.text || "").join(" ")
            : (m.content || "");
          return sum + estimateTokens(text) + estimateTokens(m.reasoning || "");
        }, 0);
        setTokenUsage({
          prompt_tokens: Math.round(total * 0.7),
          completion_tokens: Math.round(total * 0.3),
          total_tokens: total
        });
      }
    } else {
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    }
  }, [activeConversationId, conversations, models, isBusy]);

  const refresh = useCallback(async () => {
    const [nextModels, nextStatus] = await Promise.all([listLlmModels(), getLlmStatus()]);
    const selectableModels = nextModels.filter((model) => !model.isProjector);
    setModels(selectableModels);
    setStatus(nextStatus);
    const active = nextStatus.settings?.model;
    setSelectedModel((current) => {
      const saved = localStorage.getItem("selectedLlmModel");
      const savedExists = selectableModels.some((m) => m.filename === saved);
      return active || current || (savedExists ? saved : "") || selectableModels[0]?.filename || "";
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => {
      getLlmStatus().then((nextStatus) => {
        setStatus(nextStatus);
        // If it suddenly loaded or became ready externally, update selection and reset loading states
        if (nextStatus.ready && nextStatus.settings?.model) {
          setSelectedModel(nextStatus.settings.model);
          setLoadingModel(null);
        }
      }).catch(() => {});
      getDownloadProgress().then((state) => {
        if (state.kind === "text" && (state.active || state.error || state.progress === 100)) {
          const completionKey = `${state.filename || ""}:${state.downloadedBytes || 0}`;
          if (!state.active && !state.error && completedDownloadRef.current !== completionKey) {
            completedDownloadRef.current = completionKey;
            refresh().catch(() => {});
          }
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    // Track the length even while the thread is unmounted (home screen), so the
    // first message of a new or cleared chat is detected correctly
    const len = messages.length;
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = len;

    const container = chatMessagesRef.current;
    if (!container) return;

    const lastMessage = messages[len - 1];
    const isNewUserMessage = len > prevLen && lastMessage?.role === "user";
    const isOpeningConversation = prevLen === 0 && len > 0;

    // Scroll only the message list. scrollIntoView() also scrolls every scrollable
    // ancestor, which pushed the header and composer off screen while streaming.
    // Follow new text only while the reader is at the bottom (see handleMessagesScroll),
    // so scrolling up during generation is never pulled back down.
    if (isNewUserMessage || isOpeningConversation) followGenerationRef.current = true;
    if (followGenerationRef.current) {
      container.scrollTo({ top: container.scrollHeight });
    }
  }, [messages, isBusy, loadingModel]);

  // Lets the app hide its top bar while a conversation is on screen
  useEffect(() => {
    onThreadChange?.(messages.length > 0 && !loadingModel);
  }, [messages.length, loadingModel, onThreadChange]);

  const handleMessagesScroll = (event) => {
    const container = event.currentTarget;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    followGenerationRef.current = distanceFromBottom <= 24;
  };

  const handleModelChange = async (filename) => {
    if (!filename) {
      if (status.ready) {
        setIsBusy(true);
        try {
          await stopLlm();
          setStatus((prev) => ({ ...prev, ready: false, running: false }));
          setSelectedModel("");
          setMessages([]);
          setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        } catch (err) {
          showAlert({ title: "Unload Failed", message: err.message || String(err), danger: true });
        } finally {
          setIsBusy(false);
        }
      }
      return;
    }

    // Only one large model fits at a time: if an image model is loaded, ask before swapping
    const imageStatus = await getBackendStatus().catch(() => null);
    const imageModel = imageStatus?.ready && imageStatus.settings?.model
      ? imageStatus.settings.model.split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|gguf)$/i, "")
      : null;
    if (imageModel) {
      const confirmed = await showConfirm({
        title: "Unload the image model?",
        message: `${imageModel} is loaded for images. Only one large model can run at a time, so it will be unloaded to load ${filename.replace(/\.gguf$/i, "")}. You can load it again from Images later.`,
        confirmLabel: "Unload and load",
      });
      if (!confirmed) return;
    }

    setSelectedModel(filename);
    localStorage.setItem("selectedLlmModel", filename);
    setIsBusy(true);
    setLoadingModel(filename);
    try {
      if (imageModel) {
        await stopServer();
        if (setServerRunning) setServerRunning(false);
      }

      const result = await startLlm(filename, {
        threads: textSettings?.threads || specs?.cpu_cores_physical || 4,
        contextSize: textSettings?.contextSize ?? 0,
        gpuLayers: textSettings?.gpuLayers ?? -1,
        enableThinking: textSettings?.enableThinking === true,
        flashAttn: textSettings?.flashAttn,
        cacheTypeK: textSettings?.cacheTypeK,
        cacheTypeV: textSettings?.cacheTypeV,
        mlock: textSettings?.mlock,
        mmap: textSettings?.mmap,
        cachePrompt: textSettings?.cachePrompt,
        defragThold: textSettings?.defragThold,
        batchSize: textSettings?.batchSize,
        ubatchSize: textSettings?.ubatchSize,
        performanceProfile: textSettings?.performanceProfile,
        preferredBackend: textSettings?.preferredBackend,
      });
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    } catch (err) {
      if (loadingModelRef.current === filename) {
        showAlert({ title: "Text Model Load Failed", message: err.message, danger: true });
      }
    } finally {
      setLoadingModel(null);
      setIsBusy(false);
    }
  };

  const handleCancelLlmLoad = async () => {
    try {
      await stopLlm();
    } catch (_) {}
    setLoadingModel(null);
    setIsBusy(false);
    setSelectedModel("");
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
  };

  const sendMessage = async () => {
    const text = input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || isBusy || !status.ready) return;

    let convId = activeConversationId;
    let isNew = false;
    if (!convId) {
      convId = "chat_" + Date.now();
      setActiveConversationId(convId);
      isNew = true;
    }

    // Delimited context blocks for document attachments
    let documentContext = "";
    attachments.filter(att => att.type === "document").forEach((att) => {
      documentContext += `\n[Attached File: ${att.name}]\n${att.content}\n`;
    });

    const imageAttachments = attachments.filter(att => att.type === "image");
    const conversationHasImage = messages.some(messageContainsImage);
    const requestHasImage = imageAttachments.length > 0 || conversationHasImage;
    const visionInstruction = requestHasImage
      ? "For images in this conversation: answer in natural language, describe the actual image content, and read visible text carefully when relevant. If the user asks a follow-up like \"what is this\" or \"explain\", treat it as referring to the most recent image unless they say otherwise. Do not output raw JSON, arrays, bounding boxes, OCR layout objects, UI class names, or detection labels unless the user explicitly asks for that format."
      : "";
    const requestText = imageAttachments.length > 0
      ? (text && text !== "?" ? text : "Describe what is visible in the image.")
      : text;
    const displayText = text || (imageAttachments.length > 0 ? "Describe what is visible in the image." : "");
    const requestCombinedText = [
      requestText,
      documentContext,
    ].filter(Boolean).join("\n\n").trim();
    const displayCombinedText = documentContext
      ? [displayText, documentContext].filter(Boolean).join("\n\n").trim()
      : displayText;

    let userMessageContent;
    let requestUserMessageContent;
    if (imageAttachments.length > 0) {
      userMessageContent = [
        {
          type: "text",
          text: displayCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.dataUrl
          }
        }))
      ];
      requestUserMessageContent = [
        {
          type: "text",
          text: requestCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.sendDataUrl || img.dataUrl
          }
        }))
      ];
    } else {
      userMessageContent = displayCombinedText;
      requestUserMessageContent = requestCombinedText;
    }

    const nextMessages = [...messages, { role: "user", content: userMessageContent }];
    const requestConversationMessages = [...messages, { role: "user", content: requestUserMessageContent }];
    followGenerationRef.current = true;
    setMessages(nextMessages);
    setInput("");
    setIsBusy(true);

    const displayTitleText = text || (imageAttachments.length > 0 ? "Sent Image" : "Sent File");
    // Keep the full first line; the sidebar truncates visually
    const firstTitle = isNew ? displayTitleText.split("\n")[0].slice(0, 80) : null;
    saveConversationState(convId, nextMessages, selectedModel, firstTitle);

    const requestStartedAt = performance.now();
    setMessages([...nextMessages, {
      role: "assistant",
      content: "",
      generationStats: { status: "starting", tokens: 0, tokensPerSecond: 0, seconds: 0, vision: requestHasImage, web: useWebSearch },
    }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = textSettings?.systemPrompt || "You are a helpful local AI assistant.";
      const combinedSystemPrompt = [
        systemPrompt.trim(),
        visionInstruction,
      ].filter(Boolean).join("\n\n");
      const requestMessages = [
        ...(combinedSystemPrompt ? [{ role: "system", content: combinedSystemPrompt }] : []),
        ...requestConversationMessages,
      ];
      const promptTokenEstimate = requestMessages.reduce((sum, message) => {
        const messageText = Array.isArray(message.content)
          ? message.content.map((item) => item.text || "").join(" ")
          : (message.content || "");
        return sum + estimateTokens(messageText);
      }, 0);
      setTokenUsage({
        prompt_tokens: promptTokenEstimate,
        completion_tokens: 0,
        total_tokens: promptTokenEstimate,
      });

      let assistantText = "";
      let rawAssistantText = "";
      let assistantReasoning = "";
      let streamedTokens = 0;
      let firstTokenAt = null;
      let thinkingStartedAt = null;
      let thinkingEndedAt = null;
      let thinkingDuration = 0;

      const thinkingEnabled = deepThinkEnabled;
      const manualMaxTokens = textSettings?.maxTokens || 1024;
      const effectiveMaxTokens = textSettings?.responseTokenMode === "manual"
        ? (thinkingEnabled ? Math.max(manualMaxTokens, 1024) : manualMaxTokens)
        : getAutoMaxResponseTokens(promptTokenEstimate, thinkingEnabled);

      const response = await streamChatWithLlm(requestMessages, {
        temperature: textSettings?.temperature || 0.7,
        maxTokens: effectiveMaxTokens,
        topP: textSettings?.topP,
        topK: textSettings?.topK,
        minP: textSettings?.minP,
        repeatPenalty: textSettings?.repeatPenalty,
        seed: textSettings?.seed,
        enableThinking: thinkingEnabled,
        useWeb: useWebSearch,
        timeFilter: webTimeFilter,
        signal: controller.signal,
      }, (_token, fullText, _reasoningToken, fullReasoning) => {
        const now = performance.now();
        if (streamedTokens === 0) {
          firstTokenAt = now;
        }
        streamedTokens += 1;
        const generationSeconds = firstTokenAt
          ? Math.max(0.05, (now - firstTokenAt) / 1000)
          : Math.max(0.05, (now - requestStartedAt) / 1000);
        
        rawAssistantText = fullText;
        const processed = processMessageContent(fullText, fullReasoning);
        assistantText = processed.content;
        assistantReasoning = processed.reasoning;

        // Calculate thinking duration
        if (processed.reasoning && !thinkingStartedAt) {
          thinkingStartedAt = now;
        }
        if (processed.content && thinkingStartedAt && !thinkingEndedAt) {
          thinkingEndedAt = now;
          thinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
        }
        const currentThinkingDuration = thinkingEndedAt 
          ? thinkingDuration 
          : (thinkingStartedAt ? (now - thinkingStartedAt) / 1000 : 0);

        // Debounced stats update: only update stats every 250ms for smoother UI
        // while text still updates per-frame via rAF batching
        const currentStats = {
          status: "streaming",
          tokens: streamedTokens,
          tokensPerSecond: streamedTokens / generationSeconds,
          seconds: (now - requestStartedAt) / 1000,
        };
        // rAF batching: accumulate updates and flush once per frame (~16ms)
        // This reduces React re-renders from N per token to ~60/sec
        tokenBufferRef.current = {
          content: processed.content,
          reasoning: processed.reasoning,
          thinkingDuration: currentThinkingDuration,
          stats: currentStats,
        };

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            const buffer = tokenBufferRef.current;
            if (buffer) {
              setMessages((prev) => {
                const updated = [...prev];
                if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: buffer.content,
                    reasoning: buffer.reasoning,
                    thinkingDuration: buffer.thinkingDuration,
                    generationStats: buffer.stats,
                  };
                }
                return updated;
              });
              tokenBufferRef.current = null;
            }
            rafRef.current = null;
          });
        }
      });

      const completedAt = performance.now();
      let finalThinkingDuration = thinkingDuration;
      if (thinkingStartedAt && !thinkingEndedAt) {
        thinkingEndedAt = completedAt;
        finalThinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
      }

      const exactTokens = Number(response.timings?.predicted_n) || streamedTokens;
      const backendTotalMs = Number(response.timings?.prompt_ms || 0) + Number(response.timings?.predicted_ms || 0);
      const exactSeconds = backendTotalMs > 0
        ? backendTotalMs / 1000
        : (completedAt - requestStartedAt) / 1000;
      const exactTokensPerSecond = Number(response.timings?.predicted_per_second)
        || (exactTokens / Math.max(0.001, exactSeconds));
      const generationStats = {
        status: "complete",
        tokens: exactTokens,
        tokensPerSecond: exactTokensPerSecond,
        seconds: exactSeconds,
        finishReason: response.finishReason || null,
        truncated: response.finishReason === "length",
      };
      
      const processed = processMessageContent(response.content || rawAssistantText || assistantText, response.reasoningContent || assistantReasoning);
      const finalMessages = [...nextMessages, {
        role: "assistant",
        content: processed.content,
        reasoning: processed.reasoning,
        thinkingDuration: finalThinkingDuration,
        generationStats,
        webSources: response.webSources || [],
      }];
      setMessages(finalMessages);
      saveConversationState(convId, finalMessages, selectedModel);
      const finalCompletionEstimate = Math.max(
        exactTokens,
        estimateTokens(processed.content) + estimateTokens(processed.reasoning)
      );
      const finalUsageEstimate = {
        prompt_tokens: promptTokenEstimate,
        completion_tokens: finalCompletionEstimate,
        total_tokens: promptTokenEstimate + finalCompletionEstimate,
      };
      setTokenUsage(response.usage
        ? {
            prompt_tokens: Math.max(Number(response.usage.prompt_tokens) || 0, finalUsageEstimate.prompt_tokens),
            completion_tokens: Math.max(Number(response.usage.completion_tokens) || 0, finalUsageEstimate.completion_tokens),
            total_tokens: Math.max(Number(response.usage.total_tokens) || 0, finalUsageEstimate.total_tokens),
          }
        : finalUsageEstimate
      );
      
      // Clean up attached files on success
      setAttachments([]);
    } catch (err) {
      if (err.name === "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
            const lastMsg = updated[updated.length - 1];
            updated[updated.length - 1] = {
              ...lastMsg,
              generationStats: lastMsg.generationStats ? {
                ...lastMsg.generationStats,
                status: "complete",
              } : null
            };
            saveConversationState(convId, updated, selectedModel);
          }
          return updated;
        });
      } else {
        const finalMessages = [...nextMessages, { role: "assistant", content: `Error: ${err.message}`, error: true }];
        setMessages(finalMessages);
        saveConversationState(convId, finalMessages, selectedModel);
      }
    } finally {
      setIsBusy(false);
      abortControllerRef.current = null;
      setTimeout(() => {
        followGenerationRef.current = false;
      }, 250);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    if (activeConversationId) {
      saveConversationState(activeConversationId, [], selectedModel);
    }
  };

  const hasMessages = messages.length > 0;
  // Shows what is actually loaded, not just what was last chosen
  const modelLabel = status.ready && status.settings?.model
    ? status.settings.model.replace(/\.gguf$/i, "")
    : "Select model";
  const contextMax = status.settings?.contextSize || 4096;
  const contextUsed = tokenUsage.total_tokens || 0;
  const contextPercent = Math.min(100, Math.round((contextUsed / contextMax) * 100));
  const composerPlaceholder = status.ready ? "Ask anything" : "Select a model to start chatting";

  const homeSuggestions = [
    ...(status.ready ? [
      { Icon: PenLine, label: "Write a professional email to reschedule a meeting", onClick: () => setInput("Write a professional email to reschedule a meeting") },
      { Icon: Lightbulb, label: "Explain how transformers work in simple terms", onClick: () => setInput("Explain how transformers work in simple terms") },
    ] : []),
    { Icon: ImageIcon, label: "Create an image", onClick: () => setActiveTab?.("generator") },
    { Icon: Mic, label: "Transcribe a recording", onClick: () => setActiveTab?.("speech") },
    { Icon: AudioLines, label: "Turn text into speech", onClick: () => setActiveTab?.("tts") },
  ];

  const composer = (
    <div className="chat-composer">
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((att) => (
            <div key={att.id} className="chat-attachment">
              {att.type === "image" ? (
                <img src={att.dataUrl} alt="" className="chat-attachment-thumb" />
              ) : (
                <FileText size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
              )}
              <span className="chat-attachment-name" title={att.name}>{att.name}</span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => setAttachments(prev => prev.filter(item => item.id !== att.id))}
                aria-label={`Remove ${att.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-composer-inner">
        <textarea
          ref={textareaRef}
          className="chat-composer-textarea"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={composerPlaceholder}
          aria-label="Message"
          disabled={!status.ready || isBusy}
          rows={1}
        />

        <div className="chat-composer-toolbar">
          <div className="chat-composer-toolbar-left">
            <input type="file" ref={fileInputRef} style={{ display: "none" }} multiple onChange={handleFileChange} />
            <button
              type="button"
              className="chat-composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!status.ready || isBusy}
              aria-label="Attach files"
              title={status.ready ? "Attach files (text/code) or images (vision models only)" : "Load a model to attach files"}
            >
              <Plus size={20} />
            </button>
            <button
              type="button"
              className={`chat-composer-chip ${useWebSearch ? "active" : ""}`}
              onClick={() => setUseWebSearch((value) => !value)}
              disabled={!status.ready || isBusy}
              aria-pressed={useWebSearch}
              title={useWebSearch ? "Disable web search" : "Enable web search"}
            >
              <Globe2 size={15} />
              <span>Web</span>
            </button>
            {status.ready && supportsThinking && (
              <button
                type="button"
                className={`chat-composer-chip ${deepThinkEnabled ? "active" : ""}`}
                onClick={handleThinkingToggle}
                aria-pressed={deepThinkEnabled}
                title={deepThinkEnabled ? "Disable DeepThink reasoning" : "Enable DeepThink reasoning"}
              >
                <Brain size={15} />
                <span>Think</span>
              </button>
            )}
          </div>

          <div className="chat-composer-toolbar-right">
            <div ref={modelMenuRef} className="chat-model-picker">
              <button
                type="button"
                onClick={() => !isBusy && setShowModelMenu(!showModelMenu)}
                className={`chat-model-trigger ${showModelMenu ? "active" : ""}`}
                disabled={isBusy}
                aria-haspopup="menu"
                aria-expanded={showModelMenu}
                title={status.ready ? status.settings?.model : "Choose a text model to load"}
              >
                {status.ready && <span className="chat-model-dot" aria-hidden="true" />}
                <span className="chat-model-trigger-label">{modelLabel}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>

              {showModelMenu && (
                <div className={`chat-model-menu ${hasMessages ? "up" : ""}`} role="menu">
                  <div className="chat-model-menu-label">Text models</div>
                  {models.length === 0 && (
                    <button
                      type="button"
                      role="menuitem"
                      className="chat-model-menu-item"
                      onClick={() => {
                        setShowModelMenu(false);
                        setActiveTab?.("models");
                      }}
                    >
                      No models yet. Download one in Models
                    </button>
                  )}
                  {models.map((m) => {
                    const isActive = m.filename === status.settings?.model && status.ready;
                    return (
                      <button
                        type="button"
                        role="menuitem"
                        key={m.filename}
                        className={`chat-model-menu-item ${isActive ? "selected" : ""}`}
                        onClick={() => {
                          handleModelChange(m.filename);
                          setShowModelMenu(false);
                        }}
                        title={m.filename}
                      >
                        <span className="chat-model-menu-name">{m.filename.replace(/\.gguf$/i, "")}</span>
                        {isActive && <span className="chat-model-menu-badge">Loaded</span>}
                      </button>
                    );
                  })}
                  {status.ready && (
                    <>
                      <div className="chat-model-menu-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-model-menu-item"
                        onClick={() => {
                          handleModelChange("");
                          setShowModelMenu(false);
                        }}
                      >
                        Unload model
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {isBusy && status.ready ? (
              <button type="button" className="chat-composer-stop-btn" onClick={handleStopGeneration} aria-label="Stop generating" title="Stop generating">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-composer-send-btn"
                onClick={sendMessage}
                disabled={(!input.trim() && attachments.length === 0) || !status.ready}
                aria-label="Send message"
                title="Send message"
              >
                <ArrowUp size={18} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="text-chat-layout">
      <section className="text-chat-main" aria-label="Chat">
        {loadingModel ? (
          <div className="chat-home">
            <div className="chat-loading">
              <LoaderCircle className="progress-spinner" size={28} aria-hidden="true" />
              <h1 className="chat-home-title">Loading model</h1>
              <p className="chat-loading-name">{loadingModel.replace(/\.gguf$/i, "")}</p>
              <p className="chat-loading-note">
                Starting llama.cpp and loading the weights into memory. This can take up to 30 seconds depending on model size and hardware.
              </p>
              <button type="button" className="m3-btn m3-btn-outlined" onClick={handleCancelLlmLoad}>
                <Square size={13} fill="currentColor" aria-hidden="true" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        ) : !hasMessages ? (
          <div className="chat-home">
            <h1 className="chat-home-title">What should we make today?</h1>
            {composer}
            <ul className="chat-home-suggestions">
              {homeSuggestions.map(({ Icon, label, onClick }) => (
                <li key={label}>
                  <button type="button" className="chat-home-suggestion" onClick={onClick}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="chat-thread-bar">
              {!sidebarVisible && (
                <button type="button" className="chat-thread-btn chat-thread-sidebar-btn" onClick={onToggleSidebar} aria-label="Open sidebar" title="Open sidebar">
                  <PanelLeft size={18} />
                </button>
              )}
              <div
                className="chat-context"
                title={`Context used: ${contextUsed} / ${contextMax} tokens`}
                aria-label={`Context used: ${contextPercent}%`}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="8" stroke="var(--border-color)" strokeWidth="2.5" fill="none" />
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2.5" fill="none"
                    strokeDasharray={2 * Math.PI * 8}
                    strokeDashoffset={2 * Math.PI * 8 * (1 - contextPercent / 100)}
                    strokeLinecap="round" transform="rotate(-90 10 10)"
                  />
                </svg>
                <span>{contextPercent}%</span>
              </div>
              <button type="button" className="chat-thread-btn" onClick={handleClearChat} aria-label="Clear this chat" title="Clear this chat">
                <Trash2 size={16} />
              </button>
            </div>

            <div
              ref={chatMessagesRef}
              className="chat-messages"
              onScroll={handleMessagesScroll}
            >
              <div className="chat-thread">
                {messages.map((message, index) => {
                  const processed = processMessageContent(
                    Array.isArray(message.content) ? "" : (message.content || ""),
                    message.reasoning || ""
                  );
                  const displayContent = Array.isArray(message.content) ? message.content : processed.content;
                  const displayReasoning = processed.reasoning;
                  const hasDisplayContent = Array.isArray(displayContent)
                    ? displayContent.length > 0
                    : Boolean(String(displayContent || "").trim());

                  return (
                    <div
                      key={`${message.role}-${index}`}
                      className={`chat-message-row ${message.role === "user" ? "user" : "ai"}`}
                    >
                      <span className="sr-only">{message.role === "user" ? "You said:" : "Assistant said:"}</span>
                      <div className="chat-bubble-wrap">
                        {message.role === "assistant" && displayReasoning && (
                          <ChatThinkingSection
                            reasoning={displayReasoning}
                            timeElapsed={Number(message.thinkingDuration) || 0}
                            isComplete={!message.generationStats || message.generationStats.status === "complete"}
                          />
                        )}
                        {(hasDisplayContent || message.error) && (
                          <div className={`chat-bubble ${message.error ? "error" : ""}`}>
                            {Array.isArray(displayContent) ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {displayContent.map((item, idx) => {
                                  if (item.type === "text") return <MarkdownRenderer key={idx} content={item.text} />;
                                  if (item.type === "image_url") return (
                                    <img key={idx} src={item.image_url.url} alt="Attached image"
                                      style={{ maxWidth: "240px", maxHeight: "180px", objectFit: "contain", borderRadius: "8px", marginTop: "4px" }}
                                    />
                                  );
                                  return null;
                                })}
                              </div>
                            ) : (
                              <MarkdownRenderer content={displayContent} />
                            )}
                          </div>
                        )}
                        {message.role === "assistant" && Array.isArray(message.webSources) && message.webSources.length > 0 && (
                          <div className="chat-sources">
                            <div className="chat-sources-title">
                              <Globe2 size={13} aria-hidden="true" />
                              <span>Sources</span>
                            </div>
                            {message.webSources.map((source, sourceIndex) => (
                              <a key={`${source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer">
                                [{source.index || sourceIndex + 1}] {source.title || source.url}
                              </a>
                            ))}
                          </div>
                        )}

                        {message.role === "assistant" && message.generationStats && !message.error && (
                          <>
                            {message.generationStats.truncated && (
                              <div className="chat-generation-warning">
                                Response reached the token limit. Ask "continue" or switch Max Response Tokens to Manual for a larger cap.
                              </div>
                            )}
                            <div className={`chat-generation-stats ${message.generationStats.status}`}>
                              {message.generationStats.status === "starting" ? (
                                <><LoaderCircle size={12} className="progress-spinner" /> {message.generationStats.web ? "Searching the web…" : message.generationStats.vision ? "Reading the image…" : "Thinking…"}</>
                              ) : message.generationStats.status === "streaming" ? (
                                <><Zap size={12} aria-hidden="true" /> {message.generationStats.tokensPerSecond.toFixed(1)} tok/s</>
                              ) : (
                                <>{message.generationStats.tokens} tokens · {formatGenerationTime(message.generationStats.seconds)}</>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div ref={bottomRef} />
            </div>

            <div className="chat-composer-dock">{composer}</div>
          </>
        )}
      </section>
    </div>
  );
}
// PDF text is extracted in the browser, so PDFs work with every model, not only vision ones.
// pdf.js is loaded on first use to keep it out of the main bundle.
async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => (item.str || "") + (item.hasEOL ? "\n" : " ")).join("").trim();
    if (text) pages.push(`[Page ${pageNumber}]\n${text}`);
  }
  await pdf.destroy();
  return pages.join("\n\n");
}

function MathFormula({ tex, display = false }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  return display
    ? <div className="chat-math-block" dangerouslySetInnerHTML={{ __html: html }} />
    : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// Inline math: \( ... \) or $...$ (no space just inside the dollars and no digit right
// after the closing one, so prices like "$5 and $10" stay plain text).
const INLINE_MATH = String.raw`\\\(.+?\\\)|\$(?:[^\s$]|[^\s$][^$\n]*?[^\s$])\$(?!\d)`;

function parseInlineMarkdown(text) {
  const regex = new RegExp(`(${INLINE_MATH}|\\*\\*.*?\\*\\*|\`.*?\`|\\*.*?\\*|\\[.*?\\]\\(.*?\\))`, "g");
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (part.length > 4 && part.startsWith("\\(") && part.endsWith("\\)")) {
      return <MathFormula key={idx} tex={part.slice(2, -2)} />;
    }
    if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) {
      return <MathFormula key={idx} tex={part.slice(1, -1)} />;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={idx} className="markdown-inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        return (
          <a key={idx} href={match[2]} target="_blank" rel="noopener noreferrer" className="markdown-link">
            {match[1]}
          </a>
        );
      }
    }
    return part;
  });
}

function normalizeLanguage(lang) {
  if (!lang) return "";
  const lower = String(lang).toLowerCase().trim();
  const map = {
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    py: "python",
    python3: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    golang: "go",
    rs: "rust",
    cs: "csharp",
    "c++": "cpp",
    "c#": "csharp",
    html: "markup",
    xml: "markup",
    svg: "markup",
  };
  return map[lower] || lower;
}

function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const normalized = normalizeLanguage(lang);
  const trimmedCode = (code || "").replace(/\r\n/g, "\n").trim();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(trimmedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  let highlighted = null;
  const grammar = normalized ? Prism.languages[normalized] : null;
  if (grammar) {
    try {
      highlighted = Prism.highlight(trimmedCode, grammar, normalized);
    } catch {
      highlighted = null;
    }
  } else if (normalized && Prism.languages.clike) {
    try {
      highlighted = Prism.highlight(trimmedCode, Prism.languages.clike, "clike");
    } catch {
      highlighted = null;
    }
  }

  return (
    <div className="markdown-code-wrapper">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{lang || "code"}</span>
        <button
          type="button"
          className="markdown-code-copy-btn"
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy code"}
          aria-label={copied ? "Copied!" : "Copy code"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className={`markdown-code-block language-${normalized || "none"}`}>
        {highlighted ? (
          <code
            className={`language-${normalized || "clike"}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <code>{trimmedCode}</code>
        )}
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content }) {
  if (typeof content !== 'string') return null;

  const parts = content.split(/(```[\s\S]*?```|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/g);
  const isTableSeparator = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
  const splitTableRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

  return (
    <div className="markdown-body">
      {parts.map((part, index) => {
        if (part.length > 4 && part.startsWith("$$") && part.endsWith("$$")) {
          return <MathFormula key={index} tex={part.slice(2, -2).trim()} display />;
        }
        if (part.length > 4 && part.startsWith("\\[") && part.endsWith("\\]")) {
          return <MathFormula key={index} tex={part.slice(2, -2).trim()} display />;
        }
        if (part.startsWith("```") && part.endsWith("```")) {
          const match = part.match(/^```([^\r\n]*)\r?\n?([\s\S]*?)```$/);
          const lang = match ? match[1].trim() : "";
          const code = match ? match[2] : part.slice(3, -3);
          return <CodeBlock key={index} code={code} lang={lang} />;
        } else {
          const rawLines = part.split(/\r?\n/);
          const blocks = [];
          let currentBlock = null;

          for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith("|") && i + 1 < rawLines.length && isTableSeparator(rawLines[i + 1])) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              const header = splitTableRow(line);
              const rows = [];
              i += 2;
              while (i < rawLines.length && rawLines[i].trim().startsWith("|")) {
                rows.push(splitTableRow(rawLines[i]));
                i += 1;
              }
              i -= 1;
              blocks.push({ type: "table", header, rows });
            } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "hr" });
            } else if (trimmed.startsWith(">")) {
              const quoteLine = trimmed.replace(/^>\s?/, "");
              if (currentBlock && currentBlock.type === "quote") {
                currentBlock.lines.push(quoteLine);
              } else {
                if (currentBlock) { blocks.push(currentBlock); }
                currentBlock = { type: "quote", lines: [quoteLine] };
              }
            } else if (trimmed.startsWith("### ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h4", content: trimmed.slice(4) });
            } else if (trimmed.startsWith("## ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h3", content: trimmed.slice(3) });
            } else if (trimmed.startsWith("# ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h2", content: trimmed.slice(2) });
            } else if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
              const itemContent = trimmed.slice(2);
              if (currentBlock && currentBlock.type === "ul") {
                currentBlock.items.push(itemContent);
              } else {
                if (currentBlock) { blocks.push(currentBlock); }
                currentBlock = { type: "ul", items: [itemContent] };
              }
            } else {
              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
              if (numMatch) {
                const itemContent = numMatch[2];
                if (currentBlock && currentBlock.type === "ol") {
                  currentBlock.items.push(itemContent);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "ol", items: [itemContent] };
                }
              } else if (trimmed === "") {
                if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              } else {
                if (currentBlock && currentBlock.type === "p") {
                  currentBlock.lines.push(line);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "p", lines: [line] };
                }
              }
            }
          }
          if (currentBlock) {
            blocks.push(currentBlock);
          }

          return blocks.map((block, blockIdx) => {
            switch (block.type) {
              case "h4":
                return <h4 key={blockIdx}>{parseInlineMarkdown(block.content)}</h4>;
              case "h3":
                return <h3 key={blockIdx}>{parseInlineMarkdown(block.content)}</h3>;
              case "h2":
                return <h2 key={blockIdx}>{parseInlineMarkdown(block.content)}</h2>;
              case "ul":
                return (
                  <ul key={blockIdx}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ul>
                );
              case "ol":
                return (
                  <ol key={blockIdx}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ol>
                );
              case "table":
                return (
                  <div key={blockIdx} className="chat-table-wrap">
                    <table className="chat-table">
                      <thead>
                        <tr>{block.header.map((cell, cellIdx) => <th key={cellIdx}>{parseInlineMarkdown(cell)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {block.header.map((_, cellIdx) => <td key={cellIdx}>{parseInlineMarkdown(row[cellIdx] || "")}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              case "hr":
                return <hr key={blockIdx} />;
              case "quote":
                return <blockquote key={blockIdx}>{parseInlineMarkdown(block.lines.join(" "))}</blockquote>;
              case "p": {
                // A lone bold line such as "🧠 **Analysis:**" acts as a section label, so it gets heading spacing
                const isSectionLabel = block.lines.length === 1 && /^[^\w*]*\*\*[^*]+\*\*:?$/u.test(block.lines[0].trim());
                // Keep the model's single line breaks (addresses, emails, poems)
                return (
                  <p key={blockIdx} className={isSectionLabel ? "md-section-label" : undefined}>
                    {block.lines.map((line, lineIdx) => (
                      <React.Fragment key={lineIdx}>
                        {lineIdx > 0 && <br />}
                        {parseInlineMarkdown(line.trim())}
                      </React.Fragment>
                    ))}
                  </p>
                );
              }
              default:
                return null;
            }
          });
        }
      })}
    </div>
  );
}

export default TextChat;
