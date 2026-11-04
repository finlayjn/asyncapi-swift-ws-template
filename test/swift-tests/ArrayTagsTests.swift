// test/swift-tests/ArrayTagsTests.swift — Positional MessagePack messages decode by their first
// element, with the constants after it checked and a Double-backed enum.
//
// Injected into a package generated from msgpack-array-tags.asyncapi.yaml
// (serialization=msgpack, msgpackFormat=array) and run as an executable.

import Foundation
import MessagePack

var passed = 0
var failed = 0

@MainActor func expect(_ condition: Bool, _ message: @autoclosure () -> String, line: Int = #line) {
    if condition {
        passed += 1
    } else {
        failed += 1
        print("FAIL [ArrayTagsTests.swift:\(line)]: \(message())")
    }
}

/// One positional message, as the server would send it.
struct Row: Encodable {
    enum Element: Encodable {
        case string(String)
        case number(Double)

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .string(let value): try container.encode(value)
            case .number(let value): try container.encode(value)
            }
        }
    }

    let elements: [Element]

    init(_ elements: Element...) { self.elements = elements }

    func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        for element in elements { try container.encode(element) }
    }
}

func decode(_ row: Row) throws -> IncomingMessage {
    try MessagePackSerializer().decode(IncomingMessage.self, from: try MessagePackEncoder().encode(row))
}

do {
    let message = try decode(Row(.string("trade"), .string("book"), .string("0.52"), .string("10")))
    if case .trade(let trade) = message {
        expect(trade.channel == "book" && trade.price == "0.52" && trade.size == "10", "trade fields should follow the tag: \(trade)")
    } else {
        expect(false, "a trade row should decode as a trade: \(message)")
    }
} catch {
    expect(false, "a trade row should decode: \(error)")
}

do {
    let message = try decode(Row(.string("quote"), .string("book"), .string("0.51"), .number(1.5)))
    if case .quote(let quote) = message {
        expect(quote.bid == "0.51" && quote.step == ._1_5, "quote fields should follow the tag: \(quote)")
    } else {
        expect(false, "a quote row should decode as a quote: \(message)")
    }
} catch {
    expect(false, "a quote row should decode: \(error)")
}

do {
    _ = try decode(Row(.string("trade"), .string("0.52"), .string("10"), .string("x")))
    expect(false, "a trade row without its channel constant should fail, not shift its fields")
} catch {
    expect(error is DecodingError, "the wrong constant should be a decoding error: \(error)")
}

do {
    let message = try decode(Row(.string("auction"), .string("book")))
    if case .unknown(let tag) = message {
        expect(tag == "auction", "an unknown tag should be kept: \(tag)")
    } else {
        expect(false, "an unknown tag should decode as unknown: \(message)")
    }
} catch {
    expect(false, "an unknown tag should decode: \(error)")
}

print("\nArray tag tests: \(passed) passed, \(failed) failed")
if failed > 0 {
    exit(1)
}
