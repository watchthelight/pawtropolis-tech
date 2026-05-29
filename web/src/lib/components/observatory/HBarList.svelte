<script lang="ts">
  import { fmtInt } from "$lib/components/observatory/format";

  interface Props {
    items: { label: string; value: number; display?: string }[];
    accent?: string;
    max?: number;
    ariaLabel?: string;
  }

  let {
    items = [],
    accent = "var(--obs-c1)",
    max,
    ariaLabel = "Horizontal bar list",
  }: Props = $props();

  // Coerce to a finite, non-negative number; anything else reads as 0 so a
  // null/NaN value never poisons a bar width.
  const safe = (v: number | null | undefined): number =>
    v == null || Number.isNaN(Number(v)) ? 0 : Math.max(0, Number(v));

  // Largest value across rows, used when `max` is omitted.
  const largest = items.reduce((m, it) => Math.max(m, safe(it?.value)), 0);

  // Scale floor of 1 keeps the divisor positive even when every value is
  // 0/null, so widths resolve to 0% instead of NaN.
  const givenMax = safe(max);
  const scale = Math.max(1, givenMax > 0 ? givenMax : largest);

  // Pre-resolve each row: clamp width to 0..100 (a value above max fills, never
  // overflows) and pick the display string. fmtInt renders null/NaN as "n/a".
  const rows = items.map((it) => {
    const raw = it?.value;
    const pct = Math.max(0, Math.min(100, (safe(raw) / scale) * 100));
    const valid = raw != null && !Number.isNaN(Number(raw));
    return {
      label: it?.label ?? "",
      width: pct,
      text: it?.display ?? fmtInt(valid ? Number(raw) : null),
    };
  });

  const empty = rows.length === 0;
</script>

{#if empty}
  <p class="hbar-empty" role="img" aria-label={ariaLabel}>No data yet</p>
{:else}
  <ul class="hbar-list" role="img" aria-label={ariaLabel}>
    {#each rows as row}
      <li class="hbar-row">
        <span class="hbar-label" title={row.label}>{row.label}</span>
        <span class="hbar-track">
          <span
            class="hbar-fill"
            style="width:{row.width}%; --hbar-accent:{accent};"
          ></span>
        </span>
        <span class="hbar-value">{row.text}</span>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .hbar-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    font-family: var(--obs-font-body);
  }

  .hbar-row {
    display: grid;
    grid-template-columns: minmax(0, 9rem) 1fr auto;
    align-items: center;
    gap: 0.75rem;
  }

  .hbar-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.78rem;
    color: var(--obs-ink-dim);
    letter-spacing: 0.01em;
  }

  .hbar-track {
    position: relative;
    height: 0.6rem;
    border-radius: 2px;
    background: var(--obs-surface-2);
    box-shadow: inset 0 0 0 1px var(--obs-border);
    overflow: hidden;
  }

  .hbar-fill {
    position: absolute;
    inset: 0 auto 0 0;
    display: block;
    min-width: 2px;
    border-radius: 2px;
    background: linear-gradient(
      90deg,
      var(--obs-c3),
      var(--hbar-accent, var(--obs-c1))
    );
    box-shadow: 0 0 6px -1px var(--hbar-accent, var(--obs-c1));
  }

  /* A single faint luminous sweep across the filled bar: decorative, pure CSS,
     and only active when motion is welcome. */
  .hbar-fill::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in oklab, var(--obs-ink) 35%, transparent) 50%,
      transparent 100%
    );
    transform: translateX(-100%);
    opacity: 0;
  }

  .hbar-value {
    font-family: var(--obs-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    color: var(--obs-ink);
    text-align: right;
    white-space: nowrap;
  }

  .hbar-empty {
    margin: 0;
    padding: calc(var(--obs-r-md, 8px) * 1.5) 0;
    font-family: var(--obs-font-mono);
    font-size: 0.78rem;
    color: var(--obs-ink-faint);
  }

  @media (prefers-reduced-motion: no-preference) {
    .hbar-fill::after {
      animation: hbar-sweep 3.6s ease-in-out infinite;
    }

    @keyframes hbar-sweep {
      0%,
      60% {
        transform: translateX(-100%);
        opacity: 0;
      }
      70% {
        opacity: 0.7;
      }
      100% {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  }
</style>
