import { db } from "../data/db";
import type { GitHubConfig } from "../services/githubClient";
import {
  addStar,
  buildRepoMembershipIndex,
  createUserList,
  detectStarListApi,
  fetchStarLists,
  getRepositoryMeta,
  type UserListRef,
  updateUserListsForItem,
} from "../services/githubStarLists";
import { runWithConcurrency } from "./queues";

export type WritebackIssueReason =
  | "empty_tags"
  | "repo_not_found"
  | "invalid_repo_name"
  | "repo_meta_missing"
  | "repo_meta_fetch_failed"
  | "missing_list"
  | "create_list_failed"
  | "membership_scan_failed"
  | "no_changes"
  | "unstarred_requires_confirmation"
  | "add_star_failed"
  | "update_failed";

export type WritebackIssue = {
  repoId?: string;
  repoFullName?: string;
  reason: WritebackIssueReason;
  message: string;
};

export type WritebackCandidate = {
  repoId: string;
  repoFullName: string;
  itemId: string;
  viewerHasStarred: boolean;
  targetTags: string[];
  targetListIds: string[];
  targetListNames: string[];
  currentListIds: string[];
  currentListNames: string[];
  finalListIds: string[];
  finalListNames: string[];
};

export type WritebackPlan = {
  totalClassifications: number;
  validTaggedRepos: number;
  actionableRepos: number;
  unchangedRepos: number;
  scanFailures: number;
  missingLists: string[];
  createdLists: string[];
  unstarredActionableRepos: number;
  skipped: WritebackIssue[];
  candidates: WritebackCandidate[];
};

export type WritebackResult = {
  plan: WritebackPlan;
  applied: number;
  failed: WritebackIssue[];
  skipped: WritebackIssue[];
  createdLists: string[];
  locallyUpdated: number;
};

export type WritebackProgress = {
  stage: string;
  current: number;
  total: number;
  failed: number;
  skipped: number;
};

export type PlanWritebackOptions = {
  createMissingLists?: boolean;
  createMissingListsAsPrivate?: boolean;
};

export type ApplyWritebackOptions = {
  autoStarForUnstarred?: boolean;
  resolveAutoStarForUnstarred?: (unstarredCount: number) => boolean | Promise<boolean>;
  createMissingListsAsPrivate?: boolean;
  reusePlan?: WritebackPlan | null;
};

type PreparedWriteback = {
  plan: WritebackPlan;
  listIdToName: Map<string, string>;
  createdListRefs: UserListRef[];
};

const REPO_META_CONCURRENCY = 3;

export async function planWriteback(
  config: GitHubConfig,
  options: PlanWritebackOptions = {},
  onProgress?: (progress: WritebackProgress) => void
): Promise<WritebackPlan> {
  const prepared = await prepareWriteback(
    config,
    options.createMissingLists ?? false,
    options.createMissingListsAsPrivate,
    onProgress
  );
  return prepared.plan;
}

export async function applyWriteback(
  config: GitHubConfig,
  options: ApplyWritebackOptions,
  onProgress?: (progress: WritebackProgress) => void
): Promise<WritebackResult> {
  const prepared =
    options.reusePlan != null
      ? {
          plan: options.reusePlan,
          listIdToName: new Map<string, string>(),
          createdListRefs: [],
        }
      : await prepareWriteback(config, true, options.createMissingListsAsPrivate, onProgress);

  return applyPreparedWriteback(config, prepared, options, onProgress);
}

