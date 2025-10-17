// SPDX-License-Identifier: LicenseRef-ANW-1.0

export function hintFor(err: unknown): string {
  const error = err as { name?: string; message?: string; code?: unknown };
  const name = typeof error?.name === "string" ? error.name : undefined;
  const message = typeof error?.message === "string" ? error.message : "";
  const code = error?.code;

  if (name === "SqliteError" && /no such table/i.test(message)) {
    return "Database schema mismatch. Run migrations or reset safely.";
  }

  if (code === 50013) {
    return "Missing Discord permission in this channel.";
  }

  return "Unexpected error. Try again or contact staff.";
}
