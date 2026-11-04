// test/swift-tests/SocketTests.swift — The client's connection lifecycle, against a local
// WebSocket server (Network.framework) and a port nothing listens on.
//
// Injected into a package generated from basic.asyncapi.yaml and run as an executable.
//
// It tests:
//   - `.connected` and `onConnected` come when the socket opens, never for one that doesn't
//   - while the server is unreachable, attempts count up and the policy can give up
//   - a reconnect after a socket that opened starts again from the first attempt
//   - `connect()` on a connected client closes the old socket
//   - `disconnect()` ends at `.disconnected`

import Foundation
import Network
import os

// ── Test Infrastructure ──

var passed = 0
var failed = 0

@MainActor func expect(_ condition: Bool, _ message: @autoclosure () -> String, line: Int = #line) {
    if condition {
        passed += 1
    } else {
        failed += 1
        print("FAIL [SocketTests.swift:\(line)]: \(message())")
    }
}

/// Values appended from any thread.
final class Recorder<Value: Sendable>: Sendable {
    private let lock = OSAllocatedUnfairLock(initialState: [Value]())
    func append(_ value: Value) { lock.withLock { $0.append(value) } }
    var values: [Value] { lock.withLock { $0 } }
}

func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return condition()
}

/// Retries quickly, a fixed number of times.
struct QuickPolicy: ReconnectionPolicy {
    let attempts: Int
    func delay(forAttempt attempt: Int) -> TimeInterval? { attempt <= attempts ? 0.05 : nil }
}

/// A WebSocket server that greets each connection with `echo_reply` "conn<index>" and records
/// which connections the client closed.
final class Server: Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "test-server")
    private let connections = OSAllocatedUnfairLock(initialState: [NWConnection]())
    let closed = Recorder<Int>()

    init() throws {
        let parameters = NWParameters.tcp
        let options = NWProtocolWebSocket.Options()
        options.autoReplyPing = true
        parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
        listener = try NWListener(using: parameters, on: .any)
    }

    func start() async -> UInt16 {
        listener.newConnectionHandler = { [self] connection in
            let index = connections.withLock { $0.append(connection); return $0.count - 1 }
            connection.stateUpdateHandler = { [self] state in
                if case .ready = state { greet(connection, as: "conn\(index)") }
            }
            connection.start(queue: queue)
            receive(on: connection, index: index)
        }
        let ready = Recorder<Bool>()
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.append(true) }
        }
        listener.start(queue: queue)
        _ = await waitUntil { !ready.values.isEmpty }
        return listener.port?.rawValue ?? 0
    }

    private func greet(_ connection: NWConnection, as name: String) {
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "greeting", metadata: [metadata])
        let json = #"{"type":"echo_reply","message":"\#(name)"}"#
        connection.send(content: Data(json.utf8), contentContext: context, isComplete: true, completion: .idempotent)
    }

    private func receive(on connection: NWConnection, index: Int) {
        connection.receiveMessage { [self] _, context, _, error in
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if error != nil || metadata?.opcode == .close {
                closed.append(index)
                return
            }
            receive(on: connection, index: index)
        }
    }

    /// Drops a connection from the server's side, as a network failure would.
    func drop(_ index: Int) {
        connections.withLock { $0[index] }.cancel()
    }

    func stop() {
        listener.cancel()
        for connection in connections.withLock({ $0 }) { connection.cancel() }
    }
}

// ── An unreachable server ──

do {
    let opened = Recorder<Int>()
    let states = Recorder<ConnectionState>()
    let client = WebSocketClient(configuration: ClientConfiguration(
        url: URL(string: "ws://127.0.0.1:1")!,
        reconnectionPolicy: QuickPolicy(attempts: 3),
        pingInterval: nil,
        onConnected: { opened.append(1) }
    ))
    let watcher = Task { for await state in client.connectionState { states.append(state) } }
    await client.connect()

    let gaveUp = await waitUntil { states.values.last == .disconnected }
    expect(gaveUp, "an unreachable server should end at .disconnected once the policy gives up: \(states.values)")
    expect(
        states.values == [.connecting, .reconnecting(attempt: 1), .reconnecting(attempt: 2), .reconnecting(attempt: 3), .disconnected],
        "attempts should count up without ever reporting .connected: \(states.values)"
    )
    expect(opened.values.isEmpty, "onConnected should not run for a socket that never opened")
    watcher.cancel()
}

// ── A server that accepts, drops and replaces sockets ──

do {
    let server = try Server()
    let port = await server.start()
    expect(port != 0, "the test server should be listening")

    let opened = Recorder<Int>()
    let states = Recorder<ConnectionState>()
    let greetings = Recorder<String>()
    let client = WebSocketClient(configuration: ClientConfiguration(
        url: URL(string: "ws://127.0.0.1:\(port)")!,
        reconnectionPolicy: QuickPolicy(attempts: 5),
        pingInterval: nil,
        onConnected: { opened.append(1) }
    ))
    let stateWatcher = Task { for await state in client.connectionState { states.append(state) } }
    let messageWatcher = Task {
        for await message in client.messages {
            if case .echoReply(let reply) = message { greetings.append(reply.message) }
        }
    }

    await client.connect()
    expect(await waitUntil { states.values.last == .connected && opened.values.count == 1 }, "should connect once the socket opens: \(states.values)")
    expect(await waitUntil { greetings.values.contains("conn0") }, "should receive on the first socket: \(greetings.values)")

    server.drop(0)
    expect(await waitUntil { opened.values.count == 2 && states.values.last == .connected }, "should reconnect after a drop: \(states.values)")
    expect(states.values.contains(.reconnecting(attempt: 1)), "the first drop should be attempt 1: \(states.values)")

    server.drop(1)
    expect(await waitUntil { opened.values.count == 3 && states.values.last == .connected }, "should reconnect after a second drop: \(states.values)")
    expect(!states.values.contains(.reconnecting(attempt: 2)), "a socket that opened should reset the attempts: \(states.values)")

    await client.connect()
    expect(await waitUntil { opened.values.count == 4 && greetings.values.contains("conn3") }, "connect() should open a new socket: \(greetings.values)")
    expect(await waitUntil { server.closed.values.contains(2) }, "connect() should close the socket it replaces: \(server.closed.values)")

    await client.disconnect()
    expect(await waitUntil { states.values.last == .disconnected }, "disconnect() should end at .disconnected: \(states.values)")
    try? await Task.sleep(for: .milliseconds(200))
    expect(opened.values.count == 4, "nothing should reconnect after disconnect(): \(opened.values.count) opens")

    stateWatcher.cancel()
    messageWatcher.cancel()
    server.stop()
}

// ── Summary ──

print("\nSocket tests: \(passed) passed, \(failed) failed")
if failed > 0 {
    exit(1)
}
