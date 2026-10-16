-- admin_audit is append-only (security review, S1): no session, not even a
-- direct SQL one, may rewrite or erase an Admin change once recorded.
-- Drizzle cannot express triggers in the schema, so this is a custom migration.
CREATE FUNCTION "admin_audit_refuse_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'admin_audit is append-only: % refused', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "admin_audit_append_only"
BEFORE UPDATE OR DELETE ON "admin_audit"
FOR EACH ROW EXECUTE FUNCTION "admin_audit_refuse_change"();
