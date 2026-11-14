// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/handles.test.ts
 * WHAT: Finding the handles an applicant claimed, and comparing a reverse image
 *       match's names against them.
 * WHY: The ownership label decides how a match reads in the report: under the
 *      applicant's own name it supports them, under another name it is a red
 *      flag. A wrong label in either direction misleads the owner.
 */
import { describe, expect, it } from "vitest";
import {
  classifyOwnership,
  compareNames,
  dedupeHandles,
  extractHandles,
  extractUrls,
  handleFromUrl,
  matchNames,
  normalizeHandle,
  scatteredImages,
} from "../../../src/features/artistInvestigation/handles.js";
import type { ClaimedHandle, RawMatch } from "../../../src/features/artistInvestigation/types.js";
import { rawMatch } from "./fixtures.js";

const claim = (
  platform: string,
  handle: string,
  origin: ClaimedHandle["origin"] = "link"
): ClaimedHandle => ({
  platform,
  handle,
  origin,
  url: null,
});

describe("extractUrls", () => {
  it("drops trailing punctuation, brackets and duplicates", () => {
    const text =
      "see https://www.furaffinity.net/user/foxyartz/, and (https://x.com/FoxyArtz). Again: https://x.com/FoxyArtz!";
    expect(extractUrls(text)).toEqual([
      "https://www.furaffinity.net/user/foxyartz/",
      "https://x.com/FoxyArtz",
    ]);
  });

  it("returns nothing for text without links", () => {
    expect(extractUrls("no links here, just www and words")).toEqual([]);
  });
});

describe("handleFromUrl", () => {
  it.each([
    ["https://www.furaffinity.net/user/foxyartz/", "furaffinity", "foxyartz"],
    ["https://furaffinity.net/gallery/foxyartz/folder/1", "furaffinity", "foxyartz"],
    ["https://www.deviantart.com/foxyartz/art/A-piece-123", "deviantart", "foxyartz"],
    ["https://foxyartz.deviantart.com/gallery", "deviantart", "foxyartz"],
    ["https://twitter.com/FoxyArtz/status/1234567890123456789", "twitter", "FoxyArtz"],
    ["https://x.com/@FoxyArtz", "twitter", "FoxyArtz"],
    ["https://bsky.app/profile/foxyartz.bsky.social", "bluesky", "foxyartz"],
    ["https://bsky.app/profile/foxyartz.art/post/abc", "bluesky", "foxyartz.art"],
    ["https://www.instagram.com/foxy.artz/", "instagram", "foxy.artz"],
    ["https://toyhou.se/foxyartz/characters", "toyhouse", "foxyartz"],
    ["https://www.weasyl.com/~foxyartz", "weasyl", "foxyartz"],
    ["https://ko-fi.com/foxyartz", "kofi", "foxyartz"],
    ["https://vgen.co/foxyartz", "vgen", "foxyartz"],
    ["https://foxyartz.tumblr.com/post/1", "tumblr", "foxyartz"],
    ["https://foxyartz.carrd.co/#tos", "carrd", "foxyartz"],
    ["https://www.youtube.com/@foxyartz/videos", "youtube", "foxyartz"],
    ["https://www.tiktok.com/@foxyartz", "tiktok", "foxyartz"],
    ["https://www.pixiv.net/en/users/1234567", "pixiv", "1234567"],
    ["https://itaku.ee/profile/foxyartz/gallery", "itaku", "foxyartz"],
    ["https://www.patreon.com/c/foxyartz", "patreon", "foxyartz"],
  ])("%s is %s account %s", (url, platform, handle) => {
    expect(handleFromUrl(url)).toEqual({ platform, handle });
  });

  it.each([
    ["a single submission page", "https://www.furaffinity.net/view/12345/"],
    ["a site-level page", "https://x.com/home"],
    ["an Instagram post", "https://www.instagram.com/p/Cabc123/"],
    ["a Toyhouse character page", "https://toyhou.se/1234567.some-character"],
    ["an e621 post", "https://e621.net/posts/123456"],
    ["an unknown site", "https://example.com/foxyartz"],
    ["a Discord attachment", "https://cdn.discordapp.com/attachments/1/2/a.png"],
    ["text that is not a URL", "foxyartz on FA"],
  ])("finds no account in %s", (_label, url) => {
    expect(handleFromUrl(url)).toBeNull();
  });
});

