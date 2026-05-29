<script lang="ts">
  import "$lib/styles/observatory.css";
  import HeroStat from "$lib/components/observatory/HeroStat.svelte";
  import KpiCard from "$lib/components/observatory/KpiCard.svelte";
  import AreaChart from "$lib/components/observatory/AreaChart.svelte";
  import LineChart from "$lib/components/observatory/LineChart.svelte";
  import DivergingBars from "$lib/components/observatory/DivergingBars.svelte";
  import HBarList from "$lib/components/observatory/HBarList.svelte";
  import HeatmapGrid from "$lib/components/observatory/HeatmapGrid.svelte";
  import CohortTable from "$lib/components/observatory/CohortTable.svelte";
  import QotdFunnel from "$lib/components/observatory/QotdFunnel.svelte";
  import DonutChart from "$lib/components/observatory/DonutChart.svelte";
  import ModLeaderboard from "$lib/components/observatory/ModLeaderboard.svelte";
  import {
    fmtInt,
    fmtSignedInt,
    fmtPct,
    fmtSignedPct,
    fmtDurationS,
    fmtDayShort,
  } from "$lib/components/observatory/format";
  import type { ObservatoryData } from "$lib/server/queries/observatory";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  const obs = data.observatory as ObservatoryData | null;

  const deltaDir = (n: number | null | undefined): "up" | "down" | "flat" =>
    n == null || n === 0 ? "flat" : n > 0 ? "up" : "down";

  function freshness(s: number | null): string {
    if (s == null) return "unknown";
    const iso = new Date(s * 1000).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }

  // Derived view-model (cheap, pure; runs once at SSR).
  const vm = obs
    ? {
        decisionTotal: obs.decisionMix.approve + obs.decisionMix.reject + obs.decisionMix.kick,
        decisionSegments: [
          { label: "Approved", value: obs.decisionMix.approve, color: "var(--obs-green)" },
          { label: "Rejected", value: obs.decisionMix.reject, color: "var(--obs-rose)" },
          { label: "Kicked", value: obs.decisionMix.kick, color: "var(--obs-gold)" },
        ],
        dailyDecisionTotals: obs.dailyDecisions.map((d) => ({
          day: d.day,
          value: d.approve + d.reject + d.kick,
        })),
        tenureItems: obs.tenure.map((t) => ({ label: t.bucket, value: t.count })),
        channelItems: obs.topChannels.map((c) => ({ label: c.name, value: c.count })),
        reactionItems: obs.reactions.map((r) => ({ label: r.emoji, value: r.count })),
        eventItems: obs.events.map((e) => ({
          label: `${fmtDayShort(e.date)} ${e.type}`,
          value: e.qualified,
          display: `${e.qualified}/${e.total}`,
        })),
      }
    : null;
</script>

<svelte:head>
  <title>Observatory :: Pawtropolis</title>
  <meta
    name="description"
    content="Live public stats for the Pawtropolis community: growth, activity, voice, events, and moderation transparency. All times UTC."
  />
  <meta name="theme-color" content="#05060e" />
</svelte:head>

