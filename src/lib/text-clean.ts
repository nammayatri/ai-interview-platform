/** Postgres text columns cannot hold a NUL character, and PDF text extraction can produce them. */
export function stripNul(value: string): string;
export function stripNul(value: string | null | undefined): string | null | undefined;
export function stripNul(value: string | null | undefined): string | null | undefined {
  return typeof value === "string" ? value.replace(/\u0000/g, "") : value;
}
