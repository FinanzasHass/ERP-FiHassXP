import { createClient } from "@supabase/supabase-js";
import type { RuntimeConfig } from "../config/env.js";
import { HttpError } from "../middleware/errors.js";
// Request-scoped publishable client. No privileged database/Storage client.
export function attachmentStorage(config: RuntimeConfig, token: string) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from("financial-encrypted");
}
export function validateAttachment(
  filename: string,
  mime: string,
  bytes: Buffer,
) {
  if (bytes.length < 4 || bytes.length > 5242880)
    throw new HttpError(400, "INVALID_FILE");
  const ext = filename.split(".").at(-1)?.toLowerCase(),
    prefix = bytes.subarray(0, 8).toString("hex");
  let valid = false;
  if (ext === "pdf" && mime === "application/pdf")
    valid =
      bytes.subarray(0, 5).toString() === "%PDF-" &&
      !/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/i.test(
        bytes.toString("latin1"),
      );
  if (ext === "png" && mime === "image/png")
    valid = prefix === "89504e470d0a1a0a";
  if (["jpg", "jpeg"].includes(ext || "") && mime === "image/jpeg")
    valid = prefix.startsWith("ffd8ff");
  if (ext === "xml" && mime === "application/xml") {
    const s = bytes.toString("utf8");
    valid =
      /^\s*(?:<\?xml[^?]*\?>\s*)?<[A-Za-z_][\w:.-]*(?:\s|>)/.test(s) &&
      !/<!(DOCTYPE|ENTITY)|<\?xml-stylesheet|<\s*(?:\w+:)?script\b|\x00/i.test(
        s,
      );
  }
  if (!valid) throw new HttpError(400, "INVALID_FILE");
}
