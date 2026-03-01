import { useCallback, useSyncExternalStore } from "react";
import type { LLMConfig } from "../services/llmClient";

type LlmConfigState = {
  config: LLMConfig;
};

const STORAGE_KEY = "star-manager.llm-config";

const defaultConfig: LLMConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.3,
  maxTokens: 120,
  pass1Prompt: "You label GitHub repositories with 1-3 concise tags. Output only comma-separated tags.",
  pass1StrictPrompt: "You label GitHub repositories with exactly 1 concise tag. Output only the tag text.",
  pass2Prompt:
    "You consolidate tag lists by merging synonyms and near-duplicates. Output only JSON mapping each original tag to a compressed tag. Do not invent new tags beyond the provided list.",
  pass1PromptZh:
    "你将 GitHub 仓库标注为 1-3 个简洁标签，仅输出逗号分隔的标签。",
  pass1StrictPromptZh: "你将 GitHub 仓库标注为且仅标注 1 个简洁标签，仅输出标签文本。",
  pass2PromptZh:
    "你需要合并标签中的同义词或近似词，输出仅包含原始标签到压缩标签的 JSON 映射。不要创造列表外的新标签。",
  pass1PromptWithExisting:
    "You label GitHub repositories with 1-3 concise tags. Prefer existing Star Lists when they fit, but you may add a new tag if needed. Output only comma-separated tags.",
  pass1PromptNoNewWithExisting:
    "You label GitHub repositories with 1-3 concise tags. You must select from the existing Star Lists only. If none fit, output nothing. Output only comma-separated tags.",
  pass1StrictPromptWithExisting:
    "You label GitHub repositories with exactly 1 concise tag. Prefer existing Star Lists when they fit. Output only the tag text.",
  pass1StrictNoNewWithExisting:
    "You must select exactly 1 tag from the existing Star Lists. If none fit, output nothing. Output only the tag text.",
  pass1PromptWithExistingZh:
    "你将 GitHub 仓库标注为 1-3 个简洁标签，优先使用已有 Star Lists，如有必要可新增标签，仅输出逗号分隔的标签。",
  pass1PromptNoNewWithExistingZh:
    "你将 GitHub 仓库标注为 1-3 个简洁标签，只能从已有 Star Lists 中选择。如果没有合适标签，请输出空内容，仅输出逗号分隔的标签。",
  pass1StrictPromptWithExistingZh:
    "你将 GitHub 仓库标注为且仅标注 1 个简洁标签，优先使用已有 Star Lists，仅输出标签文本。",
  pass1StrictNoNewWithExistingZh:
    "你必须从已有 Star Lists 中选择且仅选择 1 个标签。如果没有合适的标签，请输出空内容，仅输出标签文本。",
  pass2PromptWithExisting:
    "You consolidate tag lists by merging synonyms and near-duplicates. Output only JSON mapping each original tag to a compressed tag. Do not invent new tags beyond the provided list.",
  pass2PromptWithExistingZh:
    "你需要合并标签中的同义词或近似词，输出仅包含原始标签到压缩标签的 JSON 映射。不要创造列表外的新标签。",
};

let cached = readFromStorage();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function readFromStorage(): LlmConfigState {
  if (typeof window === "undefined") {
    return { config: { ...defaultConfig } };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { config: { ...defaultConfig } };
    const parsed = JSON.parse(raw) as Partial<LLMConfig>;
    return {
      config: {
        ...defaultConfig,
        ...parsed,
      },
    };
  } catch {
    return { config: { ...defaultConfig } };
  }
}

function persist(next: LlmConfigState) {
  cached = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.config));
  }
  emitChange();
}

export function useLlmConfigStore() {
  const state = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => cached,
    () => cached
  );

  const setConfig = useCallback((config: LLMConfig) => {
    persist({ config });
  }, []);

  const updateConfig = useCallback((partial: Partial<LLMConfig>) => {
    persist({ config: { ...cached.config, ...partial } });
  }, []);

  const clearConfig = useCallback(() => {
    persist({ config: { ...defaultConfig, apiKey: "" } });
  }, []);

  return {
    config: state.config,
    setConfig,
    updateConfig,
    clearConfig,
  };
}
