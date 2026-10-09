import { runbookHandlers as h } from "@/lib/runbooks-api";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return h.get(req, (await params).id);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return h.update(req, (await params).id);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return h.archive(req, (await params).id);
}
