import { Router } from "express";
import { z } from "zod";
import { getActor } from "../middleware/auth.js";
import { HttpError } from "../middleware/errors.js";
import { uuid } from "../validators/index.js";
import {
  financeSchemas,
  transitionSchema,
  uploadSchema,
} from "../validators/finance.js";
import {
  attachmentStorage,
  validateAttachment,
} from "../services/attachments.js";
import type { RuntimeConfig } from "../config/env.js";
import {attachmentKey,encryptVersionedAttachment,decryptVersionedAttachment} from '../services/attachment-crypto.js';
const lists = {
  "financial-requests": ["request", "financial_requests"],
  suppliers: ["supplier", "supplier_companies"],
  "supplier-contacts": ["supplier_contact", "supplier_contacts"],
  "bank-changes": ["bank_change", "supplier_bank_account_changes"],
  "payment-terms": ["payment_term", "payment_terms"],
  "approval-policies": ["approval_policy", "approval_policies"],
  "purchase-orders": ["purchase_order", "purchase_orders"],
  "service-acceptances": ["service_acceptance", "service_acceptances"],
  "tax-documents": ["tax_document", "tax_documents"],
  payables: ["payable", "payables"],
} as const;
const listQuery = z
  .object({
    company_id: uuid,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    status: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
    supplier_id: uuid.optional(),
    request_id: uuid.optional(),
    entity_type: z
      .string()
      .regex(/^[a-z_]+$/)
      .optional(),
    entity_id: uuid.optional(),
  })
  .strict();
