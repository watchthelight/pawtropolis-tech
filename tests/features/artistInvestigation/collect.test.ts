// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/collect.test.ts
 * WHAT: Ticket history paging and the sorting of what an applicant posted into
 *       images, files, links, handles and a labeled transcript.
 * WHY: Everything later in a run cites evidence by label (m4, img2). A message
 *      or attachment that is dropped, double-counted or credited to the wrong
 *      person here would be wrong in the whole report.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildEvidence,
  classifyFile,
  fetchTicketHistory,
  toTicketMessage,
  type HistoryChannel,
  type RawMessage,
} from "../../../src/features/artistInvestigation/collect.js";
import { LIMITS } from "../../../src/features/artistInvestigation/config.js";
import { APPLICANT_ID, BOT_ID, STAFF_ID, T0, attachment, message } from "./fixtures.js";

function raw(index: number, overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: String(800000000000000000n + BigInt(index)),
    author: { id: APPLICANT_ID, username: "foxyartz", bot: false, globalName: "Foxy" },
    member: null,
    createdTimestamp: T0 + index * 1000,
    content: `message ${index}`,
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

/** Serves history the way Discord does: newest first, `limit` at a time, older than `before`. */
function historyChannel(total: number): HistoryChannel & { fetch: ReturnType<typeof vi.fn> } {
  const all = Array.from({ length: total }, (_, i) => raw(i + 1));
  const fetch = vi.fn(async ({ limit, before }: { limit: number; before?: string }) => {
    const older = before ? all.filter((m) => BigInt(m.id) < BigInt(before)) : all;
    const page = older.slice(-limit).reverse();
    return new Map(page.map((m) => [m.id, m]));
  });
  return { messages: { fetch }, fetch };
}

describe("fetchTicketHistory", () => {
  it("reads a short ticket in one request and returns it oldest first", async () => {
    const channel = historyChannel(3);
    const history = await fetchTicketHistory(channel);

    expect(channel.fetch).toHaveBeenCalledTimes(1);
    expect(history.complete).toBe(true);
    expect(history.messages.map((m) => m.content)).toEqual(["message 1", "message 2", "message 3"]);
  });

  it("pages back through a long ticket without losing or repeating a message", async () => {
    const channel = historyChannel(237);
    const history = await fetchTicketHistory(channel);

    expect(channel.fetch).toHaveBeenCalledTimes(3);
    expect(channel.fetch.mock.calls[0]?.[0]).toEqual({ limit: 100 });
    // Each later page starts before the oldest message of the page before it.
    expect(channel.fetch.mock.calls[1]?.[0]).toEqual({ limit: 100, before: "800000000000000138" });
    expect(channel.fetch.mock.calls[2]?.[0]).toEqual({ limit: 100, before: "800000000000000038" });

    expect(history.complete).toBe(true);
    expect(history.messages).toHaveLength(237);
    expect(new Set(history.messages.map((m) => m.id)).size).toBe(237);
    expect(history.messages[0]?.content).toBe("message 1");
    expect(history.messages[236]?.content).toBe("message 237");
  });

  it("makes one more request when the ticket is an exact multiple of the page size", async () => {
    const channel = historyChannel(200);
    const history = await fetchTicketHistory(channel);

    expect(channel.fetch).toHaveBeenCalledTimes(3);
    expect(history).toMatchObject({ complete: true });
    expect(history.messages).toHaveLength(200);
  });

  it("stops at the page cap and says the history is incomplete", async () => {
    const channel = historyChannel(450);
    const history = await fetchTicketHistory(channel, 2);

    expect(channel.fetch).toHaveBeenCalledTimes(2);
    expect(history.complete).toBe(false);
    expect(history.messages).toHaveLength(200);
    // The newest messages are the ones kept.
    expect(history.messages[199]?.content).toBe("message 450");
  });

  it("returns an empty, complete history for an empty channel", async () => {
    const history = await fetchTicketHistory(historyChannel(0));
    expect(history).toEqual({ messages: [], complete: true });
  });
});

describe("toTicketMessage", () => {
  it("prefers the server display name, then the global name, then the username", () => {
    expect(toTicketMessage(raw(1, { member: { displayName: "Foxy the Artist" } })).authorName).toBe(
      "Foxy the Artist"
    );
    expect(toTicketMessage(raw(1)).authorName).toBe("Foxy");
    expect(
      toTicketMessage(raw(1, { author: { id: APPLICANT_ID, username: "foxyartz", bot: false } }))
        .authorName
    ).toBe("foxyartz");
  });

  it("copies attachments and fills missing fields with null", () => {
    const attachments = new Map([
      [
        "1",
        {
          id: "1",
          name: "a.png",
          url: "https://cdn.discordapp.com/a.png",
          contentType: "image/png",
          size: 10,
          width: 5,
          height: 6,
        },
      ],
      ["2", { id: "2", name: "b.psd", url: "https://cdn.discordapp.com/b.psd", size: 20 } as never],
    ]);
    const result = toTicketMessage(raw(1, { attachments }));

    expect(result.attachments).toEqual([
      {
        id: "1",
        name: "a.png",
        url: "https://cdn.discordapp.com/a.png",
        contentType: "image/png",
        size: 10,
        width: 5,
        height: 6,
      },
      {
        id: "2",
        name: "b.psd",
        url: "https://cdn.discordapp.com/b.psd",
        contentType: null,
        size: 20,
        width: null,
        height: null,
      },
    ]);
  });

  it("takes the picture of a pasted image link from the embed thumbnail, through Discord's proxy", () => {
    const result = toTicketMessage(
      raw(1, {
        embeds: [
          {
            data: { type: "image" },
            title: null,
            description: null,
            url: "https://example.com/art.png",
            image: null,
            thumbnail: {
              url: "https://example.com/art.png",
              proxyURL: "https://images-ext-1.discordapp.net/external/x/art.png",
            },
          },
        ],
      })
    );
    expect(result.embeds).toEqual([
      {
        type: "image",
        title: null,
        description: null,
        url: "https://example.com/art.png",
        imageUrl: "https://images-ext-1.discordapp.net/external/x/art.png",
      },
    ]);
  });

  it("ignores the thumbnail of a link preview that is not an image embed", () => {
    const result = toTicketMessage(
      raw(1, {
        embeds: [
          {
            data: { type: "rich" },
            title: "A gallery",
            description: "Some page",
            url: "https://example.com/gallery",
            image: null,
            thumbnail: { url: "https://example.com/avatar.png" },
          },
        ],
      })
    );
    expect(result.embeds[0]).toMatchObject({ type: "rich", imageUrl: null, title: "A gallery" });
  });
});

describe("classifyFile", () => {
  it.each([
    ["timelapse.mp4", "video/mp4", "video"],
    ["process.MOV", null, "video"],
    ["commission.psd", "application/octet-stream", "source_file"],
    ["piece.clip", null, "source_file"],
    ["canvas.procreate", null, "source_file"],
    ["tos.pdf", "application/pdf", "other"],
    ["notes.txt", "text/plain", "other"],
  ] as const)("%s is %s", (name, contentType, kind) => {
    expect(classifyFile({ name, contentType })).toBe(kind);
  });
});

describe("buildEvidence", () => {
  const options = { maxImages: 12, identityNames: [] as string[] };

  it("labels every message in order and counts the applicant's own", () => {
    const messages = [
      message({
        authorId: BOT_ID,
        authorIsBot: true,
        authorName: "Ticket Tool",
        content: "Hello!",
      }),
      message({ content: "hi, here is my art" }),
      message({ authorId: STAFF_ID, authorName: "Mod", content: "thanks, taking a look" }),
      message({ content: "ok!" }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.messageCount).toBe(4);
    expect(evidence.applicantMessageCount).toBe(2);
    expect(evidence.messageIds).toEqual({
      m1: messages[0]?.id,
      m2: messages[1]?.id,
      m3: messages[2]?.id,
      m4: messages[3]?.id,
    });
    expect(evidence.firstMessageAtMs).toBe(messages[0]?.createdAtMs);
    expect(evidence.lastMessageAtMs).toBe(messages[3]?.createdAtMs);

    const lines = evidence.transcript.split("\n");
    expect(lines[0]).toMatch(
      /^\[m1\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \| BOT \(Ticket Tool\): Hello!$/
    );
    expect(lines[1]).toContain("| APPLICANT (foxyartz): hi, here is my art");
    expect(lines[2]).toContain("| MEMBER (Mod): thanks, taking a look");
    expect(evidence.transcriptTruncated).toBe(false);
  });

  it("collects every image the applicant attached, across messages, with stable labels", () => {
    const messages = [
      message({
        content: "sketch and lines",
        attachments: [
          attachment({
            id: "1",
            name: "sketch.png",
            url: "https://cdn.discordapp.com/attachments/1/1/sketch.png?ex=1",
          }),
          attachment({
            id: "2",
            name: "lines.jpg",
            contentType: "image/jpeg",
            url: "https://cdn.discordapp.com/attachments/1/2/lines.jpg?ex=1",
          }),
        ],
      }),
      message({
        attachments: [
          attachment({
            id: "3",
            name: "final.webp",
            contentType: "image/webp",
            url: "https://cdn.discordapp.com/attachments/1/3/final.webp",
          }),
        ],
      }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.images.map((i) => [i.key, i.name, i.messageLabel, i.source])).toEqual([
      ["img1", "sketch.png", "m1", "attachment"],
      ["img2", "lines.jpg", "m1", "attachment"],
      ["img3", "final.webp", "m2", "attachment"],
    ]);
    expect(evidence.images[0]).toMatchObject({
      messageId: messages[0]?.id,
      postedAtMs: messages[0]?.createdAtMs,
      width: 1200,
      height: 900,
    });
    expect(evidence.transcript).toContain(
      'attached: img1 (image "sketch.png", 1200x900); img2 (image "lines.jpg", 1200x900)'
    );
  });

  it("never treats another member's or a bot's attachments as part of the application", () => {
    const messages = [
      message({
        authorId: STAFF_ID,
        authorName: "Mod",
        content: "example of what we need",
        attachments: [attachment({ name: "example.png" })],
      }),
      message({
        authorId: BOT_ID,
        authorIsBot: true,
        authorName: "Ticket Tool",
        attachments: [attachment({ name: "banner.png" })],
      }),
      message({ content: "understood" }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.images).toEqual([]);
    expect(evidence.files).toEqual([]);
    expect(evidence.transcript).toContain("attached: 1 attachment (not part of the application)");
  });

  it("sorts non-image attachments into videos, source files and other files", () => {
    const messages = [
      message({
        attachments: [
          attachment({
            id: "1",
            name: "timelapse.mp4",
            contentType: "video/mp4",
            size: 8 * 1024 * 1024,
          }),
          attachment({ id: "2", name: "piece.psd", contentType: null, size: 3 * 1024 * 1024 }),
          attachment({
            id: "3",
            name: "tos.pdf",
            contentType: "application/pdf",
            size: 1024 * 1024,
          }),
          attachment({ id: "4", name: "logo.svg", contentType: "image/svg+xml", size: 2048 }),
        ],
      }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.images).toEqual([]);
    expect(evidence.files.map((f) => [f.name, f.kind, f.messageLabel])).toEqual([
      ["timelapse.mp4", "video", "m1"],
      ["piece.psd", "source_file", "m1"],
      ["tos.pdf", "other", "m1"],
      ["logo.svg", "other", "m1"],
    ]);
    expect(evidence.transcript).toContain('video "timelapse.mp4" (8.0 MB, contents not inspected)');
    expect(evidence.transcript).toContain(
      'source file "piece.psd" (3.0 MB, contents not inspected)'
    );
  });

  it("recognizes an image by extension when Discord sent no content type", () => {
    const messages = [
      message({ attachments: [attachment({ name: "scan.JPEG", contentType: null })] }),
    ];
    expect(buildEvidence(messages, APPLICANT_ID, options).images).toHaveLength(1);
  });

  it("counts the same upload once when it appears again with a new signature", () => {
    const messages = [
      message({
        attachments: [
          attachment({ url: "https://cdn.discordapp.com/attachments/1/2/sketch.png?ex=aaa" }),
        ],
      }),
      message({
        attachments: [
          attachment({ url: "https://cdn.discordapp.com/attachments/1/2/sketch.png?ex=bbb" }),
        ],
      }),
    ];
    expect(buildEvidence(messages, APPLICANT_ID, options).images).toHaveLength(1);
  });

  it("picks up images the applicant linked instead of attaching", () => {
    const messages = [
      message({
        content: "https://example.com/art/my%20piece.png",
        embeds: [
          {
            type: "image",
            title: null,
            description: null,
            url: "https://example.com/art/my%20piece.png",
            imageUrl:
              "https://images-ext-1.discordapp.net/external/abc/https/example.com/art/my%20piece.png",
          },
          {
            type: "rich",
            title: "Gallery",
            description: null,
            url: "https://example.com/gallery",
            imageUrl: "https://example.com/preview.png",
          },
        ],
      }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.images).toHaveLength(1);
    expect(evidence.images[0]).toMatchObject({
      key: "img1",
      name: "my piece.png",
      source: "embed",
      url: "https://images-ext-1.discordapp.net/external/abc/https/example.com/art/my%20piece.png",
    });
    expect(evidence.transcript).toContain('img1 (linked image "my piece.png")');
  });

  it("keeps images past the per-run cap on a separate list", () => {
    const messages = [
      message({
        attachments: Array.from({ length: 5 }, (_, i) =>
          attachment({
            id: String(i),
            name: `piece${i + 1}.png`,
            url: `https://cdn.discordapp.com/attachments/1/${i}/piece.png`,
          })
        ),
      }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, { maxImages: 3, identityNames: [] });

    expect(evidence.images.map((i) => i.key)).toEqual(["img1", "img2", "img3"]);
    expect(evidence.imagesOverCap.map((i) => [i.key, i.name])).toEqual([
      ["img4", "piece4.png"],
      ["img5", "piece5.png"],
    ]);
  });

  it("collects the applicant's links and gallery handles, and leaves out other people's", () => {
    const messages = [
      message({
        authorId: STAFF_ID,
        authorName: "Mod",
        content: "see https://www.furaffinity.net/user/modaccount/ for an example",
      }),
      message({
        content:
          "My gallery is https://www.furaffinity.net/user/foxyartz/ and my ToS: https://foxyartz.carrd.co/#tos. Twitter: @Foxy_Artz " +
          "https://cdn.discordapp.com/attachments/1/2/old.png",
      }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, {
      maxImages: 12,
      identityNames: ["foxyartz", "Foxy", " "],
    });

    expect(evidence.links).toEqual([
      "https://www.furaffinity.net/user/foxyartz/",
      "https://foxyartz.carrd.co/#tos",
    ]);
    expect(evidence.handles).toContainEqual({
      platform: "furaffinity",
      handle: "foxyartz",
      origin: "link",
      url: "https://www.furaffinity.net/user/foxyartz/",
    });
    expect(evidence.handles).toContainEqual({
      platform: "twitter",
      handle: "Foxy_Artz",
      origin: "text",
      url: null,
    });
    expect(evidence.handles).toContainEqual({
      platform: "discord",
      handle: "Foxy",
      origin: "discord",
      url: null,
    });
    expect(evidence.handles.some((h) => h.handle === "modaccount")).toBe(false);
    expect(evidence.handles.some((h) => h.handle.trim() === "")).toBe(false);
  });

  it("keeps the greeting text, embed included, for the requirement check", () => {
    const messages = [
      message({
        authorId: BOT_ID,
        authorIsBot: true,
        authorName: "Ticket Tool",
        content: `Hello <@${APPLICANT_ID}>!`,
        embeds: [
          {
            type: "rich",
            title: "2D Artist",
            description: "3 different WIP/Layers to previous work",
            url: null,
            imageUrl: null,
          },
        ],
      }),
      message({
        authorId: BOT_ID,
        authorIsBot: true,
        authorName: "Ticket Tool",
        content: "A later bot message",
      }),
    ];
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.greetingText).toBe(
      `Hello <@${APPLICANT_ID}>!\n3 different WIP/Layers to previous work`
    );
    expect(evidence.transcript).toContain("2D Artist: 3 different WIP/Layers to previous work");
  });

  it("trims one very long message and marks the cut", () => {
    const evidence = buildEvidence(
      [message({ content: "a".repeat(LIMITS.messageChars + 500) })],
      APPLICANT_ID,
      options
    );
    expect(evidence.transcript).toContain(`${"a".repeat(LIMITS.messageChars)} [cut]`);
    expect(evidence.transcript).not.toContain("a".repeat(LIMITS.messageChars + 1));
  });

  it("keeps the start and the end of an over-long ticket and says what was left out", () => {
    const messages = Array.from({ length: 60 }, (_, i) =>
      message({ content: `${i + 1} `.padEnd(1500, "x") })
    );
    const evidence = buildEvidence(messages, APPLICANT_ID, options);

    expect(evidence.transcriptTruncated).toBe(true);
    expect(evidence.transcript.length).toBeLessThanOrEqual(LIMITS.transcriptChars + 100);
    expect(evidence.transcript).toContain("[m1] ");
    expect(evidence.transcript).toContain("[m60] ");
    expect(evidence.transcript).toMatch(
      /\[\.\.\. \d+ messages left out to fit the size limit \.\.\.\]/
    );
    // Labels still cover every message, so a citation of a left-out message can be linked.
    expect(Object.keys(evidence.messageIds)).toHaveLength(60);
  });

  it("describes an empty ticket without failing", () => {
    const evidence = buildEvidence([], APPLICANT_ID, options);
    expect(evidence).toMatchObject({
      messageCount: 0,
      applicantMessageCount: 0,
      firstMessageAtMs: null,
      lastMessageAtMs: null,
      images: [],
      transcript: "",
      transcriptTruncated: false,
    });
  });

  it("shows a message with no text as such", () => {
    const evidence = buildEvidence(
      [message({ attachments: [attachment()] })],
      APPLICANT_ID,
      options
    );
    expect(evidence.transcript).toContain("APPLICANT (foxyartz): (no text)");
  });
});
