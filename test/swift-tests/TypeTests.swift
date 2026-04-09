// test/swift-tests/TypeTests.swift — Swift script that exercises generated types
//
// This file is injected into a generated package and compiled as an executable
// to verify that generated Swift types work correctly at runtime.
//
// It tests:
//   - Struct instantiation
//   - JSON encoding/decoding round-trip
//   - Enum case creation and raw values
//   - Message enum encoding/decoding
//   - Serializer protocol conformance
//   - Configuration and client instantiation
//
// Exit code 0 = all tests passed. Non-zero = failure with diagnostic output.

import Foundation

// ── Test Infrastructure ──

nonisolated(unsafe) var passed = 0
nonisolated(unsafe) var failed = 0

func expect(_ condition: Bool, _ message: String, file: String = #file, line: Int = #line) {
    if condition {
        passed += 1
    } else {
        failed += 1
        print("FAIL [\(file):\(line)]: \(message)")
    }
}

func expectEqual<T: Equatable>(_ a: T, _ b: T, _ message: String, file: String = #file, line: Int = #line) {
    if a == b {
        passed += 1
    } else {
        failed += 1
        print("FAIL [\(file):\(line)]: \(message) — got \(a), expected \(b)")
    }
}

// ── Struct Instantiation ──

print("── Struct Instantiation ──")

let ping = Ping(type: "ping", timestamp: 1234567890)
expect(ping.type == "ping", "Ping.type should be 'ping'")
expect(ping.timestamp == 1234567890, "Ping.timestamp should be 1234567890")

let echo = Echo(type: "echo", message: "hello world")
expect(echo.type == "echo", "Echo.type should be 'echo'")
expect(echo.message == "hello world", "Echo.message should be 'hello world'")

let pong = Pong(type: "pong", timestamp: 1234567890)
expect(pong.type == "pong", "Pong.type should be 'pong'")

let echoReply = EchoReply(type: "echo_reply", message: "hello", serverTime: "2025-01-01T00:00:00Z")
expect(echoReply.message == "hello", "EchoReply.message should be 'hello'")

let error = ServerError(type: "error", code: "bad_request", message: "invalid payload")
expect(error.code == "bad_request", "ServerError.code should be 'bad_request'")

// ── JSON Round-Trip ──

print("── JSON Encoding/Decoding ──")

let encoder = JSONEncoder()
let decoder = JSONDecoder()

do {
    let data = try encoder.encode(echo)
    let decoded = try decoder.decode(Echo.self, from: data)
    expectEqual(decoded.type, echo.type, "Echo round-trip: type")
    expectEqual(decoded.message, echo.message, "Echo round-trip: message")
} catch {
    failed += 1
    print("FAIL: Echo JSON round-trip threw: \(error)")
}

do {
    let data = try encoder.encode(error)
    let decoded = try decoder.decode(ServerError.self, from: data)
    expectEqual(decoded.code, error.code, "ServerError round-trip: code")
    expectEqual(decoded.message, error.message, "ServerError round-trip: message")
} catch {
    failed += 1
    print("FAIL: ServerError JSON round-trip threw: \(error)")
}

// ── CodingKeys (snake_case wire format) ──

print("── CodingKeys ──")

do {
    let data = try encoder.encode(echoReply)
    let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    expect(json["server_time"] != nil, "EchoReply should encode serverTime as server_time")
    expect(json["serverTime"] == nil, "EchoReply should not use camelCase on the wire")
} catch {
    failed += 1
    print("FAIL: CodingKeys test threw: \(error)")
}

do {
    let wireJSON = """
    {"type":"echo_reply","message":"test","server_time":"2025-06-01T12:00:00Z"}
    """.data(using: .utf8)!
    let decoded = try decoder.decode(EchoReply.self, from: wireJSON)
    expectEqual(decoded.serverTime, "2025-06-01T12:00:00Z", "Decode snake_case wire format")
} catch {
    failed += 1
    print("FAIL: snake_case decode threw: \(error)")
}

// ── OutgoingMessage Encoding ──

print("── OutgoingMessage Encoding ──")

do {
    let msg = OutgoingMessage.echo(echo)
    let data = try encoder.encode(msg)
    let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    expectEqual(json["type"] as? String, "echo", "OutgoingMessage.echo encodes type field")
    expectEqual(json["message"] as? String, "hello world", "OutgoingMessage.echo encodes payload")
} catch {
    failed += 1
    print("FAIL: OutgoingMessage encoding threw: \(error)")
}

// ── IncomingMessage Decoding ──

print("── IncomingMessage Decoding ──")

do {
    let pongJSON = """
    {"type":"pong","timestamp":999}
    """.data(using: .utf8)!
    let msg = try decoder.decode(IncomingMessage.self, from: pongJSON)
    if case .pong(let p) = msg {
        expectEqual(p.timestamp, 999, "IncomingMessage.pong decoded timestamp")
    } else {
        failed += 1
        print("FAIL: Expected .pong case, got \(msg)")
    }
} catch {
    failed += 1
    print("FAIL: IncomingMessage pong decode threw: \(error)")
}

do {
    let unknownJSON = """
    {"type":"some_future_type","data":123}
    """.data(using: .utf8)!
    let msg = try decoder.decode(IncomingMessage.self, from: unknownJSON)
    if case .unknown(let typeStr) = msg {
        expectEqual(typeStr, "some_future_type", "IncomingMessage.unknown captures type string")
    } else {
        failed += 1
        print("FAIL: Expected .unknown case, got \(msg)")
    }
} catch {
    failed += 1
    print("FAIL: IncomingMessage unknown decode threw: \(error)")
}

// ── Serializer ──

print("── Serializer ──")

do {
    let serializer = JSONMessageSerializer()
    let msg = OutgoingMessage.ping(ping)
    let encoded = try serializer.encode(msg)
    expect(encoded.count > 0, "JSONMessageSerializer.encode produces non-empty data")

    // Decode a known JSON payload back via the serializer
    let pongJSON = """
    {"type":"pong","timestamp":42}
    """.data(using: .utf8)!
    let decoded = try serializer.decode(IncomingMessage.self, from: pongJSON)
    if case .pong(let p) = decoded {
        expectEqual(p.timestamp, 42, "Serializer round-trip: decoded pong timestamp")
    } else {
        failed += 1
        print("FAIL: Serializer round-trip expected .pong, got \(decoded)")
    }
} catch {
    failed += 1
    print("FAIL: Serializer test threw: \(error)")
}

// ── ClientConfiguration ──

print("── ClientConfiguration ──")

let config = ClientConfiguration(
    url: URL(string: "ws://localhost:9000")!,
    headers: ["X-Test": "value"]
)
expectEqual(config.url.absoluteString, "ws://localhost:9000", "Config URL")
expectEqual(config.headers["X-Test"], "value", "Config headers")

// ── ConnectionState ──

print("── ConnectionState ──")

let state: ConnectionState = .connected
expect(state == .connected, "ConnectionState.connected equality")
expect(ConnectionState.disconnected != .connected, "ConnectionState inequality")

// ── Results ──

print("")
print("══════════════════════════════════")
print("  \(passed) passed, \(failed) failed")
print("══════════════════════════════════")

if failed > 0 {
    exit(1)
}
