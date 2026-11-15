/**
 * Pawtropolis Tech -- src/features/artistInvestigation/handles.ts
 * WHAT: Finds the gallery handles an applicant claimed and compares lookup
 *       matches against them.
 * WHY: A reverse image match means little on its own. What matters is whose
 *      account it sits under: the applicant's own name supports them, another
 *      name needs an explanation. The comparison is mechanical on purpose and
 *      the report says so.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { ClaimedHandle, Ownership, RawMatch } from "./types.js";

interface SiteRule {
  platform: string;
  host: RegExp;
  /** Returns the account name from a URL on this site, or null when the URL is not a profile or post under one. */
  handle: (url: URL, hostMatch: RegExpMatchArray) => string | null;
}

const seg = (url: URL, index: number): string | null => {
  const part = url.pathname.split("/").filter(Boolean)[index];
  return part ? decodeURIComponent(part) : null;
};

const firstSegUnless = (reserved: readonly string[]) => (url: URL) => {
  const first = seg(url, 0);
  if (!first || reserved.includes(first.toLowerCase())) return null;
  return first.replace(/^@/, "");
};

const afterSeg =
  (...markers: string[]) =>
  (url: URL) =>
    markers.includes((seg(url, 0) ?? "").toLowerCase()) ? seg(url, 1) : null;

const subdomain = (reserved: readonly string[]) => (_url: URL, hostMatch: RegExpMatchArray) => {
  const sub = hostMatch[1]?.toLowerCase();
  return sub && !reserved.includes(sub) ? sub : null;
};

const SOCIAL_RESERVED = [
  "home",
  "i",
  "search",
  "explore",
  "hashtag",
  "intent",
  "share",
  "settings",
  "login",
  "signup",
];

