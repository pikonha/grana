ALTER TABLE "installment_plan" DROP CONSTRAINT "installment_plan_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_recurrence_rule_id_recurrence_rule_id_fk";
--> statement-breakpoint
ALTER TABLE "installment_plan" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_recurrence_rule_id_recurrence_rule_id_fk" FOREIGN KEY ("recurrence_rule_id") REFERENCES "public"."recurrence_rule"("id") ON DELETE set null ON UPDATE no action;