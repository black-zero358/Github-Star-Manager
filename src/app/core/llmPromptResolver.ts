import type { LLMConfig } from "../services/llmClient";

export type PromptLanguage = "zh" | "en";

export type PromptFieldKey =
  | "pass1Prompt"
  | "pass1StrictPrompt"
  | "pass2Prompt"
  | "pass1PromptWithExisting"
  | "pass1PromptNoNewWithExisting"
  | "pass1StrictPromptWithExisting"
  | "pass1StrictNoNewWithExisting"
  | "pass2PromptWithExisting"
  | "pass1PromptZh"
  | "pass1StrictPromptZh"
  | "pass2PromptZh"
  | "pass1PromptWithExistingZh"
  | "pass1PromptNoNewWithExistingZh"
  | "pass1StrictPromptWithExistingZh"
  | "pass1StrictNoNewWithExistingZh"
  | "pass2PromptWithExistingZh";

type PromptFieldSet = {
  pass1: PromptFieldKey;
  pass1Strict: PromptFieldKey;
  pass2: PromptFieldKey;
};

export type PromptMode = {
  useExistingLists: boolean;
  allowNewTagsWithExistingLists: boolean;
  strictSingleTag: boolean;
  language: PromptLanguage;
};

export type ResolvedPrompts = {
  pass1: string;
  pass1Strict: string;
  pass2: string;
  selectedPass1: string;
  activeKeys: PromptFieldSet;
  inactiveKeys: PromptFieldKey[];
};

const DEFAULT_PASS1_PROMPT =
  "You label GitHub repositories with 1-3 concise tags. Output only comma-separated tags.";
const DEFAULT_PASS1_STRICT_PROMPT =
  "You label GitHub repositories with exactly 1 concise tag. Output only the tag text.";
const DEFAULT_PASS2_PROMPT =
  "You consolidate tag lists by merging synonyms and near-duplicates. Output only JSON mapping each original tag to a compressed tag. Do not invent new tags beyond the provided list.";

const EN_PROMPT_FIELDS: PromptFieldKey[] = [
  "pass1Prompt",
  "pass1StrictPrompt",
  "pass2Prompt",
  "pass1PromptWithExisting",
  "pass1PromptNoNewWithExisting",
  "pass1StrictPromptWithExisting",
  "pass1StrictNoNewWithExisting",
  "pass2PromptWithExisting",
];

const ZH_PROMPT_FIELDS: PromptFieldKey[] = [
  "pass1PromptZh",
  "pass1StrictPromptZh",
  "pass2PromptZh",
  "pass1PromptWithExistingZh",
  "pass1PromptNoNewWithExistingZh",
  "pass1StrictPromptWithExistingZh",
  "pass1StrictNoNewWithExistingZh",
  "pass2PromptWithExistingZh",
];

export function resolvePrompts(config: LLMConfig, mode: PromptMode): ResolvedPrompts {
  const activeKeys = resolvePromptKeys(mode);
  const pass1 = readPrompt(config, activeKeys.pass1, DEFAULT_PASS1_PROMPT);
  const pass1Strict = readPrompt(config, activeKeys.pass1Strict, DEFAULT_PASS1_STRICT_PROMPT);
  const pass2 = readPrompt(config, activeKeys.pass2, DEFAULT_PASS2_PROMPT);
  const selectedPass1 = mode.strictSingleTag ? pass1Strict : pass1;
  const inactiveKeys = getPromptFields(mode.language).filter(
    (key) =>
      key !== activeKeys.pass1 && key !== activeKeys.pass1Strict && key !== activeKeys.pass2
  );

  return {
    pass1,
    pass1Strict,
    pass2,
    selectedPass1,
    activeKeys,
    inactiveKeys,
  };
}

function resolvePromptKeys(mode: PromptMode): PromptFieldSet {
  if (mode.language === "zh") {
    return resolveZhPromptKeys(mode);
  }
  return resolveEnPromptKeys(mode);
}

function resolveEnPromptKeys(mode: PromptMode): PromptFieldSet {
  if (!mode.useExistingLists) {
    return {
      pass1: "pass1Prompt",
      pass1Strict: "pass1StrictPrompt",
      pass2: "pass2Prompt",
    };
  }

  if (mode.allowNewTagsWithExistingLists) {
    return {
      pass1: "pass1PromptWithExisting",
      pass1Strict: "pass1StrictPromptWithExisting",
      pass2: "pass2PromptWithExisting",
    };
  }

  return {
    pass1: "pass1PromptNoNewWithExisting",
    pass1Strict: "pass1StrictNoNewWithExisting",
    pass2: "pass2PromptWithExisting",
  };
}

function resolveZhPromptKeys(mode: PromptMode): PromptFieldSet {
  if (!mode.useExistingLists) {
    return {
      pass1: "pass1PromptZh",
      pass1Strict: "pass1StrictPromptZh",
      pass2: "pass2PromptZh",
    };
  }

  if (mode.allowNewTagsWithExistingLists) {
    return {
      pass1: "pass1PromptWithExistingZh",
      pass1Strict: "pass1StrictPromptWithExistingZh",
      pass2: "pass2PromptWithExistingZh",
    };
  }

  return {
    pass1: "pass1PromptNoNewWithExistingZh",
    pass1Strict: "pass1StrictNoNewWithExistingZh",
    pass2: "pass2PromptWithExistingZh",
  };
}

function getPromptFields(language: PromptLanguage): PromptFieldKey[] {
  return language === "zh" ? ZH_PROMPT_FIELDS : EN_PROMPT_FIELDS;
}

function readPrompt(config: LLMConfig, key: PromptFieldKey, fallback: string): string {
  const value = config[key];
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return fallback;
}
