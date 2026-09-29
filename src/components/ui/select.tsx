import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const EMPTY_SELECT_VALUE = "__empty_select_value__";
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between gap-3 border-2 border-input bg-white px-3 text-left text-sm font-medium text-black outline-none transition-all focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-[3px_3px_0_0_var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={4}
        className={cn(
          "brutal-shadow z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-hidden border-2 border-foreground bg-popover text-popover-foreground",
          position === "popper" &&
            "w-max min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)]",
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="max-h-60 p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-9 cursor-pointer select-none items-center py-2 pl-9 pr-3 text-sm font-medium outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
        className
      )}
      {...props}
    >
      <span className="absolute left-3">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
