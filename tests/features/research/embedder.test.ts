/**
 * Pawtropolis Tech -- tests/features/research/embedder.test.ts
 * WHAT: Tests for the pinned model files and for the batching around the
 *       embedding library. The library itself is replaced by a stand-in.
 * WHY: A model file that is not the pinned one must never be used, the library
 *      must never be allowed to fetch a model by itself, and sorting the texts
 *      by length must not mix up whose vector is whose. A batch must get
 *      smaller as its texts get longer, or one long message costs gigabytes.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VECTOR_SIZE } from "../../../src/features/research/effortModel.js";
import {
  EMBEDDING_ID,
  EMBEDDING_MODEL,
  createEmbedder,
  fetchModelFiles,
  loadTransformers,
  verifyModelFiles,
  type ModelSpec,
  type TransformersLibrary,
} from "../../../src/features/research/embedder.js";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const CONTENT: Record<string, string> = {
  "config.json": '{"model_type":"test"}',
  "onnx/model.onnx": "not really a model",
};
const SPEC: ModelSpec = {
  name: "Example/tiny-model",
  revision: "0123456789abcdef0123456789abcdef01234567",
  dtype: "fp32",
  files: Object.fromEntries(Object.entries(CONTENT).map(([name, text]) => [name, sha256(text)])),
};

let dir: string;
const fileOf = (name: string): string =>
  path.join(dir, "Example", "tiny-model", ...name.split("/"));

function putFiles(content: Record<string, string> = CONTENT): void {
  for (const [name, text] of Object.entries(content)) {
    fs.mkdirSync(path.dirname(fileOf(name)), { recursive: true });
    fs.writeFileSync(fileOf(name), text);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-embed-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the pinned model", () => {
  it("is all-MiniLM-L6-v2 at one revision, full precision", () => {
    expect(EMBEDDING_ID).toBe("Xenova/all-MiniLM-L6-v2@751bff37182d/fp32");
    expect(Object.keys(EMBEDDING_MODEL.files).sort()).toEqual([
      "config.json",
      "onnx/model.onnx",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    for (const hash of Object.values(EMBEDDING_MODEL.files)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyModelFiles", () => {
  it("accepts the pinned files", () => {
    putFiles();
    expect(() => verifyModelFiles(dir, SPEC)).not.toThrow();
  });

  it("names the command to run when a file is missing", () => {
    putFiles({ "config.json": CONTENT["config.json"] ?? "" });
    expect(() => verifyModelFiles(dir, SPEC)).toThrow(/model file missing: .*fetch-model/);
  });

  it("refuses a file with other content", () => {
    putFiles({ ...CONTENT, "onnx/model.onnx": "something else" });
    expect(() => verifyModelFiles(dir, SPEC)).toThrow("is not the pinned one");
  });

  it("finds nothing of the real model in an empty folder", () => {
    expect(() => verifyModelFiles(dir)).toThrow("model file missing");
  });
});

describe("fetchModelFiles", () => {
  const serve = (content: Record<string, string>, status = 200) =>
    vi.fn(async (url: string) => {
      const name = Object.keys(content).find((n) => url.endsWith(`/${n}`));
      return {
        ok: status === 200 && name !== undefined,
        status: name === undefined ? 404 : status,
        arrayBuffer: async () => new TextEncoder().encode(content[name ?? ""] ?? "").buffer,
      };
    });

  it("downloads every file from the pinned revision and puts it in place", async () => {
    const fetchFile = serve(CONTENT);
    expect(await fetchModelFiles(dir, fetchFile, SPEC)).toEqual(["config.json", "onnx/model.onnx"]);
    expect(fetchFile.mock.calls.map((call) => call[0])).toEqual([
      `https://huggingface.co/Example/tiny-model/resolve/${SPEC.revision}/config.json`,
      `https://huggingface.co/Example/tiny-model/resolve/${SPEC.revision}/onnx/model.onnx`,
    ]);
    expect(() => verifyModelFiles(dir, SPEC)).not.toThrow();
    expect(fs.existsSync(`${fileOf("config.json")}.part`)).toBe(false);
  });

  it("leaves a file alone that is already the pinned one", async () => {
    putFiles({ "config.json": CONTENT["config.json"] ?? "" });
    const fetchFile = serve(CONTENT);
    expect(await fetchModelFiles(dir, fetchFile, SPEC)).toEqual(["onnx/model.onnx"]);
    expect(await fetchModelFiles(dir, fetchFile, SPEC)).toEqual([]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it("replaces a file with other content", async () => {
    putFiles({ ...CONTENT, "config.json": "tampered" });
    expect(await fetchModelFiles(dir, serve(CONTENT), SPEC)).toEqual(["config.json"]);
    expect(fs.readFileSync(fileOf("config.json"), "utf8")).toBe(CONTENT["config.json"]);
  });

  it("does not keep a download that is not the pinned file", async () => {
    const wrong = serve({ ...CONTENT, "config.json": "a page that says rate limited" });
    await expect(fetchModelFiles(dir, wrong, SPEC)).rejects.toThrow(
      "download of config.json is not the pinned file"
    );
    expect(fs.existsSync(fileOf("config.json"))).toBe(false);
  });

  it("reports a failed download with its status", async () => {
    await expect(fetchModelFiles(dir, serve(CONTENT, 503), SPEC)).rejects.toThrow(
      "download of config.json failed with status 503"
    );
  });
});

describe("loadTransformers", () => {
  it("loads the library from the folder it is installed in", () => {
    const packageDir = path.join(dir, "research");
    const libraryDir = path.join(packageDir, "node_modules", "@huggingface", "transformers");
    fs.mkdirSync(libraryDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");
    fs.writeFileSync(path.join(libraryDir, "package.json"), '{"main":"index.js"}');
    fs.writeFileSync(path.join(libraryDir, "index.js"), "module.exports = { marker: 42 };");
    expect(loadTransformers(packageDir)).toEqual({ marker: 42 });
  });

  it("says how to install it when it is not there", () => {
    expect(() => loadTransformers(path.join(dir, "nothing-here"))).toThrow(
      /is not installed in .*npm ci --ignore-scripts/
    );
  });
});

describe("createEmbedder", () => {
  /** Gives every text a vector that holds its length, and remembers the batches. */
  function fakeLibrary(shape?: number[]) {
    const batches: string[][] = [];
    const library: TransformersLibrary = {
      env: { allowRemoteModels: true, allowLocalModels: false, localModelPath: "" },
      pipeline: vi.fn(async () => async (texts: string[]) => {
        batches.push(texts);
        const data = new Float32Array(texts.length * VECTOR_SIZE);
        texts.forEach((text, k) => {
          data[k * VECTOR_SIZE] = text.length;
        });
        return { data, dims: shape ?? [texts.length, VECTOR_SIZE] };
      }),
    };
    return { library, batches };
  }

  it("forbids downloads and points the library at the checked files", async () => {
    putFiles();
    const { library } = fakeLibrary();
    await createEmbedder({ library, modelDir: dir, threads: 3, model: SPEC });
    expect(library.env).toEqual({
      allowRemoteModels: false,
      allowLocalModels: true,
      localModelPath: path.resolve(dir),
    });
    expect(library.pipeline).toHaveBeenCalledWith("feature-extraction", "Example/tiny-model", {
      dtype: "fp32",
      session_options: { intraOpNumThreads: 3, interOpNumThreads: 1 },
    });
  });

  it("does not load a model whose files are not the pinned ones", async () => {
    putFiles({ ...CONTENT, "onnx/model.onnx": "swapped" });
    const { library } = fakeLibrary();
    await expect(
      createEmbedder({ library, modelDir: dir, threads: 1, model: SPEC })
    ).rejects.toThrow("is not the pinned one");
    expect(library.pipeline).not.toHaveBeenCalled();
  });

  it("returns one vector per text, in the order of the texts", async () => {
    putFiles();
    const { library, batches } = fakeLibrary();
    const embedder = await createEmbedder({ library, modelDir: dir, threads: 1, model: SPEC });
    // 70 texts of mixed length, longest first
    const texts = Array.from({ length: 70 }, (_, i) => "x".repeat(((69 - i) * 7) % 41));
    const vectors = await embedder.embed(texts);

    expect(vectors).toHaveLength(70);
    vectors.forEach((vector, i) => {
      expect(vector).toHaveLength(VECTOR_SIZE);
      expect(vector[0]).toBe(texts[i]?.length);
    });
    // Batches of at most 32, and every batch holds texts of rising length.
    expect(batches.map((batch) => batch.length)).toEqual([32, 32, 6]);
    const lengths = batches.flat().map((text) => text.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  });

  it("puts fewer texts into a batch the longer they are", async () => {
    putFiles();
    const { library, batches } = fakeLibrary();
    const embedder = await createEmbedder({ library, modelDir: dir, threads: 1, model: SPEC });
    // 5 texts that the model cuts at 512 tokens, 40 short ones and 10 of 300 characters
    const texts = [
      ...Array.from({ length: 5 }, () => "z".repeat(1000)),
      ...Array.from({ length: 40 }, () => "x".repeat(10)),
      ...Array.from({ length: 10 }, () => "y".repeat(300)),
    ];
    const vectors = await embedder.embed(texts);

    vectors.forEach((vector, i) => expect(vector[0]).toBe(texts[i]?.length));
    expect(batches.map((batch) => batch.length)).toEqual([32, 8, 5, 5, 2, 2, 1]);
    // Texts x tokens x tokens of the longest text stays within 32 x 128 x 128.
    for (const batch of batches) {
      const tokens = Math.min(512, Math.max(...batch.map((text) => text.length)) + 2);
      expect(batch.length * tokens * tokens).toBeLessThanOrEqual(32 * 128 * 128);
    }
  });

  it("gives each caller its own copy of a vector", async () => {
    putFiles();
    const { library } = fakeLibrary();
    const embedder = await createEmbedder({ library, modelDir: dir, threads: 1, model: SPEC });
    const [first, second] = await embedder.embed(["ab", "ab"]);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("returns nothing for no texts", async () => {
    putFiles();
    const { library, batches } = fakeLibrary();
    const embedder = await createEmbedder({ library, modelDir: dir, threads: 1, model: SPEC });
    expect(await embedder.embed([])).toEqual([]);
    expect(batches).toEqual([]);
  });

  it("stops when the model answers with another shape", async () => {
    putFiles();
    const { library } = fakeLibrary([1, 768]);
    const embedder = await createEmbedder({ library, modelDir: dir, threads: 1, model: SPEC });
    await expect(embedder.embed(["one text"])).rejects.toThrow("unexpected shape: 1x768");
  });
});
