import { db } from "../data/db";
import { fetchListMembership, fetchStarLists, fetchStarredRepos, detectStarListApi } from "../services/githubStarLists";
import type { GitHubConfig } from "../services/githubClient";
import { runWithConcurrency } from "./queues";

export type SyncProgress = {
  stage: string;
  current: number;
  total: number;
  failed: number;
};

type ListMembershipResult = {
  listId: string;
  repoIds: string[];
  failed?: boolean;
};

export type SyncResult = {
  lists: number;
  repos: number;
  failedListIds: string[];
};

type RetryResult = {
  failedListIds: string[];
};

export async function syncFromGitHub(
  config: GitHubConfig,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResult> {
  const listApi = await detectStarListApi(config);

  onProgress?.({ stage: "fetching_star_lists", current: 0, total: 1, failed: 0 });
  const lists = await fetchStarLists(config, listApi);
  onProgress?.({ stage: "fetching_star_lists", current: 1, total: 1, failed: 0 });

  onProgress?.({ stage: "fetching_starred_repos", current: 0, total: 1, failed: 0 });
  const repos = await fetchStarredRepos(config);
  onProgress?.({ stage: "fetching_starred_repos", current: 1, total: 1, failed: 0 });

  onProgress?.({ stage: "scanning_list_membership", current: 0, total: lists.length || 1, failed: 0 });
  let processed = 0;
  let failed = 0;
  const membershipTasks = lists.map((list) => async (): Promise<ListMembershipResult> => {
    try {
      const membership = await fetchListMembership(config, list.id);
      processed += 1;
      onProgress?.({
        stage: "scanning_list_membership",
        current: processed,
        total: lists.length || 1,
        failed,
      });
      return { ...membership, failed: false };
    } catch {
      processed += 1;
      failed += 1;
      onProgress?.({
        stage: "scanning_list_membership",
        current: processed,
        total: lists.length || 1,
        failed,
      });
      return { listId: list.id, repoIds: [], failed: true };
    }
  });

  const memberships = await runWithConcurrency(membershipTasks, 2);
  const failedListIds = memberships.filter((membership) => membership.failed).map((m) => m.listId);

  const repoListMap = new Map<string, Set<string>>();
  for (const membership of memberships) {
    for (const repoId of membership.repoIds) {
      const existing = repoListMap.get(repoId) ?? new Set<string>();
      existing.add(membership.listId);
      repoListMap.set(repoId, existing);
    }
  }

  await db.transaction("rw", db.lists, db.repos, db.repoLists, async () => {
    await db.lists.clear();
    await db.repos.clear();
    await db.repoLists.clear();

    await db.lists.bulkPut(
      lists.map((list) => ({
        id: list.id,
        name: list.name,
        description: list.description ?? "",
        isPrivate: false,
      }))
    );

    await db.repos.bulkPut(
      repos.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
        description: repo.description ?? "",
        repoUrl: repo.url,
        topics: repo.topics,
        language: repo.language,
        updatedAt: repo.updatedAt,
        readmeExcerpt: "",
        stargazerCount: repo.stargazerCount,
      }))
    );

    await db.repoLists.bulkPut(
      Array.from(repoListMap.entries()).map(([repoId, listIds]) => ({
        repoId,
        listIds: Array.from(listIds),
      }))
    );
  });

  return { lists: lists.length, repos: repos.length, failedListIds };
}

export async function retryListMembership(
  config: GitHubConfig,
  listIds: string[],
  onProgress?: (progress: SyncProgress) => void
): Promise<RetryResult> {
  if (listIds.length === 0) return { failedListIds: [] };

  let processed = 0;
  let failed = 0;
  onProgress?.({ stage: "retrying_list_membership", current: 0, total: listIds.length, failed: 0 });

  const tasks = listIds.map((listId) => async () => {
    try {
    const membership = await fetchListMembership(config, listId);
      processed += 1;
      onProgress?.({ stage: "retrying_list_membership", current: processed, total: listIds.length, failed });
      return { listId, repoIds: membership.repoIds, failed: false };
    } catch {
      processed += 1;
      failed += 1;
      onProgress?.({ stage: "retrying_list_membership", current: processed, total: listIds.length, failed });
      return { listId, repoIds: [], failed: true };
    }
  });

  const results = await runWithConcurrency(tasks, 2);
  const failedListIds = results.filter((item) => item.failed).map((item) => item.listId);

  await db.transaction("rw", db.repoLists, async () => {
    for (const membership of results) {
      for (const repoId of membership.repoIds) {
        const existing = await db.repoLists.get(repoId);
        const listIdsForRepo = existing?.listIds ?? [];
        const next = Array.from(new Set([...listIdsForRepo, membership.listId]));
        await db.repoLists.put({ repoId, listIds: next });
      }
    }
  });

  return { failedListIds };
}
