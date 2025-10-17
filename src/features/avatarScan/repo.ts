// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { db } from "../../db/connection.js";

export type AvatarScanRow = {
  application_id: string;
  avatar_url: string;
  nsfw_score: number | null;
  skin_edge_score: number | null;
  flagged: number;
  reason: string;
  scanned_at: string;
};

export function upsertScan(
  applicationId: string,
  data: {
    avatarUrl: string;
    nsfwScore: number | null;
    skinEdgeScore: number;
    flagged: boolean;
    reason: string;
  }
) {
  db.prepare(
    `
    INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, skin_edge_score, flagged, reason, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(application_id) DO UPDATE SET
      avatar_url = excluded.avatar_url,
      nsfw_score = excluded.nsfw_score,
      skin_edge_score = excluded.skin_edge_score,
      flagged = excluded.flagged,
      reason = excluded.reason,
      scanned_at = datetime('now')
  `
  ).run(
    applicationId,
    data.avatarUrl,
    data.nsfwScore,
    data.skinEdgeScore,
    data.flagged ? 1 : 0,
    data.reason
  );
}

export function getScan(applicationId: string): AvatarScanRow | undefined {
  return db
    .prepare(
      `
      SELECT application_id, avatar_url, nsfw_score, skin_edge_score, flagged, reason, scanned_at
      FROM avatar_scan
      WHERE application_id = ?
    `
    )
    .get(applicationId) as AvatarScanRow | undefined;
}
