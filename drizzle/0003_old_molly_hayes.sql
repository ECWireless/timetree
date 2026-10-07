ALTER TABLE "agent_api_keys" DROP CONSTRAINT "agent_api_keys_user_root_unique";--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD COLUMN "label" varchar(100) DEFAULT 'Agent key' NOT NULL;--> statement-breakpoint
UPDATE "agent_api_keys" SET "label" = 'Existing key';--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD COLUMN "access_level" varchar(16) DEFAULT 'read_write' NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_api_keys_user_root_idx" ON "agent_api_keys" USING btree ("user_id","root_node_id");--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_label_trimmed_length_check" CHECK ("agent_api_keys"."label" = btrim("agent_api_keys"."label") and char_length("agent_api_keys"."label") between 1 and 100);--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_access_level_check" CHECK ("agent_api_keys"."access_level" in ('read_only', 'read_write'));
