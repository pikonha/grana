// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionModal } from "./TransactionModal";

afterEach(cleanup);

const categories = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Groceries", color: "#2563eb" },
];
const accounts = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Checking",
    kind: "bank_account",
  },
];

describe("TransactionModal", () => {
  it("opens on demand and submits integer cents", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const initialDate = [
      new Date().getFullYear(),
      String(new Date().getMonth() + 1).padStart(2, "0"),
      String(new Date().getDate()).padStart(2, "0"),
    ].join("-");
    render(
      <TransactionModal
        type="earn"
        accounts={accounts}
        categories={categories}
        onCreate={onCreate}
        onCreateCategory={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar receita" }));

    const dialog = screen.getByRole("dialog");
    // Themed tokens, not hardcoded white/black.
    expect(dialog.classList.contains("bg-background")).toBe(true);
    expect(dialog.classList.contains("bg-white")).toBe(false);
    expect(within(dialog).getByLabelText("Repetir").textContent).toContain(
      "Não repetir"
    );
    const amountInput = within(dialog).getByLabelText("Valor (R$)");
    fireEvent.change(amountInput, { target: { value: "1234" } });
    expect((amountInput as HTMLInputElement).value.replace(/\s/g, " ")).toBe(
      "R$ 12,34"
    );
    expect(
      within(dialog)
        .getByRole("button", { name: "Etiquetas: Nenhuma" })
        .closest(".grid")
    ).toBe(within(dialog).getByLabelText("Repetir").closest(".grid"));
    expect(within(dialog).getByLabelText("Data").tagName).toBe("BUTTON");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Etiquetas: Nenhuma" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Groceries" }));
    fireEvent.click(within(dialog).getByLabelText("Conta"));
    fireEvent.click(
      screen.getByRole("option", { name: "Checking · conta bancária" })
    );
    fireEvent.change(within(dialog).getByLabelText("Nome"), {
      target: { value: "Paycheck" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar transação" })
    );

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        type: "earn",
        amount: 1234,
        date: initialDate,
        tag_ids: [categories[0].id],
        account_id: accounts[0].id,
        note: "Paycheck",
        recurrence: undefined,
        installments: undefined,
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("creates a tag without closing the dialog", async () => {
    const onCreateCategory = vi.fn().mockResolvedValue("new-tag-id");
    render(
      <TransactionModal
        type="expend"
        accounts={accounts}
        categories={categories}
        onCreate={vi.fn()}
        onCreateCategory={onCreateCategory}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Adicionar despesa" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Etiquetas: Nenhuma" })
    );
    const search = screen.getByLabelText("Buscar ou criar etiqueta");
    await waitFor(() => expect(document.activeElement).toBe(search));
    // The modal Dialog sets `pointer-events: none` on <body>; a dropdown that doesn't
    // opt back in lets clicks fall through to the overlay, which closes the Dialog.
    expect(document.body.style.pointerEvents).toBe("none");
    expect(search.closest('[style*="pointer-events: auto"]')).not.toBeNull();
    fireEvent.change(search, { target: { value: "Casa" } });
    const create = screen.getByRole("button", { name: 'Criar "Casa"' });
    fireEvent.pointerDown(create);
    fireEvent.click(create);

    await waitFor(() =>
      expect(onCreateCategory).toHaveBeenCalledWith("Casa", expect.any(String))
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the selected repeat option and submits recurrence", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <TransactionModal
        type="earn"
        accounts={accounts}
        categories={categories}
        onCreate={onCreate}
        onCreateCategory={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Adicionar receita" }));
    const dialog = screen.getByRole("dialog");
    const repeatSelect = within(dialog).getByLabelText("Repetir");
    fireEvent.click(repeatSelect);
    fireEvent.click(screen.getByRole("option", { name: "Mensal" }));
    expect(repeatSelect.textContent).toContain("Mensal");

    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), {
      target: { value: "1000" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar transação" })
    );

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence: { interval: "monthly" },
          installments: undefined,
        })
      )
    );
  });

  it("opens edit mode with the transaction already filled", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <TransactionModal
        type="expend"
        accounts={accounts}
        categories={categories}
        trigger={<button type="button">Editar</button>}
        initialTransaction={{
          id: "33333333-3333-4333-8333-333333333333",
          type: "expend",
          amount: 4567,
          date: "2026-07-15",
          tags: [{ id: categories[0].id }],
          accountId: accounts[0].id,
          note: "Lunch",
        }}
        onUpdate={onUpdate}
        onCreateCategory={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("heading").textContent).toBe(
      "Editar transação"
    );
    expect(within(dialog).queryByLabelText("Repetir")).toBeNull();
    expect((within(dialog).getByLabelText("Nome") as HTMLInputElement).value).toBe(
      "Lunch"
    );
    expect(
      (
        within(dialog).getByLabelText("Valor (R$)") as HTMLInputElement
      ).value.replace(/\s/g, " ")
    ).toBe("R$ 45,67");
    expect(within(dialog).getByLabelText("Data").textContent).toContain(
      "15/07/2026"
    );
    expect(within(dialog).getByLabelText("Tipo").textContent).toContain(
      "Despesa"
    );
    expect(within(dialog).getByLabelText("Conta").textContent).toContain(
      "Checking"
    );

    fireEvent.change(within(dialog).getByLabelText("Nome"), {
      target: { value: "Updated lunch" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar transação" })
    );

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        id: "33333333-3333-4333-8333-333333333333",
        type: "expend",
        amount: 4567,
        date: "2026-07-15",
        tag_ids: [categories[0].id],
        account_id: accounts[0].id,
        note: "Updated lunch",
      })
    );
  });

  it("keeps the modal open and shows server errors", async () => {
    render(
      <TransactionModal
        type="expend"
        accounts={[]}
        categories={[]}
        onCreate={vi.fn().mockRejectedValue(new Error("Save failed"))}
        onCreateCategory={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Adicionar despesa" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), {
      target: { value: "100" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Adicionar transação" })
    );
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Save failed"
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
