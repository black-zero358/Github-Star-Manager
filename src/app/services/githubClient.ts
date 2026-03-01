export type GitHubConfig = {
  token: string;
};

export type GitHubRequestOptions = {
  signal?: AbortSignal;
  retries?: number;
};

const API_URL = "https://api.github.com";
const GRAPHQL_URL = "https://api.github.com/graphql";

async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: GitHubRequestOptions
): Promise<T> {
  const retries = options.retries ?? 2;
  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed: ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }
}

export async function ghGraphql<T>(
  config: GitHubConfig,
  query: string,
  variables: Record<string, unknown> = {},
  options: GitHubRequestOptions = {}
): Promise<T> {
  const body = JSON.stringify({ query, variables });
  const response = await requestJson<{ data?: T; errors?: { message: string }[] }>(
    GRAPHQL_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        Authorization: `bearer ${config.token}`,
      },
      body,
      signal: options.signal,
    },
    options
  );
  if (response.errors && response.errors.length > 0) {
    throw new Error(response.errors[0].message || "GitHub GraphQL error");
  }
  if (!response.data) {
    throw new Error("GitHub GraphQL response missing data");
  }
  return response.data;
}

export async function ghRest<T>(
  config: GitHubConfig,
  path: string,
  options: GitHubRequestOptions = {}
): Promise<T> {
  return requestJson<T>(
    `${API_URL}${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `bearer ${config.token}`,
      },
      signal: options.signal,
    },
    options
  );
}
