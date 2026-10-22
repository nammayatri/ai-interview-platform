import { describe, it, expect } from "vitest";
import { mapInviteRows, parseCsv, MAX_INVITE_ROWS } from "../bulk-parse";
import { inviteStatus } from "../batch-invites";

describe("mapInviteRows", () => {
  it("reads emails with or without a name, in any column order and header spelling", () => {
    const r = mapInviteRows(parseCsv("Name,E-mail Address\nAsha Rao,asha@example.com\n,ravi@example.com\n"));
    expect(r.fatal).toBeUndefined();
    expect(r.rows.map((x) => [x.email, x.name, x.errors.length])).toEqual([["asha@example.com", "Asha Rao", 0], ["ravi@example.com", "", 0]]);
    expect(mapInviteRows(parseCsv("email\na@b.co\n")).rows[0].errors).toEqual([]);
  });
  it("flags bad and duplicate emails, skips blank lines, and says when the email column is missing", () => {
    const r = mapInviteRows(parseCsv("email,name\nnot-an-email,X\nA@b.co,A\n\na@B.co,A again\n"));
    expect(r.rows[0].errors).toContain("email is not valid");
    expect(r.rows[2].errors[0]).toMatch(/already on row 3/);
    expect(mapInviteRows(parseCsv("name\nA\n")).fatal).toMatch(/Missing the email column/);
    expect(mapInviteRows([]).fatal).toMatch(/empty/);
    expect(mapInviteRows(parseCsv("email\n")).fatal).toMatch(/no candidate rows/);
  });
  it("refuses a file over the row limit", () => {
    const big = "email\n" + Array.from({ length: MAX_INVITE_ROWS + 1 }, (_, i) => `u${i}@x.co`).join("\n");
    expect(mapInviteRows(parseCsv(big)).fatal).toMatch(/limit/);
  });
});

describe("inviteStatus", () => {
  it("follows the candidate from invited to completed", () => {
    expect(inviteStatus({ email_status: "pending" })).toBe("invited");
    expect(inviteStatus({ email_status: "sent" })).toBe("email_sent");
    expect(inviteStatus({ email_status: "failed" })).toBe("email_failed");
    expect(inviteStatus({ email_status: "sent", interview_id: "i", interview_status: "waiting" })).toBe("logged_in");
    expect(inviteStatus({ email_status: "sent", interview_id: "i", interview_status: "in_progress", started_at: new Date() })).toBe("started");
    expect(inviteStatus({ email_status: "failed", interview_id: "i", interview_status: "completed" })).toBe("completed");
  });
});
