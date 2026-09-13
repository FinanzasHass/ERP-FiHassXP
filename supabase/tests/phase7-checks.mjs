import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function phase7Checks({
  db,
  rpc,
  asUser,
  scalar,
  test,
  admin,
  c,
  b,
  owner,
  reviewer,
  outsider,
  currency,
  bank,
  method,
  approver,
}) {
  const role = await rpc(admin, "admin_save_entity", [
    "role",
    null,
    { code: "phase7_operator", name: "Cobranzas sintéticas" },
  ]);
  const ids = (
    await db.query(
      "select id from public.permissions where active and resource in ('customer','receivable','collection','receivable_schedule','membership','lot_receivable','receivable_report','collection_report')",
    )
  ).rows.map((p) => p.id);
  await rpc(admin, "admin_set_role_permissions", [role.id, ids]);
  for (const user of [owner, reviewer, approver])
    await rpc(admin, "admin_set_user_role", [user, role.id, c, true]);
  const customerInput = {
    customer_type: "natural",
    document_type: "TEST",
    document_number: "SYNTHETIC-7",
    legal_name: "Cliente sintético F7",
  };
  let customer, receivable, collection;
  const debt = (amount = 100, extra = {}) =>
    rpc(owner, "receivable_create", [
      c,
      {
        customer_id: customer.id,
        source_type: "manual_authorized",
        currency_id: currency,
        issue_date: "2027-02-01",
        due_date: "2027-02-28",
        original_amount: amount,
        description: "Obligación sintética",
        ...extra,
      },
      randomUUID(),
    ]);
  const balance = (id) =>
    scalar(
      "select outstanding_amount from public.receivable_balances where id=$1",
      [id],
    );
  async function credit(amount = 100) {
    const external = randomUUID();
    await rpc(owner, "treasury_import", [
      c,
      bank,
      "f7-synthetic.csv",
      {},
      [
        {
          transaction_date: "2027-02-01",
          transaction_type: "credit",
          amount,
          currency_code: "PEN",
          bank_reference: "SYNTHETIC-7",
          description: "Depósito sintético",
          external_id: external,
        },
      ],
      true,
    ]);
    const tid = await scalar(
      "select id from public.bank_transactions where external_id=$1",
      [external],
    );
    const payload = { bank_transaction_id: tid },
      key = randomUUID();
    const result = await rpc(owner, "collection_register", [c, payload, key]);
    assert.equal(
      (await rpc(owner, "collection_register", [c, payload, key])).id,
      result.id,
    );
    return result;
  }
  const identify = (id, user = owner, cid = customer.id) =>
    rpc(user, "collection_identify", [
      id,
      cid,
      "Identificación sintética",
      randomUUID(),
    ]);
  const apply = (id, allocations, key = randomUUID()) =>
    rpc(owner, "collection_apply", [id, { allocations }, key]);
  await test("F7 customer identity is enterprise-scoped, duplicate protected and REST writes denied", async () => {
    customer = await rpc(owner, "customer_save", [null, c, customerInput]);
    await assert.rejects(
      () =>
        rpc(owner, "customer_save", [
          null,
          c,
          {
            ...customerInput,
            document_type: " test ",
            document_number: "synthetic-7",
          },
        ]),
      /unique|duplicate/i,
    );
    await assert.rejects(() =>
      rpc(owner, "customer_save", [null, b, customerInput]),
    );
    assert.equal(
      (
        await asUser(outsider, "select * from public.customers where id=$1", [
          customer.id,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      () => asUser(owner, "update public.customers set status='inactive'"),
      /permission denied/,
    );
  });
  await test("F7 manual obligation has derived balances, immutable used identity and no manual collected", async () => {
    receivable = await debt();
    assert.match(receivable.receivable_number, /CXC-\d{4}-\d{6}/);
    assert.equal(Number(await balance(receivable.id)), 100);
    await assert.rejects(
      () =>
        rpc(owner, "customer_save", [
          customer.id,
          c,
          { document_number: "CHANGED" },
        ]),
      /immutable/,
    );
    await assert.rejects(
      () => asUser(owner, "update public.receivables set status='collected'"),
      /permission denied/,
    );
    await assert.rejects(() => debt(0.001), /precision/);
  });
  await test("F7 confirmed credit capture idempotent and identification does not reconcile", async () => {
    collection = await credit(180);
    assert.equal(
      await scalar(
        "select financial_status from public.collection_balances where id=$1",
        [collection.id],
      ),
      "unidentified",
    );
    await assert.rejects(
      () =>
        rpc(owner, "collection_register", [
          c,
          { bank_transaction_id: collection.bank_transaction_id },
          randomUUID(),
        ]),
      /unique|duplicate/i,
    );
    const first = await identify(collection.id);
    const again = await identify(collection.id, reviewer);
    await assert.rejects(
      () =>
        rpc(approver, "treasury_action", [
          "bank_transaction",
          collection.bank_transaction_id,
          "exclude",
          { reason: "Remove evidence" },
        ]),
      /Reverse active collection/,
    );
    assert.equal(again.identified_by, first.identified_by);
    assert.equal(
      Number(
        await scalar(
          "select count(*) from public.bank_reconciliation_matches where collection_id=$1",
          [collection.id],
        ),
      ),
      0,
    );
  });
  let allocation;
  await test("F7 partial, full, multiple receivables and unapplied customer credit are exact and idempotent", async () => {
    const key = randomUUID(),
      payload = [{ receivable_id: receivable.id, amount: 40 }];
    allocation = (await apply(collection.id, payload, key))[0];
    assert.equal(
      (await apply(collection.id, payload, key))[0].id,
      allocation.id,
    );
    assert.equal(Number(await balance(receivable.id)), 60);
    const second = await debt(50);
    await apply(collection.id, [
      { receivable_id: receivable.id, amount: 60 },
      { receivable_id: second.id, amount: 50 },
    ]);
    assert.equal(Number(await balance(receivable.id)), 0);
    assert.equal(
      Number(
        await scalar(
          "select unapplied_amount from public.collection_balances where id=$1",
          [collection.id],
        ),
      ),
      30,
    );
    const later = await debt(30);
    await apply(collection.id, [{ receivable_id: later.id, amount: 30 }]);
    assert.equal(Number(await balance(later.id)), 0);
    await assert.rejects(
      () => apply(collection.id, [{ receivable_id: later.id, amount: 1 }]),
      /exceeds/,
    );
  });
  await test("F7 unapply restores credit and reversal restores receivables without deleting history", async () => {
    await rpc(owner, "collection_unapply", [
      allocation.id,
      "Corrección sintética",
      randomUUID(),
    ]);
    assert.equal(Number(await balance(receivable.id)), 40);
    const key = randomUUID();
    await rpc(owner, "collection_reverse", [
      collection.id,
      "Reverso sintético",
      key,
    ]);
    await rpc(owner, "collection_reverse", [
      collection.id,
      "Reverso sintético",
      key,
    ]);
    assert.equal(Number(await balance(receivable.id)), 100);
    assert.equal(
      Number(
        await scalar(
          "select unapplied_amount from public.collection_balances where id=$1",
          [collection.id],
        ),
      ),
      0,
    );
    assert.ok(
      Number(
        await scalar(
          "select count(*) from public.collection_allocations where collection_id=$1",
          [collection.id],
        ),
      ) >= 3,
    );
  });
  await test("F7 missing evidence, different customer and currency cannot be applied", async () => {
    const manual = await rpc(owner, "collection_register", [
      c,
      {
        currency_id: currency,
        collection_date: "2027-02-01",
        amount: 10,
        payment_method_id: method.id,
      },
      randomUUID(),
    ]);
    await identify(manual.id);
    await assert.rejects(
      () => apply(manual.id, [{ receivable_id: receivable.id, amount: 10 }]),
      /evidence/,
    );
    const bankCredit = await credit(10);
    await identify(bankCredit.id);
    const other = await rpc(owner, "customer_save", [
      null,
      c,
      { ...customerInput, document_number: "OTHER" },
    ]);
    const otherDebt = await debt(10, { customer_id: other.id });
    await assert.rejects(
      () => apply(bankCredit.id, [{ receivable_id: otherDebt.id, amount: 10 }]),
      /mismatch/,
    );
    const usd = await scalar(
      "select id from public.currencies where code='USD'",
    );
    const usdDebt = await debt(10, { currency_id: usd });
    await assert.rejects(
      () => apply(bankCredit.id, [{ receivable_id: usdDebt.id, amount: 10 }]),
      /mismatch/,
    );
  });
  await test("F7 schedule preserves configured membership and lot totals; replacement is versioned", async () => {
    const source = await rpc(owner, "receivable_source_create", [
      c,
      {
        source_type: "membership",
        customer_id: customer.id,
        currency_id: currency,
        reference: "MEM-SYNTH",
        description: "Plan sintético",
        plan_name: "Plan explícito",
        start_date: "2027-01-01",
        end_date: "2027-12-31",
        periodic_amount: 25,
        period_months: 1,
      },
      randomUUID(),
    ]);
    const payload = {
      period_reference: "2027",
      issue_date: "2027-01-01",
      installments: [
        { due_date: "2027-01-01", amount: 25 },
        { due_date: "2027-02-01", amount: 25 },
      ],
    };
    const schedule = await rpc(owner, "receivable_schedule_generate", [
      source.id,
      payload,
      randomUUID(),
    ]);
    assert.equal(Number(schedule.total_amount), 50);
    await assert.rejects(
      () =>
        rpc(owner, "receivable_schedule_generate", [
          source.id,
          {
            ...payload,
            period_reference: "OFF-CADENCE",
            installments: [{ due_date: "2027-03-02", amount: 25 }],
          },
          randomUUID(),
        ]),
      /cadence/,
    );
    await assert.rejects(
      () =>
        rpc(owner, "receivable_schedule_generate", [
          source.id,
          { ...payload, period_reference: "duplicate" },
          randomUUID(),
        ]),
      /already generated/,
    );
    const replacement = await rpc(owner, "receivable_schedule_generate", [
      source.id,
      {
        ...payload,
        replace_schedule_id: schedule.id,
        reason: "Cambio sintético",
      },
      randomUUID(),
    ]);
    assert.equal(replacement.version, 2);
    assert.equal(
      await scalar(
        "select status from public.receivable_schedules where id=$1",
        [schedule.id],
      ),
      "superseded",
    );
    const lot = await rpc(owner, "receivable_source_create", [
      c,
      {
        source_type: "lot_sale",
        customer_id: customer.id,
        currency_id: currency,
        reference: "LOT-SYNTH",
        description: "Contrato sintético",
        lot_identifier: "EXTERNAL-SYNTH",
        agreed_price: 100,
        down_payment: 20,
      },
      randomUUID(),
    ]);
    const lotPayload = {
      period_reference: "CONTRACT",
      issue_date: "2027-01-01",
      installments: [
        { due_date: "2027-01-01", amount: 20 },
        { due_date: "2027-02-01", amount: 80 },
      ],
    };
    assert.equal(
      Number(
        (
          await rpc(owner, "receivable_schedule_generate", [
            lot.id,
            lotPayload,
            randomUUID(),
          ])
        ).total_amount,
      ),
      100,
    );
  });
  await test("F7 historical identifiers remain segregated from bank reconciliation", async () => {
    const coll = await credit(12);
    await identify(coll.id, reviewer);
    const different = await rpc(owner, "customer_save", [
      null,
      c,
      { ...customerInput, document_number: "DIFFERENT" },
    ]);
    await identify(coll.id, owner, different.id);
    const period = await rpc(owner, "treasury_save", [
      "reconciliation_period",
      null,
      c,
      {
        bank_account_id: bank,
        start_date: "2027-02-01",
        end_date: "2027-02-28",
      },
    ]);
    await assert.rejects(
      () =>
        rpc(reviewer, "collection_match", [
          coll.id,
          period.id,
          coll.bank_transaction_id,
          12,
        ]),
      /segregation/,
    );
    const match = await rpc(approver, "collection_match", [
      coll.id,
      period.id,
      coll.bank_transaction_id,
      12,
    ]);
    assert.equal(match.status, "matched");
    await rpc(approver, "treasury_action", [
      "reconciliation_match",
      match.id,
      "reconcile",
      {},
    ]);
    await assert.rejects(
      () =>
        rpc(owner, "collection_reverse", [coll.id, "Sintético", randomUUID()]),
      /Reopen/,
    );
  });
  await test("F7 cashflow keeps actual bank cash unchanged by receivable allocation and aging is derived", async () => {
    const old = await debt(17, {
      due_date: "2020-01-01",
      issue_date: "2020-01-01",
    });
    assert.equal(
      await scalar(
        "select financial_status from public.receivable_balances where id=$1",
        [old.id],
      ),
      "overdue",
    );
    const coll = await credit(10);
    await identify(coll.id);
    const before = await rpc(owner, "treasury_cashflow", [c]);
    await apply(coll.id, [{ receivable_id: old.id, amount: 10 }]);
    const after = await rpc(owner, "treasury_cashflow", [c]);
    assert.deepEqual(after.actual, before.actual);
    assert.deepEqual(after.position, before.position);
    const dashboard = await rpc(owner, "receivable_dashboard", [
      c,
      "2027-02-01",
    ]);
    assert.ok(dashboard.aging.length);
    assert.ok(after.expected_receivables.length);
  });
  await test("F7 revocation immediately denies existing session, direct reads and replayed operation", async () => {
    await rpc(admin, "admin_set_membership", [owner, c, false]);
    assert.equal(
      (await asUser(owner, "select * from public.receivables")).rows.length,
      0,
    );
    await assert.rejects(() => debt());
    await rpc(admin, "admin_set_membership", [owner, c, true]);
    const rows = (
      await db.query(
        "select * from public.audit_logs where entity_type='collections' and company_id=$1",
        [c],
      )
    ).rows;
    assert.ok(rows.length);
    assert.ok(rows.every((x) => x.user_id && x.company_id === c));
  });
  if (process.env.TEST_DATABASE_URL) {
    const { Client } = await import("pg");
    const target = new URL(process.env.TEST_DATABASE_URL);
    if (
      target.hostname !== "127.0.0.1" ||
      !target.pathname.startsWith("/phase6_fixture_")
    )
      throw new Error("DISPOSABLE_LOCAL_DATABASE_REQUIRED");
    const connections = await Promise.all(
      [0, 1].map(async () => {
        const client = new Client({
          connectionString: process.env.TEST_DATABASE_URL,
        });
        await client.connect();
        await client.query("set role authenticated");
        await client.query(
          "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
          [owner, JSON.stringify({ sub: owner, session_id: owner })],
        );
        return client;
      }),
    );
    const parallel = (fn, args) =>
      Promise.allSettled(
        connections.map((client, i) =>
          client.query(
            `select public.${fn}(${args[i].map((_, j) => "$" + (j + 1)).join(",")}) result`,
            args[i],
          ),
        ),
      );
    const appArgs = (coll, r, amount, key = randomUUID()) => [
      coll.id,
      JSON.stringify({ allocations: [{ receivable_id: r.id, amount }] }),
      key,
    ];
    try {
      await test("F7 CONCURRENT two collections cannot consume same receivable remainder", async () => {
        const r = await debt(10),
          left = await credit(10),
          right = await credit(10);
        await identify(left.id);
        await identify(right.id);
        const result = await parallel("collection_apply", [
          appArgs(left, r, 10),
          appArgs(right, r, 10),
        ]);
        assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal(Number(await balance(r.id)), 0);
      });
      await test("F7 CONCURRENT same customer credit cannot be spent twice", async () => {
        const left = await debt(10),
          right = await debt(10),
          coll = await credit(10);
        await identify(coll.id);
        const result = await parallel("collection_apply", [
          appArgs(coll, left, 10),
          appArgs(coll, right, 10),
        ]);
        assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal(
          Number(await balance(left.id)) + Number(await balance(right.id)),
          10,
        );
      });
      await test("F7 CONCURRENT identification and application retries create one effect", async () => {
        const coll = await credit(10),
          r = await debt(10),
          key = randomUUID(),
          args = [coll.id, customer.id, "Concurrent synthetic", key];
        const identified = await parallel("collection_identify", [args, args]);
        assert.equal(
          identified.filter((x) => x.status === "fulfilled").length,
          2,
        );
        const application = appArgs(coll, r, 10);
        const result = await parallel("collection_apply", [
          application,
          application,
        ]);
        assert.equal(result.filter((x) => x.status === "fulfilled").length, 2);
        assert.equal(
          Number(
            await scalar(
              "select count(*) from public.collection_allocations where collection_id=$1",
              [coll.id],
            ),
          ),
          1,
        );
      });
      await test("F7 CONCURRENT reverse restores the obligation only once", async () => {
        const coll = await credit(10),
          r = await debt(10);
        await identify(coll.id);
        await apply(coll.id, [{ receivable_id: r.id, amount: 10 }]);
        const result = await parallel("collection_reverse", [
          [coll.id, "Concurrent reverse", randomUUID()],
          [coll.id, "Concurrent reverse", randomUUID()],
        ]);
        assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
        assert.equal(Number(await balance(r.id)), 10);
      });
    } finally {
      await Promise.all(connections.map((client) => client.end()));
    }
  }
}
