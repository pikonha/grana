import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { listAccounts } from "#/server/accounts";
import { listCategories } from "#/server/categories";
import { listFaturas } from "#/server/faturas";
import { listTransactions } from "#/server/transactions";
import { ReportCharts } from "@/components/ReportCharts";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authed/report")({ component: Report });

function Report() {
  const [showValues, setShowValues] = useState(true);
  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => listTransactions(),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories(),
  });
  const { data: faturas = [] } = useQuery({
    queryKey: ["faturas"],
    queryFn: () => listFaturas(),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
  });

  return (
    <main className="page-wrap rise-in py-6 sm:py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-muted-foreground">Relatórios</p>
          <h1 className="display-title text-3xl font-bold sm:text-4xl">
            Para onde vai o dinheiro.
          </h1>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowValues((current) => !current)}
          aria-pressed={!showValues}
          aria-label={showValues ? "Ocultar valores" : "Mostrar valores"}
          title={showValues ? "Ocultar valores" : "Mostrar valores"}
        >
          {showValues ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </Button>
      </div>
      <ReportCharts
        transactions={transactions}
        categories={categories}
        faturas={faturas}
        accounts={accounts}
        showValues={showValues}
      />
    </main>
  );
}
