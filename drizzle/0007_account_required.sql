ALTER TABLE "installment_plan" DROP CONSTRAINT "installment_plan_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "recurrence_rule" DROP CONSTRAINT "recurrence_rule_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" DROP CONSTRAINT "transaction_counter_account_id_account_id_fk";
--> statement-breakpoint
ALTER TABLE "installment_plan" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_counter_account_id_account_id_fk" FOREIGN KEY ("counter_account_id") REFERENCES "public"."account"("id") ON DELETE restrict ON UPDATE no action;