import { handle } from "@/lib/route";
import { listVoices } from "@/lib/voices";

export const GET = handle(async () => Response.json({ voices: await listVoices() }));
