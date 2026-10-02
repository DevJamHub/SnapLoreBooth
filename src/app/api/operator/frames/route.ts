import { NextResponse } from 'next/server';
import { FrameInputError, saveFrame } from '@/lib/frames';

export const dynamic = 'force-dynamic';

/**
 * Operator-only (see middleware): stores a frame prepared in the console — the PNG with
 * transparent holes, and where those holes are.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'kirim sebagai form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'file frame wajib ada' }, { status: 400 });

  let slots: unknown;
  try {
    slots = JSON.parse(String(form.get('slots') ?? ''));
  } catch {
    return NextResponse.json({ error: 'posisi lubang foto tidak valid' }, { status: 400 });
  }

  try {
    const frame = await saveFrame({
      name: String(form.get('name') ?? ''),
      format: String(form.get('format') ?? ''),
      slots,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ frame }, { status: 201 });
  } catch (error) {
    if (error instanceof FrameInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
