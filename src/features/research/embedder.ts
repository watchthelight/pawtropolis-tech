/**
 * Pawtropolis Tech -- src/features/research/embedder.ts
 * WHAT: Turns texts into 384-number sentence vectors with all-MiniLM-L6-v2,
 *       on the machine's own CPU. Also fetches and checks the model files.
 * WHY: The effort score and the novelty measure need a vector for every
 *      message and for its context. No text leaves the machine for that.
 *
 *      The library (@huggingface/transformers, with the ONNX runtime about
 *      470 MB) is not a dependency of the bot. It is installed in research/,
 *      which has its own package.json and lockfile, and loaded from there at
 *      run time, so the bot's install and audit stay as they are.
 *
 *      The model files are pinned: one revision of the model repository and
 *      the SHA-256 of each file. They are checked on every load, and the
 *      library is told never to download anything by itself. The removed
 *      pipeline fetched whatever the hub served that day (#00089).
 *
 *      The full-precision model is used on purpose. Measured on 2026-11-15:
 *      the 8-bit model gives one and the same text a different vector
 *      depending on the other texts in its batch (cosine down to 0.91),
 *      because it picks its number ranges per batch. The full model gives the
 *      same vector in any batch, so texts can be sorted by length, which
 *      doubles the speed, and a score depends on the message alone.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { VECTOR_SIZE } from "./effortModel.js";

/** A model on the hub, pinned to one revision and to the hash of each file. */
export interface ModelSpec {
  name: string;
  revision: string;
  dtype: string;
  /** File name in the model repository, and the SHA-256 of its content. */
  files: Readonly<Record<string, string>>;
}

export const EMBEDDING_MODEL: ModelSpec = {
  name: "Xenova/all-MiniLM-L6-v2",
  revision: "751bff37182d3f1213fa05d7196b954e230abad9",
  dtype: "fp32",
  files: {
    "config.json": "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
    "tokenizer.json": "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    "tokenizer_config.json": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
    "onnx/model.onnx": "759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e",
  },
};

/** Stored with the scores, so that one file never mixes two models. */
export const EMBEDDING_ID = `${EMBEDDING_MODEL.name}@${EMBEDDING_MODEL.revision.slice(0, 12)}/${EMBEDDING_MODEL.dtype}`;

const BATCH_SIZE = 32;

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
const modelFile = (modelDir: string, model: ModelSpec, name: string): string =>
  path.join(modelDir, ...model.name.split("/"), ...name.split("/"));

/** Throws unless every model file is there and is the pinned one. */
export function verifyModelFiles(modelDir: string, model: ModelSpec = EMBEDDING_MODEL): void {
  for (const [name, expected] of Object.entries(model.files)) {
    const file = modelFile(modelDir, model, name);
    let actual: string;
    try {
      actual = sha256(readFileSync(file));
    } catch {
      throw new Error(`model file missing: ${file} (run the research script with fetch-model)`);
    }
    if (actual !== expected) throw new Error(`model file is not the pinned one: ${file}`);
  }
}

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Downloads the pinned files that are missing or wrong. A file is checked
 * before it is put in place, so a broken download never becomes the model.
 * Returns the names of the files it fetched.
 */
export async function fetchModelFiles(
  modelDir: string,
  fetchFile: FetchLike,
  model: ModelSpec = EMBEDDING_MODEL
): Promise<string[]> {
  const fetched: string[] = [];
  for (const [name, expected] of Object.entries(model.files)) {
    const file = modelFile(modelDir, model, name);
    try {
      if (sha256(readFileSync(file)) === expected) continue;
    } catch {
      // not there yet
    }
    const url = `https://huggingface.co/${model.name}/resolve/${model.revision}/${name}`;
    const response = await fetchFile(url);
    if (!response.ok) throw new Error(`download of ${name} failed with status ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (sha256(data) !== expected) throw new Error(`download of ${name} is not the pinned file`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.part`, data);
    renameSync(`${file}.part`, file);
    fetched.push(name);
  }
  return fetched;
}

/** The part of @huggingface/transformers that is used here. */
export interface TransformersLibrary {
  env: { allowRemoteModels: boolean; allowLocalModels: boolean; localModelPath: string };
  pipeline(
    task: "feature-extraction",
    model: string,
    options: { dtype: string; session_options: Record<string, number> }
  ): Promise<
    (
      texts: string[],
      options: { pooling: "mean"; normalize: boolean }
    ) => Promise<{ data: Float32Array; dims: number[] }>
  >;
}

/** Loads the library from the folder that holds research/package.json. */
export function loadTransformers(packageDir: string): TransformersLibrary {
  const requireFrom = createRequire(path.join(path.resolve(packageDir), "package.json"));
  try {
    return requireFrom("@huggingface/transformers") as TransformersLibrary;
  } catch (err) {
    throw new Error(
      `@huggingface/transformers is not installed in ${packageDir} (npm ci --ignore-scripts there): ${String(err)}`,
      { cause: err }
    );
  }
}

export interface Embedder {
  /** One normalized vector per text, in the order of the texts. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export async function createEmbedder(options: {
  library: TransformersLibrary;
  modelDir: string;
  threads: number;
  model?: ModelSpec;
}): Promise<Embedder> {
  const { library, modelDir, threads, model = EMBEDDING_MODEL } = options;
  verifyModelFiles(modelDir, model);
  library.env.allowRemoteModels = false;
  library.env.allowLocalModels = true;
  library.env.localModelPath = path.resolve(modelDir);
  const extract = await library.pipeline("feature-extraction", model.name, {
    dtype: model.dtype,
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });

  return {
    async embed(texts) {
      // A batch is padded to its longest text, so texts of similar length go together.
      const order = texts
        .map((text, index) => ({ text, index }))
        .sort((a, b) => a.text.length - b.text.length);
      const vectors = new Array<Float32Array>(texts.length);
      for (let start = 0; start < order.length; start += BATCH_SIZE) {
        const batch = order.slice(start, start + BATCH_SIZE);
        const { data, dims } = await extract(
          batch.map((entry) => entry.text),
          { pooling: "mean", normalize: true }
        );
        if (dims[0] !== batch.length || dims[1] !== VECTOR_SIZE) {
          throw new Error(`the embedding model returned an unexpected shape: ${dims.join("x")}`);
        }
        batch.forEach((entry, k) => {
          vectors[entry.index] = data.slice(k * VECTOR_SIZE, (k + 1) * VECTOR_SIZE);
        });
      }
      return vectors;
    },
  };
}
