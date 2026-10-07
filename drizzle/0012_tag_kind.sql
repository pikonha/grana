CREATE TYPE "public"."tag_kind" AS ENUM('earn', 'expend');--> statement-breakpoint
ALTER TABLE "tag" ADD COLUMN "kind" "tag_kind" DEFAULT 'expend' NOT NULL;--> statement-breakpoint
-- Tags used only on earn rows (and the opening-balance tag) become earn categories; the rest stay expend.
UPDATE "tag" SET "kind" = 'earn' WHERE lower(trim("name")) = 'saldo inicial' OR (
  "id" IN (SELECT tt."tag_id" FROM "transaction_tag" tt JOIN "transaction" t ON t."id" = tt."transaction_id" WHERE t."type" = 'earn'
    UNION SELECT rt."tag_id" FROM "recurrence_rule_tag" rt JOIN "recurrence_rule" r ON r."id" = rt."recurrence_rule_id" WHERE r."type" = 'earn')
  AND "id" NOT IN (SELECT tt."tag_id" FROM "transaction_tag" tt JOIN "transaction" t ON t."id" = tt."transaction_id" WHERE t."type" <> 'earn'
    UNION SELECT rt."tag_id" FROM "recurrence_rule_tag" rt JOIN "recurrence_rule" r ON r."id" = rt."recurrence_rule_id" WHERE r."type" <> 'earn')
);
