/**
 * Pawtropolis Tech -- src/features/research/effortModel.ts
 * WHAT: Loads the trained effort model and applies it to one message.
 * WHY: The model is a ridge regression over 793 standardized inputs: the 24
 *      hand features, the cosine between the message's vector and its
 *      context's vector, the 384 numbers of the message's vector and the 384
 *      differences to the context's vector. It was trained on 2,774 messages
 *      that Claude Haiku 4.5 rated once, in April 2026, and explains 68% of
 *      the variance of those ratings on its test set. Nothing is trained here:
 *      the weights come from models/effort_v1.json and stay as they are.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readFileSync } from "node:fs";

export const HAND_FEATURE_COUNT = 24;
export const VECTOR_SIZE = 384;
const INPUT_COUNT = HAND_FEATURE_COUNT + 1 + VECTOR_SIZE + VECTOR_SIZE;

export interface EffortModel {
  version: string;
  means: number[];
  stds: number[];
  /** The bias first, then one weight per input. */
  weights: number[];
}

const isNumberList = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every((n) => Number.isFinite(n));

export function loadEffortModel(file: string): EffortModel {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const hand = raw.hand_features;
  if (
    typeof raw.version !== "string" ||
    !Array.isArray(hand) ||
    hand.length !== HAND_FEATURE_COUNT ||
    !isNumberList(raw.means, INPUT_COUNT) ||
    !isNumberList(raw.stds, INPUT_COUNT) ||
    !isNumberList(raw.weights, INPUT_COUNT + 1)
  ) {
    throw new Error(`${file} is not an effort model with ${INPUT_COUNT} inputs`);
  }
  return { version: raw.version, means: raw.means, stds: raw.stds, weights: raw.weights };
}

/**
 * The effort of one message, 0 to 1. `hand` comes from handFeatures(); the two
 * vectors are the normalized embeddings of the message and of its context.
 */
export function predictEffort(
  model: EffortModel,
  hand: number[],
  target: Float32Array,
  context: Float32Array
): number {
  const { means, stds, weights } = model;
  if (hand.length !== HAND_FEATURE_COUNT || target.length !== VECTOR_SIZE) {
    throw new Error("the effort model got inputs of the wrong size");
  }
  let cosine = 0;
  for (let i = 0; i < VECTOR_SIZE; i++) cosine += target[i]! * context[i]!;

  const input = (j: number): number => {
    if (j < HAND_FEATURE_COUNT) return hand[j]!;
    if (j === HAND_FEATURE_COUNT) return cosine;
    const i = j - HAND_FEATURE_COUNT - 1;
    return i < VECTOR_SIZE ? target[i]! : target[i - VECTOR_SIZE]! - context[i - VECTOR_SIZE]!;
  };

  // Summed in the order of the training script, so a score comes out the same to the last digit.
  let estimate = weights[0]!;
  for (let j = 0; j < INPUT_COUNT; j++) {
    estimate += weights[j + 1]! * ((input(j) - means[j]!) / stds[j]!);
  }
  return Math.max(0, Math.min(1, estimate));
}