export function financeRouter(config: RuntimeConfig) {
  const router = Router();
  const assertCompany = async (
    req: Parameters<typeof getActor>[0],
    company: string,
  ) => {
    if (
      !(await getActor(req).db.rpc("has_company_access", {
        target_company: company,
      }))
    )
      throw new HttpError(403, "COMPANY_ACCESS_DENIED");
  };
  for (const [path, [kind, table]] of Object.entries(lists)) {
    router.get("/" + path, async (req, res) => {
      const q = listQuery.parse(req.query);
      await assertCompany(req, q.company_id);
      const { page, limit, ...filters } = q;
      res.json(await getActor(req).db.list(table, { page, limit }, filters));
    });
    router.get("/" + path + "/:id", async (req, res) => {
      const actor = getActor(req),
        id = uuid.parse(req.params.id);
      const result = await actor.db.list(table, { page: 1, limit: 1 }, { id });
      const row = result.data[0] as Record<string, unknown> | undefined;
      if (!row) throw new HttpError(404, "NOT_FOUND");
      const details: Record<string, unknown> = { record: row };
      const relations: [string, string, string][] =
        kind === "request"
          ? [
              ["items", "financial_request_items", "request_id"],
              ["history", "financial_request_history", "request_id"],
            ]
          : kind === "purchase_order"
            ? [["items", "purchase_order_items", "order_id"]]
            : kind === "tax_document"
              ? [["amounts", "tax_document_amounts", "tax_document_id"]]
              : [];
      for (const [key, t, f] of relations)
        details[key] = (
          await actor.db.list(t, { page: 1, limit: 100 }, { [f]: id })
        ).data;
      details.attachments = (
        await actor.db.list(
          "attachments",
          { page: 1, limit: 100 },
          {
            entity_type: kind === "bank_change" ? "supplier_bank_change" : kind,
            entity_id: id,
          },
        )
      ).data;
      res.json(details);
    });
    for (const method of ["post", "patch"] as const)
      router[method](
        "/" + path + (method === "patch" ? "/:id" : ""),
        async (req, res) => {
          const schema = financeSchemas[kind];
          const payload = (
            method === "patch" ? schema.partial() : schema
          ).parse(req.body);
          res
            .status(method === "post" ? 201 : 200)
            .json(
              await getActor(req).db.rpc("financial_save", {
                kind,
                target_id:
                  method === "patch" ? uuid.parse(req.params.id) : null,
                target_company: uuid.parse(req.query.company_id),
                payload,
              }),
            );
        },
      );
    router.post("/" + path + "/:id/actions", async (req, res) => {
      const b = transitionSchema.parse(req.body);
      res.json(
        await getActor(req).db.rpc("financial_transition", {
          kind,
          target_id: uuid.parse(req.params.id),
          ...b,
        }),
      );
    });
  }
  router.get("/supplier-bank-accounts", async (req, res) => {
    const q = listQuery.parse(req.query);
    await assertCompany(req, q.company_id);
    const { page, limit, ...filters } = q;
    res.json(
      await getActor(req).db.list(
        "supplier_bank_accounts",
        { page, limit },
        filters,
      ),
    );
  });
  router.get("/finance/options", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("financial_options", {
        target_company: uuid.parse(req.query.company_id),
      }),
    ),
  );
  router.get("/finance/reports", async (req, res) => {
    const c = uuid.parse(req.query.company_id);
    await assertCompany(req, c);
    res.json(
      await getActor(req).db.rpc("financial_reports", { target_company: c }),
    );
  });
  router.get("/approvals", async (req, res) =>
    res.json(
      await getActor(req).db.rpc("financial_inbox", {
        target_company: uuid.parse(req.query.company_id),
      }),
    ),
  );
  router.patch("/payables/:id/due-date", async (req, res) => {
    const b = z
      .object({
        new_date: z.iso.date(),
        reason: z.string().trim().min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    res.json(
      await getActor(req).db.rpc("payable_change_due_date", {
        target_id: uuid.parse(req.params.id),
        ...b,
      }),
    );
  });
  router.post("/attachments/upload", async (req, res) => {
    const b = uploadSchema.parse(req.body),
      bytes = Buffer.from(b.base64, "base64");
    validateAttachment(b.filename, b.mime_type, bytes);
    const keyVersion=config.ATTACHMENT_ENCRYPTION_ACTIVE_VERSION??'V1';
    attachmentKey(config,keyVersion);
    const actor = getActor(req);
    const a = await actor.db.rpc<{ id: string; company_id:string; storage_path: string }>(
      "attachment_prepare_versioned",
      {
        target_company: b.company_id,
        kind: b.entity_type,
        target_id: b.entity_id,
        filename: b.filename,
        mime_type: b.mime_type,
        file_size: bytes.length,
        key_version: keyVersion,
      },
    );
    const { error } = await attachmentStorage(config, actor.token).upload(
      a.storage_path,
      encryptVersionedAttachment(config,bytes,a.company_id,a.id,keyVersion),
      { contentType: 'application/octet-stream', upsert: false, cacheControl: '0' },
    );
    if (error) throw new HttpError(503, "STORAGE_UNAVAILABLE");
    res
      .status(201)
      .json(await actor.db.rpc("attachment_finish", { target_id: a.id }));
  });
  router.get("/attachments/:id/download", async (req, res) => {
    const actor = getActor(req);
    const found = await actor.db.list(
      "attachments",
      { page: 1, limit: 1 },
      { id: uuid.parse(req.params.id), status: "ready" },
    );
    const a = found.data[0] as
      { id:string;company_id:string;encryption_format:string;encryption_key_version:string; storage_path: string; filename: string; mime_type: string } | undefined;
    if (!a) throw new HttpError(404, "NOT_FOUND");
    if(a.encryption_format!=='aes-256-gcm-v1')throw new HttpError(409,'ATTACHMENT_INTEGRITY_ERROR');
    const { data, error } = await attachmentStorage(
      config,
      actor.token,
    ).download(a.storage_path, {}, { cache: 'no-store' });
    if (error || !data) throw new HttpError(503, "STORAGE_UNAVAILABLE");
    const bytes = decryptVersionedAttachment(config,Buffer.from(await data.arrayBuffer()),a.company_id,a.id,a.encryption_key_version);
    validateAttachment(a.filename, a.mime_type, bytes);
    res.json({
      filename: a.filename,
      mime_type: a.mime_type,
      base64: bytes.toString("base64"),
    });
  });
  return router;
}
