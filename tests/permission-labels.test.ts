import test from "node:test";
import assert from "node:assert/strict";
import {
  permissionModuleLabel,
  permissionPresentation,
} from "../src/client/permission-labels.js";

test("permission presentation uses the centralized Spanish copy", () => {
  const payment = permissionPresentation({
    code: "payment.execute",
    resource: "payment",
    action: "execute",
  });

  assert.equal(payment.moduleLabel, "Pagos");
  assert.equal(payment.label, "Ejecutar pago");
  assert.equal(
    payment.description,
    "Permite registrar una salida real de dinero en Tesorería.",
  );
  assert.equal(payment.technicalCode, "payment.execute");
  assert.equal(permissionModuleLabel("accounting_account"), "Plan de cuentas");
  assert.equal(permissionModuleLabel("trial_balance"), "Balance de comprobación");
});

test("unknown permissions are humanized without losing their technical code", () => {
  const unknown = permissionPresentation({
    code: "future_resource.publish_report",
    resource: "future_resource",
    action: "publish_report",
  });

  assert.equal(unknown.moduleLabel, "Future resource");
  assert.equal(unknown.label, "Publish report");
  assert.equal(unknown.technicalCode, "future_resource.publish_report");
  assert.match(unknown.description, /^Permite /);
});

test("permission order follows the functional action sequence", () => {
  const order = [
    "view",
    "create",
    "edit",
    "review",
    "submit",
    "approve",
    "reject",
    "execute",
    "reverse",
    "close",
    "reopen",
    "manage",
  ].map((action) =>
    permissionPresentation({
      code: `sample.${action}`,
      resource: "sample",
      action,
    }).order,
  );

  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});
