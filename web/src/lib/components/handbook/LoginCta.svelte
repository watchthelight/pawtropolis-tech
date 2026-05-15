<script lang="ts">
	type Props = { headingText: string };
	let { headingText }: Props = $props();
</script>

<aside class="hb-login-cta">
	<div class="hb-login-cta-text">
		<strong>Sign in to read this.</strong>
		<p>
			<em>{headingText}</em> is staff-only documentation. Sign in with Discord to see whether
			you can run it.
		</p>
	</div>
	<a class="hb-login-cta-btn" href="/auth/login?return=/handbook">Sign in with Discord</a>
</aside>

<style>
	.hb-login-cta {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
		justify-content: space-between;
		margin: 0.7em 0 1.2em;
		padding: 1em 1.1em;
		border-radius: var(--radius-md);
		border: 1px dashed var(--border-strong);
		background: var(--surface);
	}
	.hb-login-cta-text {
		max-width: 36ch;
	}
	.hb-login-cta-text strong {
		color: var(--text-primary);
		font-size: 1rem;
	}
	.hb-login-cta-text p {
		margin: 0.25em 0 0;
		color: var(--text-tertiary);
		font-size: 0.9rem;
	}
	.hb-login-cta-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.55em 1.1em;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: 600;
		text-decoration: none;
		min-height: 44px;
	}
	.hb-login-cta-btn:hover {
		background: var(--accent-strong);
	}
</style>
