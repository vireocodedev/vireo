import { createPrivateKey, createSign } from "node:crypto";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createAppJwt({ appId, privateKey, now = Date.now() }) {
  if (!/^\d+$/u.test(appId ?? "") || typeof privateKey !== "string" || !privateKey.includes("BEGIN"))
    throw new Error("Template adoption GitHub App ID and private key are required.");
  const issuedAt = Math.floor(now / 1000) - 30;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  return `${header}.${claims}.${signer.sign(createPrivateKey(privateKey)).toString("base64url")}`;
}

export async function createInstallationToken({ appId, privateKey, fetchResponse = fetch }) {
  const jwt = createAppJwt({ appId, privateKey });
  const appResponse = await fetchResponse("https://api.github.com/app", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!appResponse.ok) throw new Error(`GitHub App identity lookup failed with HTTP ${appResponse.status}.`);
  const slug = (await appResponse.json())?.slug;
  if (!/^[a-z0-9-]+$/u.test(slug ?? "")) throw new Error("GitHub App identity has an unsafe slug.");
  const installations = await fetchResponse("https://api.github.com/app/installations", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!installations.ok) throw new Error(`GitHub App installation lookup failed with HTTP ${installations.status}.`);
  const matching = (await installations.json()).filter(installation => installation?.account?.login === "vireocodedev");
  if (matching.length !== 1) throw new Error("Template adoption App must have exactly one Vireo Code installation.");
  const response = await fetchResponse(`https://api.github.com/app/installations/${matching[0].id}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repositories: ["vireo"],
      permissions: { contents: "write", pull_requests: "write", workflows: "write" },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub App token creation failed with HTTP ${response.status}.`);
  const issued = await response.json();
  const token = issued?.token;
  if (typeof token !== "string" || token.length < 20)
    throw new Error("GitHub App did not return an installation token.");
  if (
    issued?.repository_selection !== "selected" ||
    issued?.permissions?.contents !== "write" ||
    issued?.permissions?.pull_requests !== "write" ||
    issued?.permissions?.workflows !== "write" ||
    (issued?.permissions?.metadata !== undefined && issued.permissions.metadata !== "read")
  ) {
    throw new Error("GitHub App installation token was not narrowed to the required Vireo repository permissions.");
  }
  const login = `${slug}[bot]`;
  const identityResponse = await fetchResponse(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!identityResponse.ok)
    throw new Error(`GitHub App bot identity lookup failed with HTTP ${identityResponse.status}.`);
  const identity = await identityResponse.json();
  if (
    identity?.login !== login ||
    identity?.type !== "Bot" ||
    !Number.isSafeInteger(identity?.id) ||
    identity.id <= 0
  ) {
    throw new Error("GitHub App bot identity did not exactly match the authenticated App.");
  }
  return {
    token,
    login,
    email: `${identity.id}+${login}@users.noreply.github.com`,
  };
}

if (process.argv[1]?.endsWith("create-template-adoption-app-token.mjs")) {
  const { token, login, email } = await createInstallationToken({
    appId: process.env.TEMPLATE_ADOPTION_APP_ID,
    privateKey: process.env.TEMPLATE_ADOPTION_APP_PRIVATE_KEY,
  });
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("GITHUB_OUTPUT is required to pass the short-lived App token to this workflow.");
  console.log(`::add-mask::${token}`);
  await import("node:fs/promises").then(({ appendFile }) =>
    appendFile(process.env.GITHUB_OUTPUT, `token=${token}\nlogin=${login}\nemail=${email}\n`),
  );
}
