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

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (document.querySelector(`script[src="${src}"]`)) {
			resolve();
			return;
		}
		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.head.appendChild(script);
	});
}

async function ensureGoogleSdksLoaded(): Promise<void> {
	if (!window.google?.accounts?.oauth2) {
		await loadScript(GIS_SRC);
	}
	if (!window.gapi?.picker) {
		await loadScript(GAPI_SRC);
		await new Promise<void>((resolve) => window.gapi.load('picker', resolve));
	}
}

function requestAccessToken(clientId: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		try {
			const tokenClient = window.google.accounts.oauth2.initTokenClient({
				client_id: clientId,
				scope: DRIVE_FILE_SCOPE,
				callback: (response: any) => {
					if (response.error) {
						// Includes the user closing/dismissing the consent popup —
						// treated as a cancel, not a hard failure.
						resolve(null);
						return;
					}
					resolve(response.access_token as string);
				}
			});
			tokenClient.requestAccessToken();
		} catch (err) {
			reject(err instanceof Error ? err : new Error('Failed to start Google sign-in'));
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
	if (!res.ok) throw new Error('Could not download that file from Google Drive.');
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