async function applyPreparedWriteback(
  config: GitHubConfig,
  prepared: PreparedWriteback,
  options: ApplyWritebackOptions,
  onProgress?: (progress: WritebackProgress) => void
): Promise<WritebackResult> {
  const failed: WritebackIssue[] = [];
  const skipped: WritebackIssue[] = [...prepared.plan.skipped];
  const successfulCandidates: WritebackCandidate[] = [];
  let applied = 0;
  let current = 0;
  const total = prepared.plan.candidates.length;
  let autoStarForUnstarred = options.autoStarForUnstarred ?? false;

  if (prepared.plan.unstarredActionableRepos > 0 && options.resolveAutoStarForUnstarred) {
    autoStarForUnstarred = await options.resolveAutoStarForUnstarred(
      prepared.plan.unstarredActionableRepos
    );
  }

  emitProgress(onProgress, {
    stage: "applying_updates",
    current: 0,
    total: total || 1,
    failed: failed.length,
    skipped: skipped.length,
  });

  for (const candidate of prepared.plan.candidates) {
    if (!autoStarForUnstarred && !candidate.viewerHasStarred) {
      skipped.push({
        repoId: candidate.repoId,
        repoFullName: candidate.repoFullName,
        reason: "unstarred_requires_confirmation",
        message: "Repo is not starred and auto-star was declined.",
      });
      current += 1;
      emitProgress(onProgress, {
        stage: "applying_updates",
        current,
        total: total || 1,
        failed: failed.length,
        skipped: skipped.length,
      });
      continue;
    }

    try {
      if (autoStarForUnstarred && !candidate.viewerHasStarred) {
        await addStar(config, candidate.itemId);
      }
    } catch (error) {
      failed.push({
        repoId: candidate.repoId,
        repoFullName: candidate.repoFullName,
        reason: "add_star_failed",
        message: `Failed to star repo before writeback: ${(error as Error).message || "unknown"}`,
      });
      current += 1;
      emitProgress(onProgress, {
        stage: "applying_updates",
        current,
        total: total || 1,
        failed: failed.length,
        skipped: skipped.length,
      });
      continue;
    }

    try {
      await updateUserListsForItem(config, candidate.itemId, candidate.finalListIds);
      applied += 1;
      successfulCandidates.push(candidate);
    } catch (error) {
      failed.push({
        repoId: candidate.repoId,
        repoFullName: candidate.repoFullName,
        reason: "update_failed",
        message: `Failed to update repo lists: ${(error as Error).message || "unknown"}`,
      });
    }

    current += 1;
    emitProgress(onProgress, {
      stage: "applying_updates",
      current,
      total: total || 1,
      failed: failed.length,
      skipped: skipped.length,
    });
  }

  const locallyUpdated = await syncLocalWritebackState(
    prepared,
    successfulCandidates,
    options.createMissingListsAsPrivate ?? false
  );

  return {
    plan: prepared.plan,
    applied,
    failed,
    skipped,
    createdLists: prepared.plan.createdLists,
    locallyUpdated,
  };
}

