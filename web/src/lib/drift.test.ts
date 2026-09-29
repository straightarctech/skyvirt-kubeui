// Tests for drift detection.
//
// These three functions decide what the console calls "drift", and the answer
// feeds a revert button. Both failure directions are bad and they are not
// symmetric: showing drift that is not real trains people to ignore the page,
// while hiding real drift means a revert silently discards a change someone made
// on purpose.

import test from "node:test";
import assert from "node:assert/strict";

import { pruneToShape, lastApplied, stripNoise } from "./drift";

// A live object as the API server returns it: the declared fields plus a pile of
// defaults nobody wrote.
const live = {
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: "web",
    namespace: "default",
    creationTimestamp: "2026-01-01T00:00:00Z",
    resourceVersion: "12345",
    uid: "abc-123",
  },
  spec: {
    selector: { app: "web" },
    ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http", nodePort: 30080 }],
    type: "ClusterIP",
    clusterIP: "10.0.0.5",
    sessionAffinity: "None",
    ipFamilies: ["IPv4"],
  },
  status: { loadBalancer: {} },
};

// What the user actually wrote.
const declared = {
  apiVersion: "v1",
  kind: "Service",
  metadata: { name: "web", namespace: "default" },
  spec: {
    selector: { app: "web" },
    ports: [{ port: 80, targetPort: 8080 }],
  },
};

test("pruneToShape keeps only what was declared", () => {
  const pruned = pruneToShape(live, declared) as Record<string, any>;

  // Server-added fields must not appear, or every object drifts the moment it
  // is created and the page becomes noise.
  assert.equal(pruned.status, undefined, "status is never declared");
  assert.equal(pruned.spec.clusterIP, undefined, "clusterIP is assigned by the server");
  assert.equal(pruned.spec.type, undefined, "type was defaulted, not declared");
  assert.equal(pruned.spec.sessionAffinity, undefined);
  assert.equal(pruned.metadata.resourceVersion, undefined);
  assert.equal(pruned.metadata.uid, undefined);

  // What WAS declared survives, with the live values — that is the comparison.
  assert.equal(pruned.metadata.name, "web");
  assert.deepEqual(pruned.spec.selector, { app: "web" });
});

test("pruneToShape prunes array elements against the declared template", () => {
  // The declared port has two fields; the live one has five. Only the declared
  // two may be compared, or a server-assigned nodePort reads as drift forever.
  const pruned = pruneToShape(live, declared) as Record<string, any>;
  assert.equal(pruned.spec.ports.length, 1);
  assert.deepEqual(pruned.spec.ports[0], { port: 80, targetPort: 8080 });
});

test("pruneToShape keeps every live element, not just as many as were declared", () => {
  // One declared element is a TEMPLATE for the shape, not a count. A live list
  // that grew must still be fully visible, otherwise added items are invisible.
  const liveMany = { items: [{ a: 1, extra: true }, { a: 2, extra: true }, { a: 3, extra: true }] };
  const shape = { items: [{ a: 0 }] };
  const pruned = pruneToShape(liveMany, shape) as Record<string, any>;
  assert.equal(pruned.items.length, 3);
  assert.deepEqual(pruned.items, [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test("pruneToShape reports a declared field the server does not have", () => {
  // Declared but absent from live IS drift — something removed it. It must not
  // be silently skipped.
  const pruned = pruneToShape({ spec: {} }, { spec: { replicas: 3 } }) as Record<string, any>;
  assert.ok("replicas" in pruned.spec, "a declared-but-missing field must still appear");
  assert.equal(pruned.spec.replicas, undefined);
});

test("pruneToShape passes scalars and mismatched types through unchanged", () => {
  assert.equal(pruneToShape("live", "declared"), "live");
  assert.equal(pruneToShape(42, 0), 42);
  assert.equal(pruneToShape(true, false), true);
  // Live is a scalar where an object was declared: return the live value rather
  // than pretending it matches.
  assert.equal(pruneToShape("oops", { a: 1 }), "oops");
  // Live is an object where an array was declared.
  assert.deepEqual(pruneToShape({ a: 1 }, [{ a: 0 }]), { a: 1 });
});

test("lastApplied parses the annotation", () => {
  const obj = {
    metadata: {
      annotations: {
        "kubectl.kubernetes.io/last-applied-configuration": '{"kind":"Service","spec":{"type":"ClusterIP"}}',
      },
    },
  };
  const got = lastApplied(obj) as Record<string, any>;
  assert.equal(got.kind, "Service");
  assert.equal(got.spec.type, "ClusterIP");
});

test("lastApplied returns null rather than throwing on anything unusable", () => {
  // A resource created without kubectl apply has no annotation at all — that is
  // ordinary, and the page shows "not tracked" rather than an error.
  assert.equal(lastApplied({}), null, "no metadata");
  assert.equal(lastApplied({ metadata: {} }), null, "no annotations");
  assert.equal(lastApplied({ metadata: { annotations: {} } }), null, "no last-applied key");
  assert.equal(
    lastApplied({ metadata: { annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{not json" } } }),
    null,
    "malformed JSON must not throw",
  );
});

test("stripNoise removes the fields that always differ", () => {
  const out = stripNoise({
    metadata: {
      name: "web",
      creationTimestamp: "2026-01-01T00:00:00Z",
      annotations: {
        "kubectl.kubernetes.io/last-applied-configuration": "{}",
        team: "platform",
      },
    },
  }) as Record<string, any>;

  assert.equal(out.metadata.creationTimestamp, undefined);
  assert.equal(out.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"], undefined);
  // Real annotations survive — they are declared config and can genuinely drift.
  assert.equal(out.metadata.annotations.team, "platform");
  assert.equal(out.metadata.name, "web");
});

test("stripNoise does not mutate its input", () => {
  // The caller holds the live object in React state and renders it elsewhere. A
  // shallow copy here would delete the annotation out from under the rest of the
  // page — and the drift view would then disagree with the YAML tab beside it.
  const original = {
    metadata: {
      name: "web",
      creationTimestamp: "2026-01-01T00:00:00Z",
      annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{}" },
    },
  };
  stripNoise(original);
  assert.equal(original.metadata.creationTimestamp, "2026-01-01T00:00:00Z", "input was mutated");
  assert.equal(
    original.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"],
    "{}",
    "input annotation was deleted",
  );
});

test("stripNoise tolerates an object with no metadata", () => {
  const out = stripNoise({ spec: { replicas: 2 } }) as Record<string, any>;
  assert.deepEqual(out, { spec: { replicas: 2 } });
});

test("the three compose into a clean comparison for an undrifted resource", () => {
  // End to end: a live object whose declared fields all still match should
  // produce an identical pair, i.e. no drift.
  const withAnnotation = {
    ...live,
    metadata: {
      ...live.metadata,
      annotations: { "kubectl.kubernetes.io/last-applied-configuration": JSON.stringify(declared) },
    },
  };
  const shape = lastApplied(withAnnotation as Record<string, unknown>);
  assert.ok(shape, "the annotation should parse");

  const a = stripNoise(pruneToShape(withAnnotation, shape) as Record<string, unknown>);
  const b = stripNoise(shape);
  assert.deepEqual(a, b, "an unchanged resource must show no drift");
});
