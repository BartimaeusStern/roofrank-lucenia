import { NextResponse } from "next/server";
import { client, INDEX } from "@/lib/engine.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { body } = await client.get({ index: INDEX, id });
    const { description_vector, ...src } = (body._source ?? {}) as Record<string, any>;
    return NextResponse.json({ id, ...src });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