async function prepareWriteback(
  config: GitHubConfig,
  createMissingLists: boolean,
  createMissingListsAsPrivate = false,
  onProgress?: (progress: WritebackProgress) => void
): Promise<PreparedWriteback> {
  const skipped: WritebackIssue[] = [];
  const createdLists: string[] = [];
  const createdListRefs: UserListRef[] = [];

  emitProgress(onProgress, {
    stage: "loading_local_classifications",
    current: 0,
    total: 1,
    failed: 0,
    skipped: 0,
  });
  const [classificationRows, repoRows] = await Promise.all([db.classifications.toArray(), db.repos.toArray()]);
  emitProgress(onProgress, {
    stage: "loading_local_classifications",
    current: 1,
    total: 1,
    failed: 0,
    skipped: skipped.length,
  });

  const repoById = new Map(repoRows.map((repo) => [repo.id, repo]));
  const repoTargetTags = new Map<string, string[]>();
  const allTargetTags = new Set<string>();

  for (const row of classificationRows) {
    const validTags = normalizeTags(row.tags);
    if (validTags.length === 0) {
      skipped.push({
        repoId: row.repoId,
        reason: "empty_tags",
        message: "Classification has no valid tags.",
      });
      continue;
    }
    if (!repoById.has(row.repoId)) {
      skipped.push({
        repoId: row.repoId,
        reason: "repo_not_found",
        message: "Repo is not present in local database.",
      });
      continue;
    }
    repoTargetTags.set(row.repoId, validTags);
    for (const tag of validTags) {
      allTargetTags.add(tag);
    }
  }

  emitProgress(onProgress, {
    stage: "fetching_star_lists",
    current: 0,
    total: 1,
    failed: 0,
    skipped: skipped.length,
  });
  const listApi = await detectStarListApi(config);
  const remoteLists = await fetchStarLists(config, listApi);
  const listNameToId = new Map(remoteLists.map((list) => [list.name, list.id]));
  const listIdToName = new Map(remoteLists.map((list) => [list.id, list.name]));
  emitProgress(onProgress, {
    stage: "fetching_star_lists",
    current: 1,
    total: 1,
    failed: 0,
    skipped: skipped.length,
  });

  const missingLists: string[] = [];
  for (const tag of allTargetTags) {
    if (!listNameToId.has(tag)) {
      missingLists.push(tag);
    }
  }

  if (createMissingLists && missingLists.length > 0) {
    let current = 0;
    emitProgress(onProgress, {
      stage: "creating_missing_lists",
      current: 0,
      total: missingLists.length,
      failed: 0,
      skipped: skipped.length,
    });
    for (const listName of missingLists) {
      try {
        const created = await createUserList(config, listName, createMissingListsAsPrivate, "");
        listNameToId.set(created.name, created.id);
        listIdToName.set(created.id, created.name);
        createdLists.push(created.name);
        createdListRefs.push(created);
      } catch (error) {
        skipped.push({
          reason: "create_list_failed",
          message: `Failed to create list "${listName}": ${(error as Error).message || "unknown"}`,
        });
      }
      current += 1;
      emitProgress(onProgress, {
        stage: "creating_missing_lists",
        current,
        total: missingLists.length,
        failed: 0,
        skipped: skipped.length,
      });
    }
  }

  const resolvableRepoIds = Array.from(repoTargetTags.keys());
  const repoMetaByRepoId = new Map<string, { itemId: string; viewerHasStarred: boolean; repoFullName: string }>();
  let repoMetaCurrent = 0;

  emitProgress(onProgress, {
    stage: "resolving_repositories",
    current: 0,
    total: resolvableRepoIds.length || 1,
    failed: 0,
    skipped: skipped.length,
  });

  const repoMetaTasks = resolvableRepoIds.map((repoId) => async () => {
    const repo = repoById.get(repoId);
    if (!repo) return;
    const parsed = parseRepoFullName(repo.fullName);
    if (!parsed) {
      skipped.push({
        repoId,
        repoFullName: repo.fullName,
        reason: "invalid_repo_name",
        message: `Invalid fullName format: ${repo.fullName}`,
      });
      repoMetaCurrent += 1;
      emitProgress(onProgress, {
        stage: "resolving_repositories",
        current: repoMetaCurrent,
        total: resolvableRepoIds.length || 1,
        failed: 0,
        skipped: skipped.length,
      });
      return;
    }

    try {
      const meta = await getRepositoryMeta(config, parsed.owner, parsed.name);
      if (!meta) {
        skipped.push({
          repoId,
          repoFullName: repo.fullName,
          reason: "repo_meta_missing",
          message: "Repository metadata cannot be loaded from GitHub.",
        });
      } else {
        repoMetaByRepoId.set(repoId, {
          itemId: meta.id,
          viewerHasStarred: meta.viewerHasStarred,
          repoFullName: repo.fullName,
        });
      }
    } catch (error) {
      skipped.push({
        repoId,
        repoFullName: repo.fullName,
        reason: "repo_meta_fetch_failed",
        message: `Repository metadata request failed: ${(error as Error).message || "unknown"}`,
      });
    }

    repoMetaCurrent += 1;
    emitProgress(onProgress, {
      stage: "resolving_repositories",
      current: repoMetaCurrent,
      total: resolvableRepoIds.length || 1,
      failed: 0,
      skipped: skipped.length,
    });
  });
  await runWithConcurrency(repoMetaTasks, REPO_META_CONCURRENCY);

  const targetRepoIds = new Set<string>();
  for (const meta of repoMetaByRepoId.values()) {
    targetRepoIds.add(meta.itemId);
  }

  emitProgress(onProgress, {
    stage: "scanning_existing_memberships",
    current: 0,
    total: listNameToId.size || 1,
    failed: 0,
    skipped: skipped.length,
  });
  const repoMembershipResult = await buildRepoMembershipIndex(
    config,
    Array.from(listNameToId.values()),
    targetRepoIds,
    (progress) => {
      emitProgress(onProgress, {
        stage: "scanning_existing_memberships",
        current: progress.current,
        total: progress.total || 1,
        failed: 0,
        skipped: skipped.length,
      });
    }
  );
  const repoMembershipIndex = repoMembershipResult.index;
  const scanFailures = repoMembershipResult.failedListIds.length;
  for (const failedListId of repoMembershipResult.failedListIds) {
    skipped.push({
      reason: "membership_scan_failed",
      message: `Membership scan failed for list ${listIdToName.get(failedListId) || failedListId}.`,
    });
  }

  const candidates: WritebackCandidate[] = [];
  let unchangedRepos = 0;
  let unstarredActionableRepos = 0;

  for (const [repoId, tags] of repoTargetTags.entries()) {
    const meta = repoMetaByRepoId.get(repoId);
    if (!meta) continue;

    const targetListIds: string[] = [];
    let hasMissingList = false;
    for (const tag of tags) {
      const listId = listNameToId.get(tag);
      if (!listId) {
        hasMissingList = true;
        break;
      }
      targetListIds.push(listId);
    }
    if (hasMissingList) {
      skipped.push({
        repoId,
        repoFullName: meta.repoFullName,
        reason: "missing_list",
        message: "One or more target lists do not exist on GitHub.",
      });
      continue;
    }

    const currentSet = repoMembershipIndex.get(meta.itemId) ?? new Set<string>();
    const finalSet = new Set([...currentSet, ...targetListIds]);
    const changed = finalSet.size !== currentSet.size;

    if (!changed) {
      unchangedRepos += 1;
      skipped.push({
        repoId,
        repoFullName: meta.repoFullName,
        reason: "no_changes",
        message: "Repo already contains all target lists.",
      });
      continue;
    }

    if (!meta.viewerHasStarred) {
      unstarredActionableRepos += 1;
    }

    candidates.push({
      repoId,
      repoFullName: meta.repoFullName,
      itemId: meta.itemId,
      viewerHasStarred: meta.viewerHasStarred,
      targetTags: tags,
      targetListIds: uniqueArray(targetListIds),
      targetListNames: uniqueArray(
        targetListIds.map((id) => listIdToName.get(id)).filter((name): name is string => Boolean(name))
      ),
      currentListIds: Array.from(currentSet),
      currentListNames: Array.from(currentSet)
        .map((id) => listIdToName.get(id))
        .filter((name): name is string => Boolean(name)),
      finalListIds: Array.from(finalSet),
      finalListNames: Array.from(finalSet)
        .map((id) => listIdToName.get(id))
        .filter((name): name is string => Boolean(name)),
    });
  }

  return {
    plan: {
      totalClassifications: classificationRows.length,
      validTaggedRepos: repoTargetTags.size,
      actionableRepos: candidates.length,
      unchangedRepos,
      scanFailures,
      missingLists,
      createdLists,
      unstarredActionableRepos,
      skipped,
      candidates,
    },
    listIdToName,
    createdListRefs,
  };
}