describe("extractHandles", () => {
  it("reads profile links, labeled names and @names", () => {
    const handles = extractHandles(
      "My FA: FoxyArtz and twitter = @foxy_artz. Gallery https://www.deviantart.com/foxyartz - also @sketchfox on telegram"
    );

    expect(handles).toContainEqual({
      platform: "deviantart",
      handle: "foxyartz",
      origin: "link",
      url: "https://www.deviantart.com/foxyartz",
    });
    expect(handles).toContainEqual({
      platform: "furaffinity",
      handle: "FoxyArtz",
      origin: "text",
      url: null,
    });
    expect(handles).toContainEqual({
      platform: "twitter",
      handle: "foxy_artz",
      origin: "text",
      url: null,
    });
    expect(handles).toContainEqual({
      platform: "unknown",
      handle: "sketchfox",
      origin: "text",
      url: null,
    });
  });

  it("does not take Discord mentions, emails or broadcast pings for handles", () => {
    const handles = extractHandles(
      "ping <@123456789012345678> or mail fox@example.com, not @everyone or @here"
    );
    expect(handles).toEqual([]);
  });

  it("does not read a handle out of the middle of a link", () => {
    const handles = extractHandles("https://example.com/@notahandle/page?fa=alsonot");
    expect(handles).toEqual([]);
  });

  it("does not match a platform alias inside another word", () => {
    // "big:" ends in "ig" and "both:" ends in "th", which are aliases on their own.
    expect(extractHandles("the big: picture, and both: styles")).toEqual([]);
  });

  it("lists one account once however often it is mentioned", () => {
    const handles = extractHandles(
      "FA: FoxyArtz, again fa: foxy_artz, and https://www.furaffinity.net/user/foxyartz/"
    );
    expect(handles.filter((h) => h.platform === "furaffinity")).toHaveLength(1);
  });
});

describe("normalizeHandle and dedupeHandles", () => {
  it("compares names by letters and digits only", () => {
    expect(normalizeHandle("Foxy_Artz")).toBe("foxyartz");
    expect(normalizeHandle("@foxy-artz")).toBe("foxyartz");
    expect(normalizeHandle("foxy.artz99")).toBe("foxyartz99");
    expect(normalizeHandle("Fóxy")).toBe("foxy");
  });

  it("drops the tag suffixes e621 adds to artist names", () => {
    expect(normalizeHandle("foxyartz_(artist)")).toBe("foxyartz");
  });

  it("removes handles that normalize to nothing", () => {
    expect(dedupeHandles([claim("unknown", "___"), claim("unknown", "fox")])).toEqual([
      claim("unknown", "fox"),
    ]);
  });
});

describe("compareNames", () => {
  const claimed = [claim("furaffinity", "Foxy_Artz"), claim("discord", "foxy", "discord")];

  it("labels a match under the applicant's own handle as theirs", () => {
    expect(compareNames(["foxyartz"], claimed)).toEqual({
      ownership: "applicant",
      matchedHandle: "furaffinity: Foxy_Artz",
    });
  });

  it("matches any one of several names on the post", () => {
    expect(compareNames(["commissioner123", "FoxyArtz"], claimed).ownership).toBe("applicant");
  });

  it("labels a longer or shorter variant as possible, never as theirs", () => {
    expect(compareNames(["foxyartz_commissions"], claimed)).toEqual({
      ownership: "possible",
      matchedHandle: "furaffinity: Foxy_Artz",
    });
    expect(compareNames(["foxyartz"], [claim("twitter", "foxyartz_art")]).ownership).toBe(
      "possible"
    );
  });

  it("labels a match under someone else's name as other", () => {
    expect(compareNames(["SomeOtherArtist"], claimed)).toEqual({
      ownership: "other",
      matchedHandle: null,
    });
  });

  it("does not call a short name a partial match", () => {
    // "foxy" (the Discord name) sits inside "foxytrot", but four letters is too little to go on.
    expect(compareNames(["foxytrot"], claimed).ownership).toBe("other");
  });

  it("says unknown when the match carries no name", () => {
    expect(compareNames([], claimed)).toEqual({ ownership: "unknown", matchedHandle: null });
    expect(compareNames(["", "___"], claimed).ownership).toBe("unknown");
  });

  it("says unknown, not other, when the applicant claimed no gallery handle", () => {
    const discordOnly = [claim("discord", "foxyartz", "discord")];
    expect(compareNames(["SomeOtherArtist"], discordOnly)).toEqual({
      ownership: "unknown",
      matchedHandle: null,
    });
  });

  it("accepts the applicant's Discord name as a claimed name", () => {
    const discordOnly = [claim("discord", "foxyartz", "discord")];
    expect(compareNames(["FoxyArtz"], discordOnly)).toEqual({
      ownership: "applicant",
      matchedHandle: "discord: foxyartz",
    });
  });

  it("shows a bare @name without a platform prefix", () => {
    expect(compareNames(["sketchfox"], [claim("unknown", "sketchfox", "text")]).matchedHandle).toBe(
      "sketchfox"
    );
  });
});

