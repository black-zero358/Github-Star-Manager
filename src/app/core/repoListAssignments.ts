import { db } from "../data/db";

export async function setRepoListMembership(repoId: string, listIds: string[]): Promise<void> {
  const uniqueListIds = Array.from(new Set(listIds.map((id) => id.trim()).filter(Boolean)));
  await db.transaction("rw", db.repoLists, async () => {
    await db.repoLists.put({
      repoId,
      listIds: uniqueListIds,
    });
  });
}
