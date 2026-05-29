<script lang="ts">
  import { fmtInt, fmtDurationS } from "$lib/components/observatory/format";

  interface Props {
    mods: {
      label: string;
      accepts: number;
      rejects: number;
      kicks: number;
      p50S: number | null;
      p95S: number | null;
    }[];
    ariaLabel: string;
  }

  let { mods, ariaLabel }: Props = $props();

  // Leaderboard order: most accepts first. Tie-break on label for stability.
  const ranked = [...mods].sort(
    (a, b) => b.accepts - a.accepts || a.label.localeCompare(b.label),
  );

  // Scale bars to the busiest moderator. Guard against zero / negatives so the
  // width never becomes NaN or Infinity when every count is 0 or empty.
  const maxAccepts = ranked.reduce((m, r) => Math.max(m, r.accepts), 0);

  function barPct(accepts: number): number {
    if (maxAccepts <= 0) return 0;
    const pct = (accepts / maxAccepts) * 100;
    return Math.max(0, Math.min(100, pct));
  }
</script>

<figure class="modlb" aria-label={ariaLabel}>
  {#if ranked.length === 0}
    <p class="empty">No moderation data yet</p>
  {:else}
    <div class="rows" role="table" aria-label={ariaLabel}>
      <div class="head" role="row">
        <span class="col-label" role="columnheader">Moderator</span>
        <span class="col-accepts" role="columnheader">Accepts</span>
        <span class="col-other" role="columnheader">Rej</span>
        <span class="col-other" role="columnheader">Kick</span>
        <span class="col-time" role="columnheader">p50</span>
        <span class="col-time" role="columnheader">p95</span>
      </div>

      {#each ranked as mod (mod.label)}
        <div class="row" role="row">
          <span class="label" role="cell">{mod.label}</span>

          <span class="accepts" role="cell">
            <span class="bar-track" aria-hidden="true">
              <span class="bar-fill" style="width:{barPct(mod.accepts)}%"></span>
            </span>
            <span class="num accepts-num">{fmtInt(mod.accepts)}</span>
          </span>

          <span class="num other" role="cell">{fmtInt(mod.rejects)}</span>
          <span class="num other" role="cell">{fmtInt(mod.kicks)}</span>
          <span class="num time" role="cell">{fmtDurationS(mod.p50S)}</span>
          <span class="num time" role="cell">{fmtDurationS(mod.p95S)}</span>
        </div>
      {/each}
    </div>

    <figcaption class="caption">
      Moderators are anonymized. Times are p50 / p95 of claim-to-decision.
    </figcaption>
  {/if}
</figure>

<style>
  .modlb {
    margin: 0;
    color: var(--obs-ink);
    font-family: var(--obs-font-body);
  }

  .empty {
    margin: 0;
    padding: 1.5rem 0.25rem;
    color: var(--obs-ink-mute);
    font-family: var(--obs-font-body);
    font-size: 0.9rem;
    letter-spacing: 0.01em;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns:
      minmax(4.5rem, 0.9fr)
      minmax(0, 2.4fr)
      3rem
      3rem
      3.4rem
      3.4rem;
    align-items: center;
    gap: 0.75rem;
  }

  .head {
    padding: 0 0.85rem 0.35rem;
    border-bottom: 1px solid var(--obs-border);
    color: var(--obs-ink-faint);
    font-family: var(--obs-font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .head .col-accepts {
    text-align: left;
  }

  .head .col-other,
  .head .col-time {
    text-align: right;
  }

  .row {
    position: relative;
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--obs-border);
    border-radius: var(--obs-r-md);
    background: var(--obs-card-bg);
  }

  /* Quiet luminous edge on the leader; CSS only, no JS. */
  .row:first-of-type {
    border-color: var(--obs-border-strong);
  }

  .label {
    overflow: hidden;
    color: var(--obs-ink);
    font-family: var(--obs-font-display);
    font-size: 0.92rem;
    letter-spacing: 0.01em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .accepts {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .bar-track {
    position: relative;
    flex: 1 1 auto;
    height: 0.5rem;
    min-width: 0;
    border-radius: 999px;
    background: var(--obs-surface-2);
    box-shadow: inset 0 0 0 1px var(--obs-grid);
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
    min-width: 2px;
    border-radius: 999px;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, var(--obs-cyan) 70%, var(--obs-violet)) 0%,
      var(--obs-cyan) 100%
    );
    box-shadow: 0 0 8px var(--obs-glow-cyan);
  }

  .num {
    font-family: var(--obs-font-mono);
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
  }

  .accepts-num {
    flex: 0 0 auto;
    min-width: 2.5ch;
    color: var(--obs-ink);
    font-size: 0.85rem;
    text-align: right;
  }

  .other {
    color: var(--obs-ink-mute);
    font-size: 0.78rem;
    text-align: right;
  }

  .time {
    color: var(--obs-ink-dim);
    font-size: 0.8rem;
    text-align: right;
    white-space: nowrap;
  }

  .caption {
    margin: 0.85rem 0.1rem 0;
    color: var(--obs-ink-faint);
    font-family: var(--obs-font-body);
    font-size: 0.74rem;
    line-height: 1.45;
    letter-spacing: 0.01em;
  }

  @media (max-width: 540px) {
    .head {
      display: none;
    }

    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "label accepts-num"
        "bar   bar"
        "stats stats";
      row-gap: 0.45rem;
      column-gap: 0.5rem;
    }

    .label {
      grid-area: label;
    }

    .accepts {
      grid-area: bar;
      order: 0;
    }

    /* On narrow screens the accepts count moves beside the label and the
       remaining stats wrap onto their own line below the bar. */
    .accepts-num {
      grid-area: accepts-num;
      align-self: center;
    }

    .accepts .bar-track {
      width: 100%;
    }

    .other:nth-of-type(1) {
      grid-area: stats;
      justify-self: start;
      text-align: left;
    }

    .other:nth-of-type(2),
    .time {
      grid-area: stats;
    }

    .row .other,
    .row .time {
      grid-area: stats;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar-fill {
      box-shadow: none;
    }
  }

</style>
