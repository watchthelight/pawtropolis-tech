import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import crypto from "node:crypto";
import { stateCookieDomain } from "$lib/server/env";

export const GET: RequestHandler = async ({ cookies }) => {
  const state = crypto.randomBytes(16).toString("hex");
  // Domain-scoped so a login started on www.pawtropolis.tech survives the
  // callback on the apex domain (redirect_uri is always apex).
  cookies.set("oauth_state", state, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    domain: stateCookieDomain(),
  });

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: process.env.OAUTH2_REDIRECT_URI!,
    response_type: "code",
    scope: "identify email guilds.members.read",
    state,
    prompt: "none",
  });

  redirect(302, `https://discord.com/api/oauth2/authorize?${params}`);
};