describe("matchNames and classifyOwnership", () => {
  const claimed = [claim("furaffinity", "foxyartz")];

  it("uses the credited artists when the service gives any", () => {
    const match = rawMatch({
      artists: ["realartist"],
      uploader: "foxyartz",
      relatedUrls: ["https://www.furaffinity.net/user/foxyartz/"],
    });
    // The post links the applicant's gallery, but the credited artist is someone else:
    // that is what a commissioner's upload looks like.
    expect(matchNames(match)).toEqual(["realartist"]);
    expect(classifyOwnership(match, claimed).ownership).toBe("other");
  });

  it("falls back to the uploader and to accounts in the match's links", () => {
    const match = rawMatch({
      artists: [],
      uploader: "FoxyArtz",
      sourceUrl: "https://www.furaffinity.net/view/12345/",
      relatedUrls: ["https://twitter.com/FoxyArtz/status/1234567890123456789"],
    });
    expect(matchNames(match)).toEqual(["FoxyArtz", "FoxyArtz"]);
    expect(classifyOwnership(match, claimed)).toEqual({
      ownership: "applicant",
      matchedHandle: "furaffinity: foxyartz",
    });
  });

  it("ignores the e621 uploader, who archived the post and did not draw it", () => {
    const match = rawMatch({
      service: "e621",
      platform: "e621",
      sourceUrl: "https://e621.net/posts/123",
      artists: [],
      uploader: "foxyartz",
      relatedUrls: [],
    });
    expect(matchNames(match)).toEqual([]);
    expect(classifyOwnership(match, claimed).ownership).toBe("unknown");
  });

  it("reads the artist's gallery from an e621 post's source links", () => {
    const match = rawMatch({
      service: "e621",
      platform: "e621",
      sourceUrl: "https://e621.net/posts/123",
      artists: [],
      uploader: "archiver",
      relatedUrls: ["https://www.furaffinity.net/user/someoneelse/", "https://e621.net/users/999"],
    });
    expect(matchNames(match)).toEqual(["someoneelse"]);
    expect(classifyOwnership(match, claimed).ownership).toBe("other");
  });

  it("supports the applicant when an e621 artist tag is their handle", () => {
    const match = rawMatch({
      service: "e621",
      platform: "e621",
      artists: ["foxyartz_(artist)"],
      uploader: "archiver",
    });
    expect(classifyOwnership(match, claimed).ownership).toBe("applicant");
  });
});

describe("scatteredImages", () => {
  const on = (imageKey: string, overrides: Partial<RawMatch>) => ({
    ...rawMatch(overrides),
    imageKey,
  });
  /** Matches for one image, each credited to a different artist. */
  const strangers = (imageKey: string, count: number) =>
    Array.from({ length: count }, (_, i) =>
      on(imageKey, { artists: [`artist${i}`], uploader: `artist${i}` })
    );

  it("flags an image whose matches name four or more different artists, with the count", () => {
    expect(scatteredImages(strangers("img4", 4))).toEqual(new Map([["img4", 4]]));
    expect(scatteredImages(strangers("img4", 6))).toEqual(new Map([["img4", 6]]));
  });

  it("does not flag an image whose matches name fewer", () => {
    expect(scatteredImages(strangers("img1", 3)).size).toBe(0);
    expect(scatteredImages([]).size).toBe(0);
  });

  it("counts one artist once however the name is written", () => {
    const matches = ["FoxyArtz", "foxy_artz", "foxyartz_(artist)", "@Foxy-Artz", "FOXYARTZ"].map(
      (name) => on("img1", { artists: [name] })
    );
    expect(scatteredImages(matches).size).toBe(0);
  });

  it("looks at each image on its own", () => {
    const matches = [...strangers("img1", 2), ...strangers("img2", 5), ...strangers("img3", 3)];
    expect(scatteredImages(matches)).toEqual(new Map([["img2", 5]]));
  });

  it("goes by the same names the ownership check compares", () => {
    // Without a credited artist the uploader counts, except on e621, where the uploader only archived the post.
    const uploads = Array.from({ length: 4 }, (_, i) =>
      on("img1", { artists: [], uploader: `uploader${i}` })
    );
    const archived = Array.from({ length: 4 }, (_, i) =>
      on("img2", {
        service: "e621",
        platform: "e621",
        sourceUrl: `https://e621.net/posts/${i}`,
        artists: [],
        uploader: `archiver${i}`,
      })
    );

    expect(scatteredImages([...uploads, ...archived])).toEqual(new Map([["img1", 4]]));
  });

  it("ignores matches that carry no name", () => {
    const nameless = Array.from({ length: 6 }, (_, i) =>
      on("img1", { artists: [], uploader: null, sourceUrl: `https://example.com/art/${i}` })
    );
    expect(scatteredImages(nameless).size).toBe(0);
  });
});
