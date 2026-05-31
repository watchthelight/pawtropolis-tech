/**
 * Pawtropolis Tech - web/src/routes/CHANGELOG.md/+server.ts
 * WHAT: 308-redirects the bare /CHANGELOG.md URL to the themed /changelog page.
 * WHY: That URL used to 404 (the file lives at the repo root). Keep the old,
 *      intuitive link working and point it at the rendered page.
 */
import { redirect } from "@sveltejs/kit";

export const prerender = false;

export function GET(): never {
  throw redirect(308, "/changelog");
}
