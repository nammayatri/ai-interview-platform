import { describe, expect, it } from "vitest";
import { mapBulkRows, parseCsv, readSpreadsheet, MAX_BULK_ROWS, SAMPLE_CSV } from "../bulk-parse";

describe("parseCsv", () => {
  it("reads quoted cells with commas, escaped quotes and line breaks (this is what code looks like)", () => {
    const csv = 'email,name,role,parta_code\r\na@x.io,"Rao, Asha",SDE,"def f(a, b):\n    print(""hi"")\n    return a,b"\r\nb@x.io,Ravi,SDE,"x = 1"\r\n';
    const t = parseCsv(csv);
    expect(t).toHaveLength(3);
    expect(t[1]).toEqual(["a@x.io", "Rao, Asha", "SDE", 'def f(a, b):\n    print("hi")\n    return a,b']);
    expect(t[2][3]).toBe("x = 1");
  });
  it("strips a BOM and handles a last line without a newline", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("detects semicolons and tabs", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty cells", () => expect(parseCsv("a,b,c\n1,,3")[1]).toEqual(["1", "", "3"]));
  it("round-trips the sample file", () => {
    const t = parseCsv(SAMPLE_CSV);
    expect(t[0]).toEqual(["email", "name", "role", "parta_code"]);
    expect(t[1][3]).toContain("def lock(x):\n");
  });
});

describe("mapBulkRows", () => {
  const head = ["email", "name", "role", "parta_code"];
  it("maps the four columns, in any order and spelling", () => {
    const r = mapBulkRows([["Role", "Name", "Email Address", "Part A Code"], ["SDE", "Asha", "a@x.io", "code"]], { needCode: true });
    expect(r.rows[0]).toMatchObject({ email: "a@x.io", name: "Asha", role: "SDE", code: "code", errors: [], rowNumber: 2 });
  });
  it("names the missing columns", () => {
    const r = mapBulkRows([["email", "name"], ["a@x.io", "A"]], { needCode: true });
    expect(r.fatal).toMatch(/Missing column: parta_code/);
  });
  it("role is optional: only email and name are needed for a puzzle-only template", () => {
    const r = mapBulkRows([["email", "name"], ["a@x.io", "A"], ["b@x.io", "B"]], { needCode: false });
    expect(r.fatal).toBeUndefined();
    expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
    expect(r.rows[0].role).toBe("Software Engineer");
  });
  it("does not need parta_code when the template has no Part A", () => {
    const r = mapBulkRows([["email", "name", "role"], ["a@x.io", "A", "SDE"]], { needCode: false });
    expect(r.fatal).toBeUndefined();
    expect(r.rows[0].code).toBe("");
  });
  it("reports row problems and keeps going", () => {
    const r = mapBulkRows([head, ["bad", "", "SDE", ""], ["ok@x.io", "Ok", "SDE", "x"]], { needCode: true });
    expect(r.rows[0].errors).toEqual(["email is not valid", "name is empty", "parta_code is empty"]);
    expect(r.rows[1].errors).toEqual([]);
  });
  it("flags a duplicate email and a too-long code", () => {
    const r = mapBulkRows([head, ["a@x.io", "A", "SDE", "x"], ["A@x.io", "B", "SDE", "y".repeat(50001)]], { needCode: true });
    expect(r.rows[1].errors.join()).toMatch(/already on row 2/);
    expect(r.rows[1].errors.join()).toMatch(/longer than/);
  });
  it("skips blank lines and numbers rows as in the file", () => {
    const r = mapBulkRows([head, ["", "", "", ""], ["a@x.io", "A", "SDE", "x"]], { needCode: true });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].rowNumber).toBe(3);
  });
  it("rejects an empty file, a header-only file and too many rows", () => {
    expect(mapBulkRows([], { needCode: true }).fatal).toMatch(/empty/);
    expect(mapBulkRows([head], { needCode: true }).fatal).toMatch(/no candidate rows/);
    const many = [head, ...Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => [`u${i}@x.io`, "N", "SDE", "x"])];
    expect(mapBulkRows(many, { needCode: true }).fatal).toMatch(/limit is 200/);
  });
});

describe("readSpreadsheet", () => {
  it("reads csv", async () => {
    expect(await readSpreadsheet(Buffer.from("a,b\n1,2"), "x.csv")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("reads xlsx, including multi-line code cells and numbers", async () => {
    const writeXlsx = (await import("write-excel-file/node")).default as any;
    const data = [
      [{ value: "email" }, { value: "name" }, { value: "role" }, { value: "parta_code" }],
      [{ value: "a@x.io" }, { value: "Asha" }, { value: "SDE" }, { value: "def f():\n    return 1" }],
    ];
    const buffer: Buffer = await writeXlsx(data, { buffer: true });
    const t = await readSpreadsheet(buffer, "candidates.xlsx");
    expect(t[0]).toEqual(["email", "name", "role", "parta_code"]);
    expect(t[1][3]).toBe("def f():\n    return 1");
  });
  it("explains .xls and unknown types", async () => {
    await expect(readSpreadsheet(Buffer.from(""), "x.xls")).rejects.toThrow(/\.xlsx or \.csv/);
    await expect(readSpreadsheet(Buffer.from(""), "x.pdf")).rejects.toThrow(/\.csv or \.xlsx/);
  });
});
