// Reads the bulk-upload file (CSV or Excel) into candidate rows and validates them.
// Columns: email, name, role, parta_code (parta_code is only needed when the template has a Part A stage).
import { LIMITS } from "./runbook";
import { MAX_BULK_ROWS, type BulkRow } from "./bulk-shared";

export { MAX_BULK_ROWS, SAMPLE_CSV } from "./bulk-shared";
export type { BulkRow } from "./bulk-shared";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** RFC 4180 CSV reader: quoted cells may contain commas, quotes ("") and line breaks, which code always does. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  // The delimiter is whichever of , ; tab appears most in the header line (Excel in some locales saves with ;).
  const header = text.split(/\r?\n/)[0] || "";
  const count = (ch: string) => header.split(ch).length - 1;
  const delim = [",", ";", "\t"].reduce((best, d) => (count(d) > count(best) ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Turns an uploaded file into rows of cells. */
export async function readSpreadsheet(buffer: Buffer, filename: string): Promise<string[][]> {
  const name = filename.toLowerCase();
  if (name.endsWith(".xlsx")) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const readXlsx = require("read-excel-file/node");
    const rows: unknown[][] = await readXlsx(buffer);
    return rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString() : String(c))));
  }
  if (name.endsWith(".xls")) throw new Error("Old .xls files are not supported. Save the sheet as .xlsx or .csv and upload that.");
  if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) return parseCsv(buffer.toString("utf8"));
  throw new Error("Upload a .csv or .xlsx file.");
}

export interface BulkParseResult {
  rows: BulkRow[];
  /** Set when the file as a whole cannot be used (missing columns, no rows, too many rows). */
  fatal?: string;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<"email" | "name" | "role" | "code", string[]> = {
  email: ["email", "emailaddress", "candidateemail", "mail"],
  name: ["name", "candidatename", "fullname"],
  role: ["role", "jobrole", "position", "designation"],
  code: ["partacode", "partacodes", "partacandidatecode", "code", "submission", "partasubmission", "partacodesubmission"],
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mapBulkRows(table: string[][], opts: { needCode: boolean }): BulkParseResult {
  if (table.length === 0) return { rows: [], fatal: "The file is empty." };
  const header = table[0].map(norm);
  const col = (k: keyof typeof ALIASES) => header.findIndex((h) => ALIASES[k].includes(h));
  const idx = { email: col("email"), name: col("name"), role: col("role"), code: col("code") };
  const missing: string[] = [];
  if (idx.email < 0) missing.push("email");
  if (idx.name < 0) missing.push("name");
  if (idx.role < 0) missing.push("role");
  if (opts.needCode && idx.code < 0) missing.push("parta_code");
  if (missing.length) {
    return { rows: [], fatal: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. The first row must be a header with: email, name, role${opts.needCode ? ", parta_code" : ""}. Found: ${table[0].filter(Boolean).join(", ") || "(nothing)"}.` };
  }

  const cell = (r: string[], i: number) => (i >= 0 && r[i] !== undefined ? r[i] : "");
  const raw: Array<Omit<BulkRow, "errors">> = [];
  table.slice(1).forEach((r, i) => {
    if (r.every((c) => String(c ?? "").trim() === "")) return; // blank line
    raw.push({
      rowNumber: i + 2,
      email: cell(r, idx.email).trim(),
      name: cell(r, idx.name).trim(),
      role: cell(r, idx.role).trim(),
      code: opts.needCode ? cell(r, idx.code).replace(/\r\n/g, "\n") : "",
    });
  });
  if (raw.length === 0) return { rows: [], fatal: "The file has a header but no candidate rows." };
  if (raw.length > MAX_BULK_ROWS) return { rows: [], fatal: `The file has ${raw.length} rows. The limit is ${MAX_BULK_ROWS} per upload; split it into smaller files.` };
  return { rows: validateBulkRows(raw, opts.needCode) };
}

/** Checks each row and flags duplicate emails. Used on upload and again on the server before anything is created. */
export function validateBulkRows(rows: Array<Omit<BulkRow, "errors">>, needCode: boolean): BulkRow[] {
  const seenEmail = new Map<string, number>();
  return rows.map((r) => {
    const row: BulkRow = { rowNumber: r.rowNumber, email: String(r.email ?? "").trim(), name: String(r.name ?? "").trim(), role: String(r.role ?? "").trim(), code: needCode ? String(r.code ?? "") : "", errors: [] };
    if (!row.email) row.errors.push("email is empty");
    else if (!EMAIL_RE.test(row.email)) row.errors.push("email is not valid");
    if (!row.name) row.errors.push("name is empty");
    if (!row.role) row.errors.push("role is empty");
    if (needCode) {
      if (!row.code.trim()) row.errors.push("parta_code is empty");
      else if (row.code.length > LIMITS.codeChars) row.errors.push(`parta_code is longer than ${LIMITS.codeChars.toLocaleString()} characters`);
    }
    const key = row.email.toLowerCase();
    if (key) {
      if (seenEmail.has(key)) row.errors.push(`the same email is already on row ${seenEmail.get(key)}`);
      else seenEmail.set(key, row.rowNumber);
    }
    return row;
  });
}

