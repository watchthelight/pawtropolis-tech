<script lang="ts" module>
  // Per-instance unique id seed so multiple charts on one page do not share
  // SVG filter/gradient ids. Increments once per component init during SSR.
  let __lineChartSeq = 0;
</script>

<script lang="ts">
  import { fmtInt, fmtDayShort } from "$lib/components/observatory/format";

  interface Props {
    points: { day: string; value: number | null }[];
    color?: string;
    height?: number;
    ariaLabel: string;
  }

  let {
    points,
    color = "var(--obs-violet)",
    height = 120,
    ariaLabel
  }: Props = $props();

  const uid = `lc${(__lineChartSeq = (__lineChartSeq + 1) % 1_000_000)}`;
  const glowId = `${uid}-glow`;

  const VBW = 1000;

  // Inset so glow + vertices are not clipped at the edges.
  const PAD_X = 18;
  const PAD_TOP = 14;
  const PAD_BOT = 14;

  type Pt = { x: number; y: number };

  function toPath(seg: Pt[]): string {
    return seg
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
  }

  // All geometry is computed once from props. The page sets csr=false, so this
  // component never hydrates and props never change; reading them inside this
  // function keeps the work non-reactive and out of the render hot path.
  function build(
    pts: Props["points"],
    h: number
  ) {
    const VBH = Math.max(40, Math.round(h));
    const plotW = VBW - PAD_X * 2;
    const plotH = VBH - PAD_TOP - PAD_BOT;

    const n = pts?.length ?? 0;
    const values = (pts ?? []).map((p) => p?.value);
    const finite = values.filter(
      (v): v is number => v != null && Number.isFinite(v)
    );
    const hasData = finite.length > 0;

    // Y domain with a touch of headroom; guard the zero-range case.
    const rawMin = hasData ? Math.min(...finite) : 0;
    const rawMax = hasData ? Math.max(...finite) : 1;
    const dataSpan = rawMax - rawMin;
    const headroom =
      dataSpan > 0 ? dataSpan * 0.12 : Math.max(Math.abs(rawMax), 1) * 0.12 || 1;
    const yMin = rawMin - headroom;
    const yRange = rawMax + headroom - yMin || 1;

    const xAt = (i: number) =>
      n <= 1 ? PAD_X + plotW / 2 : PAD_X + (i / (n - 1)) * plotW;
    const yAt = (v: number) => PAD_TOP + (1 - (v - yMin) / yRange) * plotH;

    // Break the line on nulls: one run of points per contiguous value stretch.
    const segments: Pt[][] = [];
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

    // A few faint horizontal gridlines across the plot band.
    const GRID_LINES = 3;
    const gridYs = Array.from(
      { length: GRID_LINES },
      (_, i) => PAD_TOP + (plotH * (i + 1)) / (GRID_LINES + 1)
    );

    let lastVal: number | null = null;
    for (let i = n - 1; i >= 0; i--) {
      const v = values[i];
      if (v != null && Number.isFinite(v)) {
        lastVal = v;
        break;
      }
    }

    return {
      VBH,
      hasData,
      segments,
      vertices: segments.flat(),
      gridYs,
      lastVal,
      firstDay: pts?.[0]?.day,
      lastDay: pts?.[n - 1]?.day
    };
  }

  // svelte-ignore state_referenced_locally
  const g = build(points, height);
</script>

<svg
  class="line-chart"
  viewBox={`0 0 ${VBW} ${g.VBH}`}
  preserveAspectRatio="none"
  role="img"
  aria-label={ariaLabel}
>
  <defs>
    <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>

  {#if g.hasData}
    <g class="grid">
      {#each g.gridYs as gy}
        <line
          x1={PAD_X}
          x2={VBW - PAD_X}
          y1={gy.toFixed(2)}
          y2={gy.toFixed(2)}
          vector-effect="non-scaling-stroke"
        />
      {/each}
    </g>

    <g class="line" style:--line-color={color}>
      <!-- soft luminous underlay -->
      <g class="glow" filter={`url(#${glowId})`}>
        {#each g.segments as seg}
          <path d={toPath(seg)} vector-effect="non-scaling-stroke" />
        {/each}
      </g>
      <!-- crisp stroke on top -->
      {#each g.segments as seg}
        <path
          class="stroke"
          d={toPath(seg)}
          vector-effect="non-scaling-stroke"
        />
      {/each}
      {#each g.vertices as v}
        <circle class="vertex" cx={v.x.toFixed(2)} cy={v.y.toFixed(2)} r="2.4" />
      {/each}
    </g>
  {:else}
    <text class="empty" x={VBW / 2} y={g.VBH / 2} text-anchor="middle">
      No data yet
    </text>
  {/if}
</svg>

{#if g.hasData && g.lastVal != null}
  <p class="sr-only">
    Latest value {fmtInt(g.lastVal)}{#if g.firstDay && g.lastDay}, from {fmtDayShort(g.firstDay)} to {fmtDayShort(g.lastDay)}{/if}.
  </p>
{/if}

<style>
  .line-chart {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  .grid line {
    stroke: var(--obs-grid);
    stroke-width: 1;
    stroke-dasharray: 2 6;
    opacity: 0.55;
  }

  .line {
    --c: var(--line-color, var(--obs-violet));
  }

  .glow path {
    fill: none;
    stroke: var(--c);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.5;
  }

  .stroke {
    fill: none;
    stroke: var(--c);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .vertex {
    fill: var(--obs-bg);
    stroke: var(--c);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .empty {
    fill: var(--obs-ink-mute);
    font-family: var(--obs-font-body);
    font-size: 13px;
    letter-spacing: 0.02em;
  }

  text {
    font-variant-numeric: tabular-nums;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
