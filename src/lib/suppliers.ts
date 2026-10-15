// Who the pharmacy can order from.
//
// There is no suppliers collection yet, so this is a fixed list to pick from,
// plus "Other" for anyone not on it. These are placeholders to be replaced with
// the pharmacy's real supplier list (or a collection an admin can edit) before
// the system is used for real orders.

export const SUPPLIERS: readonly string[] = [
  "Provincial medical depot",
  "Adcock Ingram",
  "Aspen Pharmacare",
  "Cipla Medpro",
  "Mylan (Viatris)",
];

/** The picker's entry for a supplier that isn't on the list; the name is typed. */
export const OTHER_SUPPLIER = "Other";

/**
 * The supplier to record, from the picker's choice and the typed name.
 * "Other" with no name is not a supplier (empty string).
 */
export function resolveSupplier(choice: string, typed: string): string {
  if (choice === OTHER_SUPPLIER) return typed.trim().slice(0, 80);
  return SUPPLIERS.includes(choice) ? choice : "";
}
