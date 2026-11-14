// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/lib/githubGit.ts
 * WHAT: Token-safe helpers for pushing to GitHub with the bot PAT.
 * WHY: Embedding the token in a remote URL puts it in argv, and execSync errors
 *      carry the full command line, so any failure leaked it to logs and Discord.
 *      The credential travels in an http.extraheader passed through the environment
 *      (never argv, never .git/config), and error text is scrubbed before logging.
 */

import { execFileSync } from "node:child_process";

export const GIT_PUSH_FAILED_MESSAGE = "Push to GitHub failed. Check the bot logs.";

function basicCredential(username: string, token: string): string {
  return Buffer.from(`${username}:${token}`).toString("base64");
}

function githubAuthEnv(username: string, token: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicCredential(username, token)}`,
  };
}

export function githubHttpsUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

/** Run git against GitHub with the bot credential supplied out of band. */
export function gitAuthed(
  args: string[],
  opts: { cwd: string; username: string; token: string }
): string {
  return execFileSync("git", args, {
    cwd: opts.cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: githubAuthEnv(opts.username, opts.token),
  });
}

/** Strip the token, its base64 credential and any URL userinfo from text bound for logs. */
function scrubGitSecrets(text: string, username: string, token: string): string {
  let out = text;
  for (const secret of [token, basicCredential(username, token)]) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[redacted]@");
}

export function scrubbedErrorMessage(err: unknown, username: string, token: string): string {
  const parts = [err instanceof Error ? err.message : String(err)];
  const stderr = (err as { stderr?: unknown } | null)?.stderr;
  if (stderr) parts.push(String(stderr));
  return scrubGitSecrets(parts.join("\n"), username, token);
}
