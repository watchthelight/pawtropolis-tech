<script lang="ts">
  // SPDX-License-Identifier: LicenseRef-ANW-1.0
  import { fmtDayShort } from "$lib/components/observatory/format";

  interface Props {
    points: { day: string; value: number | null }[];
    color?: string;
    height?: number;
    glow?: boolean;
    ariaLabel: string;
  }

  let {
    points,
    color = "var(--obs-cyan)",
    height = 160,
    glow = true,
    ariaLabel,
  }: Props = $props();

  // Fixed user-space width; the svg scales to 100% via CSS.
  const W = 1000;

  // Inner padding so strokes/glow are not clipped at the edges.
  const PAD_X = 8;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 10;

  // Deterministic id from the (page-unique) aria-label so the server-rendered
  // HTML is byte-stable and hard-cacheable. No randomness.
  const fillId = `area-fill-${ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

  const H = Math.max(40, Math.round(height));
  const plotTop = PAD_TOP;
  const plotBottom = H - PAD_BOTTOM;
  const plotH = Math.max(1, plotBottom - plotTop);
  const baseline = plotBottom;

  const n = points.length;
  const values = points.map((p) => p.value);
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  const hasData = finite.length > 0;

  // Y domain from non-null values, with gentle headroom. Guard a flat series
  // (single point or all-equal) so we never divide by zero.
  let lo = hasData ? Math.min(...finite) : 0;
  let hi = hasData ? Math.max(...finite) : 1;
  if (lo === hi) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1;
    lo -= pad;
    hi += pad;
  } else {
    hi += (hi - lo) * 0.12; // headroom on top only; keep baseline honest
  }
  const span = hi - lo || 1;

  // Even X spacing. With a single point we center it so the dot reads clearly.
  function xAt(i: number): number {
    const inner = W - PAD_X * 2;
    if (n <= 1) return PAD_X + inner / 2;
    return PAD_X + (inner * i) / (n - 1);
  }
  function yAt(v: number): number {
    const t = (v - lo) / span;
    return plotBottom - t * plotH;
  }

  type Pt = { x: number; y: number };

  // Split into contiguous runs of non-null values, breaking the path on gaps.
  const segments: Pt[][] = [];
  {
    let run: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v != null && Number.isFinite(v)) {
        run.push({ x: xAt(i), y: yAt(v) });
      } else if (run.length) {
        segments.push(run);
        run = [];
      }
    }
    if (run.length) segments.push(run);
  }

  // Honest straight segments between points.
  function linePath(pts: Pt[]): string {
    if (!pts.length) return "";
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    }
    return d;
  }
  function areaPath(pts: Pt[]): string {
    if (!pts.length) return "";
    const first = pts[0];
    const last = pts[pts.length - 1];
    return (
      `${linePath(pts)}` +
      ` L ${last.x.toFixed(2)} ${baseline.toFixed(2)}` +
      ` L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`
    );
  }

  // Three faint horizontal grid rules across the plot band.
  const gridYs = [0, 0.5, 1].map((t) => plotTop + plotH * t);

  // Lone-point markers (a single-sample run can't draw a line).
  const dots = segments.filter((s) => s.length === 1).map((s) => s[0]);

  const firstDay = n ? points[0].day : "";
  const lastDay = n ? points[n - 1].day : "";
</script>

<div class="area" style="--area-color:{color}">
  {#if hasData}
    <svg
      class="chart"
      class:glow
      viewBox="0 0 {W} {H}"
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.28" />
          <stop offset="100%" stop-color={color} stop-opacity="0" />
        </linearGradient>
      </defs>

      {#each gridYs as gy}
        <line
          class="grid"
          x1={PAD_X}
          y1={gy.toFixed(2)}
          x2={W - PAD_X}
          y2={gy.toFixed(2)}
          vector-effect="non-scaling-stroke"
        />
      {/each}

      {#each segments as seg}
        {#if seg.length > 1}
          <path class="fill" d={areaPath(seg)} fill="url(#{fillId})" />
        {/if}
      {/each}

      {#each segments as seg}
        {#if seg.length > 1}
          <path
            class="line"
            d={linePath(seg)}
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/each}

      {#each dots as d}
        <circle class="dot" cx={d.x.toFixed(2)} cy={d.y.toFixed(2)} r="3" />
      {/each}
    </svg>

    <div class="axis" aria-hidden="true">
      <span class="day">{fmtDayShort(firstDay)}</span>
      <span class="day">{fmtDayShort(lastDay)}</span>
    </div>
  {:else}
    <p class="empty">No data yet</p>
  {/if}
</div>

<style>
  .area {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .chart {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  .grid {
    stroke: var(--obs-grid);
    stroke-width: 1;
  }

  .fill {
    stroke: none;
  }

  .line {
    fill: none;
    stroke: var(--area-color);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .dot {
    fill: var(--area-color);
  }

  /* Soft luminous glow on the value line; CSS-only, no JS. */
  .chart.glow .line {
    filter: drop-shadow(0 0 4px var(--area-color));
  }
  .chart.glow .dot {
    filter: drop-shadow(0 0 3px var(--area-color));
  }

  .axis {
    display: flex;
    justify-content: space-between;
    font-family: var(--obs-font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    color: var(--obs-ink-faint);
  }

  .day {
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: 0.75rem 0;
    font-family: var(--obs-font-mono);
    font-size: 0.78rem;
    letter-spacing: 0.03em;
    color: var(--obs-ink-mute);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .chart.glow .line,
    .chart.glow .dot {
      /* keep the static glow; nothing animates here, but stay explicit */
      filter: drop-shadow(0 0 4px var(--area-color));
    }
  }

</style>
