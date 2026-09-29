import { z } from "zod";
import { isoDateTime, nullableId } from "./api";
import { idParam } from "./http";

/** Request-body schemas shared by several routes. */

export const sharePermissionSchema = z.enum(["view", "download"]);

export const shareOptionsSchema = z.object({
  password: z.string().min(4, "Use at least 4 characters.").max(128).nullable().optional(),
  expiresAt: isoDateTime.nullable().optional(),
  maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(),
  maxViews: z.number().int().min(1).max(10_000_000).nullable().optional(),
  permissions: z.array(sharePermissionSchema).max(2).optional(),
  ipAllowlist: z.array(z.string().max(64)).max(50).optional(),
  title: z.string().max(120).nullable().optional(),
  message: z.string().max(1000).nullable().optional(),
  showSha256: z.boolean().optional(),
  embedEnabled: z.boolean().optional(),
});

export const createShareSchema = shareOptionsSchema
  .extend({ fileId: idParam.optional(), folderId: idParam.optional() })
  .refine((v) => !!v.fileId !== !!v.folderId, { message: "Provide exactly one of fileId or folderId." });

export { idParam, isoDateTime, nullableId };
