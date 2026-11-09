// test/swift-tests/FramesTests.swift — Plain-text and array frames, on the wire and decoded.
//
// Injected into a package generated from text-and-array-frames.asyncapi.yaml (client
// perspective) and run as an executable against a local WebSocket server (Network.framework).
//
// It tests:
//   - a plain-text message goes out as its raw text (PING, not "PING")
//   - raw text frames come in as their plain-text messages (PONG, the server's text errors)
//   - a frame that is an array decodes as the array message, its items as the book message's type
//   - object frames still decode by their discriminator
//   - a JSON string still decodes as its plain-text message; unknown text is undecodable

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
        print("FAIL [FramesTests.swift:\(line)]: \(message())")
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

/// A server that answers like the Polymarket market socket: a raw PING gets a raw PONG, any
/// other text that isn't JSON gets INVALID MESSAGE, and a subscribe gets an array of books,
/// a quote and a text error. It records every text frame it receives.
final class Server: Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "frames-server")
    private let connections = OSAllocatedUnfairLock(initialState: [NWConnection]())
    let received = Recorder<String>()

    init() throws {
        let parameters = NWParameters.tcp
        let options = NWProtocolWebSocket.Options()
        options.autoReplyPing = true
        parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
        listener = try NWListener(using: parameters, on: .any)
    }

    func start() async -> UInt16 {
        listener.newConnectionHandler = { [self] connection in
            connections.withLock { $0.append(connection) }
            connection.start(queue: queue)
            receive(on: connection)
        }
        let ready = Recorder<Bool>()
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.append(true) }
        }
        listener.start(queue: queue)
        _ = await waitUntil { !ready.values.isEmpty }
        return listener.port?.rawValue ?? 0
    }

    private func send(_ text: String, on connection: NWConnection) {
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        connection.send(content: Data(text.utf8), contentContext: context, isComplete: true, completion: .idempotent)
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [self] data, context, _, error in
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if error != nil || metadata?.opcode == .close { return }
            if let data, let text = String(data: data, encoding: .utf8) {
                received.append(text)
                if text == "PING" {
                    send("PONG", on: connection)
                } else if text.hasPrefix("{") {
                    send(#"[{"event_type":"book","asset_id":"a1","bids":["0.4"]},{"event_type":"book","asset_id":"a2","bids":[]}]"#, on: connection)
                    send(#"{"event_type":"quote","price":"0.5"}"#, on: connection)
                    send("INVALID ASSET IDS", on: connection)
                } else {
                    send("INVALID MESSAGE", on: connection)
                }
            }
            receive(on: connection)
        }
    }

    func stop() {
        listener.cancel()
        for connection in connections.withLock({ $0 }) { connection.cancel() }
    }
}

/// A message received, reduced to something comparable.
func describe(_ message: IncomingMessage) -> String {
    switch message {
    case .pong(let text): "pong \(text)"
    case .serverError(let text): "serverError \(text)"
    case .book(let book): "book \(book.assetId)"
    case .bookSnapshots(let books): "bookSnapshots \(books.map(\.assetId).joined(separator: ","))"
    case .quote(let quote): "quote \(quote.price)"
    case .unknown(let value): "unknown \(value)"
    case .undecodable(let data, _): "undecodable \(String(decoding: data, as: UTF8.self))"
    }
}

// ── On the wire ──

do {
    let server = try Server()
    let port = await server.start()
    let messages = Recorder<String>()
    let opened = Recorder<Int>()
    let client = WebSocketClient(configuration: ClientConfiguration(
        url: URL(string: "ws://127.0.0.1:\(port)")!,
        pingInterval: nil,
        onConnected: { opened.append(1) }
    ))
    let watcher = Task { for await message in client.messages { messages.append(describe(message)) } }
    await client.connect()
    expect(await waitUntil { !opened.values.isEmpty }, "should connect to the test server")

    try await client.send(.subscribe(Subscribe(assetsIds: ["a1", "a2"])))
    let answered = await waitUntil { messages.values.count >= 3 }
    expect(answered, "the subscribe should be answered with three frames: \(messages.values)")
    expect(messages.values.prefix(3) == ["bookSnapshots a1,a2", "quote 0.5", "serverError INVALID ASSET IDS"],
           "an array frame, an object frame and a text error should each decode as their message: \(messages.values)")

    try await client.send(.ping("PING"))
    let ponged = await waitUntil { messages.values.contains("pong PONG") }
    expect(ponged, "a raw PING should be answered with a raw PONG, received as .pong: \(messages.values)")
    expect(server.received.values.contains("PING"), "the ping should go out as the raw text PING: \(server.received.values)")
    expect(!server.received.values.contains(#""PING""#), "the ping should never go out JSON-encoded: \(server.received.values)")
    expect(!messages.values.contains("serverError INVALID MESSAGE"), "the server should never see a frame it can't use: \(messages.values)")

    watcher.cancel()
    await client.disconnect()
    server.stop()
}

// ── Decoding ──

do {
    expect(IncomingMessage.message(text: #"{"event_type":"quote","price":"1"}"#) == nil, "JSON text is no plain-text message")
    expect(IncomingMessage.message(text: "HELLO") == nil, "an undeclared text is no plain-text message")
    expect(OutgoingMessage.subscribe(Subscribe(assetsIds: [])).text == nil, "an object message isn't sent as text")

    let quoted = try JSONDecoder().decode(IncomingMessage.self, from: Data(#""PONG""#.utf8))
    expect(describe(quoted) == "pong PONG", "a JSON string still decodes as its plain-text message: \(describe(quoted))")

    let empty = try JSONDecoder().decode(IncomingMessage.self, from: Data("[]".utf8))
    expect(describe(empty) == "bookSnapshots ", "an empty array is an empty array message: \(describe(empty))")

    do {
        _ = try JSONDecoder().decode(IncomingMessage.self, from: Data(#"[{"event_type":"book"}]"#.utf8))
        expect(false, "an array whose items don't decode should throw")
    } catch {
        expect("\(error)".contains("assetId") || "\(error)".contains("asset_id"),
               "the error should be the items' own, naming the missing key: \(error)")
    }
}

print("FramesTests: \(passed) passed, \(failed) failed")
if failed > 0 { exit(1) }
