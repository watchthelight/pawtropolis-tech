<script lang="ts">
  import { fmtInt } from "$lib/components/observatory/format";

  interface Props {
    segments: { label: string; value: number; color: string }[];
    centerLabel?: string;
    centerValue?: string;
    ariaLabel: string;
  }

  let { segments, centerLabel, centerValue, ariaLabel }: Props = $props();

  // Geometry: a square 1000x1000 viewBox. The donut is a single circle whose
  // stroke we slice with dasharray; thickness is the stroke width.
  const CX = 500;
  const CY = 500;
  const R = 360;
  const STROKE = 132;
  const C = 2 * Math.PI * R;

  // Keep only renderable slices: finite, strictly positive values. This drops
  // null/NaN/negative/zero so no slice ever contributes a NaN arc length.
  const clean = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = clean.reduce((sum, s) => sum + s.value, 0);
  const hasData = total > 0;

  // Build slices with cumulative offsets. Offset is negated so arcs march
  // clockwise; the whole ring is rotated -90deg in CSS to start at 12 o'clock.
  type Slice = {
    label: string;
    color: string;
    value: number;
    pct: number;
    dash: number;
    offset: number;
  };

  let acc = 0;
  const slices: Slice[] = hasData
    ? clean.map((s) => {
        const frac = s.value / total;
        const dash = frac * C;
        const offset = -acc;
        acc += dash;
        return {
          label: s.label,
          color: s.color,
          value: s.value,
          pct: Math.round(frac * 100),
          dash,
          offset,
        };
      })
    : [];
</script>

<figure class="donut" role="img" aria-label={ariaLabel}>
  <div class="plot">
    <svg viewBox="0 0 1000 1000" class="ring" aria-hidden="true">
      <defs>
        <filter id="donut-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="9" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Track ring: always present, even with no data. -->
      <circle
        class="track"
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke="var(--obs-surface-2)"
        stroke-width={STROKE}
        vector-effect="non-scaling-stroke"
      />

      {#if hasData}
        <g class="slices" filter="url(#donut-glow)">
          {#each slices as s, i (i)}
            <circle
              class="slice"
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={s.color}
              stroke-width={STROKE}
              stroke-dasharray={`${s.dash} ${C - s.dash}`}
              stroke-dashoffset={s.offset}
              stroke-linecap="butt"
              vector-effect="non-scaling-stroke"
            />
          {/each}
        </g>
      {/if}
    </svg>

    <div class="center">
      {#if hasData}
        {#if centerValue}
          <span class="value">{centerValue}</span>
        {/if}
        {#if centerLabel}
          <span class="label">{centerLabel}</span>
        {/if}
      {:else}
        <span class="empty">No decisions yet</span>
      {/if}
    </div>
  </div>

  {#if hasData}
    <ul class="legend">
      {#each slices as s, i (i)}
        <li class="row">
          <span class="swatch" style={`background:${s.color}`} aria-hidden="true"
          ></span>
          <span class="name">{s.label}</span>
          <span class="num">{fmtInt(s.value)}</span>
          <span class="pct">{s.pct}%</span>
        </li>
      {/each}
    </ul>
  {/if}
</figure>

<style>
  .donut {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: clamp(1rem, 4vw, 2.5rem);
  }

  /* When there is no legend (empty state), let the plot breathe centered. */
  .donut:not(:has(.legend)) {
    grid-template-columns: 1fr;
    justify-items: center;
  }

  .plot {
    position: relative;
    width: 100%;
    max-width: 260px;
    margin-inline: auto;
  }

  .ring {
    width: 100%;
    height: auto;
    display: block;
    transform: rotate(-90deg);
    overflow: visible;
  }

  .track {
    opacity: 0.55;
  }

  .slice {
    /* Soft luminance lift; the SVG filter supplies the actual glow. */
    opacity: 0.95;
  }

  /* Subtle draw-in. Geometry is fully resolved server-side, so this only
     animates opacity/length and never affects the static SSR snapshot. */
  @media (prefers-reduced-motion: no-preference) {
    .slices {
      animation: donut-fade 700ms ease-out both;
    }
  }

  @keyframes donut-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.15rem;
    pointer-events: none;
    padding: 18%;
  }

  .center .value {
    font-family: var(--obs-font-display);
    font-size: clamp(1.6rem, 6vw, 2.4rem);
    line-height: 1;
    color: var(--obs-ink);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    text-shadow: 0 0 18px var(--obs-glow-cyan);
  }

  .center .label {
    font-family: var(--obs-font-body);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--obs-ink-mute);
  }

  .center .empty {
    font-family: var(--obs-font-body);
    font-size: 0.82rem;
    color: var(--obs-ink-mute);
    letter-spacing: 0.02em;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    min-width: 0;
  }

  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: 0.6rem;
  }

  .swatch {
    align-self: center;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: var(--obs-r-sm);
    box-shadow: 0 0 8px color-mix(in srgb, currentColor 0%, transparent);
    outline: 1px solid var(--obs-border);
    outline-offset: -1px;
  }

  .name {
    font-family: var(--obs-font-body);
    font-size: 0.86rem;
    color: var(--obs-ink-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .num {
    font-family: var(--obs-font-mono);
    font-size: 0.86rem;
    color: var(--obs-ink);
    font-variant-numeric: tabular-nums;
  }

  .pct {
    font-family: var(--obs-font-mono);
    font-size: 0.78rem;
    color: var(--obs-ink-mute);
    font-variant-numeric: tabular-nums;
    min-width: 2.8em;
    text-align: right;
  }

  @media (max-width: 460px) {
    .donut {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 1.25rem;
    }
    .legend {
      width: 100%;
      max-width: 260px;
    }
  }
</style>
