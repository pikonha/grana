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
import { TransferModal } from "./TransferModal";
import { localDateKey } from "./ui/date-picker";

afterEach(cleanup);

// ponytail: derived from the clock — the picker opens on the current month, so a
// hardcoded date only passes during that month. Fake timers deadlock waitFor here.
const pickedDate = new Date();
const pickedDateKey = localDateKey(pickedDate);
const pickedDateLabel = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(pickedDate);

const accounts = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Checking" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Savings" },
];

describe("TransferModal", () => {
  it("opens on demand and submits integer cents", async () => {
    const onTransfer = vi.fn().mockResolvedValue(undefined);
    render(<TransferModal accounts={accounts} onTransfer={onTransfer} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transferir" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("De"));
    fireEvent.click(screen.getByRole("option", { name: "Checking" }));
    fireEvent.click(within(dialog).getByLabelText("Para"));
    expect(
      screen.getByRole("option", { name: "Checking" }).getAttribute(
        "aria-disabled"
      )
    ).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Savings" }));
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), {
      target: { value: "12.34" },
    });
    fireEvent.click(within(dialog).getByLabelText("Data"));
    fireEvent.click(
      screen.getByRole("gridcell", { name: pickedDateLabel })
    );
    fireEvent.change(within(dialog).getByLabelText("Hora (opcional)"), {
      target: { value: "08:05" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Transferir" }));

    await waitFor(() =>
      expect(onTransfer).toHaveBeenCalledWith({
        amount: 1234,
        date: pickedDateKey,
        time: "08:05",
        account_id: accounts[0].id,
        counter_account_id: accounts[1].id,
        note: "Transferência",
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits an existing transfer", async () => {
    const onTransfer = vi.fn().mockResolvedValue(undefined);
    render(
      <TransferModal
        accounts={accounts}
        onTransfer={onTransfer}
        trigger={<button type="button">Editar</button>}
        initialTransfer={{
          amount: 1533510,
          date: "2026-09-21",
          accountId: accounts[0].id,
          counterAccountId: accounts[1].id,
          note: "Transferência",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = screen.getByRole("dialog");
    expect(
      (within(dialog).getByLabelText("Valor (R$)") as HTMLInputElement).value
    ).toBe("15335.10");
    fireEvent.change(within(dialog).getByLabelText("Descrição"), {
      target: { value: "caução casa nova" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Salvar transferência" })
    );

    await waitFor(() =>
      expect(onTransfer).toHaveBeenCalledWith({
        amount: 1533510,
        date: "2026-09-21",
        account_id: accounts[0].id,
        counter_account_id: accounts[1].id,
        note: "caução casa nova",
      })
    );
  });

  it("closes without submitting", () => {
    const onTransfer = vi.fn();
    render(<TransferModal accounts={accounts} onTransfer={onTransfer} />);

    fireEvent.click(screen.getByRole("button", { name: "Transferir" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancelar",
      })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onTransfer).not.toHaveBeenCalled();
  });
});