const SITE_RULES: readonly SiteRule[] = [
  {
    platform: "furaffinity",
    host: /^(?:www\.)?furaffinity\.net$/,
    handle: afterSeg("user", "gallery", "scraps", "commissions", "journals"),
  },
  {
    platform: "deviantart",
    host: /^(?:www\.)?deviantart\.com$/,
    handle: firstSegUnless([
      "tag",
      "about",
      "search",
      "topic",
      "watch",
      "daily-deviations",
      "users",
      "join",
      "notifications",
      "core-membership",
    ]),
  },
  {
    platform: "deviantart",
    host: /^([a-z0-9-]+)\.deviantart\.com$/,
    handle: subdomain(["www", "sta", "fav", "about", "shop", "chat", "forum"]),
  },
  {
    platform: "twitter",
    host: /^(?:www\.|mobile\.)?(?:twitter|x|fxtwitter|vxtwitter|fixupx)\.com$/,
    handle: firstSegUnless(SOCIAL_RESERVED),
  },
  {
    platform: "bluesky",
    host: /^bsky\.app$/,
    handle: (url) => afterSeg("profile")(url)?.replace(/\.bsky\.social$/i, "") ?? null,
  },
  {
    platform: "instagram",
    host: /^(?:www\.)?instagram\.com$/,
    handle: firstSegUnless(["p", "reel", "reels", "explore", "stories", "accounts", "tv"]),
  },
  {
    platform: "artstation",
    host: /^(?:www\.)?artstation\.com$/,
    handle: firstSegUnless([
      "artwork",
      "marketplace",
      "learning",
      "search",
      "jobs",
      "blogs",
      "channels",
    ]),
  },
  {
    platform: "toyhouse",
    host: /^(?:www\.)?toyhou\.se$/,
    handle: (url) =>
      /^\d+\./.test(seg(url, 0) ?? "")
        ? null
        : firstSegUnless(["~images", "~forums", "~account"])(url),
  },
  {
    platform: "weasyl",
    host: /^(?:www\.)?weasyl\.com$/,
    handle: (url) => {
      const s = seg(url, 0);
      return s?.startsWith("~") ? s.slice(1) : afterSeg("profile", "submissions", "user")(url);
    },
  },
  {
    platform: "inkbunny",
    host: /^(?:www\.)?inkbunny\.net$/,
    handle: (url) => {
      const s = seg(url, 0);
      return s && !/\.php$/i.test(s) && s !== "s" && s !== "j" ? s : null;
    },
  },
  { platform: "itaku", host: /^(?:www\.)?itaku\.ee$/, handle: afterSeg("profile") },
  {
    platform: "kofi",
    host: /^(?:www\.)?ko-fi\.com$/,
    handle: firstSegUnless(["s", "post", "home", "explore", "about", "c", "i", "album"]),
  },
  {
    platform: "vgen",
    host: /^(?:www\.)?vgen\.co$/,
    handle: firstSegUnless(["as", "explore", "search", "commissions", "characters"]),
  },
  { platform: "linktree", host: /^(?:www\.)?linktr\.ee$/, handle: firstSegUnless([]) },
  {
    platform: "patreon",
    host: /^(?:www\.)?patreon\.com$/,
    handle: (url) =>
      afterSeg("c", "cw")(url) ??
      firstSegUnless(["posts", "home", "user", "join", "login", "explore", "search"])(url),
  },
  {
    platform: "tumblr",
    host: /^([a-z0-9-]+)\.tumblr\.com$/,
    handle: subdomain(["www", "assets", "media", "static"]),
  },
  { platform: "carrd", host: /^([a-z0-9-]+)\.carrd\.co$/, handle: subdomain(["www"]) },
  {
    platform: "newgrounds",
    host: /^([a-z0-9-]+)\.newgrounds\.com$/,
    handle: subdomain(["www", "art", "img", "uimg"]),
  },
  {
    platform: "youtube",
    host: /^(?:www\.|m\.)?youtube\.com$/,
    handle: (url) => {
      const s = seg(url, 0);
      return s?.startsWith("@") ? s.slice(1) : afterSeg("c", "user")(url);
    },
  },
  {
    platform: "tiktok",
    host: /^(?:www\.)?tiktok\.com$/,
    handle: (url) => {
      const s = seg(url, 0);
      return s?.startsWith("@") ? s.slice(1) : null;
    },
  },
  {
    platform: "twitch",
    host: /^(?:www\.)?twitch\.tv$/,
    handle: firstSegUnless(["videos", "directory", "settings", "p"]),
  },
  {
    platform: "artfight",
    host: /^(?:www\.)?artfight\.net$/,
    handle: (url) => {
      const s = seg(url, 0);
      return s?.startsWith("~") ? s.slice(1) : null;
    },
  },
  {
    platform: "pixiv",
    host: /^(?:www\.)?pixiv\.net$/,
    handle: (url) => {
      const parts = url.pathname.split("/").filter(Boolean);
      const at = parts.indexOf("users");
      return at >= 0 ? (parts[at + 1] ?? null) : null;
    },
  },
  { platform: "e621", host: /^(?:www\.)?e(?:621|926)\.net$/, handle: afterSeg("users") },
];

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`|]+/gi;

/** URLs in a message, with trailing punctuation removed and duplicates dropped. */
export function extractUrls(text: string): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  const cleaned = found.map((u) => u.replace(/[.,;:!?*_~]+$/, ""));
  return [...new Set(cleaned)];
}

/** The account a URL points at, when the site is one we know how to read. */
export function handleFromUrl(rawUrl: string): { platform: string; handle: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  for (const rule of SITE_RULES) {
    const hostMatch = host.match(rule.host);
    if (!hostMatch) continue;
    let handle: string | null;
    try {
      handle = rule.handle(url, hostMatch);
    } catch {
      return null;
    }
    return handle ? { platform: rule.platform, handle } : null;
  }
  return null;
}

const PLATFORM_ALIASES: Record<string, string> = {
  fa: "furaffinity",
  furaffinity: "furaffinity",
  "fur affinity": "furaffinity",
  da: "deviantart",
  deviantart: "deviantart",
  twitter: "twitter",
  bsky: "bluesky",
  bluesky: "bluesky",
  ig: "instagram",
  insta: "instagram",
  instagram: "instagram",
  toyhouse: "toyhouse",
  "toyhou.se": "toyhouse",
  th: "toyhouse",
  artstation: "artstation",
  pixiv: "pixiv",
  tumblr: "tumblr",
  kofi: "kofi",
  "ko-fi": "kofi",
  vgen: "vgen",
  itaku: "itaku",
  weasyl: "weasyl",
  inkbunny: "inkbunny",
  telegram: "telegram",
  youtube: "youtube",
  tiktok: "tiktok",
  twitch: "twitch",
  artfight: "artfight",
  e621: "e621",
  newgrounds: "newgrounds",
};

const ALIAS_PATTERN = new RegExp(
  `(?<![\\w.])(${Object.keys(PLATFORM_ALIASES)
    .sort((a, b) => b.length - a.length)
    .map((a) => a.replace(/[.-]/g, "\\$&").replace(/ /g, "\\s"))
    .join("|")})\\s*[:=]\\s*@?([A-Za-z0-9][A-Za-z0-9_.~\\-]{2,29})`,
  "gi"
);

/** `@name` in running text. Discord mentions (`<@123>`) and email addresses are not handles. */
const AT_PATTERN = /(?<![\w<@/.])@([A-Za-z0-9_][A-Za-z0-9_.]{2,29})/g;

/** Handles an applicant put in a message: profile links, "FA: name" style lines, and @names. */
export function extractHandles(text: string): ClaimedHandle[] {
  const out: ClaimedHandle[] = [];
  const urls = extractUrls(text);
  for (const url of urls) {
    const parsed = handleFromUrl(url);
    if (parsed) out.push({ ...parsed, origin: "link", url });
  }

  const withoutUrls = urls.reduce((acc, u) => acc.split(u).join(" "), text);
  for (const m of withoutUrls.matchAll(ALIAS_PATTERN)) {
    const alias = m[1]?.toLowerCase().replace(/\s+/g, " ");
    const handle = m[2]?.replace(/[.\-~]+$/, "");
    const platform = alias ? PLATFORM_ALIASES[alias] : undefined;
    if (platform && handle) out.push({ platform, handle, origin: "text", url: null });
  }
  for (const m of withoutUrls.matchAll(AT_PATTERN)) {
    const handle = m[1]?.replace(/\.+$/, "");
    if (handle && !/^(everyone|here)$/i.test(handle))
      out.push({ platform: "unknown", handle, origin: "text", url: null });
  }
  return dedupeHandles(out);
}

export function dedupeHandles(handles: ClaimedHandle[]): ClaimedHandle[] {
  const seen = new Set<string>();
  return handles.filter((h) => {
    const key = `${h.platform}:${normalizeHandle(h.handle)}`;
    if (!normalizeHandle(h.handle) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Lowercase letters and digits only, so "Foxy_Artz", "foxy-artz" and "@FoxyArtz" compare equal. */
export function normalizeHandle(value: string): string {
  return value
    .replace(/_\((?:artist|character)\)$/i, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Shortest name length at which "one contains the other" is treated as a possible match. */
const MIN_PARTIAL_LENGTH = 5;

export interface OwnershipResult {
  ownership: Ownership;
  matchedHandle: string | null;
}

/**
 * Compare the names attached to a match with the names the applicant goes by.
 *  - applicant: a name is identical to a claimed handle.
 *  - possible:  one name contains the other (both at least 5 characters).
 *  - other:     the match has a name, the applicant gave gallery handles, none fit.
 *  - unknown:   the match has no name, or the applicant gave no gallery handles to compare with.
 */
export function compareNames(candidates: string[], claimed: ClaimedHandle[]): OwnershipResult {
  const names = [...new Set(candidates.map(normalizeHandle).filter((n) => n.length > 0))];
  if (names.length === 0) return { ownership: "unknown", matchedHandle: null };

  const label = (h: ClaimedHandle) =>
    h.platform === "unknown" ? h.handle : `${h.platform}: ${h.handle}`;

  for (const h of claimed) {
    if (names.includes(normalizeHandle(h.handle)))
      return { ownership: "applicant", matchedHandle: label(h) };
  }
  for (const h of claimed) {
    const mine = normalizeHandle(h.handle);
    if (mine.length < MIN_PARTIAL_LENGTH) continue;
    if (
      names.some((n) => n.length >= MIN_PARTIAL_LENGTH && (n.includes(mine) || mine.includes(n)))
    ) {
      return { ownership: "possible", matchedHandle: label(h) };
    }
  }
  const gaveGalleryHandles = claimed.some((h) => h.origin !== "discord");
  return { ownership: gaveGalleryHandles ? "other" : "unknown", matchedHandle: null };
}

/**
 * Names worth comparing for one match. Creator names win when the service gives
 * any: a post's source links often include the commissioner's gallery, and the
 * commissioner did not draw it. Without creator names, fall back to the posting
 * account and to accounts named in the match's URLs.
 */
export function matchNames(match: RawMatch): string[] {
  if (match.artists.length > 0) return match.artists;
  const names: string[] = [];
  // On e621 the uploader is whoever archived the post, usually not the artist.
  if (match.uploader && match.platform !== "e621") names.push(match.uploader);
  for (const url of [match.sourceUrl, ...match.relatedUrls]) {
    const parsed = handleFromUrl(url);
    if (parsed && parsed.platform !== "e621") names.push(parsed.handle);
  }
  return names;
}

export function classifyOwnership(match: RawMatch, claimed: ClaimedHandle[]): OwnershipResult {
  return compareNames(matchNames(match), claimed);
}

/** How many different artists the matches for one image must name before they read as noise. */
const SCATTER_THRESHOLD = 4;

/**
 * Images whose matches name several unrelated artists, with how many. A real
 * source turns up under one or two names: the artist, cross-posted. A lookup
 * service that answers a text page or flat line art has little detail to
 * compare, and returns look-alikes by a different artist each time.
 */
export function scatteredImages(
  matches: ReadonlyArray<RawMatch & { imageKey: string }>
): Map<string, number> {
  const names = new Map<string, Set<string>>();
  for (const match of matches) {
    // Google finds copies on the open web, where one picture is reposted under
    // many accounts. Counting those would call a widely copied image a look-alike.
    if (match.service === "google") continue;
    const name = normalizeHandle(matchNames(match)[0] ?? "");
    if (!name) continue;
    names.set(match.imageKey, (names.get(match.imageKey) ?? new Set<string>()).add(name));
  }
  return new Map(
    [...names]
      .filter(([, seen]) => seen.size >= SCATTER_THRESHOLD)
      .map(([imageKey, seen]) => [imageKey, seen.size])
  );
}
