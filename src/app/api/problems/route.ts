import { contentHandlers } from "@/lib/content-api";

const h = contentHandlers("problem");

export async function GET(req: Request) {
  return h.list(req);
}

export async function POST(req: Request) {
  return h.create(req);
}
