import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { clearSession } from "$lib/server/session";

export const GET: RequestHandler = async ({ cookies }) => {
  clearSession(cookies);
  redirect(302, "/");
};
