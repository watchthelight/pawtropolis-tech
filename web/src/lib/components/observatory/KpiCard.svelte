<script lang="ts">
  interface Props {
    label: string;
    value: string;
    delta?: { text: string; dir: "up" | "down" | "flat" };
  }

  let { label, value, delta }: Props = $props();

  const glyph = { up: "^", down: "v", flat: "" } as const;
</script>

<div class="obs-card kpi">
  <p class="kpi-label">{label}</p>
  <p class="kpi-value obs-num">{value}</p>
  {#if delta}
    <p class="kpi-delta kpi-delta--{delta.dir}">
      {#if glyph[delta.dir]}<span class="kpi-delta-arrow" aria-hidden="true">{glyph[delta.dir]}</span
        >{/if}<span class="kpi-delta-text">{delta.text}</span>
    </p>
  {/if}
</div>

<style>
  .kpi {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .kpi-label {
    margin: 0;
    font-family: var(--obs-font-mono);
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--obs-ink-mute);
    overflow-wrap: anywhere;
  }

  .kpi-value {
    margin: 0;
    font-size: clamp(1.9rem, 4.5vw, 2.6rem);
    line-height: 1.05;
    color: var(--obs-ink);
    font-variant-numeric: tabular-nums lining;
    overflow-wrap: anywhere;
  }

  .kpi-delta {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    align-self: flex-start;
    margin: 0.1rem 0 0;
    padding: 0.16rem 0.5rem;
    border-radius: var(--obs-r-sm);
    border: 1px solid var(--obs-border);
    background: rgba(143, 168, 255, 0.04);
    font-family: var(--obs-font-mono);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: var(--obs-ink-mute);
  }

  .kpi-delta-arrow {
    font-weight: 700;
    line-height: 1;
  }

  .kpi-delta--up {
    color: var(--obs-cyan);
    border-color: var(--obs-border-strong);
  }
  .kpi-delta--down {
    color: var(--obs-rose);
    border-color: var(--obs-border-strong);
  }
  .kpi-delta--flat {
    color: var(--obs-ink-mute);
  }
</style>
