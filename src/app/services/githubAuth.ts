import { ghGraphql } from "./githubClient";

export type ViewerProfile = {
  login: string;
  name: string | null;
  avatarUrl: string;
};

export async function validatePat(token: string): Promise<ViewerProfile> {
  const query = `
    query {
      viewer {
        login
        name
        avatarUrl
      }
    }
  `;

  const data = await ghGraphql<{ viewer: ViewerProfile }>({ token }, query);
  return data.viewer;
}
