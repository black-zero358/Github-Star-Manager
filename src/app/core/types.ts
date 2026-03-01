export type RepoInfo = {
  id: string;
  fullName: string;
  description: string;
  url: string;
  topics: string[];
  language: string | null;
  updatedAt: string;
  readmeExcerpt: string;
};

export type StarList = {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
};

export type ClassificationResult = {
  repoId: string;
  listName: string;
  confidence: number;
};
