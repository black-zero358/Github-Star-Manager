import Dexie, { type Table } from "dexie";

export type RepoRecord = {
  id: string;
  fullName: string;
  description: string;
  repoUrl: string;
  topics: string[];
  language: string | null;
  updatedAt: string;
  readmeExcerpt: string;
  stargazerCount: number;
};

export type ClassificationRecord = {
  repoId: string;
  tags: string[];
  lastRunAt: string;
};

export type ClassificationRunRecord = {
  id: string;
  createdAt: string;
  repoCount: number;
  strictSingleTag: boolean;
  testMode: boolean;
  pass1Prompt: string;
  pass1StrictPrompt: string;
  pass2Prompt: string;
};

export type ClassificationTagRecord = {
  id: string;
  runId: string;
  repoId: string;
  tags: string[];
};

export type TagCompressionRecord = {
  tag: string;
  compressedTag: string;
};

export type ListRecord = {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
};

export type RepoListRecord = {
  repoId: string;
  listIds: string[];
};

export type JobRecord = {
  id: string;
  type: string;
  status: "idle" | "running" | "failed" | "completed";
  progress: number;
  total: number;
  message: string;
  updatedAt: string;
};

export type CacheRecord = {
  key: string;
  etag: string | null;
  lastFetchedAt: string;
  hash: string;
};

export class StarManagerDB extends Dexie {
  repos!: Table<RepoRecord, string>;
  lists!: Table<ListRecord, string>;
  repoLists!: Table<RepoListRecord, string>;
  classifications!: Table<ClassificationRecord, string>;
  classificationRuns!: Table<ClassificationRunRecord, string>;
  classificationTags!: Table<ClassificationTagRecord, string>;
  tagCompression!: Table<TagCompressionRecord, string>;
  jobs!: Table<JobRecord, string>;
  cache!: Table<CacheRecord, string>;

  constructor() {
    super("star-manager");
    this.version(1).stores({
      repos: "id, fullName",
      lists: "id, name",
      repoLists: "repoId",
      classifications: "repoId",
      tagCompression: "tag",
      jobs: "id, type, status",
      cache: "key",
    });
    this.version(2).stores({
      repos: "id, fullName",
      lists: "id, name",
      repoLists: "repoId",
      classifications: "repoId",
      classificationRuns: "id, createdAt",
      classificationTags: "id, runId, repoId",
      tagCompression: "tag",
      jobs: "id, type, status",
      cache: "key",
    });
  }
}

export const db = new StarManagerDB();
