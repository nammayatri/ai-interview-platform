// Bulk-upload constants and types that are safe to import from browser code (no Node-only modules here).

export const MAX_BULK_ROWS = 200;

export interface BulkRow {
  rowNumber: number; // the row in the file (the header is row 1)
  email: string;
  name: string;
  role: string;
  code: string;
  errors: string[];
}

/** Sample file offered for download in the UI. */
export const SAMPLE_CSV =
  'email,name,role,parta_code\n' +
  'asha@example.com,Asha Rao,SDE,"def lock(x):\n    # paste the candidate\'s code in this cell\n    return True"\n' +
  'ravi@example.com,Ravi Kumar,SDE,"class Node:\n    pass"\n';
