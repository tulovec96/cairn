import { route } from "@/server/http";
import { publicChangelog } from "@/server/services/content";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ items: await publicChangelog() }));