<!-- SPDX-License-Identifier: LicenseRef-ANW-1.0 -->
<script lang="ts">
  import { fmtInt, fmtDayShort } from "$lib/components/observatory/format";

  interface Props {
    weeks: { week: string; submitted: number; approved: number; used: number }[];
    ariaLabel: string;
  }

  let { weeks, ariaLabel }: Props = $props();

  // Coerce a possibly-null/NaN count to a non-negative finite number for geometry.
  // Display still goes through fmtInt so genuine nulls read as "n/a".
  const safe = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

  // Scale every bar to the largest "submitted" value (the funnel mouth). The
  // divisor is floored at 1 so a single-week, all-zero, or empty dataset never
  // divides by zero or yields NaN widths.
  const denom = Math.max(1, ...weeks.map((w) => safe(w.submitted)));

  // Percentage width [0..100] for a given count, clamped so rogue data where
  // approved/used exceed submitted can never overflow the track.
  const pct = (n: number): number => Math.max(0, Math.min(100, (safe(n) / denom) * 100));

  const series = [
    { key: "submitted" as const, label: "Submitted", color: "var(--obs-c1)" },
    { key: "approved" as const, label: "Approved", color: "var(--obs-c3)" },
    { key: "used" as const, label: "Used", color: "var(--obs-c5)" }
  ];
</script>

<figure class="qotd" role="group" aria-label={ariaLabel}>
  {#if weeks.length === 0}
    <p class="empty">No questions yet</p>
  {:else}
    <ul class="legend" aria-hidden="true">
      {#each series as s (s.key)}
        <li><span class="swatch" style:--c={s.color}></span>{s.label}</li>
      {/each}
    </ul>

    <ol class="weeks">
      {#each weeks as w (w.week)}
        <li class="week">
          <span class="wlabel">{fmtDayShort(w.week)}</span>
          <div class="cluster">
            {#each series as s (s.key)}
              <div class="row">
                <div class="track">
                  <div
                    class="bar"
                    style:--c={s.color}
                    style:--w="{pct(w[s.key])}%"
                  ></div>
                </div>
                <span class="count">{fmtInt(w[s.key])}</span>
              </div>
            {/each}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</figure>

<style>
  .qotd {
    margin: 0;
    font-family: var(--obs-font-body);
  }

  .empty {
    margin: 0;
    padding: 1rem 0;
    color: var(--obs-ink-mute);
    font-size: 0.85rem;
    font-style: italic;
  }

  /* ---- Legend ---- */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    margin: 0 0 1.1rem;
    padding: 0;
    list-style: none;
    font-family: var(--obs-font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--obs-ink-dim);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .swatch {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
    background: var(--c);
    box-shadow: 0 0 6px color-mix(in oklab, var(--c) 60%, transparent);
  }

  /* ---- Weekly clusters ---- */
  .weeks {
    display: grid;
    gap: clamp(0.85rem, 2.2vw, 1.35rem);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .week {
    display: grid;
    gap: 0.4rem;
  }
  .wlabel {
    font-family: var(--obs-font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    color: var(--obs-ink-mute);
  }

  .cluster {
    display: grid;
    gap: 0.32rem;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.6rem;
  }

  /* ---- Bar track + fill ---- */
  .track {
    position: relative;
    height: 0.55rem;
    border-radius: var(--obs-r-sm);
    background: var(--obs-grid);
    box-shadow: inset 0 0 0 1px var(--obs-border);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    width: var(--w);
    min-width: 2px;
    border-radius: var(--obs-r-sm);
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--c) 55%, transparent),
      var(--c)
    );
    box-shadow: 0 0 8px color-mix(in oklab, var(--c) 45%, transparent);
    transform-origin: left center;
  }

  .count {
    font-family: var(--obs-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.74rem;
    color: var(--obs-ink-dim);
    min-width: 2.5ch;
    text-align: right;
  }

  /* Subtle one-shot grow on load; motion-safe only, never blocks render. */
  @media (prefers-reduced-motion: no-preference) {
    .bar {
      animation: qotd-grow 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes qotd-grow {
      from {
        transform: scaleX(0);
      }
      to {
        transform: scaleX(1);
      }
    }
  }
</style>
