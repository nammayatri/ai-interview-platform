import { runbookHandlers as h } from "@/lib/runbooks-api";

export async function GET(req: Request) {
  return h.list(req);
}

export async function POST(req: Request) {
  return h.create(req);
}
