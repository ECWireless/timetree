CREATE TABLE "agent_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"root_node_id" uuid NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_api_keys_user_root_unique" UNIQUE("user_id","root_node_id"),
	CONSTRAINT "agent_api_keys_secret_hash_check" CHECK ("agent_api_keys"."secret_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_root_owner_fk" FOREIGN KEY ("user_id","root_node_id") REFERENCES "public"."nodes"("user_id","id") ON DELETE cascade ON UPDATE no action;