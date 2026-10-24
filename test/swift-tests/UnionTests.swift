// test/swift-tests/UnionTests.swift — runtime checks for the unions-and-nesting fixture,
// generated with openEnums=true.
//
// It tests:
//   - Open enums: known values, unknown values decoded and reported, round-trip of unknowns
//   - Primitive unions decoding either JSON type
//   - Discriminated unions, including an unknown discriminator
//   - Positional tuples decoded from and encoded to arrays
//   - Nested inline structs, enums in arrays, null enum members, allOf-merged items
//
// Exit code 0 = all tests passed. Non-zero = failure with diagnostic output.

import Foundation

// ── Test Infrastructure ──

nonisolated(unsafe) var passed = 0
nonisolated(unsafe) var failed = 0
nonisolated(unsafe) var reported: [UnknownEnumValue] = []

func expect(_ condition: Bool, _ message: String, file: String = #file, line: Int = #line) {
    if condition {
        passed += 1
    } else {
        failed += 1
        print("FAIL [\(file):\(line)]: \(message)")
    }
}

let serializer = JSONMessageSerializer(unknownEnumValueHandler: { reported.append($0) })

func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
    do {
        return try serializer.decode(type, from: Data(json.utf8))
    } catch {
        failed += 1
        print("FAIL: decoding \(type) threw: \(error)")
        return nil
    }
}

// ── Open enums ──

print("── Open enums ──")

expect(Side(rawValue: "buy") == .buy, "known raw value maps to its case")
expect(Side(rawValue: "short") == .unknown("short"), "unknown raw value maps to .unknown")
expect(Side.unknown("short").rawValue == "short", "unknown keeps its raw value")
expect(Side.allCases == [.buy, .sell], "allCases lists only the spec's cases")

let snapshotJSON = """
{
  "type": "account_snapshot",
  "status": "frozen",
  "tags": ["vip", "beta_tester"],
  "positions": [
    {"market": "BTC", "legs": [{"strike": "100000", "liquidity": "maker"}]}
  ],
  "events": [
    {"type": "order_filled", "order_id": "o1", "quantity": "340282366920938463463374607431768211455"},
    {"type": "order_cancelled", "order_id": "o2", "reason": "expired"},
    {"type": "order_amended", "order_id": "o3"}
  ],
  "entries": [{"event_id": "e1", "source": "gateway"}],
  "balance": "12.5"
}
"""

if let snapshot = decode(AccountSnapshot.self, snapshotJSON) {
    expect(snapshot.status == .unknown("frozen"), "unknown status decodes as .unknown")
    expect(snapshot.tags == [.vip, .unknown("beta_tester")], "enum array keeps known and unknown values")
    expect(reported.count == 2, "both unknown values are reported, got \(reported.count)")
    expect(reported.first?.type == "Status", "report names the enum type")
    expect(reported.first?.value == "frozen", "report carries the raw value")
    expect(reported.first?.codingPath == ["status"], "report carries the coding path, got \(reported.first?.codingPath ?? [])")

    // ── Nested inline structs ──
    expect(snapshot.positions.first?.legs.first?.liquidity == .maker, "enum inside nested inline struct")

    // ── Discriminated unions ──
    expect(snapshot.events.count == 3, "all three events decode")
    if case .orderFilled(let filled) = snapshot.events[0] {
        expect(filled.orderId == "o1", "order_filled variant fields")
        expect(filled.quantity == .string("340282366920938463463374607431768211455"), "u128 as string")
    } else {
        expect(false, "first event should be .orderFilled")
    }
    if case .orderCancelled(let cancelled) = snapshot.events[1] {
        expect(cancelled.reason == .expired, "order_cancelled variant enum")
    } else {
        expect(false, "second event should be .orderCancelled")
    }
    if case .unknown(let discriminator) = snapshot.events[2] {
        expect(discriminator == "order_amended", "unknown variant keeps its discriminator")
    } else {
        expect(false, "third event should be .unknown")
    }

    // ── allOf-merged items and single-member allOf ──
    expect(snapshot.entries.first?.source == "gateway", "allOf items merge both schemas")
    expect(snapshot.entries.first?.eventId == "e1", "allOf items keep the referenced schema's fields")
    expect(snapshot.balance == "12.5", "single-member allOf resolves to its member")
}

if let snapshot = decode(AccountSnapshot.self, #"{"type":"account_snapshot","status":null,"positions":[],"events":[],"entries":[]}"#) {
    expect(snapshot.status == nil, "null member of an enum decodes as nil")
}

// ── Primitive unions ──

print("── Primitive unions ──")

if let filled = decode(OrderFilled.self, #"{"type":"order_filled","order_id":"o4","quantity":42}"#) {
    expect(filled.quantity == .int(42), "integer form of a string|integer union")
}

// ── Tuples ──

print("── Tuples ──")

let order = PlaceOrder(
    subId: SubId(underlyingId: 1, expiryTs: 1_767_225_600, strike: "100000", right: .call),
    quantity: .string("5"),
    side: .buy
)
do {
    let data = try serializer.encode(order)
    let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let subId = json["sub_id"] as? [Any]
    expect(subId?.count == 4, "tuple encodes as a four-element array")
    expect(subId?[3] as? String == "call", "tuple enum element encodes its raw value")
    expect(json["quantity"] as? String == "5", "primitive union encodes its value")

    let decoded = try serializer.decode(PlaceOrder.self, from: data)
    expect(decoded.subId == order.subId, "tuple round-trips")
} catch {
    failed += 1
    print("FAIL: PlaceOrder round-trip threw: \(error)")
}

do {
    let unknownSide = PlaceOrder(subId: order.subId, quantity: .int(1), side: .unknown("short"))
    let json = try JSONSerialization.jsonObject(with: try serializer.encode(unknownSide)) as! [String: Any]
    expect(json["side"] as? String == "short", "unknown enum values encode back unchanged")
} catch {
    failed += 1
    print("FAIL: encoding an unknown enum value threw: \(error)")
}

// ── Message name collision ──

print("── Message name collision ──")

if let message = decode(IncomingMessage.self, #"{"type":"fill","account_id":"a1","fill":{"execution_id":"x1","price":"1.5"}}"#) {
    if case .fill(let fill) = message {
        expect(fill.fill.executionId == "x1", "fill message wraps the Fill schema")
    } else {
        expect(false, "should decode as .fill")
    }
}

// ── Results ──

print("")
print("══════════════════════════════════")
print("  \(passed) passed, \(failed) failed")
print("══════════════════════════════════")

if failed > 0 {
    exit(1)
}
