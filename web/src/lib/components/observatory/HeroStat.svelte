<script lang="ts">
  // SPDX-License-Identifier: LicenseRef-ANW-1.0
  interface Props {
    value: string;
    caption: string;
    delta?: { text: string; dir: "up" | "down" | "flat" };
  }

  let { value, caption, delta }: Props = $props();

  const arrow = { up: "^", down: "v", flat: "—" } as const;
</script>

<div class="hero-stat">
  <div class="value obs-num">{value}</div>
  <div class="caption">{caption}</div>
  {#if delta}
    <div class="delta delta--{delta.dir}">
      <span class="delta-arrow" aria-hidden="true">{arrow[delta.dir]}</span>
      <span class="delta-text">{delta.text}</span>
    </div>
  {/if}
</div>

<style>
  .hero-stat {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    min-width: 0;
  }

  .value {
    font-family: var(--obs-font-display);
    font-variant-numeric: tabular-nums lining;
    font-size: clamp(3rem, 9vw, 6rem);
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--obs-ink);
    text-shadow:
      0 0 22px rgba(143, 168, 255, 0.32),
      0 0 60px rgba(111, 230, 255, 0.14);
    word-break: break-word;
  }

  .caption {
    font-size: 0.95rem;
    color: var(--obs-ink-mute);
    letter-spacing: 0.01em;
  }

  .delta {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.15rem;
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--obs-border);
    background: var(--obs-surface-2);
    font-family: var(--obs-font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
    line-height: 1;
    /* Default (flat) tone */
    color: var(--obs-ink-mute);
  }

  .delta-arrow {
    font-weight: 700;
    font-size: 0.85em;
  }

  .delta--up {
    color: var(--obs-cyan);
    border-color: var(--obs-border-strong);
    box-shadow: var(--obs-glow-cyan);
  }

  .delta--down {
    color: var(--obs-rose);
    border-color: var(--obs-border-strong);
    box-shadow: 0 0 10px rgba(255, 143, 179, 0.4);
  }

  .delta--flat {
    color: var(--obs-ink-mute);
  }

  /* Soft entrance breath: CSS-only, JS-free, disabled for reduced motion.
     SSR renders final state; this is purely decorative on first paint. */
  @media (prefers-reduced-motion: no-preference) {
    .value {
      animation: hero-rise 700ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
    }
    .delta {
      animation: hero-rise 700ms cubic-bezier(0.22, 0.61, 0.36, 1) 120ms both;
    }
  }

  @keyframes hero-rise {
    from {
      opacity: 0;
      transform: translateY(0.35rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
