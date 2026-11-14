import React, { memo, useState, useEffect, useCallback } from "react";
import { FolderOpen, DownloadCloud, Loader2, Trash2, Square, AlertTriangle, Search, X, Link, Link2, HardDrive, Copy, Plus, MoreHorizontal, ExternalLink, Check } from "lucide-react";
import "../styles/models.css";
import { 
  listLocalModels, 
  startServer, 
  stopServer, 
  importModelFile, 
  deleteModel, 
  downloadModel, 
  downloadOpenVinoModel, 
  cancelModelDownload, 
  getDownloadProgress, 
  getBackendStatus, 
  pingServer, 
  formatBytes, 
  normalizeModel,
  listLlmModels,
  startLlm,
  stopLlm,
  downloadLlmModel,
  deleteLlmModel,
  importLlmModel,
  getLlmStatus,
  searchHuggingFaceModels,
  listSpeechModels,
  startSpeech,
  stopSpeech,
  downloadSpeechModel,
  deleteSpeechModel,
  importSpeechModel,
  getSpeechStatus,
  listTtsModels,
  startTts,
  stopTts,
  downloadTtsModel,
  deleteTtsModel,
  importTtsModel,
  linkModelFile,
  moveModelFile,
  pickModelFile,
  getTtsStatus,
  isLocalServerMode
} from "../services/api";

const kindLabel = (kind) => ({ image: "Image", text: "Text", speech: "Speech", tts: "Voice" }[kind] || "Other");

// "/Users/me/Downloads/Models/x.safetensors" -> "~/Downloads/Models"; keeps link labels short
function shortPath(fullPath) {
  const folder = String(fullPath || "").replace(/[\\/][^\\/]*$/, "");
  return folder.replace(/^\/Users\/[^/]+/, "~").replace(/^[A-Z]:\\Users\\[^\\]+/i, "~") || folder;
}

// ---- Readable model names ----
// "realisticVisionV60B1_v51HyperVAE.safetensors" -> "Realistic Vision V60B1 V51" plus details
// "Hyper · VAE included". Precision, quantization and baked-in extras move to the meta line.
const MODEL_DETAIL_WORDS = {
  fp16: "FP16",
  fp32: "FP32",
  bf16: "BF16",
  vae: "VAE included",
  hyper: "Hyper",
  lightning: "Lightning",
  turbo: "Turbo",
  pruned: "Pruned",
  onnx: "ONNX",
  ema: null,
  emaonly: null,
};

function describeModelFile(filename, fallbackName) {
  const base = String(filename || "").replace(/\.(safetensors|ckpt|gguf|bin|json|onnx|pt|pth)$/i, "");
  const details = [];
  let rest = base;
  // "mmproj-..." files are the vision add-on that lets a text model read images
  if (/^mmproj[-_]/i.test(rest)) {
    details.push("Vision add-on");
    rest = rest.replace(/^mmproj[-_]/i, "");
  }
  const quant = rest.match(/(?:^|[-_.])((?:I?Q\d+(?:_[A-Z0-9]+)*)|F16|F32)$/i);
  if (quant) {
    details.push(quant[1].toUpperCase());
    rest = rest.slice(0, quant.index);
  }
  const words = [];
  rest.split(/[-_\s]+/).filter(Boolean).forEach((token) => {
    // Split camelCase only in names written that way ("realisticVision"), not "CyberRealistic"
    // and keep version codes like "V60B1" together
    const parts = /^[a-z]/.test(token)
      ? token
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/(\d)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z\d])(VAE|FP16|FP32|BF16)$/, "$1 $2")
        .split(" ")
      : [token];
    parts.forEach((part) => {
      const key = part.toLowerCase();
      if (key in MODEL_DETAIL_WORDS) {
        const label = MODEL_DETAIL_WORDS[key];
        if (label && !details.includes(label)) details.push(label);
        return;
      }
      words.push(/^[a-z]/.test(part) ? part[0].toUpperCase() + part.slice(1) : part);
    });
  });
  const cleanFallback = fallbackName && fallbackName !== filename && !/\.(safetensors|ckpt|gguf|bin|json)$/i.test(fallbackName)
    ? fallbackName
    : "";
  return { title: cleanFallback || words.join(" ") || base || "Untitled model", details: cleanFallback ? [] : details };
}


const MODEL_FILTERS = [
  { id: "vision", label: "Vision" },
  { id: "uncensored", label: "Uncensored" },
];

