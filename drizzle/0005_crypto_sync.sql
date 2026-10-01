CREATE TYPE "public"."sync_kind" AS ENUM('wallet', 'etherfi_cash');--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "sync_kind" "sync_kind";--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "sync_since" date;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "sync_cursor" jsonb;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "usd_amount" integer;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "uq_transaction_external" UNIQUE("user_id","external_id");