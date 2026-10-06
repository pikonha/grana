ALTER TYPE "public"."sync_kind" ADD VALUE 'pluggy';--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "pluggy_account_id" text;