<!-- SPDX-License-Identifier: LicenseRef-ANW-1.0 -->
<script lang="ts">
  /**
   * Pure-CSS hour-by-day activity heatmap (7 rows x 24 cols). Server-rendered,
   * zero client JS: all geometry is computed from props at render time. Cell
   * tint is a color-mix between --obs-heat-lo and --obs-heat-hi; the brightest
   * hours flare with --obs-glow-gold so peaks read like stars on the chart.
   */
  interface Props {
    grid: number[][];
    max: number;
    dowLabels: string[];
    ariaLabel: string;
  }

  let { grid, max, dowLabels, ariaLabel }: Props = $props();

  // Hours that carry a printed label; the rest stay blank to keep the axis calm.
  const HOUR_TICKS = new Set([0, 6, 12, 18, 23]);
  const HOURS = Array.from({ length: 24 }, (_, h) => h);

  // A safe positive denominator. Never divide by zero / negative; max<=0 means
  // every cell is dark (the empty / no-activity state).
  const denom = max > 0 ? max : 0;
  // 0.82 of the peak flares like a bright star. Guard so max=0 never lights up.
  const peakFloor = denom > 0 ? denom * 0.82 : Infinity;

  interface Cell {
    /** color-mix percentage toward heat-hi, integer 0..100. */
    pct: number;
    /** true once a cell reaches the flare threshold. */
    peak: boolean;
  }

  // 7x24 grid of render-ready cells. Rows/values are clamped and null-guarded so
  // a ragged, short, or all-null input still yields finite, in-range numbers.
  const cells: Cell[][] = Array.from({ length: 7 }, (_, r) => {
    const row = Array.isArray(grid?.[r]) ? grid[r] : [];
    return HOURS.map((h) => {
      const raw = row[h];
      const v = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
      const ratio = denom > 0 ? v / denom : 0;
      const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      return { pct, peak: v >= peakFloor };
    });
  });

  // Day labels: trust the prop, fall back to a sane Mon..Sun set if short.
  const FALLBACK_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = Array.from({ length: 7 }, (_, r) => dowLabels?.[r] ?? FALLBACK_DOW[r]);

  // Is there anything to show at all? (max>0 implies at least one positive cell.)
  const hasData = denom > 0;

  // Accessible summary: the visual grid is aria-hidden, so describe where the
  // peak falls for screen-reader users in the figure's label.
  let peakR = 0;
  let peakH = 0;
  let peakV = 0;
  for (let r = 0; r < 7; r++) {
    const row = Array.isArray(grid?.[r]) ? grid[r] : [];
    for (let h = 0; h < 24; h++) {
      const raw = row[h];
      const v = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      if (v > peakV) {
        peakV = v;
        peakR = r;
        peakH = h;
      }
    }
  }
  const summary = hasData
    ? `${ariaLabel}. Busiest around ${String(peakH).padStart(2, "0")}:00 UTC on ${days[peakR]}. Brighter cells are busier hours.`
    : ariaLabel;
</script>

<figure class="heat" role="img" aria-label={summary}>
  {#if hasData}
    <div class="heat-grid" aria-hidden="true">
      <!-- Header row: empty corner + 24 hour slots (only ticks are labelled). -->
      <span class="corner"></span>
      {#each HOURS as h (h)}
        <span class="hcol" class:tick={HOUR_TICKS.has(h)}>
          {#if HOUR_TICKS.has(h)}{h}{/if}
        </span>
      {/each}

      <!-- One row per day: label cell + 24 heat cells. -->
      {#each cells as row, r (r)}
        <span class="daylab">{days[r]}</span>
        {#each row as cell, h (h)}
          <span
            class="cell"
            class:peak={cell.peak}
            style="--p:{cell.pct}%"
          ></span>
        {/each}
      {/each}
    </div>

    <figcaption class="legend">
      <span class="leg-label">Less</span>
      <span class="leg-bar"></span>
      <span class="leg-label">More</span>
      <span class="leg-utc">all times UTC</span>
    </figcaption>
  {:else}
    <p class="empty">No data yet</p>
  {/if}
</figure>

<style>
  .heat {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Label column auto-sizes; the 24 hour columns share the remaining width
     equally. 2px gaps let the void show between cells like gaps between stars. */
  .heat-grid {
    display: grid;
    grid-template-columns: auto repeat(24, minmax(0, 1fr));
    gap: 2px;
    align-items: center;
  }

  /* .corner is the intentionally-empty header cell above the day labels. */

  .hcol {
    font-family: var(--obs-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.62rem;
    color: var(--obs-ink-mute);
    text-align: center;
    line-height: 1;
    padding-bottom: 0.3rem;
    min-width: 0;
  }
  .hcol.tick {
    color: var(--obs-ink-dim);
  }

  .daylab {
    font-family: var(--obs-font-mono);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--obs-ink-mute);
    text-align: right;
    padding-right: 0.55rem;
    white-space: nowrap;
  }

  /* Each cell is a square tile. The dark floor is a faint heat-lo wash so empty
     hours still read as part of the chart, not as holes. The tint rides on top
     via color-mix; --p is set per cell in the markup. */
  .cell {
    aspect-ratio: 1 / 1;
    min-width: 0;
    border-radius: var(--obs-r-sm);
    background: color-mix(in oklab, var(--obs-heat-lo) 22%, var(--obs-void));
    box-shadow: inset 0 0 0 1px var(--obs-border);
  }
  /* color-mix is broadly supported; this overrides the floor where available. */
  @supports (background: color-mix(in oklab, red, blue 50%)) {
    .cell {
      background: color-mix(in oklab, var(--obs-heat-lo), var(--obs-heat-hi) var(--p));
    }
  }

  /* Brightest hours flare. Glow + a hairline gold ring so peaks pop on the
     night sky. Disabled glow inherits from the page's prefers-contrast block. */
  .cell.peak {
    box-shadow:
      var(--obs-glow-gold),
      inset 0 0 0 1px color-mix(in oklab, var(--obs-gold), transparent 35%);
  }

  /* Legend: a gradient swatch from heat-lo to heat-hi between Less .. More,
     with the UTC note pushed to the trailing edge. */
  .legend {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.72rem;
    color: var(--obs-ink-mute);
  }
  .leg-label {
    font-family: var(--obs-font-mono);
    letter-spacing: 0.04em;
  }
  .leg-bar {
    width: clamp(80px, 18vw, 160px);
    height: 8px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--obs-heat-lo), var(--obs-heat-hi));
    box-shadow: inset 0 0 0 1px var(--obs-border);
  }
  .leg-utc {
    margin-left: auto;
    font-family: var(--obs-font-mono);
    letter-spacing: 0.06em;
    color: var(--obs-ink-faint);
  }

  .empty {
    margin: 0;
    padding: 1.25rem 0;
    font-family: var(--obs-font-mono);
    font-size: 0.8rem;
    color: var(--obs-ink-mute);
    text-align: center;
  }
</style>
