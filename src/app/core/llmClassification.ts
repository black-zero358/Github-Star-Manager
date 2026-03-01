import type { LLMConfig } from "../services/llmClient";
import { requestCompletion } from "../services/llmClient";
import { resolvePrompts } from "./llmPromptResolver";
import { runWithConcurrency } from "./queues";

export type RepoForClassification = {
  id: string;
  fullName: string;
  description: string;
  topics: string[];
  language: string | null;
  readmeExcerpt: string;
  existingLists?: string[];
};

export type ClassificationProgress = {
  stage: string;
  current: number;
  total: number;
};

export type ClassificationResult = {
  repoTags: Record<string, string[]>;
  compressedTags: string[];
  tagMap: Record<string, string>;
  runId: string;
};

export type ClassificationOptions = {
  strictSingleTag?: boolean;
  pass1Prompt?: string;
  pass1StrictPrompt?: string;
  pass2Prompt?: string;
  useExistingLists?: boolean;
  allowNewTagsWithExistingLists?: boolean;
  language?: "zh" | "en";
};

const DEFAULT_PASS2_PROMPT =
  "You consolidate tag lists by merging synonyms and near-duplicates. Output only JSON mapping each original tag to a compressed tag. Do not invent new tags beyond the provided list.";

export async function runTwoStageClassification(
  config: LLMConfig,
  repos: RepoForClassification[],
  options: ClassificationOptions = {},
  onProgress?: (progress: ClassificationProgress) => void
): Promise<ClassificationResult> {
  const mode = {
    strictSingleTag: options.strictSingleTag ?? false,
    useExistingLists: options.useExistingLists ?? false,
    allowNewTagsWithExistingLists: options.allowNewTagsWithExistingLists !== false,
    language: options.language ?? "en",
  } as const;
  const prompts = resolvePrompts(config, mode);
  const repoTags: Record<string, string[]> = {};
  let completed = 0;
  const runId = createRunId();

  const tasks = repos.map((repo) => async () => {
    const tags = await classifyRepo(config, repo, {
      strictSingleTag: mode.strictSingleTag,
      systemPrompt: prompts.selectedPass1,
      useExistingLists: mode.useExistingLists,
      allowNewTagsWithExistingLists: mode.allowNewTagsWithExistingLists,
    });
    completed += 1;
    onProgress?.({ stage: "classifying_repos", current: completed, total: repos.length });
    return { id: repo.id, tags };
  });

  const results = await runWithConcurrency(tasks, 3);
  const allTags: string[] = [];
  for (const result of results) {
    repoTags[result.id] = result.tags;
    allTags.push(...result.tags);
  }

  const uniqueTags = normalizeTags(allTags);
  onProgress?.({ stage: "compressing_tags", current: 0, total: 1 });
  const tagMap = await compressTags(config, uniqueTags, prompts.pass2);
  const compressedTags = Array.from(new Set(Object.values(tagMap)));

  for (const repoId of Object.keys(repoTags)) {
    repoTags[repoId] = repoTags[repoId].map((tag) => tagMap[tag] ?? tag);
  }

  onProgress?.({ stage: "compressing_tags", current: 1, total: 1 });
  return { repoTags, compressedTags, tagMap, runId };
}

async function classifyRepo(
  config: LLMConfig,
  repo: RepoForClassification,
  options: {
    strictSingleTag: boolean;
    systemPrompt: string;
    useExistingLists?: boolean;
    allowNewTagsWithExistingLists?: boolean;
  }
): Promise<string[]> {
  const userContent = [
    `Name: ${repo.fullName}`,
    `Description: ${repo.description || ""}`,
    `Topics: ${repo.topics.join(", ") || ""}`,
    `Language: ${repo.language || ""}`,
    `README: ${repo.readmeExcerpt.slice(0, 800)}`,
    options.useExistingLists
      ? `Existing Lists: ${repo.existingLists && repo.existingLists.length > 0 ? repo.existingLists.join(", ") : "(none)"}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await requestCompletion(config, [
    { role: "system", content: options.systemPrompt },
    { role: "user", content: userContent },
  ]);

  const tags = parseTags(response, options.strictSingleTag);
  if (options.useExistingLists && options.allowNewTagsWithExistingLists === false) {
    const existing = new Set((repo.existingLists || []).map((tag) => tag.toLowerCase()));
    return tags.filter((tag) => existing.has(tag.toLowerCase()));
  }
  if (tags.length === 0) {
    return ["Unclassified"];
  }
  return tags;
}

async function compressTags(
  config: LLMConfig,
  tags: string[],
  pass2Prompt?: string
): Promise<Record<string, string>> {
  if (tags.length === 0) return {};
  if (tags.length === 1) return { [tags[0]]: tags[0] };

  const userContent = JSON.stringify({ tags });
  try {
    const response = await requestCompletion(config, [
      { role: "system", content: pass2Prompt || DEFAULT_PASS2_PROMPT },
      { role: "user", content: userContent },
    ]);
    return parseTagMap(response, tags);
  } catch {
    return Object.fromEntries(tags.map((tag) => [tag, tag]));
  }
}

function parseTags(response: string, strictSingleTag: boolean): string[] {
  const trimmed = response.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as string[];
      if (Array.isArray(parsed)) {
        const normalized = normalizeTags(parsed);
        return strictSingleTag ? normalized.slice(0, 1) : normalized;
      }
    } catch {
      // fall through
    }
  }

  const parts = trimmed
    .split(/[,\n]/)
    .map((part) => part.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
  const normalized = normalizeTags(parts);
  return strictSingleTag ? normalized.slice(0, 1) : normalized;
}

function parseTagMap(response: string, originals: string[]): Record<string, string> {
  const fallback = Object.fromEntries(originals.map((tag) => [tag, tag]));
  const raw = extractJson(response);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Record<string, string> | Array<{ from: string; to: string }>;
    const map: Record<string, string> = { ...fallback };
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry?.from || !entry?.to) continue;
        map[entry.from.trim()] = entry.to.trim();
      }
      return map;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!key || !value) continue;
      map[key.trim()] = value.trim();
    }
    return map;
  } catch {
    return fallback;
  }
}

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const cleaned = tag.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `run-${stamp}-${random}`;
}
