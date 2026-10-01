import { useState } from "react";
import { Upload } from "lucide-react";
import type { TransactionRow } from "#/server/transactions";
import { CSV_TEMPLATE, dupKey, normalizeForMatch, normalizeHeader, parseCSV, sniffDelimiter, toCents, toIsoDate } from "#/lib/csv";
import { formatCentsBRL } from "#/lib/money";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type AccountOption = { id: string; name: string };
type ParsedRow = { line: number; date: string; amount: number; type: "earn" | "expend"; categoria: string; conta: string; nota: string; error?: string; isDup?: boolean; includeDup?: boolean };

export function ImportCsvModal({
  transactions,
  accounts,
  onImport,
  onCreateAccount,
}: {
  transactions: TransactionRow[];
  accounts: AccountOption[];
  onImport: (rows: { type: "earn" | "expend"; amount: number; date: string; tag_names?: string[]; account_id?: string; note?: string }[]) => Promise<{ count: number }>;
  onCreateAccount: (name: string) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [treatAsExpense, setTreatAsExpense] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setStep(1);
    setRows([]);
    setTreatAsExpense(false);
    setError("");
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 1024 * 1024) {
      setError("Arquivo muito grande (máximo 1MB)");
      return;
    }
    setError("");
    const text = await selected.text();
    const delimiter = sniffDelimiter(text.split("\n")[0]);
    const parsed = parseCSV(text, delimiter);
    if (parsed.length < 2) {
      setError("Arquivo vazio ou sem dados");
      return;
    }
    const headerMap = normalizeHeader(parsed[0]);
    if (!headerMap.has("data") || !headerMap.has("valor")) {
      setError('Colunas obrigatórias ausentes: "data" e "valor"');
      return;
    }
    const dataIdx = headerMap.get("data")!;
    const valorIdx = headerMap.get("valor")!;
    const categoriaIdx = headerMap.get("categoria");
    const contaIdx = headerMap.get("conta");
    const notaIdx = headerMap.get("nota");
    const accountNormMap = new Map<string, string>();
    for (const acc of accounts) accountNormMap.set(normalizeForMatch(acc.name), acc.id);
    const existingDups = new Set(transactions.map((t) => dupKey(t.date, t.type, t.amount)));
    const fileDups = new Set<string>();
    const newRows: ParsedRow[] = [];
    for (let i = 1; i < parsed.length; i++) {
      const row = parsed[i];
      const line = i + 1;
      const dateRaw = row[dataIdx] ?? "";
      const valorRaw = row[valorIdx] ?? "";
      const categoria = categoriaIdx !== undefined ? (row[categoriaIdx] ?? "").trim() : "";
      const conta = contaIdx !== undefined ? (row[contaIdx] ?? "").trim() : "";
      const nota = notaIdx !== undefined ? (row[notaIdx] ?? "").trim() : "";
      const date = toIsoDate(dateRaw);
      const cents = toCents(valorRaw);
      if (!date) {
        newRows.push({ line, date: "", amount: 0, type: "expend", categoria, conta, nota, error: "Data inválida" });
        continue;
      }
      if (cents === null) {
        newRows.push({ line, date, amount: 0, type: "expend", categoria, conta, nota, error: "Valor inválido ou zero" });
        continue;
      }
      const type = cents < 0 ? "expend" : "earn";
      const amount = Math.abs(cents);
      let error: string | undefined;
      if (conta && !accountNormMap.has(normalizeForMatch(conta))) {
        error = "Conta desconhecida";
      }
      const key = dupKey(date, type, amount);
      const isDup = existingDups.has(key) || fileDups.has(key);
      fileDups.add(key);
      newRows.push({ line, date, amount, type, categoria, conta, nota, error, isDup, includeDup: !isDup });
    }
    if (newRows.length > 1000) {
      setError("Máximo de 1000 linhas permitido");
      return;
    }
    setRows(newRows);
    setStep(2);
  };

  const accountNormMap = new Map<string, string>();
  for (const acc of accounts) accountNormMap.set(normalizeForMatch(acc.name), acc.id);
  const unknownAccounts = [...new Set(rows.filter((r) => r.conta && !accountNormMap.has(normalizeForMatch(r.conta))).map((r) => r.conta))];
  const finalRows = rows.map((r) => ({
    ...r,
    type: treatAsExpense && r.type === "earn" ? ("expend" as const) : r.type,
    error: r.conta && !accountNormMap.has(normalizeForMatch(r.conta)) ? "Conta desconhecida" : r.error === "Conta desconhecida" ? undefined : r.error,
  }));
  const validRows = finalRows.filter((r) => !r.error && r.includeDup);
  const earnRows = validRows.filter((r) => r.type === "earn");
  const expendRows = validRows.filter((r) => r.type === "expend");
  const earnTotal = earnRows.reduce((sum, r) => sum + r.amount, 0);
  const expendTotal = expendRows.reduce((sum, r) => sum + r.amount, 0);
  const hasInvalid = finalRows.some((r) => r.error);
  const canSubmit = !hasInvalid && validRows.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError("");
    try {
      const payload = validRows.map((r) => ({
        type: r.type,
        amount: r.amount,
        date: r.date,
        tag_names: r.categoria ? [r.categoria] : undefined,
        account_id: r.conta ? accountNormMap.get(normalizeForMatch(r.conta)) : undefined,
        note: r.nota || undefined,
      }));
      await onImport(payload);
      setOpen(false);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao importar");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAccount = async (name: string) => {
    const id = await onCreateAccount(name);
    accountNormMap.set(normalizeForMatch(name), id);
    setRows([...rows]);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isSaving) { setOpen(nextOpen); if (!nextOpen) reset(); } }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Importar CSV">
          <Upload className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar transações (CSV)</DialogTitle>
          <DialogDescription>
            {step === 1 ? "Faça upload de um arquivo CSV com suas transações." : "Revise e confirme a importação."}
          </DialogDescription>
        </DialogHeader>
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-md border p-4">
              <h3 className="mb-2 text-sm font-semibold">Formato esperado</h3>
              <table className="mb-3 text-sm">
                <thead><tr className="border-b"><th className="px-2 py-1 text-left">Coluna</th><th className="px-2 py-1 text-left">Obrigatório</th><th className="px-2 py-1 text-left">Formato</th></tr></thead>
                <tbody>
                  <tr><td className="px-2 py-1">data</td><td className="px-2 py-1">Sim</td><td className="px-2 py-1">2026-07-01 ou 01/07/2026 (DD/MM)</td></tr>
                  <tr><td className="px-2 py-1">valor</td><td className="px-2 py-1">Sim</td><td className="px-2 py-1">1.234,56 ou 1234.56 (+ receita, - despesa)</td></tr>
                  <tr><td className="px-2 py-1">categoria</td><td className="px-2 py-1">Não</td><td className="px-2 py-1">Nome (criado se não existir)</td></tr>
                  <tr><td className="px-2 py-1">conta</td><td className="px-2 py-1">Não</td><td className="px-2 py-1">Nome (deve existir)</td></tr>
                  <tr><td className="px-2 py-1">nota</td><td className="px-2 py-1">Não</td><td className="px-2 py-1">Texto livre</td></tr>
                </tbody>
              </table>
              <Button type="button" onClick={downloadTemplate} variant="outline" size="sm">Baixar modelo CSV</Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="csv-file">Arquivo CSV</Label>
              <Input id="csv-file" type="file" accept=".csv,text/csv" onChange={handleFileChange} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex gap-6 text-sm">
                <span>Receitas: {earnRows.length} · {formatCentsBRL(earnTotal)}</span>
                <span>Despesas: {expendRows.length} · {formatCentsBRL(expendTotal)}</span>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={treatAsExpense} onChange={(e) => setTreatAsExpense(e.target.checked)} />
                Tratar todos como despesa
              </label>
            </div>
            {unknownAccounts.length > 0 && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-3">
                <p className="mb-2 text-sm font-semibold">Contas desconhecidas</p>
                <div className="space-y-1">
                  {unknownAccounts.map((name) => (
                    <div key={name} className="flex items-center justify-between text-sm">
                      <span>{name}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => handleCreateAccount(name)}>+ Criar conta</Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background"><tr className="border-b"><th className="px-2 py-1 text-left">Linha</th><th className="px-2 py-1 text-left">Data</th><th className="px-2 py-1 text-left">Tipo</th><th className="px-2 py-1 text-left">Valor</th><th className="px-2 py-1 text-left">Categoria</th><th className="px-2 py-1 text-left">Conta</th><th className="px-2 py-1 text-left">Status</th></tr></thead>
                <tbody>
                  {finalRows.map((r, idx) => (
                    <tr key={idx} className={`border-b ${r.error ? "bg-destructive/10" : r.isDup && !r.includeDup ? "bg-muted" : ""}`}>
                      <td className="px-2 py-1">{r.line}</td>
                      <td className="px-2 py-1">{r.date || "—"}</td>
                      <td className="px-2 py-1">{r.type === "earn" ? "Receita" : "Despesa"}</td>
                      <td className="px-2 py-1">{r.amount ? formatCentsBRL(r.amount) : "—"}</td>
                      <td className="px-2 py-1">{r.categoria || "—"}</td>
                      <td className="px-2 py-1">{r.conta || "—"}</td>
                      <td className="px-2 py-1">
                        {r.error ? <span className="text-destructive">{r.error}</span> : r.isDup ? (
                          <label className="flex cursor-pointer items-center gap-1">
                            <Checkbox checked={r.includeDup} onChange={(e) => { r.includeDup = e.target.checked; setRows([...rows]); }} />
                            <span className="text-muted-foreground">Duplicado</span>
                          </label>
                        ) : "OK"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild><Button type="button" variant="ghost" disabled={isSaving}>Cancelar</Button></DialogClose>
              <Button onClick={handleSubmit} disabled={!canSubmit || isSaving}>{isSaving ? "Importando…" : `Importar ${validRows.length} transações`}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
