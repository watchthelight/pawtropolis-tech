<script lang="ts">
  import { fmtInt, fmtDayShort } from "$lib/components/observatory/format";

  interface Props {
    data: { day: string; joins: number; leaves: number }[];
    height?: number;
    ariaLabel: string;
  }

  let { data, height = 160, ariaLabel }: Props = $props();

  const W = 1000;
  const H = Math.max(40, height);

  // Vertical room reserved top + bottom so luminous bars never clip the edge.
  const PAD_Y = 10;
  const MID = H / 2;
  // Usable half-height for either direction from the zero axis.
  const HALF = Math.max(1, MID - PAD_Y);

  const n = data?.length ?? 0;

  // Treat null/undefined/NaN counts as 0 for geometry, but remember whether any
  // real (non-null) datum exists so we can show a "no data" note instead.
  const safe = (v: number | null | undefined): number =>
    v == null || Number.isNaN(v) ? 0 : Math.max(0, v);

  const hasData =
    n > 0 &&
    data.some(
      (d) =>
        (d?.joins != null && !Number.isNaN(d.joins)) ||
        (d?.leaves != null && !Number.isNaN(d.leaves)),
    );

  // Scale to the largest magnitude in either direction; never divide by zero.
  const peak = data.reduce((m, d) => {
    return Math.max(m, safe(d?.joins), safe(d?.leaves));
  }, 0);
  const scale = peak > 0 ? HALF / peak : 0;

  // Column geometry. One column per day with thin 1-unit gaps between them.
  const GAP = n > 1 ? 1 : 0;
  const colW = n > 0 ? (W - GAP * (n - 1)) / n : W;
  // Cap the rendered bar so a single point reads as a bar, not a slab.
  const barW = Math.min(colW, 48);
  const radius = Math.min(barW / 2, 3);

  type Col = {
    x: number;
    joins: number;
    leaves: number;
    upH: number;
    downH: number;
  };

  const cols: Col[] = data.map((d, i) => {
    const colX = i * (colW + GAP);
    const x = colX + (colW - barW) / 2;
    const joins = safe(d?.joins);
    const leaves = safe(d?.leaves);
    return {
      x,
      joins,
      leaves,
      upH: joins * scale,
      downH: leaves * scale,
    };
  });

  const totalJoins = cols.reduce((s, c) => s + c.joins, 0);
  const totalLeaves = cols.reduce((s, c) => s + c.leaves, 0);

  const first = n > 0 ? fmtDayShort(data[0].day) : "";
  const last = n > 0 ? fmtDayShort(data[n - 1].day) : "";
</script>

<figure class="diverging">
  {#if hasData}
    <svg
      viewBox="0 0 {W} {H}"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <defs>
        <filter id="db-up-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g class="bars">
        {#each cols as c}
          {#if c.upH > 0}
            <rect
              class="up"
              x={c.x}
              y={MID - c.upH}
              width={barW}
              height={c.upH}
              rx={radius}
            />
          {/if}
          {#if c.downH > 0}
            <rect
              class="down"
              x={c.x}
              y={MID}
              width={barW}
              height={c.downH}
              rx={radius}
            />
          {/if}
        {/each}
      </g>

      <!-- Zero axis: a luminous gold hairline the bars diverge from. -->
      <line
        class="axis"
        x1="0"
        y1={MID}
        x2={W}
        y2={MID}
        vector-effect="non-scaling-stroke"
      />
    </svg>

    <figcaption class="legend">
      <span class="key">
        <span class="swatch up"></span>
        <span class="lbl">joins</span>
        <span class="val">{fmtInt(totalJoins)}</span>
      </span>
      <span class="range">{first}{#if last !== first}&nbsp;&ndash;&nbsp;{last}{/if}</span>
      <span class="key">
        <span class="val">{fmtInt(totalLeaves)}</span>
        <span class="lbl">leaves</span>
        <span class="swatch down"></span>
      </span>
    </figcaption>
  {:else}
    <p class="empty">No data yet</p>
  {/if}
</figure>

<style>
  .diverging {
    margin: 0;
    width: 100%;
  }

  svg {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }

  .bars {
    filter: url(#db-up-glow);
  }

  rect.up {
    fill: var(--obs-cyan);
    opacity: 0.92;
  }

  rect.down {
    fill: var(--obs-rose);
    opacity: 0.92;
  }

  .axis {
    stroke: var(--obs-gold);
    stroke-width: 1;
    opacity: 0.85;
  }

  .legend {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.6rem;
    font-family: var(--obs-font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    color: var(--obs-ink-dim);
  }

  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .swatch {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 2px;
    flex: none;
  }

  .swatch.up {
    background: var(--obs-cyan);
    box-shadow: 0 0 6px var(--obs-glow-cyan);
  }

  .swatch.down {
    background: var(--obs-rose);
  }

  .lbl {
    color: var(--obs-ink-mute);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.66rem;
  }

  .val {
    color: var(--obs-ink);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .range {
    color: var(--obs-ink-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
    padding: calc(var(--obs-r-md, 8px) * 1.5) 0;
    text-align: center;
    font-family: var(--obs-font-mono);
    font-size: 0.78rem;
    color: var(--obs-ink-faint);
  }
</style>
