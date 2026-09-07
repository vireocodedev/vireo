import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createAppJwt, createInstallationToken } from "./create-template-adoption-app-token.mjs";

test("creates a bounded RS256 GitHub App JWT without exposing its key", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = createAppJwt({
    appId: "123",
    privateKey: privateKey.export({ type: "pkcs1", format: "pem" }),
    now: 1_700_000_000_000,
  });
  assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
});

test("discovers the exact authenticated App bot identity for Git authorship", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const responses = [
    { slug: "vireo-template-adoption" },
    [{ id: 456, account: { login: "vireocodedev" } }],
    {
      token: "installation-token-value",
      repository_selection: "selected",
      permissions: { contents: "write", pull_requests: "write", workflows: "write", metadata: "read" },
    },
    { login: "vireo-template-adoption[bot]", id: 789, type: "Bot" },
  ];
  const urls = [];
  const result = await createInstallationToken({
    appId: "123",
    privateKey: privateKey.export({ type: "pkcs1", format: "pem" }),
    fetchResponse: async url => {
      urls.push(url);
      return { ok: true, json: async () => responses.shift() };
    },
  });

  assert.deepEqual(result, {
    token: "installation-token-value",
    login: "vireo-template-adoption[bot]",
    email: "789+vireo-template-adoption[bot]@users.noreply.github.com",
  });
  assert.equal(urls.at(-1), "https://api.github.com/users/vireo-template-adoption%5Bbot%5D");
});
