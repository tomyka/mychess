import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			safeGetSession: () => Promise<{
				session: Session | null;
				user: User | null;
				profile: Record<string, unknown> | null;
			}>;
		}
		interface PageData {
			session: Session | null;
			profile: Record<string, unknown> | null;
		}
	}
}
export {};
