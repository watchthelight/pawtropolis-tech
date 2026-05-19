#!/usr/bin/env node
/**
 * Standalone test for canPerformReviewAction. No vitest dependency.
 * Run: node web/scripts/test-review-gate.mjs
 */

import assert from "node:assert/strict";
import { canPerformReviewAction } from "../src/lib/server/reviewGate.ts";

const GK = "896070888762535969";
const OTHER = "987662057069482024";

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.equal(actual, expected, name);
    pass++;
  } catch (e) {
    fail++;
    console.error(`FAIL: ${name}\n  expected ${expected}, got ${actual}`);
  }
}

// Owner bypass
check("owner can claim without GK role", canPerformReviewAction("owner", [OTHER], "claim"), true);
check(
  "owner can permreject without admin tier explicit",
  canPerformReviewAction("owner", [OTHER], "permreject"),
  true
);
check("owner can unclaim", canPerformReviewAction("owner", [OTHER], "unclaim"), true);

// Actual gatekeeper role -> allowed for non-admin actions
check("GK role can claim", canPerformReviewAction("gk", [GK], "claim"), true);
check("GK role can approve", canPerformReviewAction("gk", [GK], "approve"), true);
check("GK role can reject", canPerformReviewAction("gk", [GK], "reject"), true);
check("GK role can kick", canPerformReviewAction("gk", [GK], "kick"), true);
check("GK role can wrong_password", canPerformReviewAction("gk", [GK], "wrong_password"), true);
check("GK role can vote_out", canPerformReviewAction("gk", [GK], "vote_out"), true);
check("GK role can unclaim", canPerformReviewAction("gk", [GK], "unclaim"), true);
check("GK role CANNOT permreject", canPerformReviewAction("gk", [GK], "permreject"), false);

// REGRESSION: higher tier without GK role MUST NOT act
check(
  "REGRESSION: Junior Mod without GK cannot claim",
  canPerformReviewAction("jm", [OTHER], "claim"),
  false
);
check(
  "REGRESSION: Junior Mod without GK cannot approve",
  canPerformReviewAction("jm", [OTHER], "approve"),
  false
);
check(
  "REGRESSION: Junior Mod without GK cannot reject",
  canPerformReviewAction("jm", [OTHER], "reject"),
  false
);
check(
  "REGRESSION: Junior Mod without GK cannot kick",
  canPerformReviewAction("jm", [OTHER], "kick"),
  false
);
check(
  "REGRESSION: Junior Mod without GK cannot wrong_password",
  canPerformReviewAction("jm", [OTHER], "wrong_password"),
  false
);
check(
  "REGRESSION: Junior Mod without GK cannot vote_out",
  canPerformReviewAction("jm", [OTHER], "vote_out"),
  false
);
check(
  "REGRESSION: Moderator without GK cannot claim",
  canPerformReviewAction("mod", [OTHER], "claim"),
  false
);
check(
  "REGRESSION: Senior Mod without GK cannot reject",
  canPerformReviewAction("sm", [OTHER], "reject"),
  false
);

// Junior Mod / Mod WITH GK role acts normally
check("Junior Mod with GK can claim", canPerformReviewAction("jm", [OTHER, GK], "claim"), true);
check("Junior Mod with GK can approve", canPerformReviewAction("jm", [OTHER, GK], "approve"), true);

// Unclaim: admin override (admin tier without GK role) works
check(
  "Admin without GK can unclaim (override)",
  canPerformReviewAction("admin", [OTHER], "unclaim"),
  true
);
check(
  "Senior Admin without GK can unclaim",
  canPerformReviewAction("sa", [OTHER], "unclaim"),
  true
);
check(
  "Junior Mod without GK CANNOT unclaim",
  canPerformReviewAction("jm", [OTHER], "unclaim"),
  false
);

// permreject: admin tier required, GK role not sufficient on its own
check(
  "Admin without GK can permreject",
  canPerformReviewAction("admin", [OTHER], "permreject"),
  true
);
check("Senior Admin can permreject", canPerformReviewAction("sa", [OTHER], "permreject"), true);
check("Senior Mod CANNOT permreject", canPerformReviewAction("sm", [GK], "permreject"), false);
check(
  "GK without admin tier CANNOT permreject",
  canPerformReviewAction("gk", [GK], "permreject"),
  false
);

// 'viewer' tier (Mod Team, Ambassador, Artist) can do nothing
check("Viewer cannot claim", canPerformReviewAction("viewer", [OTHER], "claim"), false);
check(
  "Viewer with GK role can claim (role wins)",
  canPerformReviewAction("viewer", [OTHER, GK], "claim"),
  true
);

// 'none' tier blocked everywhere
check("none tier cannot do anything", canPerformReviewAction("none", [], "claim"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
