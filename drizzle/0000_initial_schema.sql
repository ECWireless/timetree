CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "active_timers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"work_date" date NOT NULL,
	"hourly_rate_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "active_timers_user_node_unique" UNIQUE("user_id","node_id"),
	CONSTRAINT "active_timers_hourly_rate_non_negative_check" CHECK ("active_timers"."hourly_rate_cents" is null or "active_timers"."hourly_rate_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"position" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"hourly_rate_cents" integer,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "nodes_sibling_position_unique" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","position") DEFERRABLE INITIALLY IMMEDIATE,
	CONSTRAINT "nodes_not_own_parent_check" CHECK ("nodes"."parent_id" is null or "nodes"."parent_id" <> "nodes"."id"),
	CONSTRAINT "nodes_position_non_negative_check" CHECK ("nodes"."position" >= 0),
	CONSTRAINT "nodes_title_trimmed_length_check" CHECK ("nodes"."title" = btrim("nodes"."title") and char_length("nodes"."title") between 1 and 200),
	CONSTRAINT "nodes_hourly_rate_non_negative_check" CHECK ("nodes"."hourly_rate_cents" is null or "nodes"."hourly_rate_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer NOT NULL,
	"hourly_rate_cents" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_duration_positive_check" CHECK ("time_entries"."duration_seconds" > 0),
	CONSTRAINT "time_entries_timestamp_pair_check" CHECK (("time_entries"."started_at" is null and "time_entries"."ended_at" is null) or ("time_entries"."started_at" is not null and "time_entries"."ended_at" is not null)),
	CONSTRAINT "time_entries_timestamp_order_check" CHECK ("time_entries"."started_at" is null or "time_entries"."ended_at" > "time_entries"."started_at"),
	CONSTRAINT "time_entries_hourly_rate_non_negative_check" CHECK ("time_entries"."hourly_rate_cents" is null or "time_entries"."hourly_rate_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_timers" ADD CONSTRAINT "active_timers_node_owner_fk" FOREIGN KEY ("user_id","node_id") REFERENCES "public"."nodes"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_owner_fk" FOREIGN KEY ("user_id","parent_id") REFERENCES "public"."nodes"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_node_owner_fk" FOREIGN KEY ("user_id","node_id") REFERENCES "public"."nodes"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "active_timers_user_id_idx" ON "active_timers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "time_entries_history_idx" ON "time_entries" USING btree ("user_id","node_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
