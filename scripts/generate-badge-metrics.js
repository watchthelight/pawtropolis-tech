/**
 * Generate badge metrics for Shields.io dynamic badges
 *
 * This script generates badge-data.json with metrics that can be
 * uploaded to a GitHub Gist for use with Shields.io endpoint badges.
 *
 * Run: node scripts/generate-badge-metrics.js
 * Output: badge-data.json (multiple JSON files for each badge)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

/**
 * Count total commands from the local command spec.
 *
 * This used to shell out to `npm run print:cmds`, which needs a live Discord
 * login. In CI that always failed and the hardcoded fallback published a wrong
 * count, so read the offline spec and fail loudly instead.
 */
function countCommands() {
  const output = execSync("npx tsx scripts/print-command-count.ts", {
    cwd: rootDir,
    encoding: "utf-8",
  });

  const match = output.match(/COMMAND_COUNT=(\d+)/);
  if (!match) {
    console.error("scripts/print-command-count.ts printed no COMMAND_COUNT line. Output:");
    console.error(output);
    process.exit(1);
  }
  return Number(match[1]);
}

/**
 * Count lines of code in src/ directory
 */
function countLinesOfCode() {
  let totalLines = 0;

  function countInDir(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          countInDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n").filter((line) => {
              const trimmed = line.trim();
              // Count non-empty, non-comment lines
              return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
            });
            totalLines += lines.length;
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  countInDir(join(rootDir, "src"));
  return totalLines;
}

/**
 * Count test files and parse coverage
 */
function getTestMetrics() {
  let testCount = 0;
  let coverage = 0;

  // Count test files
  function countTests(dir) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          countTests(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
          testCount++;
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  countTests(join(rootDir, "tests"));

  // Parse coverage summary. A missing or unreadable summary means the test
  // run never completed, and publishing 0% would be a lie, so stop instead.
  const coveragePath = join(rootDir, "coverage/coverage-summary.json");
  let coverageData;
  try {
    coverageData = JSON.parse(readFileSync(coveragePath, "utf-8"));
  } catch (err) {
    console.error(`Cannot read ${coveragePath}: ${err.message}`);
    console.error("Run `npm run test -- --coverage` before generating badges.");
    process.exit(1);
  }
  if (!coverageData.total || !coverageData.total.lines) {
    console.error(`${coveragePath} has no total.lines section.`);
    process.exit(1);
  }
  coverage = Math.round(coverageData.total.lines.pct);

  return { testCount, coverage };
}

/**
 * Get version from package.json
 */
function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Format number with K/M suffix
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  return num.toString();
}

/**
 * Get color based on coverage percentage
 */
function getCoverageColor(pct) {
  if (pct >= 80) return "brightgreen";
  if (pct >= 60) return "green";
  if (pct >= 40) return "yellow";
  if (pct >= 20) return "orange";
  return "red";
}

// Generate metrics
console.log("Generating badge metrics...\n");

const commandCount = countCommands();
const loc = countLinesOfCode();
const { testCount, coverage } = getTestMetrics();
const version = getVersion();

console.log(`Commands: ${commandCount}`);
console.log(`Lines of Code: ${formatNumber(loc)}`);
console.log(`Test Files: ${testCount}`);
console.log(`Coverage: ${coverage}%`);
console.log(`Version: ${version}`);

// Generate individual badge JSON files for Shields.io endpoint format
const badges = {
  commands: {
    schemaVersion: 1,
    label: "commands",
    message: commandCount.toString(),
    color: "5865F2",
    namedLogo: "discord",
  },
  loc: {
    schemaVersion: 1,
    label: "lines of code",
    message: formatNumber(loc),
    color: "brightgreen",
  },
  tests: {
    schemaVersion: 1,
    label: "tests",
    message: `${testCount} files`,
    color: "success",
  },
  coverage: {
    schemaVersion: 1,
    label: "coverage",
    message: `${coverage}%`,
    color: getCoverageColor(coverage),
  },
  version: {
    schemaVersion: 1,
    label: "version",
    message: `v${version}`,
    color: "blue",
  },
};

// Write individual JSON files to .github/badges/
const badgesDir = join(rootDir, ".github/badges");
if (!existsSync(badgesDir)) {
  mkdirSync(badgesDir, { recursive: true });
}

for (const [name, data] of Object.entries(badges)) {
  writeFileSync(join(badgesDir, `badge-${name}.json`), JSON.stringify(data, null, 2));
  console.log(`\nWrote .github/badges/badge-${name}.json`);
}

console.log("\nDone! Badge files updated in .github/badges/");
