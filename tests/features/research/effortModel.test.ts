/**
 * Pawtropolis Tech -- tests/features/research/effortModel.test.ts
 * WHAT: Tests for loading the effort model and applying it.
 * WHY: A model file of the wrong shape must stop the job before it writes a
 *      score, and the arithmetic has to be the training script's.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HAND_FEATURE_COUNT,
  VECTOR_SIZE,
  loadEffortModel,
  predictEffort,
} from "../../../src/features/research/effortModel.js";
import { tinyModel } from "./helpers.js";

const INPUTS = HAND_FEATURE_COUNT + 1 + VECTOR_SIZE + VECTOR_SIZE;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-model-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeModel(change: Record<string, unknown>): string {
  const file = path.join(dir, "model.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: "test",
      hand_features: new Array(HAND_FEATURE_COUNT).fill("feature"),
      means: new Array(INPUTS).fill(0),
      stds: new Array(INPUTS).fill(1),
      weights: new Array(INPUTS + 1).fill(0),
      ...change,
    })
  );
  return file;
}

const unit = (index: number): Float32Array => {
  const vector = new Float32Array(VECTOR_SIZE);
  vector[index] = 1;
  return vector;
};
const hand = (change: Record<number, number> = {}): number[] => {
  const values = new Array<number>(HAND_FEATURE_COUNT).fill(0);
  for (const [index, value] of Object.entries(change)) values[Number(index)] = value;
  return values;
};

describe("loadEffortModel", () => {
  it("loads the model of the repo", () => {
    const model = loadEffortModel(path.join("models", "effort_v1.json"));
    expect(model.version).toBe("effort_v1");
    expect(model.means).toHaveLength(INPUTS);
    expect(model.stds).toHaveLength(INPUTS);
    expect(model.weights).toHaveLength(INPUTS + 1);
    // A zero here would divide by zero for every message.
    expect(model.stds.every((s) => s > 0)).toBe(true);
  });

  it("loads a file of the right shape", () => {
    expect(loadEffortModel(writeModel({})).version).toBe("test");
  });

  it.each([
    ["no version", { version: undefined }],
    ["another number of hand features", { hand_features: ["a", "b"] }],
    ["too few means", { means: [0, 0] }],
    ["too few stds", { stds: new Array(INPUTS - 1).fill(1) }],
    ["weights without the bias", { weights: new Array(INPUTS).fill(0) }],
    ["a mean that is not a number", { means: new Array(INPUTS).fill(null) }],
  ])("refuses a file with %s", (_name, change) => {
    expect(() => loadEffortModel(writeModel(change))).toThrow("is not an effort model");
  });
});

describe("predictEffort", () => {
  it("is the bias when every weight is zero", () => {
    const model = { ...tinyModel(), weights: [0.3, ...new Array<number>(INPUTS).fill(0)] };
    expect(predictEffort(model, hand(), unit(0), unit(1))).toBeCloseTo(0.3, 12);
  });

  it("uses the hand features and the cosine to the context", () => {
    const model = tinyModel();
    // 0.5, plus 0.25 for the question mark, minus 0.25 times the cosine
    expect(predictEffort(model, hand(), unit(0), unit(1))).toBeCloseTo(0.5, 12);
    expect(predictEffort(model, hand({ 13: 1 }), unit(0), unit(1))).toBeCloseTo(0.75, 12);
    expect(predictEffort(model, hand({ 13: 1 }), unit(0), unit(0))).toBeCloseTo(0.5, 12);
  });

  it("uses the vector and its difference to the context, standardized", () => {
    const model = tinyModel();
    model.weights = new Array<number>(INPUTS + 1).fill(0);
    const firstOfVector = HAND_FEATURE_COUNT + 1;
    const firstOfDifference = firstOfVector + VECTOR_SIZE;
    model.weights[1 + firstOfVector] = 0.5;
    model.weights[1 + firstOfDifference] = 0.25;
    model.means[firstOfVector] = 0.5;
    model.stds[firstOfVector] = 2;
    // vector[0] = 1 and context[0] = 0: 0.5 * (1 - 0.5) / 2 + 0.25 * (1 - 0) = 0.375
    expect(predictEffort(model, hand(), unit(0), unit(1))).toBeCloseTo(0.375, 12);
  });

  it("stays between 0 and 1", () => {
    const high = { ...tinyModel(), weights: [5, ...new Array<number>(INPUTS).fill(0)] };
    const low = { ...tinyModel(), weights: [-5, ...new Array<number>(INPUTS).fill(0)] };
    expect(predictEffort(high, hand(), unit(0), unit(1))).toBe(1);
    expect(predictEffort(low, hand(), unit(0), unit(1))).toBe(0);
  });

  it("refuses inputs of the wrong size", () => {
    expect(() => predictEffort(tinyModel(), [1, 2, 3], unit(0), unit(1))).toThrow("wrong size");
    expect(() => predictEffort(tinyModel(), hand(), new Float32Array(3), unit(1))).toThrow(
      "wrong size"
    );
  });
});
