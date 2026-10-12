import { templateHandlers as h } from "@/lib/templates-api";

export async function GET(req: Request) {
  return h.list(req);
}

export async function POST(req: Request) {
  return h.create(req);
}
