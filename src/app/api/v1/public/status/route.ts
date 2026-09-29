import { route } from "@/server/http";
import { publicStatus } from "@/server/services/content";

export const dynamic = "force-dynamic";

export const GET = route(async () => publicStatus());