<div class="observatory">
  <div class="obs-shell">
    {#if !obs || !vm || !obs.hasData}
      <header class="masthead">
        <p class="obs-eyebrow">Pawtropolis Observatory</p>
        <h1>The sky is clear for now</h1>
        <p class="empty">
          Community stats have not been gathered yet. Check back once the Observatory has had a
          chance to chart the night.
        </p>
        <p class="back"><a href="/">Back to pawtropolis.tech</a></p>
      </header>
    {:else}
      <!-- HERO -->
      <header class="masthead">
        <p class="obs-eyebrow">Pawtropolis Observatory</p>
        <h1 class="hero-q">Is this community alive and growing?</h1>
        <div class="hero-row">
          <HeroStat
            value={fmtInt(obs.currentMembers)}
            caption="members and counting"
            delta={{ text: `${fmtSignedInt(obs.kpis.net30d)} / 30d`, dir: deltaDir(obs.kpis.net30d) }}
          />
          <div class="hero-chart obs-card">
            <p class="obs-chart-title">Daily member count, last 90 days</p>
            <AreaChart points={obs.memberSeries} color="var(--obs-cyan)" height={170} ariaLabel="Daily member count over the last 90 days" />
          </div>
        </div>
      </header>

      <!-- SUMMARY BAND -->
      <section class="obs-section" aria-label="Summary">
        <div class="kpi-band">
          <KpiCard label="Net growth 30d" value={fmtSignedInt(obs.kpis.net30d)} delta={{ text: "joins minus leaves", dir: deltaDir(obs.kpis.net30d) }} />
          <KpiCard
            label="Messages 7d"
            value={fmtInt(obs.kpis.messages7d)}
            delta={obs.kpis.messagesWoWPct == null ? undefined : { text: `${fmtSignedPct(obs.kpis.messagesWoWPct)} WoW`, dir: deltaDir(obs.kpis.messagesWoWPct) }}
          />
          <KpiCard label="Active authors" value={fmtInt(obs.kpis.dauLatest)} delta={{ text: "latest day", dir: "flat" }} />
          <KpiCard label="Approval rate" value={fmtPct(obs.kpis.approvalRatePct)} delta={{ text: "last 30 days", dir: "flat" }} />
          <KpiCard label="Typical response" value={fmtDurationS(obs.kpis.decisionP50S)} delta={{ text: "p50 across mods", dir: "flat" }} />
        </div>
      </section>

      <!-- DRILL 1: MEMBERSHIP & RETENTION -->
      <section class="obs-section" aria-label="Membership and retention">
        <h2 class="obs-eyebrow">Membership and retention</h2>
        <div class="grid-2">
          <div class="obs-card">
            <p class="obs-chart-title">Daily joins vs leaves</p>
            <DivergingBars data={obs.joinsLeaves} ariaLabel="Daily joins versus leaves" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Cumulative net growth</p>
            <AreaChart points={obs.cumulativeNet} color="var(--obs-violet)" height={160} ariaLabel="Cumulative net member growth" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Member tenure</p>
            <HBarList items={vm.tenureItems} accent="var(--obs-violet)" ariaLabel="Member tenure distribution" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Cohort retention by join week</p>
            <CohortTable cohorts={obs.cohorts} offsets={[1, 2, 4, 8, 12]} ariaLabel="Cohort retention by join week" />
          </div>
        </div>
      </section>

      <!-- DRILL 2: ACTIVITY -->
      <section class="obs-section" aria-label="Activity">
        <h2 class="obs-eyebrow">When the city is awake</h2>
        <div class="obs-card heatmap-card">
          <p class="obs-chart-title">Hour of day by day of week</p>
          <HeatmapGrid grid={obs.heatmap} max={obs.heatmapMax} dowLabels={obs.dowLabels} ariaLabel="Message activity heatmap, hour of day by day of week" />
        </div>
        <div class="grid-2">
          <div class="obs-card">
            <p class="obs-chart-title">Daily message volume</p>
            <AreaChart points={obs.messageVolume} color="var(--obs-cyan)" height={150} ariaLabel="Daily message volume" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Daily active authors</p>
            <LineChart points={obs.dau} color="var(--obs-violet)" height={150} ariaLabel="Daily active authors" />
          </div>
        </div>
        <div class="obs-card">
          <p class="obs-chart-title">Top channels by message share</p>
          <HBarList items={vm.channelItems} accent="var(--obs-cyan)" ariaLabel="Top channels by message share" />
        </div>
      </section>

      <!-- DRILL 3: COMMUNITY LIFE -->
      <section class="obs-section" aria-label="Community life">
        <h2 class="obs-eyebrow">Community life</h2>
        <div class="grid-2">
          <div class="obs-card">
            <p class="obs-chart-title">Daily voice minutes</p>
            <AreaChart points={obs.voice} color="var(--obs-green)" height={150} ariaLabel="Daily voice minutes" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Movie and game night turnout</p>
            <HBarList items={vm.eventItems} accent="var(--obs-gold)" ariaLabel="Event participation, qualified attendees" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Question of the day funnel</p>
            <QotdFunnel weeks={obs.qotd} ariaLabel="QOTD weekly funnel of submitted, approved, and used" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Top reactions</p>
            <HBarList items={vm.reactionItems} accent="var(--obs-rose)" ariaLabel="Top reactions by emoji" />
          </div>
        </div>
      </section>

      <!-- DRILL 4: MODERATION TRANSPARENCY -->
      <section class="obs-section" aria-label="Moderation transparency">
        <h2 class="obs-eyebrow">Who keeps the gate</h2>
        <div class="grid-2">
          <div class="obs-card">
            <p class="obs-chart-title">Decision mix, last 90 days</p>
            <DonutChart segments={vm.decisionSegments} centerValue={fmtInt(vm.decisionTotal)} centerLabel="decisions" ariaLabel="Application decision mix" />
          </div>
          <div class="obs-card">
            <p class="obs-chart-title">Daily decisions</p>
            <AreaChart points={vm.dailyDecisionTotals} color="var(--obs-gold)" height={160} ariaLabel="Daily moderation decisions" />
          </div>
        </div>
        <div class="obs-card">
          <p class="obs-chart-title">Moderator throughput and response time</p>
          <ModLeaderboard mods={obs.mods} ariaLabel="Anonymized moderator leaderboard with response times" />
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="provenance">
        <span>Data as of {freshness(obs.refreshedAtS)}</span>
        <span class="dot">.</span>
        <span>all times UTC</span>
        <span class="dot">.</span>
        <a href="/">back to pawtropolis.tech</a>
      </footer>
    {/if}
  </div>
</div>

<style>
  .masthead {
    padding-top: clamp(1rem, 4vw, 2.5rem);
  }
  .masthead h1 {
    font-family: var(--obs-font-display);
    font-weight: 600;
    font-size: clamp(1.6rem, 4vw, 2.6rem);
    line-height: 1.15;
    margin: 0 0 1.5rem;
    color: var(--obs-ink);
    text-wrap: balance;
  }
  .hero-q {
    max-width: 22ch;
  }
  .empty {
    color: var(--obs-ink-dim);
    max-width: 48ch;
  }
  .back,
  .empty {
    margin-top: 1rem;
  }
  .hero-row {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.6fr);
    gap: clamp(1rem, 3vw, 2rem);
    align-items: stretch;
  }
  .hero-chart {
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .kpi-band {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: clamp(0.6rem, 1.5vw, 1rem);
  }
  .grid-2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(0.75rem, 2vw, 1.25rem);
  }
  .heatmap-card {
    margin-bottom: clamp(0.75rem, 2vw, 1.25rem);
    overflow-x: auto;
  }
  .provenance {
    margin-top: clamp(3rem, 7vw, 5rem);
    padding-top: 1.25rem;
    border-top: 1px solid var(--obs-border);
    color: var(--obs-ink-mute);
    font-family: var(--obs-font-mono);
    font-size: 0.75rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .provenance .dot {
    color: var(--obs-ink-faint);
  }

  @media (max-width: 900px) {
    .hero-row {
      grid-template-columns: 1fr;
    }
    .kpi-band {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 620px) {
    .grid-2 {
      grid-template-columns: 1fr;
    }
  }
</style>
