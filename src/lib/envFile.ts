/**
 * Pawtropolis Tech -- src/lib/envFile.ts
 * WHAT: Sets and removes single NAME=value lines in the host's .env file and
 *       makes the same change in process.env.
 * WHY: A key entered in Discord has to be in use at once and still be there
 *      after a restart. Every other secret already lives in the host's .env,
 *      which both PM2 apps read when they start, so that is where it goes.
 *      The new file is written next to the old one and renamed over it, so a
 *      crash in the middle cannot leave half a file behind.
 * NOTE: Values are written without quotes. Only characters that dotenv and
 *       Node's --env-file read back unchanged are allowed, which covers the
 *       keys this is used for. Nothing here logs a value or puts one in an
 *       error message.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import path from "node:path";

/** A value to set, or null to remove the line. */
export type EnvChanges = Record<string, string | null>;

const NAME = /^[A-Z][A-Z0-9_]*$/;
// Letters, digits and . _ ~ + / = : @ - anywhere, ' after the first character.
// Both parsers read those back exactly as written. Everything else is refused:
// a # ends the value, whitespace at either end is dropped and a pair of quotes
// around the value is taken off. $, backslashes and the rest stay out as well,
// because other readers of such a file (a shell, dotenv-expand) give them a meaning.
const STORABLE_VALUE = /^[A-Za-z0-9._~+/=:@-][A-Za-z0-9._~+/=:@'-]*$/;
const MAX_VALUE_LENGTH = 512;

const ASSIGNMENT = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** The .env both PM2 apps start with. deploy.sh never ships or replaces it. */
export function hostEnvPath(): string {
  return path.join(process.cwd(), ".env");
}

export function isStorableEnvValue(value: string): boolean {
  return value.length <= MAX_VALUE_LENGTH && STORABLE_VALUE.test(value);
}

function rewrite(text: string, changes: EnvChanges): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const written = new Set<string>();
  const kept: string[] = [];

  for (const line of text === "" ? [] : text.split("\n")) {
    const match = ASSIGNMENT.exec(line);
    const name = match?.[2];
    if (!match || name === undefined || !Object.hasOwn(changes, name)) {
      kept.push(line);
      continue;
    }
    const value = changes[name];
    // The first line for a name carries the new value. Both parsers let the
    // last line for a name win, so a later one would undo the change.
    if (value === null || value === undefined || written.has(name)) continue;
    written.add(name);
    kept.push(`${match[1]}${name}=${value}${line.endsWith("\r") ? "\r" : ""}`);
  }

  let next = kept.join("\n");
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || written.has(name)) continue;
    if (next !== "" && !next.endsWith("\n")) next += eol;
    next += `${name}=${value}${eol}`;
  }
  return next;
}

function writeAtomic(filePath: string, text: string, mode: number): void {
  const temp = `${filePath}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(temp, "w", mode);
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // openSync applies the umask to the mode. The file holds secrets, so set it outright.
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, filePath);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * Apply the changes to the file, then to process.env. Throws before anything
 * is written when a name or a value cannot be stored. When the write itself
 * fails, process.env is left as it was.
 */
export function applyEnvChanges(filePath: string, changes: EnvChanges): void {
  for (const [name, value] of Object.entries(changes)) {
    if (!NAME.test(name)) throw new Error(`"${name}" is not a variable name`);
    if (value !== null && !isStorableEnvValue(value))
      throw new Error(`the value for ${name} has a character the .env file cannot hold`);
  }

  const exists = fs.existsSync(filePath);
  const before = exists ? fs.readFileSync(filePath, "utf8") : "";
  const after = rewrite(before, changes);
  if (after !== before) {
    writeAtomic(filePath, after, exists ? fs.statSync(filePath).mode & 0o777 : 0o600);
  }

  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
}
