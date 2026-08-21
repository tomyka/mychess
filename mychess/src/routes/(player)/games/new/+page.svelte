<script lang="ts">
	import { goto } from '$app/navigation';
	import { pickPgnFromGoogleDrive } from '$lib/googleDrivePicker';
	import { extractSingleGame } from '$lib/games/parse';

	let pgnText = $state('');
	let fileName = $state('');
	let fileError = $state('');
	let driveError = $state('');
	let drivePicking = $state(false);
	let playedAs = $state<'white' | 'black' | null>(null);
	let submitting = $state(false);
	let errorMessage = $state('');

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		driveError = '';
		fileName = file.name;
		const reader = new FileReader();
		reader.onload = () => {
			pgnText = reader.result as string;
			fileError = '';
		};
		reader.onerror = () => {
			fileError = 'Could not read that file — try pasting the PGN text instead.';
		};
		reader.readAsText(file);
	}

	async function onGoogleDriveClick() {
		driveError = '';
		fileError = '';
		drivePicking = true;
		try {
			const result = await pickPgnFromGoogleDrive();
			if (result) {
				pgnText = result.text;
				fileName = result.name;
			}
		} catch (err) {
			driveError = err instanceof Error ? err.message : 'Could not import from Google Drive.';
		} finally {
			drivePicking = false;
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = '';

		const trimmedPgn = pgnText.trim();
		if (!trimmedPgn) {
			errorMessage = 'PGN is required';
			return;
		}
		const checked = extractSingleGame(trimmedPgn);
		if ('error' in checked) {
			errorMessage = checked.error;
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/games', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pgn: trimmedPgn, playedAs })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? 'Upload failed');
			}
			const { id } = await res.json();
			await goto(`/games/${id}`);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Upload failed';
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Upload a game — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-(--color-bg)">
	<div class="max-w-lg mx-auto px-4 py-6">
		<a href="/games" class="text-(--color-muted) text-sm hover:text-(--color-text) mb-6 block"
			>← Back to My Games</a
		>

		{#if errorMessage}
			<p
				class="text-red-600 mb-4 bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800 dark:text-red-400 px-4 py-2 rounded-xl text-sm"
			>
				{errorMessage}
			</p>
		{/if}

		<form
			onsubmit={handleSubmit}
			class="bg-(--color-surface) border border-(--color-border) rounded-xl shadow-sm p-5 space-y-4"
		>
			<h1 class="text-2xl font-bold text-(--color-text)">Upload a game</h1>

			<div>
				<span class="block text-sm font-medium text-(--color-text) mb-1">Which side did you play?</span>
				<div class="flex gap-3">
					{#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }, { id: null, label: 'Not sure' }] as const as c (c.label)}
						<button
							type="button"
							disabled={submitting}
							onclick={() => (playedAs = c.id)}
							class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm disabled:opacity-60
							       {playedAs === c.id
								? 'border-(--color-accent) bg-indigo-50 dark:bg-indigo-950 text-indigo-700'
								: 'border-(--color-border) text-(--color-muted) hover:border-gray-300 dark:hover:border-gray-600'}"
						>
							{c.label}
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label class="block text-sm font-medium text-(--color-text) mb-1" for="pgn_text">Paste PGN text</label>
				<textarea
					id="pgn_text"
					name="pgn_text"
					rows="8"
					bind:value={pgnText}
					disabled={submitting || drivePicking}
					placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
					class="w-full rounded-lg px-4 py-2.5 border border-(--color-border) text-(--color-text) placeholder-(--color-muted) focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none disabled:opacity-60"
				></textarea>
			</div>

			<div>
				<label class="block text-sm font-medium text-(--color-text) mb-1" for="pgn_file">…or upload a .pgn file</label>
				<div class="flex items-center gap-3">
					<label
						for="pgn_file"
						class="cursor-pointer inline-flex items-center gap-2 bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="shrink-0"
							aria-hidden="true"
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="17 8 12 3 7 8" />
							<line x1="12" y1="3" x2="12" y2="15" />
						</svg>
						Choose File
					</label>
					<input
						id="pgn_file"
						type="file"
						accept=".pgn"
						onchange={onFileChange}
						disabled={submitting || drivePicking}
						class="hidden"
					/>
				</div>
				{#if fileError}
					<p class="text-red-600 dark:text-red-400 text-sm mt-1">{fileError}</p>
				{/if}
			</div>

			<div>
				<button
					type="button"
					onclick={onGoogleDriveClick}
					disabled={submitting || drivePicking}
					class="cursor-pointer inline-flex items-center gap-2 bg-gray-100 border border-(--color-border) text-(--color-text) px-4 py-2.5 rounded-lg font-medium text-sm hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
				>
					<svg width="16" height="16" viewBox="0 0 87.3 78" class="shrink-0 grayscale" aria-hidden="true">
						<path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
						<path
							d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
							fill="#00ac47"
						/>
						<path
							d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
							fill="#ea4335"
						/>
						<path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
						<path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
						<path
							d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
							fill="#ffba00"
						/>
					</svg>
					{drivePicking ? 'Opening Google Drive…' : '…or import from Google Drive'}
				</button>
				{#if driveError}
					<p class="text-red-600 dark:text-red-400 text-sm mt-1">{driveError}</p>
				{/if}
			</div>

			{#if fileName}
				<p class="text-sm text-(--color-muted) truncate">Selected: {fileName}</p>
			{/if}

			<button
				type="submit"
				disabled={submitting || drivePicking}
				class="w-full bg-(--color-accent) text-white py-3 rounded-xl font-bold text-base hover:bg-(--color-accent-hover) transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
			>
				{submitting ? 'Uploading…' : 'Upload and analyze'}
			</button>
		</form>
	</div>
</main>
