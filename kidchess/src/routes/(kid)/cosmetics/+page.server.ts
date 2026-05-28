import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const THEMES = [
  { id: 'classic',    name: 'Classic',    bg: '#f0d9b5', dark: '#b58863' },
  { id: 'ocean',      name: 'Ocean',      bg: '#a8d8ea', dark: '#2e6a8e' },
  { id: 'forest',     name: 'Forest',     bg: '#c8e6c9', dark: '#2e7d32' },
  { id: 'candy',      name: 'Candy',      bg: '#f8bbd0', dark: '#c2185b' },
  { id: 'galaxy',     name: 'Galaxy',     bg: '#e1bee7', dark: '#6a1b9a' },
  { id: 'fire',       name: 'Fire',       bg: '#ffccbc', dark: '#bf360c' },
];

export const AVATARS = [
  { id: 'knight',  emoji: '♞' },
  { id: 'queen',   emoji: '♛' },
  { id: 'king',    emoji: '♚' },
  { id: 'rook',    emoji: '♜' },
  { id: 'bishop',  emoji: '♝' },
  { id: 'pawn',    emoji: '♟' },
];

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const p = profile as any;

  return {
    session,
    profile,
    themes: THEMES,
    avatars: AVATARS,
    currentTheme: p?.board_theme ?? 'classic',
    currentAvatar: p?.avatar_id ?? 'knight'
  };
};
