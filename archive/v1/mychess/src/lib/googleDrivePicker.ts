// mychess/src/lib/googleDrivePicker.ts
import { env } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';

// Google's own JS SDKs (Identity Services + the classic gapi loader for
// Picker) ship no first-party TypeScript types, and this repo already
// avoids pulling in a generic OAuth/SDK library for its hand-rolled
// Lichess/Chess.com/Google integrations — `any` here is a deliberate,
// contained exception rather than adding @types/gapi.picker for two globals.
declare global {
	interface Window {
		google?: any;
		gapi?: any;
	}
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const SDK_LOAD_TIMEOUT_MS = 15_000;

const scriptLoadPromises = new Map<string, Promise<void>>();

/**
 * Rejects if `promise` doesn't settle within `ms`, so a stalled script tag
 * (no onload/onerror ever firing) or a bare gapi.load() that only ever
 * resolves can't leave the caller waiting forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(err) => {
				clearTimeout(timeout);
				reject(err);
			}
		);
	});
}

/**
 * Caches the in-flight loading Promise itself (not just DOM presence): if two
 * calls overlap while the script is still loading, both must await the SAME
 * promise and only proceed once it has genuinely resolved — a presence-only
 * check would let a second concurrent caller race ahead of the first
 * script's `onload` and touch `window.google`/`window.gapi` while still
 * `undefined`.
 */
function loadScript(src: string): Promise<void> {
	const cached = scriptLoadPromises.get(src);
	if (cached) return cached;
	const promise = document.querySelector(`script[src="${src}"]`)
		? Promise.resolve()
		: withTimeout(
				new Promise<void>((resolve, reject) => {
					const script = document.createElement('script');
					script.src = src;
					script.async = true;
					script.onload = () => resolve();
					script.onerror = () => {
						reject(new Error(`Failed to load ${src}`));
					};
					document.head.appendChild(script);
				}),
				SDK_LOAD_TIMEOUT_MS,
				`Timed out loading ${src}`
			).catch((err) => {
				scriptLoadPromises.delete(src);
				document.querySelector(`script[src="${src}"]`)?.remove(); // otherwise a retry's
				// DOM-presence check above would false-positive on this stalled/failed tag
				// and skip loading entirely
				throw err;
			});
	scriptLoadPromises.set(src, promise);
	return promise;
}

async function ensureGoogleSdksLoaded(): Promise<void> {
	if (!window.google?.accounts?.oauth2) {
		await loadScript(GIS_SRC);
	}
	if (!window.gapi?.picker) {
		await loadScript(GAPI_SRC);
		await withTimeout(
			new Promise<void>((resolve) => window.gapi.load('picker', resolve)),
			SDK_LOAD_TIMEOUT_MS,
			'Timed out loading the Google Drive picker'
		);
	}
}

const ACCESS_TOKEN_TIMEOUT_MS = 60_000;

function requestAccessToken(clientId: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		// If Google's own callback never fires at all (e.g. a browser/extension
		// silently blocks the OAuth popup in a way GIS's popup-closed detection
		// doesn't catch), this promise would otherwise hang forever with no
		// error — a permanently-stuck "Opening Google Drive…" button.
		const timeout = setTimeout(() => {
			reject(new Error("Google sign-in didn't respond — try again."));
		}, ACCESS_TOKEN_TIMEOUT_MS);
		const settle = (fn: () => void) => {
			clearTimeout(timeout);
			fn();
		};
		try {
			const tokenClient = window.google.accounts.oauth2.initTokenClient({
				client_id: clientId,
				scope: DRIVE_FILE_SCOPE,
				callback: (response: any) => {
					if (response.error) {
						// Includes the user closing/dismissing the consent popup —
						// treated as a cancel, not a hard failure.
						settle(() => resolve(null));
						return;
					}
					settle(() => resolve(response.access_token as string));
				}
			});
			tokenClient.requestAccessToken();
		} catch (err) {
			settle(() => reject(err instanceof Error ? err : new Error('Failed to start Google sign-in')));
		}
	});
}

function showPicker(token: string, apiKey: string): Promise<{ id: string; name: string } | null> {
	return new Promise((resolve) => {
		const picker = new window.google.picker.PickerBuilder()
			.addView(window.google.picker.ViewId.DOCS)
			.setOAuthToken(token)
			.setDeveloperKey(apiKey)
			.setCallback((data: any) => {
				if (data.action === window.google.picker.Action.PICKED) {
					const doc = data.docs[0];
					resolve({ id: doc.id, name: doc.name });
				} else if (data.action === window.google.picker.Action.CANCEL) {
					resolve(null);
				}
			})
			.build();
		picker.setVisible(true);
	});
}

async function fetchFileText(fileId: string, token: string): Promise<string> {
	const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) {
		console.error(`Google Drive file fetch failed: ${res.status} ${res.statusText}`);
		throw new Error('Could not download that file from Google Drive.');
	}
	return res.text();
}

/**
 * Opens Google's file picker, scoped to `drive.file` (only files the user
 * explicitly selects here — never standing access to their whole Drive).
 * No token is ever persisted; it lives only for the duration of this call.
 * Resolves `null` on any cancellation (closed consent popup, closed picker
 * without selecting); throws on a real failure (SDK failed to load, the
 * picked file's content failed to fetch).
 */
export async function pickPgnFromGoogleDrive(): Promise<{ name: string; text: string } | null> {
	const clientId = requireEnv(env.PUBLIC_GOOGLE_CLIENT_ID, 'PUBLIC_GOOGLE_CLIENT_ID');
	const apiKey = requireEnv(env.PUBLIC_GOOGLE_API_KEY, 'PUBLIC_GOOGLE_API_KEY');

	await ensureGoogleSdksLoaded();

	const token = await requestAccessToken(clientId);
	if (!token) return null;

	const picked = await showPicker(token, apiKey);
	if (!picked) return null;

	const text = await fetchFileText(picked.id, token);
	return { name: picked.name, text };
}
