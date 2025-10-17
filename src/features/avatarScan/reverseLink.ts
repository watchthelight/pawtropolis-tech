// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { GuildConfig } from "../../lib/config.js";

export function buildReverseImageUrl(cfg: Pick<GuildConfig, "image_search_url_template">, avatarUrl: string) {
  const template = cfg.image_search_url_template || "https://lens.google.com/uploadbyurl?url={avatarUrl}";
  const encoded = encodeURIComponent(avatarUrl);
  if (template.includes("{avatarUrl}")) {
    return template.replaceAll("{avatarUrl}", encoded);
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}avatar=${encoded}`;
}
