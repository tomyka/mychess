ALTER TABLE "admin_audit" ADD COLUMN "target_email_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit" DROP COLUMN "target_email";--> statement-breakpoint
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_target_email_hash_check" CHECK ("admin_audit"."target_email_hash" ~ '^[0-9a-f]{64}$');