const MODEL_LIBRARY = [
  {
    group: "SDXL — best quality",
    items: [
      {
        name: "Juggernaut XL v9 Lightning",
        filename: "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        format: "Safetensors",
        approxSize: "7.1 GB",
        resolution: "1024x1024",
        notes: "Photorealistic SDXL model tuned for 4-8 step Lightning generation.",
        url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        recommendedTiers: ["Mid", "High"],
      },
      {
        name: "DreamShaper XL Lightning",
        filename: "DreamShaperXL_Lightning.safetensors",
        format: "Safetensors",
        approxSize: "6.9 GB",
        resolution: "1024x1024",
        notes: "All-around SDXL model for fantasy art, renders, illustration, and stylized images.",
        url: "https://huggingface.co/Lykon/dreamshaper-xl-lightning/resolve/main/DreamShaperXL_Lightning.safetensors",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
  {
    group: "SD 1.5 — fast, low memory",
    items: [
      {
        name: "DreamShaper 8",
        filename: "DreamShaper_8_pruned.safetensors",
        format: "Safetensors",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "General-purpose SD 1.5 model for illustration, anime, and semi-realistic portraits.",
        url: "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors",
        recommendedTiers: ["Low"],
      },
      {
        name: "CyberRealistic V8",
        filename: "CyberRealistic_V8_FP16.safetensors",
        format: "Safetensors",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "High-fidelity realism and photorealism in the SD 1.5 ecosystem.",
        url: "https://huggingface.co/cyberdelia/CyberRealistic/resolve/main/CyberRealistic_V8_FP16.safetensors",
        recommendedTiers: ["Low"],
      },
      {
        name: "epiCRealism Natural Sin",
        filename: "epicrealism_naturalSinRC1VAE.safetensors",
        format: "Safetensors",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "Natural, photorealistic SD 1.5 model for people, portraits, and real-world scenes.",
        url: "https://civitai.com/api/download/models/143906?type=Model&format=SafeTensor&size=pruned&fp=fp16",
        recommendedTiers: ["Low"],
      },
      {
        name: "ReV Animated v1.2.2",
        filename: "rev-animated-v1-2-2.safetensors",
        format: "Safetensors",
        approxSize: "5.5 GB",
        resolution: "512x512",
        notes: "Semi-realistic, 2.5D, anime, fantasy, and stylized digital art.",
        url: "https://huggingface.co/danbrown/RevAnimated-v1-2-2/resolve/main/rev-animated-v1-2-2.safetensors",
        recommendedTiers: ["Low"],
      },
    ],
  },
];

const TEXT_MODEL_LIBRARY = [
  {
    group: "Recommended text models (llama.cpp)",
    items: [
      {
        name: "Qwen2.5 Coder 0.5B Instruct Q4_K_M",
        filename: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "491 MB",
        resolution: "N/A",
        notes: "Extremely fast, lightweight assistant, perfect for low RAM/VRAM machines.",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        recommendedTiers: ["Low"],
      },
      {
        name: "SmolLM2 1.7B Instruct Q4_K_M",
        filename: "smollm2-1.7b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "1.1 GB",
        resolution: "N/A",
        notes: "Excellent lightweight assistant with strong logic, reasoning, and prompt expansion capabilities.",
        url: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf",
        recommendedTiers: ["Low"],
      },
      {
        name: "Qwen2.5-Coder-7B-Instruct",
        filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        format: "GGUF",
        size: "4.7 GB",
        approxSize: "4.7 GB",
        resolution: "N/A",
        notes: "Highly intelligent coding and text assistant. Recommended for mid/high tier systems.",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        recommendedTiers: ["Mid", "High"],
      },
      {
        name: "Llama-3.1-8B-Instruct",
        filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        size: "4.9 GB",
        approxSize: "4.9 GB",
        resolution: "N/A",
        notes: "Excellent general-purpose text model. Recommended for high-tier systems.",
        url: "https://huggingface.co/lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        recommendedTiers: ["High"],
      },
      {
        name: "LLaVA 1.5 7B",
        filename: "ggml-model-q4_k.gguf",
        format: "GGUF",
        size: "4.5 GB",
        approxSize: "4.5 GB",
        resolution: "N/A",
        notes: "Multimodal model capable of understanding images. Downloads companion vision projector automatically.",
        url: "https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/ggml-model-q4_k.gguf",
        projectorUrl: "https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/mmproj-model-f16.gguf",
        projectorFilename: "mmproj-model-f16.gguf",
        recommendedTiers: ["Mid", "High"],
      },
      {
        name: "Qwen2.5-VL 3B Instruct (Vision)",
        filename: "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        size: "2.8 GB",
        approxSize: "2.8 GB",
        resolution: "N/A",
        notes: "Small vision model: describes images, reads text and screenshots. Downloads its vision projector (mmproj) automatically.",
        url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
        projectorUrl: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
        projectorFilename: "mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
        recommendedTiers: ["Low", "Mid"],
      },
      {
        name: "Qwen2.5-VL 7B Instruct (Vision)",
        filename: "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        size: "5.5 GB",
        approxSize: "5.5 GB",
        resolution: "N/A",
        notes: "Stronger vision model for documents, charts and detailed image questions. Downloads its vision projector (mmproj) automatically.",
        url: "https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
        projectorUrl: "https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
        projectorFilename: "mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
];

const OPENVINO_MODEL_LIBRARY = [
  {
    group: "Intel NPU — OpenVINO test",
    items: [
      {
        id: "lcm-dreamshaper-v7-fp16",
        name: "LCM DreamShaper v7 FP16",
        filename: "lcm-dreamshaper-v7-fp16",
        format: "OpenVINO",
        backendType: "openvino-npu",
        approxSize: "2.0 GB",
        resolution: "512x512",
        notes: "NPU test model for Windows and Linux. Runs the text encoder on CPU, UNet on Intel NPU, and VAE decoder on Intel GPU or CPU fallback.",
        url: "https://huggingface.co/OpenVINO/LCM_Dreamshaper_v7-fp16-ov",
      },
    ],
  },
];

const TTS_MODEL_LIBRARY = [
  {
    group: "Kokoro text-to-speech",
    items: [
      {
        id: "kokoro-onnx-q8",
        name: "Kokoro 82M ONNX Q8",
        filename: "kokoro-onnx-q8.json",
        format: "Kokoro ONNX",
        approxSize: "Model cache on first use",
        resolution: "24 kHz WAV",
        notes: "Recommended local TTS model. Good quality and faster startup than full precision on most PCs.",
        url: "kokoro://install/kokoro-onnx-q8",
        pageUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
        recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "kokoro-onnx-fp32",
        name: "Kokoro 82M ONNX FP32",
        filename: "kokoro-onnx-fp32.json",
        format: "Kokoro ONNX",
        approxSize: "Model cache on first use",
        resolution: "24 kHz WAV",
        notes: "Full precision Kokoro ONNX path for quality testing. Uses more memory and disk cache.",
        url: "kokoro://install/kokoro-onnx-fp32",
        pageUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
];

const COREML_MODEL_LIBRARY = [
  {
    group: "Apple Silicon NPU — CoreML test",
    items: [
      {
        name: "Stable Diffusion v1.5 CoreML (split_einsum, palettized 6-bit)",
        filename: "coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled",
        format: "CoreML",
        approxSize: "2.0 GB",
        resolution: "512x512",
        notes: "Apple Silicon ANE (Neural Engine) optimized 6-bit palettized Stable Diffusion 1.5 model. Unzips automatically on download completion and runs extremely fast on Mac NPUs.",
        url: "https://huggingface.co/apple/coreml-stable-diffusion-v1-5-palettized/resolve/main/coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled.zip",
      },
      {
        name: "CyberRealistic v1.5 CoreML (6-bit palettized)",
        filename: "cyberrealistic-6bit.coreml",
        format: "CoreML",
        approxSize: "815 MB",
        resolution: "512x512",
        notes: "6-bit palettized CoreML version of CyberRealistic. Extremely fast and optimized for Apple Silicon Neural Engine (ANE).",
        url: "https://huggingface.co/orailnooor/cyberrealistic-coreml/resolve/main/cyberrealistic-6bit.coreml.zip",
      },
      {
        name: "CyberRealistic v1.5 CoreML (Standard)",
        filename: "cyberrealistic.coreml",
        format: "CoreML",
        approxSize: "1.8 GB",
        resolution: "512x512",
        notes: "Standard CoreML version of CyberRealistic. Provides high-fidelity realism optimized for Apple Silicon NPUs.",
        url: "https://huggingface.co/orailnooor/cyberrealistic-coreml/resolve/main/cyberrealistic.coreml.zip",
      },
    ],
  },
];

const getHardwareTier = (specs) => {
  if (!specs) return "Low";
  const ram = Number(specs.ram_total_gb) || 0;
  const vram = Number(specs.gpu_vram_gb) || 0;

  if (vram >= 12 || (vram >= 8 && ram >= 32)) {
    return "High";
  } else if (vram >= 6 || ram >= 16) {
    return "Mid";
  } else {
    return "Low";
  }
};

function ModelManager({ 
  activeModel, 
  setActiveModel, 
  serverRunning, 
  setServerRunning, 
  constraints, 
  setConstraints, 
  telemetry, 
  backendOptions, 
  showAlert = async ({ message }) => window.alert(message), 
  showConfirm = async ({ message }) => window.confirm(message), 
  activeTab,
  specs,
  textSettings,
}) {
  const [activeModelType, setActiveModelType] = useState("image"); // "image", "text", "speech", or "tts"
  const [localModels, setLocalModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [downloadingModelId, setDownloadingModelId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState("");
  const [loadingModelId, setLoadingModelId] = useState(null);
  const [modelLoadProgress, setModelLoadProgress] = useState(null);
  const [importProgress, setImportProgress] = useState(null); // null when not importing
  const [importInfo, setImportInfo] = useState({ filename: "", speed: "0.0", eta: 0, status: "" });
  const [downloadUrl, setDownloadUrl] = useState("");
  const [importAbortController, setImportAbortController] = useState(null);
  const [isUnloading, setIsUnloading] = useState(false);
  const [unloadProgress, setUnloadProgress] = useState({ progress: 0, phase: "" });
  const [pendingLoadModel, setPendingLoadModel] = useState(null);
  const [vramWarning, setVramWarning] = useState(null);
  const [backendInfo, setBackendInfo] = useState({ backendMode: "", backendBinary: "", backendDevice: "" });
  const [activeLlmModel, setActiveLlmModel] = useState(null);
  const [llmRunning, setLlmRunning] = useState(false);
  const [activeSpeechModel, setActiveSpeechModel] = useState(null);
  const [speechRunning, setSpeechRunning] = useState(false);
  const [activeTtsModel, setActiveTtsModel] = useState(null);
  const [ttsRunning, setTtsRunning] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedFilters, setSelectedFilters] = useState([]);
  const [huggingFaceModels, setHuggingFaceModels] = useState([]);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [modelSearchError, setModelSearchError] = useState("");
  const [hasHuggingFaceResults, setHasHuggingFaceResults] = useState(false);
  const [modelSearchPage, setModelSearchPage] = useState(1);
  const [hasMoreModels, setHasMoreModels] = useState(false);
  const [isLoadingMoreModels, setIsLoadingMoreModels] = useState(false);
  const searchRequestRef = React.useRef(0);
  // "Add model" opens the URL / import form; rowMenu is the filename whose "..." menu is open
  const [addOpen, setAddOpen] = useState(false);
  // How the add panel adds a model: "link" (download URL), "inplace" (use a file where it is), "import" (copy)
  const [addMethod, setAddMethod] = useState("link");
  const [linkPath, setLinkPath] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [isPicking, setIsPicking] = useState(false);
  const [rowMenu, setRowMenu] = useState(null);
  const pendingCompanionDownloadRef = React.useRef(null);

  const cancelLoadRef = React.useRef(false);
  
  const handleCancelLoad = async () => {
    cancelLoadRef.current = true;
    try {
      await stopServer();
    } catch (err) {
      console.warn("Failed to stop server on cancel:", err);
    }
  };

  const normalizedLocalModels = activeModelType === "speech" || activeModelType === "tts"
    ? localModels.filter((model) => model.filename)
    : localModels.map(normalizeModel).filter((model) => model.filename);
  const displayedLocalModels = activeModelType === "speech" || activeModelType === "tts"
    ? normalizedLocalModels.filter((model) => model.installed)
    : normalizedLocalModels.filter((model) => !model.isProjector);
  const allModelNames = activeModelType === "speech" || activeModelType === "tts"
    ? displayedLocalModels.map((model) => model.filename)
    : normalizedLocalModels.map((model) => model.filename);
  const modelNames = displayedLocalModels.map((model) => model.filename);
  const isBusy = loadingModelId !== null || isUnloading;
  
  const openvinoSupported = Boolean(backendOptions?.openvinoNpu?.supported);
  const appleNpuSupported = Boolean(
    backendOptions?.options?.some((opt) => opt.id === "apple-npu") ||
    backendOptions?.unavailable?.some((opt) => opt.id === "apple-npu")
  );
  const displayedHuggingFaceModels = huggingFaceModels.filter((model) => (
    selectedFilters.every((filterId) => model.tags?.includes(filterId))
  ));

  const getModelTypeLabel = (type) => {
    if (type === "image") return "Image";
    if (type === "text") return "Text";
    if (type === "speech") return "Speech";
    if (type === "tts") return "Voice";
    return "Model";
  };

  const getRuntimeForType = (type) => {
    if (type === "image" && serverRunning && activeModel) {
      return { type: "image", model: activeModel, label: getModelTypeLabel("image") };
    }
    if (type === "text" && llmRunning && activeLlmModel) {
      return { type: "text", model: activeLlmModel, label: getModelTypeLabel("text") };
    }
    if (type === "speech" && speechRunning && activeSpeechModel) {
      return { type: "speech", model: activeSpeechModel, label: getModelTypeLabel("speech") };
    }
    if (type === "tts" && ttsRunning && activeTtsModel) {
      return { type: "tts", model: activeTtsModel, label: getModelTypeLabel("tts") };
    }
    return null;
  };

  const getActiveHeavyRuntime = () => (
    getRuntimeForType("image") ||
    getRuntimeForType("text")
  );

  const blockLoadIfOtherRuntimeActive = (modelId, targetType) => {
    if (targetType !== "image" && targetType !== "text") {
      return false;
    }

    const runtime = getActiveHeavyRuntime();
    if (!runtime || (runtime.type === targetType && runtime.model === modelId)) {
      return false;
    }
    setPendingLoadModel({
      modelId,
      targetType,
      activeRuntime: runtime,
    });
    return true;
  };
  
  let visibleModelLibrary = [];
  if (activeModelType === "image") {
    visibleModelLibrary = [...MODEL_LIBRARY];
    if (openvinoSupported) {
      visibleModelLibrary = [...visibleModelLibrary, ...OPENVINO_MODEL_LIBRARY];
    }
    if (appleNpuSupported) {
      visibleModelLibrary = [...visibleModelLibrary, ...COREML_MODEL_LIBRARY];
    }
  } else if (activeModelType === "text") {
    visibleModelLibrary = [{
      group: "Recommended text models from Hugging Face",
      items: hasHuggingFaceResults ? displayedHuggingFaceModels : TEXT_MODEL_LIBRARY[0].items,
    }];
  } else if (activeModelType === "speech") {
    visibleModelLibrary = [{
      group: "Whisper speech models",
      items: normalizedLocalModels.filter((model) => model.url).map((model) => ({
        ...model,
        format: "Whisper.cpp",
        approxSize: model.size,
        notes: `${model.language || "Speech"} transcription model. Stored in app/speech-models/.`,
        recommendedTiers: model.recommended ? ["Low", "Mid", "High"] : [],
      })),
    }];
  } else {
    visibleModelLibrary = TTS_MODEL_LIBRARY;
  }

  useEffect(() => {
    if (activeModelType !== "text") return;
    const requestId = ++searchRequestRef.current;
    const timer = setTimeout(async () => {
      setIsSearchingModels(true);
      setModelSearchError("");
      try {
        const result = await searchHuggingFaceModels(modelSearch, selectedFilters, 1);
        if (requestId !== searchRequestRef.current) return;
        const matchingModels = result.models.filter((model) => (
          selectedFilters.every((filterId) => model.tags?.includes(filterId))
        ));
        setHuggingFaceModels(matchingModels);
        setHasHuggingFaceResults(true);
        setModelSearchPage(1);
        setHasMoreModels(result.hasMore);
      } catch (err) {
        if (requestId !== searchRequestRef.current) return;
        setHuggingFaceModels([]);
        setHasHuggingFaceResults(false);
        setHasMoreModels(false);
        setModelSearchError(err.message || "Could not search Hugging Face.");
      } finally {
        if (requestId === searchRequestRef.current) setIsSearchingModels(false);
      }
    }, modelSearch ? 400 : 0);
    return () => clearTimeout(timer);
  }, [activeModelType, modelSearch, selectedFilters]);

  const toggleModelFilter = (filterId) => {
    setSelectedFilters((current) => (
      current.includes(filterId)
        ? current.filter((id) => id !== filterId)
        : [...current, filterId]
    ));
  };

  const handleLoadMoreModels = async () => {
    if (isLoadingMoreModels || !hasMoreModels) return;
    const nextPage = modelSearchPage + 1;
    setIsLoadingMoreModels(true);
    setModelSearchError("");
    try {
      const [result] = await Promise.all([
        searchHuggingFaceModels(modelSearch, selectedFilters, nextPage),
        new Promise((resolve) => setTimeout(resolve, 350)),
      ]);
      const matchingModels = result.models.filter((model) => (
        selectedFilters.every((filterId) => model.tags?.includes(filterId))
      ));
      setHuggingFaceModels((current) => {
        const known = new Set(current.map((model) => model.id));
        return [...current, ...matchingModels.filter((model) => !known.has(model.id))];
      });
      setModelSearchPage(result.page);
      setHasMoreModels(result.hasMore);
    } catch (err) {
      setModelSearchError(err.message || "Could not load more Hugging Face models.");
    } finally {
      setIsLoadingMoreModels(false);
    }
  };
  
  const getLocalModelInfo = (modelId) => localModels.map(normalizeModel).find((model) => model.filename === modelId);

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      if (activeModelType === "image") {
        const list = await listLocalModels();
        setLocalModels(list.map(normalizeModel).filter((model) => model.filename));
      } else if (activeModelType === "text") {
        const list = await listLlmModels();
        setLocalModels(list.map(normalizeModel).filter((model) => model.filename));
      } else if (activeModelType === "speech") {
        const list = await listSpeechModels();
        setLocalModels(list.filter((model) => model.filename));
      } else {
        const list = await listTtsModels();
        setLocalModels(list.filter((model) => model.filename));
      }
    } catch (e) {
      console.error(e);
      setLocalModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, [activeModelType]);

  useEffect(() => {
    if (activeTab !== "models") return;
    fetchModels();
    checkActiveDownload();
  }, [activeTab, activeModelType, fetchModels]);

  useEffect(() => {
    if (activeTab !== "models") return;

    let cancelled = false;
    const updateBackendInfo = async () => {
      try {
        const [sdStatus, llmStatus, speechStatus, ttsStatus] = await Promise.all([
          getBackendStatus(),
          getLlmStatus(),
          getSpeechStatus(),
          getTtsStatus()
        ]);
        if (cancelled) return;
        
        setBackendInfo({
          backendMode: sdStatus.settings?.backendMode || sdStatus.loading?.backendMode || "",
          backendBinary: sdStatus.settings?.backendBinary || sdStatus.loading?.backendBinary || "",
          backendDevice: sdStatus.settings?.backendDevice || sdStatus.loading?.device || "",
          llmBackendMode: llmStatus.settings?.backendMode || llmStatus.settings?.backendBinary || "",
          speechBackendMode: speechStatus.settings?.backendMode || speechStatus.backendMode || "",
          ttsBackendMode: ttsStatus.settings?.backendMode || ttsStatus.backendMode || "",
        });
        
        if (llmStatus.ready) {
          setActiveLlmModel(llmStatus.settings?.model || null);
          setLlmRunning(true);
        } else {
          setActiveLlmModel(null);
          setLlmRunning(false);
        }
        if (speechStatus.ready) {
          setActiveSpeechModel(speechStatus.settings?.model || null);
          setSpeechRunning(true);
        } else {
          setActiveSpeechModel(null);
          setSpeechRunning(false);
        }
        if (ttsStatus.ready) {
          setActiveTtsModel(ttsStatus.settings?.model || null);
          setTtsRunning(true);
        } else {
          setActiveTtsModel(null);
          setTtsRunning(false);
        }
      } catch (_) {}
    };

    updateBackendInfo();
    const interval = setInterval(updateBackendInfo, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, serverRunning, loadingModelId]);

  const checkActiveDownload = async () => {
    try {
      const status = await getDownloadProgress();
      if (status.active && status.filename) {
        startProgressPolling(status.filename);
      }
    } catch (e) {
      console.error("Check active download failed:", e);
    }
  };

  const downloadByUrl = async (url, expectedFilename, companion = null, options = {}) => {
    if (downloadingModelId) return;

    if (!options.skipExistingConfirm && allModelNames.includes(expectedFilename)) {
      if (!(await showConfirm({
        title: "Overwrite Model?",
        message: `"${expectedFilename}" is already downloaded. Do you want to download and overwrite it?`,
        confirmLabel: "Overwrite",
      }))) {
        return;
      }
    }

    const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

    if (!isTauriDesktop && !isLocalServerMode()) {
      showAlert({ title: "Server Required", message: "Model download requires the local server.", danger: true });
      return;
    }

    try {
      pendingCompanionDownloadRef.current = companion;
      let res;
      if (activeModelType === "image") {
        res = await downloadModel(url, expectedFilename);
      } else if (activeModelType === "text") {
        res = await downloadLlmModel(url, expectedFilename, companion);
      } else if (activeModelType === "speech") {
        res = await downloadSpeechModel(url, expectedFilename);
      } else {
        res = await downloadTtsModel(url, expectedFilename);
      }
      if (res && res.ok) {
        if (!companion && res.projectorUrl && res.projectorFilename) {
          pendingCompanionDownloadRef.current = {
            url: res.projectorUrl,
            filename: res.projectorFilename,
          };
        }
        startProgressPolling(expectedFilename);
      } else {
        pendingCompanionDownloadRef.current = null;
        showAlert({ title: "Download Failed", message: res.error || "Unknown error", danger: true });
      }
    } catch (err) {
      pendingCompanionDownloadRef.current = null;
      showAlert({ title: "Download Error", message: err.message, danger: true });
    }
  };

  const startProgressPolling = (modelId) => {
    setDownloadingModelId(modelId);
    
    const interval = setInterval(async () => {
      try {
        const status = await getDownloadProgress();
        if (status.active) {
          setDownloadProgress(status.progress === -1 ? 0 : status.progress);
          setDownloadSpeed(`${status.speed} • ETA ${status.eta}s`);
        } else {
          clearInterval(interval);
          setDownloadingModelId(null);
          if (status.error) {
            if (!String(status.error).toLowerCase().includes("cancelled")) {
              showAlert({ title: "Download Failed", message: status.error, danger: true });
            }
          } else {
            fetchModels();
            const companion = pendingCompanionDownloadRef.current;
            pendingCompanionDownloadRef.current = null;
            if (companion?.url && companion?.filename && !allModelNames.includes(companion.filename)) {
              setTimeout(() => {
                downloadByUrl(
                  companion.url,
                  companion.filename,
                  null,
                  { skipExistingConfirm: true }
                );
              }, 500);
            }
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 1000);
  };

  const handleUrlDownloadSubmit = async (e) => {
    e.preventDefault();
    if (!downloadUrl.trim()) return;

    let modelName = activeModelType === "image" ? "model.safetensors" : activeModelType === "text" ? "model.gguf" : activeModelType === "speech" ? "model.bin" : "model.json";
    try {
      const parsed = new URL(downloadUrl.trim());
      modelName = parsed.pathname.split("/").pop() || modelName;
    } catch (_) {
      showAlert({ title: "Invalid URL", message: "Please provide a valid HTTP/HTTPS link.", danger: true });
      return;
    }

    await downloadByUrl(downloadUrl.trim(), modelName);
    setDownloadUrl("");
  };

  const handleLibraryDownload = async (model) => {
    if (downloadingModelId) return;

    if (activeModelType === "speech") {
      const confirmed = await showConfirm({
        title: "Download Speech Model?",
        message: `Download "${model.name}" (${model.size || model.approxSize})?`,
        confirmLabel: "Download",
      });
      if (confirmed) {
        await downloadByUrl(model.url, model.filename);
      }
      return;
    }

    if (activeModelType === "tts") {
      const confirmed = await showConfirm({
        title: "Download TTS Model?",
        message: `Install "${model.name}"? Kokoro model files are cached on first generation.`,
        confirmLabel: "Install",
      });
      if (confirmed) {
        await downloadByUrl(model.id || model.url, model.filename);
      }
      return;
    }

    if (model.backendType === "openvino-npu") {
      const confirmed = await showConfirm({
        title: "Download OpenVINO Model?",
        message: `Download "${model.name}" (~${model.approxSize})? OpenVINO models are downloaded folder-by-folder via python script.`,
        confirmLabel: "Download",
      });
      if (!confirmed) return;
      try {
        await downloadOpenVinoModel(model.id);
        startProgressPolling(model.name);
      } catch (err) {
        showAlert({ title: "Download Failed", message: err.message, danger: true });
      }
      return;
    }

    const hasMainModel = modelNames.includes(model.filename);
    const hasProjector = !model.projectorFilename || allModelNames.includes(model.projectorFilename);
    if (hasMainModel && model.projectorUrl && model.projectorFilename && !hasProjector) {
      const confirmed = await showConfirm({
        title: "Download Vision Projector?",
        message: `"${model.name}" is downloaded, but image input needs the matching projector file (${model.projectorFilename}). Download it now?`,
        confirmLabel: "Download Projector",
      });
      if (confirmed) {
        await downloadByUrl(model.projectorUrl, model.projectorFilename, null, { skipExistingConfirm: true });
      }
      return;
    }

    const confirmed = await showConfirm({
      title: "Download Model?",
      message: model.projectorUrl
        ? `Download "${model.name}" (~${model.approxSize}) and its required vision projector?`
        : `Download "${model.name}" (~${model.approxSize})?`,
      confirmLabel: "Download",
    });
    if (confirmed) {
      await downloadByUrl(
        model.url,
        model.filename,
        model.projectorUrl && model.projectorFilename
          ? { url: model.projectorUrl, filename: model.projectorFilename }
          : null
      );
    }
  };

  const handleCancelDownload = async () => {
    try {
      await cancelModelDownload();
      setDownloadingModelId(null);
      setDownloadProgress(0);
      setDownloadSpeed("");
    } catch (err) {
      console.error(err);
    }
  };

  const checkVramAndLoad = async (modelId, options = {}) => {
    if (!options.skipActiveGuard && blockLoadIfOtherRuntimeActive(modelId, "image")) {
      return;
    }

    const modelInfo = getLocalModelInfo(modelId);
    if (!modelInfo) {
      await performLoadModel(modelId);
      return;
    }

    const isOpenVinoSelected = constraints.backendType === "openvino-npu";
    const isOpenVinoModel = modelInfo.backendType === "openvino-npu";
    const isCoreMLModel = modelInfo.format === "CoreML" || modelInfo.backendType === "apple-npu";
    const isStandardWeights = /\.(safetensors|ckpt|gguf)$/i.test(modelId) || (!isOpenVinoModel && !isCoreMLModel);
    if (isOpenVinoSelected && isStandardWeights) {
      const gpuBackend = backendOptions?.options?.find((backend) =>
        ["vulkan", "cuda", "rocm", "metal"].includes(backend.id)
      );
      const cpuBackend = backendOptions?.options?.find((backend) => backend.id === "cpu");
      const targetBackend = gpuBackend || cpuBackend;

      if (!targetBackend) {
        await showAlert({
          title: "Switch Backend Required",
          message: `"${modelId}" is a standard weights file. OpenVINO NPU can only load downloaded OpenVINO model folders, and no GPU or CPU backend is currently installed.`,
          danger: true,
        });
        return;
      }

      const confirmed = await showConfirm({
        title: "Switch Accelerator?",
        message: `"${modelId}" cannot load on OpenVINO NPU. Switch to ${targetBackend.label} and load it there?`,
        confirmLabel: `Switch to ${targetBackend.label}`,
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;

      const nextConstraints = {
        ...constraints,
        backendType: targetBackend.id,
        useGpu: targetBackend.id !== "cpu",
      };
      setConstraints(nextConstraints);
      await performLoadModel(modelId, nextConstraints);
      return;
    }

    const totalSizeBytes = Number(modelInfo.sizeBytes) || 0;
    if (totalSizeBytes <= 0) {
      await performLoadModel(modelId);
      return;
    }

    const freeVramGb = Number(telemetry.vram_total_gb - telemetry.vram_used_gb) || 0;
    const modelSizeGb = totalSizeBytes / (1024 ** 3);
    const hasNvidiaGpu = Boolean(telemetry.gpu_name && telemetry.gpu_name.toLowerCase().includes("nvidia"));
    
    const isCpuOnlyBackend = constraints.backendType === "cpu" || constraints.useGpu === false;

    if (hasNvidiaGpu && !isCpuOnlyBackend && modelInfo.backendType !== "openvino-npu" && modelInfo.format !== "CoreML") {
      const safetyMarginGb = 0.8;
      if (modelSizeGb + safetyMarginGb > freeVramGb) {
        setVramWarning({
          modelId,
          modelSizeGb,
          freeVramGb,
          totalVramGb: telemetry.vram_total_gb,
        });
        return;
      }
    }
    await performLoadModel(modelId);
  };

  const loadTextModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 40,
      phase: "Starting llama.cpp server...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      const cores = textSettings?.threads || specs?.cpu_cores_physical || 4;
      const context = textSettings?.contextSize ?? 0;
      await startLlm(modelId, {
        threads: cores,
        contextSize: context,
        gpuLayers: -1,
        preferredBackend: textSettings?.preferredBackend
      });
      setActiveLlmModel(modelId);
      setLlmRunning(true);
    } catch (err) {
      showAlert({ title: "Model Load Failed", message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const loadSpeechModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 30,
      phase: "Starting whisper.cpp speech runtime...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      await startSpeech(modelId, { threads: textSettings?.threads || specs?.cpu_cores_physical || 4 });
      setActiveSpeechModel(modelId);
      setSpeechRunning(true);
    } catch (err) {
      showAlert({ title: "Speech Model Load Failed", message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const loadTtsModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 30,
      phase: "Starting Kokoro ONNX TTS runtime...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      await startTts(modelId);
      setActiveTtsModel(modelId);
      setTtsRunning(true);
    } catch (err) {
      showAlert({ title: "TTS Model Load Failed", message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const handleLoadModel = async (modelId) => {
    if (blockLoadIfOtherRuntimeActive(modelId, activeModelType)) {
      return;
    }

    if (activeModelType === "image") {
      await checkVramAndLoad(modelId);
    } else if (activeModelType === "text") {
      await loadTextModel(modelId);
    } else if (activeModelType === "speech") {
      await loadSpeechModel(modelId);
    } else {
      await loadTtsModel(modelId);
    }
  };

  const performLoadModel = async (modelId, forcedConstraints = null) => {
    const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
    const backendStatus = await getBackendStatus();
    const backendPort = backendStatus?.port || 8080;
    
    if (!isTauriDesktop && !isLocalServerMode()) {
      const isAlreadyRunning = await pingServer();
      const modelInfo = getLocalModelInfo(modelId);
      const isOpenVinoModel = modelInfo?.backendType === "openvino-npu";
      const cmd = isOpenVinoModel
        ? `Run the platform launcher and load "${modelId}" from Model Manager on a configured Intel NPU machine.`
        : `.\\backend\\win\\vulkan\\sd-vulkan.exe --listen-port ${backendPort} --model .\\models\\${modelId} --threads 8`;
      
      if (isAlreadyRunning) {
        if (await showConfirm({ title: "Web Browser Mode", message: `To load "${modelId}" on the active GPU server, restart your terminal backend with:\n\n${cmd}\n\nUpdate the UI status anyway?`, confirmLabel: "Update UI" })) {
          setActiveModel(modelId);
          setServerRunning(true);
        }
      } else {
        if (await showConfirm({ title: "Backend Not Running", message: `C++ backend server is not running on port ${backendPort}.\n\nTo run locally, start:\n\n${cmd}\n\nProceed in Simulation Mode instead?`, confirmLabel: "Proceed" })) {
          setActiveModel(modelId);
          setServerRunning(false);
        }
      }
      return;
    }

    cancelLoadRef.current = false;
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 0,
      phase: "Starting backend...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      const modelInfo = getLocalModelInfo(modelId);
      const isCoreMLModel = modelInfo?.format === "CoreML" || modelInfo?.backendType === "apple-npu";
      const activeConstraints = forcedConstraints || constraints;
      const loadConstraints = isCoreMLModel
        ? {
            ...activeConstraints,
            backendType: "apple-npu",
            useGpu: true,
            width: 512,
            height: 512,
            steps: activeConstraints.steps || 20,
            cfgScale: Number(activeConstraints.cfgScale) > 1 ? activeConstraints.cfgScale : 7,
          }
        : modelInfo?.backendType === "openvino-npu"
        ? {
            ...activeConstraints,
            backendType: "openvino-npu",
            useGpu: true,
            width: activeConstraints.width >= 1024 ? 1024 : 512,
            height: activeConstraints.height >= 1024 ? 1024 : 512,
            steps: Math.max(1, Math.min(8, activeConstraints.steps || 4)),
            cfgScale: activeConstraints.cfgScale || 1,
          }
        : activeConstraints;
      
      const response = await startServer(modelId, loadConstraints);
      console.log(response);
      
      let isReady = false;
      let crashError = null;
      let readyStatus = null;
      const isOpenVinoModel = modelInfo?.backendType === "openvino-npu";
      const maxStartupPolls = (isOpenVinoModel || isCoreMLModel) ? 1200 : 240;
      for (let i = 0; i < maxStartupPolls; i++) {
        if (cancelLoadRef.current) {
          crashError = "Model load cancelled by the user.";
          break;
        }
        const status = await getBackendStatus();
        if (status.loading) {
          setModelLoadProgress({
            progress: status.loading.progress || 0,
            phase: status.loading.phase || "Loading model...",
            speed: status.loading.speed || "",
            current: status.loading.current || 0,
            total: status.loading.total || 0,
            model: status.loading.model || modelId,
            backendMode: status.loading.backendMode || status.settings?.backendMode || "",
            backendBinary: status.loading.backendBinary || status.settings?.backendBinary || "",
            device: status.loading.device || status.settings?.backendDevice || "",
          });
        }
        if (status.ready) {
          isReady = true;
          readyStatus = status;
          break;
        }
        if (status.error) {
          crashError = status.error;
          break;
        }
        if (!status.running && !status.loading?.active && i > 3) {
          crashError = "The backend process terminated immediately on startup.";
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      if (isReady) {
        const loadedModelId = readyStatus?.settings?.backendType === "openvino-npu"
          ? (readyStatus.settings.model || readyStatus.loading?.model || modelId)
          : modelId;
        setModelLoadProgress((prev) => ({
          ...(prev || {}),
          progress: 100,
          phase: "Model ready",
          speed: "",
          current: prev?.current || 0,
          total: prev?.total || 0,
          model: loadedModelId,
        }));
        setActiveModel(loadedModelId);
        setServerRunning(true);
      } else {
        throw new Error(crashError || `Model server failed to respond on port ${backendPort}.`);
      }
    } catch (e) {
      console.error("Failed to load model:", e);
      if (e.message !== "Model load cancelled by the user.") {
        showAlert({ title: "Model Load Failed", message: e.message || String(e), danger: true });
      }
    } finally {
      setTimeout(() => setModelLoadProgress(null), 800);
      setLoadingModelId(null);
    }
  };

  const handleUnloadThenLoad = async () => {
    const pendingLoad = pendingLoadModel;
    const nextModel = pendingLoad?.modelId;
    const targetType = pendingLoad?.targetType;
    setPendingLoadModel(null);
    await handleUnloadModel(pendingLoad?.activeRuntime);
    if (nextModel) {
      if (targetType === "image") {
        await checkVramAndLoad(nextModel, { skipActiveGuard: true });
      } else if (targetType === "text") {
        await loadTextModel(nextModel);
      } else if (targetType === "speech") {
        await loadSpeechModel(nextModel);
      } else if (targetType === "tts") {
        await loadTtsModel(nextModel);
      }
    }
  };

  const handleUnloadPendingOnly = async () => {
    const pendingLoad = pendingLoadModel;
    setPendingLoadModel(null);
    await handleUnloadModel(pendingLoad?.activeRuntime);
  };

  const handleUnloadModel = async (runtimeOverride = null) => {
    const runtime = runtimeOverride?.type ? runtimeOverride : getRuntimeForType(activeModelType);
    if (!runtime || isUnloading) return;

    if (runtime.type === "image") {
      if (isUnloading) return;
      setIsUnloading(true);
      setUnloadProgress({ progress: 10, phase: "Stopping backend process..." });

      const poll = setInterval(async () => {
        try {
          const status = await getBackendStatus();
          if (status.unloading?.active) {
            setUnloadProgress({
              progress: status.unloading.progress || 50,
              phase: status.unloading.phase || "Unloading model...",
            });
          } else {
            setUnloadProgress((prev) => ({
              progress: Math.min(95, prev.progress + 10),
              phase: prev.phase || "Unloading model...",
            }));
          }
        } catch (_) {}
      }, 300);

      try {
        await stopServer();
        setUnloadProgress({ progress: 100, phase: "Model unloaded" });
        setActiveModel(null);
        setPendingLoadModel(null);
        setServerRunning(false);
      } catch (e) {
        console.error(e);
        showAlert({ title: "Unload Failed", message: e.message || String(e), danger: true });
      } finally {
        clearInterval(poll);
        setTimeout(() => {
          setIsUnloading(false);
          setUnloadProgress({ progress: 0, phase: "" });
        }, 500);
      }
    } else if (runtime.type === "text") {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Stopping llama.cpp backend process..." });
      try {
        await stopLlm();
        setActiveLlmModel(null);
        setLlmRunning(false);
      } catch (e) {
        showAlert({ title: "Unload Failed", message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    } else if (runtime.type === "speech") {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Stopping whisper.cpp speech runtime..." });
      try {
        await stopSpeech();
        setActiveSpeechModel(null);
        setSpeechRunning(false);
      } catch (e) {
        showAlert({ title: "Unload Failed", message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    } else {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Stopping Kokoro TTS runtime..." });
      try {
        await stopTts();
        setActiveTtsModel(null);
        setTtsRunning(false);
      } catch (e) {
        showAlert({ title: "Unload Failed", message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    }
  };

  const handleDeleteModel = async (filename) => {
    if (await showConfirm({
      title: "Delete Model?",
      message: `Delete "${filename}" from your drive?`,
      confirmLabel: "Delete",
      danger: true,
    })) {
      try {
        if (activeModelType === "image") {
          await deleteModel(filename);
          if (activeModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "text") {
          await deleteLlmModel(filename);
          if (activeLlmModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "speech") {
          await deleteSpeechModel(filename);
          if (activeSpeechModel === filename) {
            await handleUnloadModel();
          }
        } else {
          await deleteTtsModel(filename);
          if (activeTtsModel === filename) {
            await handleUnloadModel();
          }
        }
        await fetchModels();
      } catch (err) {
        console.error("Failed to delete model:", err);
        showAlert({ title: "Delete Failed", message: err.message || String(err), danger: true });
      }
    }
  };

  const executeImport = async (sourcePath, displayName) => {
    const controller = new AbortController();
    setImportAbortController(controller);
    setImportProgress(0);
    setImportInfo({
      filename: displayName,
      speed: "0.0",
      eta: 0,
      status: "Initiating file copy..."
    });

    try {
      if (activeModelType === "image") {
        await importModelFile(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "text") {
        await importLlmModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "speech") {
        await importSpeechModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else {
        await importTtsModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      }

      await fetchModels();
    } catch (err) {
      console.error("Import failed:", err);
      if (err.name !== "AbortError") {
        showAlert({ title: "Import Failed", message: err.message || String(err), danger: true });
      }
    } finally {
      setImportProgress(null);
      setImportAbortController(null);
    }
  };

  const handleCancelImport = () => {
    if (importAbortController) {
      importAbortController.abort();
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (file) {
      executeImport(file, file.name);
    }
    e.target.value = "";
  };

  const [movingModel, setMovingModel] = useState(null);

  const handleMoveModel = async (filename, to) => {
    setMovingModel(filename);
    try {
      await moveModelFile(filename, activeModelType, to);
      setActiveModelType(to);
      await fetchModels();
    } catch (err) {
      showAlert?.({ title: "Couldn't move the model", message: err.message || String(err), danger: true });
    } finally {
      setMovingModel(null);
    }
  };

  const handleBrowseForFile = async () => {
    setIsPicking(true);
    setLinkError("");
    try {
      const picked = await pickModelFile(activeModelType);
      if (picked) setLinkPath(picked);
    } catch (err) {
      setLinkError(err.message || String(err));
    } finally {
      setIsPicking(false);
    }
  };

  const handleLinkSubmit = async (event) => {
    event.preventDefault();
    if (!linkPath.trim() || isLinking) return;
    setIsLinking(true);
    setLinkError("");
    try {
      const result = await linkModelFile(linkPath.trim(), activeModelType);
      setLinkPath("");
      setAddOpen(false);
      setModelSearch("");
      // The server files it by what the file really is; follow it to that tab
      const placedElsewhere = result.kind && result.kind !== activeModelType;
      if (placedElsewhere) setActiveModelType(result.kind);
      await fetchModels();
      showAlert?.({
        title: placedElsewhere ? `Added as ${kindLabel(result.kind).toLowerCase()} model` : "Model added",
        message: `${placedElsewhere ? `This file is ${/^[aeiou]/i.test(result.kind) ? "an" : "a"} ${result.kind} model${result.detail ? ` (${result.detail})` : ""}, so it was added to ${kindLabel(result.kind)} models. ` : ""}It stays at ${result.linkedFrom} and uses no extra space. Don't move or delete that file.`,
      });
    } catch (err) {
      setLinkError(err.message || String(err));
    } finally {
      setIsLinking(false);
    }
  };
  const isUrlDownloading = Boolean(downloadingModelId);
  const fileInputRef = React.useRef(null);

  // Client-side name filter for both lists. On the Text tab the same query also
  // drives the Hugging Face search (see the effect above), so remote results are
  // not filtered a second time.
  const query = modelSearch.trim().toLowerCase();
  const matchesQuery = (...values) => !query || values.some((value) => String(value || "").toLowerCase().includes(query));
  const filteredLocalModels = displayedLocalModels.filter((model) => matchesQuery(model.filename, model.name));
  const libraryUsesRemoteSearch = activeModelType === "text" && hasHuggingFaceResults;
  const filteredLibrary = visibleModelLibrary
    .map((section) => ({
      ...section,
      items: libraryUsesRemoteSearch
        ? section.items
        : section.items.filter((model) => matchesQuery(model.name, model.filename)),
    }))
    .filter((section) => section.items.length > 0);

  const systemTier = getHardwareTier(specs);
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent || navigator.platform || "");
  const defaultFitLabel = isMac ? "Fits your Mac" : "Fits your PC";

  const typeNoun = activeModelType === "tts" ? "voice" : activeModelType;
  const importAccept = activeModelType === "image" ? ".safetensors,.ckpt" : activeModelType === "text" ? ".gguf" : activeModelType === "speech" ? ".bin" : ".json";
  const fileTypesLabel = activeModelType === "image" ? ".safetensors or .ckpt" : activeModelType === "text" ? ".gguf" : activeModelType === "speech" ? ".bin" : ".json";
  const canLinkInPlace = activeModelType !== "tts";
  const isMacClient = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent || navigator.platform || "");
  const ADD_METHODS = [
    { id: "link", label: "Download from a link", desc: "Paste a Hugging Face URL", Icon: DownloadCloud },
    ...(canLinkInPlace ? [{ id: "inplace", label: "Use a file where it is", desc: "No copy, no extra space", Icon: HardDrive }] : []),
    { id: "import", label: "Import a copy", desc: "Copies it into the app", Icon: Copy },
  ];
  const currentAddMethod = ADD_METHODS.some((method) => method.id === addMethod) ? addMethod : "link";

  const isModelActive = (filename) => (
    activeModelType === "image" ? activeModel === filename
      : activeModelType === "text" ? activeLlmModel === filename
      : activeModelType === "speech" ? activeSpeechModel === filename
      : activeTtsModel === filename
  );

  const getLocalFormatLabel = (model) => (
    activeModelType === "image"
      ? (model.backendType === "openvino-npu" ? "OpenVINO NPU" : model.format || "Weights file")
      : activeModelType === "text"
      ? "GGUF"
      : activeModelType === "speech"
      ? (model.language ? `Whisper · ${model.language}` : "Whisper")
      : "Kokoro ONNX"
  );

  const activeBackendLabel = activeModelType === "image"
    ? [backendInfo.backendMode, backendInfo.backendDevice].filter(Boolean).join(" · ")
    : activeModelType === "text"
    ? backendInfo.llmBackendMode
    : activeModelType === "speech"
    ? backendInfo.speechBackendMode
    : backendInfo.ttsBackendMode;

  // Which local row shows the load progress (OpenVINO may report a different id).
  const loadRowId = modelLoadProgress
    ? displayedLocalModels.find((model) => model.filename === loadingModelId || model.filename === modelLoadProgress.model)?.filename || null
    : null;
  const loadRowVisible = Boolean(loadRowId && filteredLocalModels.some((model) => model.filename === loadRowId));

  const isLibraryItemDownloading = (model) => (
    downloadingModelId === model.filename ||
    downloadingModelId === model.projectorFilename ||
    downloadingModelId === `${model.filename}.zip` ||
    (model.backendType === "openvino-npu" && downloadingModelId === model.name)
  );
  const libraryDownloadVisible = filteredLibrary.some((section) => section.items.some(isLibraryItemDownloading));

  const MODEL_TYPES = [
    { id: "image", label: "Image" },
    { id: "text", label: "Text" },
    { id: "speech", label: "Speech" },
    { id: "tts", label: "Voice" },
  ];

  const handleTabKeyDown = (event, index) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const nextIndex = (index + (event.key === "ArrowRight" ? 1 : -1) + MODEL_TYPES.length) % MODEL_TYPES.length;
    setActiveModelType(MODEL_TYPES[nextIndex].id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll('[role="tab"]');
    tabs?.[nextIndex]?.focus();
  };

  const renderProgress = ({ label, value, valueText, detail, danger = false, ariaLabel }) => {
    const clamped = Math.min(100, Math.max(0, Number(value) || 0));
    return (
      <div className="models-progress">
        <div className="models-progress-label">
          <span className="models-progress-phase">{label}</span>
          <span>{valueText ?? `${Math.round(clamped)}%`}</span>
        </div>
        <div
          className={`models-progress-bar ${danger ? "danger" : ""}`}
          role="progressbar"
          aria-label={ariaLabel || label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamped)}
        >
          <div className="models-progress-fill" style={{ width: `${clamped}%` }} />
        </div>
        {detail && <div className="models-progress-detail">{detail}</div>}
      </div>
    );
  };

  const renderLoadProgress = () => {
    if (!modelLoadProgress) return null;
    const isAppleNpu = modelLoadProgress.backendMode === "Apple NPU" || modelLoadProgress.backendMode === "Apple Neural Engine (NPU)";
    return (
      <div className="models-inline-panel">
        {renderProgress({
          label: `${modelLoadProgress.phase}${modelLoadProgress.speed ? ` (${modelLoadProgress.speed})` : ""}`,
          value: modelLoadProgress.progress,
          valueText: modelLoadProgress.total > 0
            ? `${modelLoadProgress.current} / ${modelLoadProgress.total} tensors`
            : `${Math.round(modelLoadProgress.progress)}%`,
          ariaLabel: `Loading ${modelLoadProgress.model}`,
          detail: (modelLoadProgress.backendMode || modelLoadProgress.device)
            ? `Starting ${modelLoadProgress.backendMode || "backend"}${modelLoadProgress.device ? ` · ${modelLoadProgress.device}` : ""}`
            : null,
        })}
        {isAppleNpu && (
          <p className="models-note">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>The first load compiles the model for the Apple Neural Engine and can take 3–4 minutes. Later loads are almost instant.</span>
          </p>
        )}
        {loadingModelId && (
          <div className="models-inline-actions">
            <button type="button" className="btn" onClick={handleCancelLoad}>
              <Square size={14} aria-hidden="true" />
              <span>Cancel load</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderDownloadProgress = (name) => (
    <div className="models-inline-panel">
      {renderProgress({
        label: name ? `Downloading ${name}` : "Downloading",
        value: downloadProgress,
        valueText: downloadProgress > 0 ? `${downloadProgress}%` : "Preparing",
        detail: downloadSpeed || null,
      })}
      <div className="models-inline-actions">
        <button type="button" className="btn" onClick={handleCancelDownload}>
          <Square size={14} aria-hidden="true" />
          <span>Stop download</span>
        </button>
      </div>
    </div>
  );

  const localEmptyTitle = query
    ? `No ${typeNoun} models match "${modelSearch.trim()}"`
    : `No ${typeNoun} models on this computer yet`;
  const localEmptyHint = query
    ? "Try a different name or clear the search."
    : activeModelType === "tts"
    ? "Install Kokoro from the library below, or import a .json manifest."
    : "Download one from the library below, or import a file.";

  // Close the row "..." menu on an outside click or Escape
  useEffect(() => {
    if (!rowMenu) return undefined;
    const onDown = (event) => {
      if (!event.target.closest?.(".models-row-menu")) setRowMenu(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setRowMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rowMenu]);

  // The add panel stays open while its download or import is running so progress stays visible
  const urlDownloadRunning = isUrlDownloading && !libraryDownloadVisible;
  const addPanelVisible = addOpen || urlDownloadRunning || importProgress !== null;

  // Generic labels ("Weights file", "GGUF") add noise; keep the ones that say something
  const localDetailLabel = (model) => {
    if (activeModelType === "speech" || activeModelType === "tts") return null; // their names already say it
    const label = getLocalFormatLabel(model);
    return /weights file|^gguf$/i.test(label) ? null : label;
  };

  return (
    <div className="page models-page">
      <div className="page-scroll">
        <div className="page-column">
          <header className="page-header models-header">
            <h1 className="page-title">Models</h1>
            <div className="models-header-tools">
              <div className="search-field models-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder={activeModelType === "text" ? "Search models and Hugging Face" : "Search models"}
                  aria-label={activeModelType === "text" ? "Search models and Hugging Face" : "Search models"}
                />
                {modelSearch && (
                  <button type="button" className="models-search-clear" onClick={() => setModelSearch("")} aria-label="Clear search">
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary models-add-btn"
                onClick={() => setAddOpen((open) => !open)}
                aria-expanded={addPanelVisible}
                aria-controls="models-add-panel"
              >
                <Plus size={15} aria-hidden="true" />
                <span>Add model</span>
              </button>
            </div>
          </header>

          <div className="segmented models-tabs" role="tablist" aria-label="Model type">
            {MODEL_TYPES.map((type, index) => {
              const selected = activeModelType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  role="tab"
                  className="segmented-item"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveModelType(type.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {type.label}
                </button>
              );
            })}
          </div>

          {/* Add from URL or file, opened from the header */}
          {addPanelVisible && (
            <section id="models-add-panel" className="models-add-panel" aria-label="Add a model">
              <div className="models-add-head">
                <h2 className="models-add-title">Add {/^[aeiou]/.test(typeNoun) ? "an" : "a"} {typeNoun} model</h2>
                {!urlDownloadRunning && importProgress === null && (
                  <button type="button" className="icon-btn" onClick={() => setAddOpen(false)} aria-label="Close">
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="models-add-methods" role="radiogroup" aria-label="How to add the model">
                {ADD_METHODS.map((method) => {
                  const MethodIcon = method.Icon;
                  const selected = currentAddMethod === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="models-add-method"
                      onClick={() => {
                        setAddMethod(method.id);
                        setLinkError("");
                      }}
                    >
                      <MethodIcon size={18} className="models-add-method-icon" aria-hidden="true" />
                      <span className="models-add-method-text">
                        <span className="models-add-method-label">{method.label}</span>
                        <span className="models-add-method-desc">{method.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {currentAddMethod === "link" && (
                <>
                  <form className="models-url-form" onSubmit={handleUrlDownloadSubmit}>
                    <div className="search-field models-url-field">
                      <Link size={16} aria-hidden="true" />
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="Paste a Hugging Face file URL"
                        aria-label="Model file URL"
                        value={downloadUrl}
                        onChange={(e) => setDownloadUrl(e.target.value)}
                        disabled={isUrlDownloading}
                      />
                    </div>
                    <button type="submit" className="btn" disabled={isUrlDownloading || !downloadUrl.trim()}>
                      <DownloadCloud size={14} aria-hidden="true" />
                      <span>Download</span>
                    </button>
                  </form>
                  <p className="field-hint models-add-hint">Works with {fileTypesLabel} files. It is saved to the app's models folder.</p>
                </>
              )}

              {currentAddMethod === "inplace" && (
                <>
                  <form className="models-url-form" onSubmit={handleLinkSubmit}>
                    <div className="search-field models-url-field">
                      <HardDrive size={16} aria-hidden="true" />
                      <input
                        type="text"
                        spellCheck={false}
                        autoComplete="off"
                        placeholder={isMacClient ? "/Users/you/Models/model.safetensors" : "D:\\Models\\model.safetensors"}
                        aria-label="Path to the model file"
                        value={linkPath}
                        onChange={(e) => {
                          setLinkPath(e.target.value);
                          setLinkError("");
                        }}
                        disabled={isLinking}
                      />
                    </div>
                    <button type="button" className="btn" onClick={handleBrowseForFile} disabled={isPicking || isLinking}>
                      {isPicking ? <Loader2 size={14} className="models-spin" aria-hidden="true" /> : <FolderOpen size={14} aria-hidden="true" />}
                      <span>{isPicking ? "Choosing…" : "Browse…"}</span>
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={isLinking || !linkPath.trim()}>
                      {isLinking ? <Loader2 size={14} className="models-spin" aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                      <span>Use file</span>
                    </button>
                  </form>
                  {linkError ? (
                    <p className="models-warning models-add-hint" role="alert">{linkError}</p>
                  ) : (
                    <p className="field-hint models-add-hint">
                      {isPicking
                        ? "Choose the file in the window that opened. It may be behind this one."
                        : isMacClient
                        ? "It stays where it is, so don't move or delete it. Tip: in Finder, Option-Command-C copies a file's path."
                        : "It stays where it is, so don't move or delete it. Tip: Shift-right-click a file and choose Copy as path."}
                    </p>
                  )}
                </>
              )}

              {currentAddMethod === "import" && (
                <>
                  <div className="models-add-row models-import-row">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="models-file-input"
                      accept={importAccept}
                      onChange={handleImportFile}
                      disabled={importProgress !== null}
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importProgress !== null}
                    >
                      <FolderOpen size={14} aria-hidden="true" />
                      <span>Choose file…</span>
                    </button>
                    <span className="models-import-note">
                      A {fileTypesLabel} file is copied into the app, so it keeps working if the original moves. The copy uses disk space.
                    </span>
                  </div>
                </>
              )}

              {urlDownloadRunning && renderDownloadProgress(downloadingModelId)}

              {importProgress !== null && (
                <div className="models-inline-panel">
                  {renderProgress({
                    label: `Copying ${importInfo.filename}${importInfo.status ? ` · ${importInfo.status}` : ""}`,
                    value: importProgress,
                    valueText: `${importProgress}%`,
                    detail: `${importInfo.speed} MB/s · ${importInfo.eta}s left`,
                  })}
                  <div className="models-inline-actions">
                    <button type="button" className="btn" onClick={handleCancelImport}>
                      <Square size={14} aria-hidden="true" />
                      <span>Stop import</span>
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* On this computer */}
          <h2 className="page-section-label models-section-label">
            <span>On this computer</span>
            {!isLoadingModels && <span className="models-count">{filteredLocalModels.length}</span>}
          </h2>

          {modelLoadProgress && !loadRowVisible && (
            <div className="row-list models-standalone">
              <div className="row-item models-stack-item">
                <div className="row-item-main">
                  <div className="row-item-title">{describeModelFile(modelLoadProgress.model).title}</div>
                  {renderLoadProgress()}
                </div>
              </div>
            </div>
          )}

          {isLoadingModels ? (
            <div className="models-scanning" role="status">
              <Loader2 size={16} className="models-spin" aria-hidden="true" />
              <span>Looking for models…</span>
            </div>
          ) : filteredLocalModels.length === 0 ? (
            <div className="row-list">
              <div className="empty-state">
                <div className="empty-state-title">{localEmptyTitle}</div>
                <div>{localEmptyHint}</div>
              </div>
            </div>
          ) : (
            <ul className="row-list">
              {filteredLocalModels.map((model) => {
                const filename = model.filename;
                const isActive = isModelActive(filename);
                const isLoadingThis = loadingModelId === filename;
                // Some runtimes put a note in "size"; only show it when it is an actual size
                const rawSize = model.size || formatBytes(model.sizeBytes);
                const sizeLabel = /^\s*~?\d/.test(String(rawSize || "")) ? rawSize : null;
                const info = describeModelFile(filename, model.name);
                const meta = [
                  model.missing ? "File not found" : sizeLabel,
                  ...info.details,
                  model.linkedFrom ? `Linked from ${shortPath(model.linkedFrom)}` : null,
                  localDetailLabel(model),
                  isActive && activeBackendLabel ? `Running on ${activeBackendLabel}` : null,
                ].filter(Boolean).join(" · ");
                const menuOpen = rowMenu === filename;
                // A file whose header says it belongs under another type (a text GGUF on the Image tab)
                const belongsIn = ["image", "text", "speech"].includes(model.detectedKind) && model.detectedKind !== activeModelType
                  ? model.detectedKind
                  : null;
                return (
                  <li
                    key={filename}
                    className={`row-item models-stack-item models-local-row ${isActive ? "is-loaded" : ""} ${isLoadingThis || menuOpen ? "is-engaged" : ""}`}
                  >
                    <div className="models-row-top">
                      <div className="row-item-main" title={model.linkedFrom || filename}>
                        <div className="models-title-line">
                          <span className="row-item-title">{info.title}</span>
                          {isActive && <span className="models-loaded-tag">Loaded</span>}
                        </div>
                        {meta && <div className="row-item-meta models-meta">{meta}</div>}
                        {belongsIn && (
                          <div className="models-misplaced" role="note">
                            <AlertTriangle size={13} aria-hidden="true" />
                            <span>This is {/^[aeiou]/i.test(belongsIn) ? "an" : "a"} {belongsIn} model, so it won't work here.</span>
                            <button
                              type="button"
                              className="models-link-btn models-misplaced-btn"
                              onClick={() => handleMoveModel(filename, belongsIn)}
                              disabled={movingModel === filename || isActive}
                            >
                              {movingModel === filename && <Loader2 size={13} className="models-spin" aria-hidden="true" />}
                              <span>Move to {kindLabel(belongsIn)} models</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="row-item-actions models-row-actions">
                        {isActive ? (
                          <button type="button" className="btn" onClick={() => handleUnloadModel()} disabled={isUnloading}>
                            {isUnloading && <Loader2 size={14} className="models-spin" aria-hidden="true" />}
                            <span>{isUnloading ? "Unloading" : "Unload"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => handleLoadModel(filename)}
                            disabled={isBusy}
                            aria-label={`Load ${info.title}`}
                          >
                            {isLoadingThis && <Loader2 size={14} className="models-spin" aria-hidden="true" />}
                            <span>{isLoadingThis ? "Loading" : "Load"}</span>
                          </button>
                        )}
                        <div className="models-row-menu">
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => setRowMenu(menuOpen ? null : filename)}
                            aria-label={`More actions for ${info.title}`}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                          >
                            <MoreHorizontal size={17} aria-hidden="true" />
                          </button>
                          {menuOpen && (
                            <div className="popover models-row-popover" role="menu">
                              <div className="models-row-popover-file" title={model.linkedFrom || filename}>{model.linkedFrom || filename}</div>
                              <button
                                type="button"
                                role="menuitem"
                                className="models-row-popover-item danger"
                                onClick={() => {
                                  setRowMenu(null);
                                  handleDeleteModel(filename);
                                }}
                                disabled={isBusy || isActive}
                                title={isActive ? "Unload it first" : undefined}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                                <span>{model.linkedFrom ? "Remove from app (keeps the file)" : "Delete from this computer"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {loadRowId === filename && renderLoadProgress()}
                    {isActive && isUnloading && activeModelType === "image" && (
                      <div className="models-inline-panel">
                        {renderProgress({
                          label: unloadProgress.phase || "Unloading model…",
                          value: unloadProgress.progress,
                          danger: true,
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Library */}
          <h2 className="page-section-label">Library</h2>

          {activeModelType === "text" && (
            <div className="models-library-tools">
              <div className="models-filter-row" role="group" aria-label="Hugging Face filters">
                {MODEL_FILTERS.map((filter) => {
                  const selected = selectedFilters.includes(filter.id);
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      className="models-filter-chip"
                      onClick={() => toggleModelFilter(filter.id)}
                      aria-pressed={selected}
                    >
                      {filter.label}
                      {selected && <X size={12} aria-hidden="true" />}
                    </button>
                  );
                })}
                {selectedFilters.length > 0 && (
                  <button type="button" className="models-link-btn" onClick={() => setSelectedFilters([])}>
                    Clear filters
                  </button>
                )}
              </div>
              {isSearchingModels && (
                <div className="models-scanning models-scanning-inline" role="status">
                  <Loader2 size={14} className="models-spin" aria-hidden="true" />
                  <span>Searching Hugging Face…</span>
                </div>
              )}
              {modelSearchError && (
                <p className="models-warning" role="status">
                  {modelSearchError} Showing the built-in list instead.
                </p>
              )}
            </div>
          )}

          {filteredLibrary.length === 0 && !(activeModelType === "text" && isSearchingModels) && (
            <div className="row-list">
              <div className="empty-state">
                <div className="empty-state-title">
                  {activeModelType === "text" && hasHuggingFaceResults
                    ? "No single-file GGUF models match"
                    : query ? `Nothing in the library matches "${modelSearch.trim()}"` : "The library is empty for this type"}
                </div>
                <div>
                  {activeModelType === "text" && hasHuggingFaceResults
                    ? "Try another search or remove a filter."
                    : "Try a different name, or add one with a download link."}
                </div>
              </div>
            </div>
          )}

          {filteredLibrary.map((section) => (
            <section key={section.group} className="models-group" aria-label={section.group}>
              <h3 className="models-group-label">{section.group}</h3>
              <ul className="models-library-grid">
                {section.items.map((model) => {
                  const hasMainModel = modelNames.includes(model.filename);
                  const hasProjector = !model.projectorFilename || allModelNames.includes(model.projectorFilename);
                  const needsProjector = Boolean(hasMainModel && model.projectorFilename && !hasProjector);
                  const installed = hasMainModel && hasProjector;
                  const downloading = isLibraryItemDownloading(model);
                  const isRecommended = typeof model.recommendedFit === "boolean"
                    ? model.recommendedFit
                    : model.recommendedTiers && model.recommendedTiers.includes(systemTier);
                  const fitLabel = model.fitLabel || defaultFitLabel;
                  const sizeLabel = model.size && model.size !== "Unknown"
                    ? model.size
                    : model.approxSize
                    ? (/^\d/.test(model.approxSize) ? `~${model.approxSize}` : model.approxSize)
                    : null;
                  const meta = [
                    sizeLabel,
                    model.resolution && model.resolution !== "N/A" ? model.resolution : null,
                    model.format && !/^(safetensors|gguf)$/i.test(model.format) ? model.format : null,
                  ].filter(Boolean).join(" · ");
                  const pageLink = model.pageUrl || model.url;
                  return (
                    <li
                      key={`${model.id || section.group}:${model.filename}`}
                      className={`models-card ${downloading ? "is-downloading" : ""}`}
                    >
                      <div className="models-card-title">
                        <span>{model.name}</span>
                        {isRecommended && (
                          <span
                            className="models-fit-dot"
                            role="img"
                            aria-label={fitLabel}
                            title={model.fitReason ? `${fitLabel}: ${model.fitReason}` : fitLabel}
                          />
                        )}
                      </div>
                      {model.notes && <p className="models-card-desc">{model.notes}</p>}
                      <div className="models-card-foot">
                        <span className="models-card-meta">{meta}</span>
                        <div className="models-card-actions">
                          {pageLink && (
                            <a
                              className="icon-btn"
                              href={pageLink}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={model.pageUrl ? `View ${model.name} on Hugging Face` : `Open the download link for ${model.name}`}
                              title={model.pageUrl ? "View on Hugging Face" : "Open download link"}
                            >
                              <ExternalLink size={15} aria-hidden="true" />
                            </a>
                          )}
                          {installed ? (
                            <span className="models-card-done">
                              <Check size={14} aria-hidden="true" />
                              <span>Downloaded</span>
                            </span>
                          ) : needsProjector ? (
                            <button
                              type="button"
                              className="btn models-card-btn"
                              onClick={() => handleLibraryDownload(model)}
                              disabled={downloadingModelId !== null}
                            >
                              {downloading && <Loader2 size={14} className="models-spin" aria-hidden="true" />}
                              <span>Get vision file</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="icon-btn models-card-download"
                              onClick={() => handleLibraryDownload(model)}
                              disabled={downloadingModelId !== null}
                              aria-label={downloading ? `Downloading ${model.name}` : `Download ${model.name}`}
                              title={downloading ? "Downloading" : "Download"}
                            >
                              {downloading
                                ? <Loader2 size={15} className="models-spin" aria-hidden="true" />
                                : <DownloadCloud size={15} aria-hidden="true" />}
                            </button>
                          )}
                        </div>
                      </div>
                      {downloading && renderDownloadProgress(null)}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {activeModelType === "text" && hasHuggingFaceResults && hasMoreModels && !isSearchingModels && (
            <div className="models-load-more">
              <button
                type="button"
                className="btn"
                onClick={handleLoadMoreModels}
                disabled={isLoadingMoreModels}
              >
                {isLoadingMoreModels && <Loader2 size={14} className="models-spin" aria-hidden="true" />}
                <span>{isLoadingMoreModels ? "Loading more…" : "Load more"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {pendingLoadModel && (
        <div className="models-dialog-backdrop">
          <div className="models-dialog" role="dialog" aria-modal="true" aria-labelledby="models-pending-title">
            <h3 id="models-pending-title" className="models-dialog-title">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>Another model is loaded</span>
            </h3>
            <p className="models-dialog-body">
              "{pendingLoadModel.activeRuntime?.model}" is loaded as the {(pendingLoadModel.activeRuntime?.label || "active").toLowerCase()} model. Unload it before loading "{pendingLoadModel.modelId}" as the {getModelTypeLabel(pendingLoadModel.targetType).toLowerCase()} model.
            </p>
            <div className="models-dialog-actions">
              <button type="button" className="btn" onClick={() => setPendingLoadModel(null)} disabled={isUnloading}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleUnloadPendingOnly} disabled={isUnloading}>
                Unload only
              </button>
              <button type="button" className="btn btn-primary" onClick={handleUnloadThenLoad} disabled={isUnloading}>
                {isUnloading && <Loader2 size={14} className="models-spin" aria-hidden="true" />}
                <span>Unload and load</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {vramWarning && (
        <div className="models-dialog-backdrop">
          <div className="models-dialog" role="dialog" aria-modal="true" aria-labelledby="models-vram-title">
            <h3 id="models-vram-title" className="models-dialog-title">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>Not enough GPU memory</span>
            </h3>
            <p className="models-dialog-body">
              <strong>{vramWarning.modelId}</strong> needs about <strong>{vramWarning.modelSizeGb.toFixed(1)} GB</strong>, but only <strong>{vramWarning.freeVramGb.toFixed(1)} GB</strong> of GPU memory is free ({vramWarning.totalVramGb.toFixed(1)} GB total).
            </p>
            <p className="models-dialog-body">
              Loading it on the GPU may fail, stop the backend, or make generation very slow. Load it on the CPU instead, or close other GPU apps first.
            </p>
            <div className="models-dialog-actions">
              <button type="button" className="btn" onClick={() => setVramWarning(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  const targetModel = vramWarning.modelId;
                  setVramWarning(null);
                  await performLoadModel(targetModel);
                }}
              >
                Use GPU anyway
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const targetModel = vramWarning.modelId;
                  setVramWarning(null);
                  if (setConstraints) {
                    setConstraints((prev) => ({
                      ...prev,
                      backendType: "cpu",
                      useGpu: false,
                    }));
                  }
                  const cpuConstraints = {
                    ...constraints,
                    backendType: "cpu",
                    useGpu: false,
                  };
                  await performLoadModel(targetModel, cpuConstraints);
                }}
              >
                Load on CPU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ModelManager);