async function syncLocalWritebackState(
  prepared: PreparedWriteback,
  successfulCandidates: WritebackCandidate[],
  createMissingListsAsPrivate: boolean
): Promise<number> {
  const updates = successfulCandidates.map((candidate) => ({
    repoId: candidate.repoId,
    listIds: candidate.finalListIds,
  }));

  await db.transaction("rw", db.lists, db.repoLists, async () => {
    if (prepared.createdListRefs.length > 0) {
      await db.lists.bulkPut(
        prepared.createdListRefs.map((list) => ({
          id: list.id,
          name: list.name,
          description: "",
          isPrivate: createMissingListsAsPrivate,
        }))
      );
    }

    for (const update of updates) {
      await db.repoLists.put(update);
    }
  });

  return updates.length;
}

function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.toLowerCase() === "unclassified") continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function parseRepoFullName(fullName: string): { owner: string; name: string } | null {
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;
  const owner = parts[0].trim();
  const name = parts[1].trim();
  if (!owner || !name) return null;
  return { owner, name };
}

function uniqueArray(items: string[]): string[] {
  return Array.from(new Set(items));
}

function emitProgress(
  onProgress: ((progress: WritebackProgress) => void) | undefined,
  progress: WritebackProgress
) {
  onProgress?.(progress);
}
