// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategorySelect } from "./CategorySelect";

afterEach(cleanup);

const tag = (id: string, name: string, color = "#2563eb") => ({ id, name, color });

describe("CategorySelect", () => {
  it("filters and selects an existing tag", () => {
    const onChange = vi.fn();
    render(
      <CategorySelect
        categories={[tag("groceries-id", "Groceries"), tag("travel-id", "Travel", "#16a34a")]}
        value={[]}
        onChange={onChange}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    fireEvent.change(screen.getByLabelText("Buscar ou criar etiqueta"), {
      target: { value: "trav" },
    });

    expect(screen.queryByRole("option", { name: "Groceries" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Travel" }));

    expect(onChange).toHaveBeenCalledWith(["travel-id"]);
    expect(screen.getByLabelText("Buscar ou criar etiqueta")).toBeTruthy();
  });

  it("creates and selects a colored tag inside the dropdown", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn().mockResolvedValue("new-id");
    render(
      <CategorySelect
        categories={[tag("existing-id", "Groceries")]}
        value={[]}
        onChange={onChange}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    fireEvent.change(screen.getByLabelText("Buscar ou criar etiqueta"), {
      target: { value: "  Travel  " },
    });
    fireEvent.change(screen.getByLabelText("Cor da etiqueta"), {
      target: { value: "#16a34a" },
    });
    fireEvent.click(screen.getByRole("button", { name: 'Criar "Travel"' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Travel", "#16a34a"));
    expect(onChange).toHaveBeenCalledWith(["new-id"]);
    expect(screen.queryByLabelText("Buscar ou criar etiqueta")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    expect(screen.getByRole("option", { name: "Travel" })).toBeTruthy();
  });

  it("selects an exact match on Enter instead of creating a duplicate", () => {
    const onChange = vi.fn();
    const onCreate = vi.fn();
    render(
      <CategorySelect
        categories={[tag("travel-id", "Travel")]}
        value={[]}
        onChange={onChange}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    const search = screen.getByLabelText("Buscar ou criar etiqueta");
    fireEvent.change(search, { target: { value: "travel" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onCreate).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(["travel-id"]);
  });

  it("keeps the dropdown open and reports creation failures", async () => {
    render(
      <CategorySelect
        categories={[]}
        value={[]}
        onChange={vi.fn()}
        onCreate={vi.fn().mockRejectedValue(new Error("Etiqueta duplicada"))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    fireEvent.change(screen.getByLabelText("Buscar ou criar etiqueta"), {
      target: { value: "Travel" },
    });
    fireEvent.click(screen.getByRole("button", { name: 'Criar "Travel"' }));

    expect((await screen.findByRole("alert")).textContent).toBe("Etiqueta duplicada");
    expect(screen.getByLabelText("Buscar ou criar etiqueta")).toBeTruthy();
  });

  it("closes on Escape without changing the selection", () => {
    const onChange = vi.fn();
    render(
      <CategorySelect categories={[]} value={[]} onChange={onChange} onCreate={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    fireEvent.keyDown(screen.getByLabelText("Buscar ou criar etiqueta"), {
      key: "Escape",
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Buscar ou criar etiqueta")).toBeNull();
  });

  it("toggles options with arrow keys and Space", () => {
    const onChange = vi.fn();
    render(
      <CategorySelect
        categories={[tag("groceries-id", "Groceries"), tag("travel-id", "Travel")]}
        value={[]}
        onChange={onChange}
        onCreate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Etiquetas: Nenhuma" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const search = screen.getByRole("combobox", { name: "Buscar ou criar etiqueta" });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: " " });

    expect(onChange).toHaveBeenCalledWith(["groceries-id"]);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("keeps dropdown options out of the form Tab order", () => {
    render(
      <>
        <CategorySelect
          categories={[tag("groceries-id", "Groceries")]}
          value={[]}
          onChange={vi.fn()}
          onCreate={vi.fn()}
        />
        <button type="button">Next field</button>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Nenhuma" }));
    screen.getByRole("combobox", { name: "Buscar ou criar etiqueta" });
    expect(screen.getAllByRole("option").every((option) => option.tabIndex === -1)).toBe(true);

    act(() => screen.getByRole("button", { name: "Next field" }).focus());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("asks where to move an in-use tag before deleting it", async () => {
    const onChange = vi.fn();
    const onDelete = vi
      .fn()
      .mockResolvedValueOnce({ deleted: false, inUse: 3 })
      .mockResolvedValueOnce({ deleted: true, inUse: 0 });
    render(
      <CategorySelect
        categories={[tag("food-id", "Food"), tag("travel-id", "Travel")]}
        value={["food-id"]}
        onChange={onChange}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Etiquetas: Food" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir etiqueta Food" }));

    expect(await screen.findByText(/está em 3 lançamentos/)).toBeTruthy();
    expect(onDelete).toHaveBeenLastCalledWith("food-id", undefined);

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(onDelete).toHaveBeenLastCalledWith("food-id", "travel-id"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["travel-id"]));
    await waitFor(() => expect(screen.queryByText(/está em 3 lançamentos/)).toBeNull());
  });
});
