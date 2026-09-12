import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "../middleware/errors.js";
const magic = Buffer.from("ERP1");
function key(value: string | undefined) {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new HttpError(503, "ATTACHMENT_KEY_REQUIRED");
  return Buffer.from(value, "hex");
}
function context(company: string, id: string) {
  return Buffer.from(company + ":" + id, "utf8");
}
export function encryptAttachment(
  value: string | undefined,
  bytes: Buffer,
  company: string,
  id: string,
) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(value), nonce);
  cipher.setAAD(context(company, id));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), encrypted]);
}
export function decryptAttachment(
  value: string | undefined,
  bytes: Buffer,
  company: string,
  id: string,
) {
  const secret = key(value);
  try {
    if (bytes.length < 32 || !bytes.subarray(0, 4).equals(magic))
      throw new Error("format");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      bytes.subarray(4, 16),
    );
    decipher.setAAD(context(company, id));
    decipher.setAuthTag(bytes.subarray(16, 32));
    return Buffer.concat([
      decipher.update(bytes.subarray(32)),
      decipher.final(),
    ]);
  } catch {
    throw new HttpError(409, "ATTACHMENT_INTEGRITY_ERROR");
  }
}

export type AttachmentKeyring = {
  ATTACHMENT_ENCRYPTION_KEY?: string;
  ATTACHMENT_ENCRYPTION_KEYS?: Record<string, string>;
  ATTACHMENT_ENCRYPTION_ACTIVE_VERSION?: string;
};
export function attachmentKey(config: AttachmentKeyring, version = "V1") {
  if (!/^V[1-9][0-9]*$/.test(version))
    throw new HttpError(409, "ATTACHMENT_INTEGRITY_ERROR");
  const value =
    config.ATTACHMENT_ENCRYPTION_KEYS?.[version] ??
    (version === "V1" ? config.ATTACHMENT_ENCRYPTION_KEY : undefined);
  key(value);
  return value!;
}
export function encryptVersionedAttachment(
  config: AttachmentKeyring,
  bytes: Buffer,
  company: string,
  id: string,
  version: string,
) {
  return encryptAttachment(
    attachmentKey(config, version),
    bytes,
    company,
    version === "V1" ? id : id + ":" + version,
  );
}
export function decryptVersionedAttachment(
  config: AttachmentKeyring,
  bytes: Buffer,
  company: string,
  id: string,
  version: string,
) {
  return decryptAttachment(
    attachmentKey(config, version),
    bytes,
    company,
    version === "V1" ? id : id + ":" + version,
  );
}
