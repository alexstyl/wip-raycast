import { OAuth } from "@raycast/api";
import fetch from "node-fetch";
import { Todo } from "../types";
import * as crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface Preferences {
  apiUrl: string;
  clientId: string;
}

// const clientId = "nzJzX-pGkEIM2Zjbf-uVkdlCBOZA0dEQAKDtoZGjnLc"
// const apiUrl = "http://localhost:3000"
const clientId = "THXW84IpDZ58z9eYYCs3OcrG-vAwY6nUme1Ta4ckEHE"
const apiUrl = "https://wip.co"

const client = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "WIP",
  providerIcon: "icon.svg",
  providerId: "wip",
  description: "Connect your WIP account",
});

// Authorization

export async function authorize(): Promise<void> {
  const tokenSet = await client.getTokens();
  if (tokenSet?.accessToken) {
    if (tokenSet.refreshToken && tokenSet.isExpired()) {
      await client.setTokens(await refreshTokens(tokenSet.refreshToken));
    }
    return;
  }

  const authRequest = await client.authorizationRequest({
    endpoint: `${apiUrl}/oauth/authorize`,
    clientId: clientId,
    scope: "",
  });
  const { authorizationCode } = await client.authorize(authRequest);
  await client.setTokens(await fetchTokens(authRequest, authorizationCode));
}

export async function fetchTokens(
  authRequest: OAuth.AuthorizationRequest,
  authCode: string
): Promise<OAuth.TokenResponse> {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("code", authCode);
  params.append("code_verifier", authRequest.codeVerifier);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", authRequest.redirectURI);

  const response = await fetch(`${apiUrl}/oauth/token`, { method: "POST", body: params });
  if (!response.ok) {
    console.error("fetch tokens error:", await response.text());
    throw new Error(response.statusText);
  }
  return (await response.json()) as OAuth.TokenResponse;
}

async function refreshTokens(refreshToken: string): Promise<OAuth.TokenResponse> {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");

  const response = await fetch(`${apiUrl}/oauth/token`, { method: "POST", body: params });
  if (!response.ok) {
    console.error("refresh tokens error:", await response.text());
    throw new Error(response.statusText);
  }

  const tokenResponse = (await response.json()) as OAuth.TokenResponse;
  tokenResponse.refresh_token = tokenResponse.refresh_token ?? refreshToken;
  return tokenResponse;
}

// API

export async function fetchUser(): Promise<{ id: string; username: string }[]> {
  const response = await fetch(`${apiUrl}/api/v1/users/me.json`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(await client.getTokens())?.accessToken}`,
    },
  });
  if (!response.ok) {
    console.error("fetch user error:", await response.text());
    throw new Error(response.statusText);
  }
  const json = (await response.json()) as { id: number; first_name: string; last_name: string; username: string; streak: number; best_streak: number; completed_todos_count: number; time_zone: string; streaking: boolean; url: string; avatar_url: string };
  return { id: json.id.toString(), username: json.username };
}

interface StreakResponse {
  streak: number;
  best_streak: number;
  streaking: boolean;
}

export async function fetchStreak(): Promise<StreakResponse> {
  const response = await fetch(`${apiUrl}/api/v1/users/me.json`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(await client.getTokens())?.accessToken}`,
    },
  });
  if (!response.ok) {
    console.error("fetch streak error:", await response.text());
    throw new Error(response.statusText);
  }
  return (await response.json()) as StreakResponse;
}

export async function fetchTodos(searchQuery: string = ""): Promise<Todo[]> {
  const params = new URLSearchParams();
  params.append("query", searchQuery);

  const response = await fetch(`${apiUrl}/api/v1/users/me/todos.json?` + params.toString(), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(await client.getTokens())?.accessToken}`,
    },
  });
  if (!response.ok) {
    console.error("fetch items error:", await response.text());
    throw new Error(response.statusText);
  }
  return (await response.json()) as Todo[];
}

export async function createTodo(todoText: string, filePaths: string[] = []): Promise<void> {
  console.log("Received file paths:", filePaths); // Log received file paths
  const attachments = await Promise.all(filePaths.map(async (filePath) => {
    if (!fs.existsSync(filePath)) {
      console.error("File does not exist:", filePath);
      throw new Error("File does not exist");
    }
    const fileBuffer = fs.readFileSync(filePath);
    const checksum = crypto.createHash("md5").update(fileBuffer).digest("base64");
    const fileType = "application/octet-stream";
    const fileName = path.basename(filePath);
    const fileSize = fileBuffer.length;

    const { url, signed_id, method, headers } = await createPresignedUrl(fileName, fileSize, checksum, fileType);

    console.log("Presigned URL", url);
    console.log("Signed ID", signed_id);
    console.log("Method", method);
    console.log("Headers", headers);

    const fileResponse = await fetch(url, {
      method: method,
      headers: headers,
      body: fileBuffer,
    });
    console.log("File upload response:", await fileResponse.text()); // Log file upload response

    if (!fileResponse.ok) {
      console.error("File upload error:", await fileResponse.text());
      throw new Error(fileResponse.statusText);
    }

    return signed_id;
  }));

  const params = new URLSearchParams();
  params.append("body", todoText);
  attachments.forEach(attachment => params.append("attachments[]", attachment));

  const response = await fetch(`${apiUrl}/api/v1/todos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${(await client.getTokens())?.accessToken}`,
    },
    body: params
  });

  if (!response.ok) {
    console.error("create todo error:", await response.text());
    throw new Error(response.statusText);
  }
}

export async function createPresignedUrl(filename: string, byteSize: number, checksum: string, contentType: string): Promise<{ url: string; signed_id: string; method: string; headers: Record<string, string> }> {
  const response = await fetch(`${apiUrl}/api/v1/presigned_urls`, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(await client.getTokens())?.accessToken}`,
    },
    body: JSON.stringify({
      filename,
      byte_size: byteSize,
      checksum,
      content_type: contentType,
    }),
  });

  if (!response.ok) {
    console.error("createPresignedUrl error:", await response.text());
    throw new Error(response.statusText);
  }

  return (await response.json()) as { url: string; signed_id: string; method: string; headers: Record<string, string> };
}