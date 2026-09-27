import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const token = process.env.SIGNALFORGE_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "No access token is configured." }, { status: 400 });
  const body = (await request.json()) as { password?: string };
  if (body.password !== token) return NextResponse.json({ error: "Incorrect access token." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("sf_session", createHash("sha256").update(token).digest("hex"), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
  });
  return response;
}
