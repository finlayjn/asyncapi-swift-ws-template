# AsyncAPI Swift WebSocket Template

An [AsyncAPI Generator](https://github.com/asyncapi/generator) template that produces a **Swift 6** WebSocket client package from an AsyncAPI v3 specification.

> **AI Disclaimer** — This template was developed with the assistance of AI (GitHub Copilot / Claude Opus 4.6). All generated code has been reviewed, tested against real AsyncAPI specs, and validated to compile under Swift 6 strict concurrency. Users should review generated output for their specific use case.

## Features

- **Swift 6 strict concurrency** — all generated types are `Sendable`; the client is an `actor`
- **AsyncStream-based observation** — subscribe to incoming messages and connection state changes via `for await`
- **Configurable serialization** — JSON (default) or [MessagePack](https://github.com/fumoboy007/msgpack-swift) with a protocol-based abstraction. MessagePack mode supports both keyed map decoding (default) and positional array-format decoding via `UnkeyedDecodingContainer`, controlled by the `msgpackFormat` parameter
- **Auto-reconnect** — optional exponential backoff with jitter, configurable max attempts and base delay (enabled by default)
- **Type prefix** — optional prefix for all generated types to avoid naming collisions in multi-module projects
- **Discriminated decoding** — incoming messages are decoded via an auto-detected discriminator field (e.g. `type`, `event_type`) into a tagged enum, using the `const` values from the schema for matching
- **`anyOf` / `oneOf` support** — `anyOf [Type, null]` maps to `Type?` (optional); multi-type `anyOf` maps to a generated `JSONValue` enum with a warning
- **Inline struct generation** — anonymous inline objects (in properties, array items, or `anyOf` variants) are extracted into dedicated structs, deduplicated by shape (matching property names, types, and nullability)
- **`JSONValue` fallback type** — a `Codable & Sendable & Hashable` enum handling arbitrary JSON values (string, int, double, bool, object, array, null), generated only when needed
- **Name collision detection** — if multiple messages share the same `name` field with different payloads, generation fails with a clear error. Pass `allowNameCollisions=true` to disambiguate using component keys instead
- **Integer & string enums** — automatically detects `Int`-backed enums from integer enum values alongside `String`-backed enums
- **Non-object message payloads** — plain string/const messages (e.g. `PING`/`PONG`) are handled as `String` cases without requiring a struct
- **Public initializers** — all generated structs include explicit `public init(...)` methods; `const` fields are auto-assigned and excluded from parameters
- **Server pathname support** — the generator appends the server's `pathname` to the `host` when building the default URL
- **SPM package** — generates a complete Swift Package Manager project targeting Apple platforms

## Generated Output

| File | Contents |
|------|----------|
| `Package.swift` | SPM manifest — iOS 16+, macOS 13+, tvOS 16+, watchOS 9+ |
| `Sources/Models.swift` | `Codable & Sendable` structs for every message payload, component schema, and inline anonymous object. Includes `JSONValue` enum when `anyOf` multi-type or untyped objects are present. When `msgpackFormat=array`, receive-direction structs include custom `init(from:)` using `UnkeyedDecodingContainer` for positional array decoding |
| `Sources/Enums.swift` | Shared enum types extracted from schemas — `String`-backed (e.g. `Side`) and `Int`-backed (e.g. `Level`) |
| `Sources/MessageEnums.swift` | `IncomingMessage` / `OutgoingMessage` tagged enums with discriminated decoding |
| `Sources/MessageSerializer.swift` | `MessageSerializer` protocol + JSON and (optionally) MessagePack implementations |
| `Sources/WebSocketClient.swift` | Actor-based client using `URLSessionWebSocketTask`, `AsyncStream` observation, optional auto-reconnect with exponential backoff |

## Usage

```bash
# Install the AsyncAPI CLI
npm install -g @asyncapi/cli

# Generate from a local template checkout
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient -p server=dev

# With MessagePack serialization (keyed map decoding, the default)
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient \
  -p server=dev -p serialization=msgpack

# With MessagePack positional array decoding
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient \
  -p server=dev -p serialization=msgpack -p msgpackFormat=array

# With a type prefix
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient \
  -p server=dev -p typePrefix=OMN

# Allow name collisions (when multiple messages share the same name field)
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient \
  -p server=dev -p allowNameCollisions=true

# Compile the generated package
cd ./MyClient && swift build
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `server` | **yes** | — | Name of the server entry in the AsyncAPI spec to use for the default connection URL |
| `packageName` | no | Derived from spec title | Name for the generated Swift package |
| `serialization` | no | `json` | Wire format: `json` or `msgpack` |
| `msgpackFormat` | no | `map` | Wire layout for msgpack messages: `map` (keyed dictionaries) or `array` (positional). Only applies when `serialization=msgpack` |
| `reconnect` | no | `true` | Generate auto-reconnect logic with exponential backoff (`true` or `false`) |
| `typePrefix` | no | `""` | Prefix prepended to all generated Swift type names (e.g. `OMN` → `OMNPlaceOrder`, `OMNWebSocketClient`) |
| `allowNameCollisions` | no | `"false"` | When `"true"`, allow multiple messages to share the same `name` field. Colliding messages are disambiguated using their component key (e.g. `order_preview_response`). Default is `"false"`, which treats collisions as a generation error. |
| `formatter` | no | `""` | Shell command to format generated Swift files (e.g. `swift-format -i`, `swiftformat`). File paths are appended as arguments. |

## Quick start (generated client)

```swift
import MyClient

// Configure and create the client
let client = WebSocketClient(
    configuration: .init(
        url: URL(string: "ws://localhost:8080")!,
        headers: ["Authorization": "Bearer \(token)"]
    )
)

// Connect
await client.connect()

// Observe connection state
Task {
    for await state in await client.stateStream {
        print("Connection state: \(state)")
    }
}

// Listen for incoming messages
Task {
    for await message in await client.messages {
        switch message {
        case .authAck(let ack):
            print("Authenticated as \(ack.userId)")
        case .fill(let fill):
            print("Fill: \(fill.price) x \(fill.size)")
        case .error(let error):
            print("Error: \(error.message)")
        case .unknown(let type):
            print("Unknown message type: \(type)")
        }
    }
}

// Send a message — const fields (like `type`) are auto-assigned
try await client.send(.auth(Auth(token: "my-token")))

// Disconnect
await client.disconnect()
```

## Reconnection behavior

When `reconnect` is `true` (the default generation parameter), the generated client includes auto-reconnect logic, **enabled by default at runtime**. You can configure or disable it via the configuration:

```swift
let client = WebSocketClient(
    configuration: .init(
        autoReconnect: true,          // default: true
        maxReconnectAttempts: 10,     // default: 10
        baseReconnectDelay: 1.0       // default: 1 second
    )
)
```

**How it works:**

- The connection state transitions to `.connected` only after the first successful message is received from the server (not immediately on `task.resume()`), so consumers can trust the state.
- On unexpected disconnection, the client enters `.reconnecting(attempt: N)` and waits using exponential backoff with jitter: `min(base * 2^(attempt-1), 60s) * random(0.8…1.2)`. Jitter prevents thundering-herd reconnections when many clients lose connectivity simultaneously.
- The reconnect attempt counter resets to zero only after a successful reconnection (confirmed by receiving a message), so `maxReconnectAttempts` is strictly enforced even if the server is unreachable.
- Calling `disconnect()` sets an `intentionalDisconnect` flag that suppresses any in-flight or future reconnect attempts.
- Connection state changes are observable via the `connectionState` AsyncStream: `.disconnected`, `.connecting`, `.connected`, `.reconnecting(attempt:)`.

To disable reconnection support entirely at generation time (removes the code from the output), pass `-p reconnect=false`.

## Architecture

```
asyncapi-swift-ws-template/
├── template/               # React render engine templates (JSX)
│   ├── index.js            # Orchestrator — assembles all generated files
│   ├── PackageSwift.js     # Package.swift generation
│   ├── Models.js           # Codable struct generation
│   ├── Enums.js            # Shared enum generation
│   ├── MessageEnums.js     # Tagged message enum generation
│   ├── Serializer.js       # Serialization protocol + implementations
│   └── WebSocketClient.js  # Actor-based client generation
├── helpers/
│   ├── swift.js            # Swift naming, type mapping, keyword escaping
│   └── schema.js           # AsyncAPI v3 model extraction and processing
├── hooks/
│   └── 01_createDirs.js    # Pre-generation hook to create Sources/ directory
├── test/
│   ├── fixtures/            # Publishable test AsyncAPI specs
│   └── swift-tests/         # Swift runtime test scripts
├── package.json            # Generator config, params, and scripts
└── README.md
```

### Key design decisions

- **All `.js` files in `template/` are processed as independent entry points** by the AsyncAPI generator's React render engine. Each component must independently initialize shared state (like `typePrefix`) rather than relying on `index.js` to set it first. This is a generator framework behavior, not a choice.
- **`toSwiftBaseTypeName` vs `toSwiftTypeName`** — internal naming uses the unprefixed base name for enum disambiguation and context building to prevent double-prefixing. Only `toSwiftTypeName` (which wraps `toSwiftBaseTypeName` + prefix) is used for final output names.
- **Enum deduplication** — enums are keyed by their sorted value set. If two different schema properties produce the same enum name but different values, the second is disambiguated with a context prefix (e.g. `Side` for `bid|ask`, `TradeSide` for `buy|sell`).
- **Reserved type collision avoidance** — types that shadow Swift stdlib/Foundation types (e.g. `Error`, `Result`, `Array`) are prefixed with `Server` (e.g. `ServerError`). This applies before the user's `typePrefix`.
- **`$ref` resolution** — the AsyncAPI parser v3 inlines `$ref` targets. The template reads `_schemaId` from resolved schemas to recover the original type name, filtering out parser-generated anonymous identifiers (`<anonymous-schema-N>` format).
- **Inline struct deduplication** — anonymous inline objects are extracted into standalone structs keyed by their *shape* (sorted property names, types, formats, and nullability). If two different messages define inline objects with identical shapes, they share a single struct. Name collisions between inline structs from different parents are resolved by prefixing with the parent context name.
- **`anyOf` handling** — `anyOf [Type, null]` (the nullable pattern) maps to `Type?`. Multi-type `anyOf` without a clear resolution maps to `JSONValue` with a generation warning. The `JSONValue` enum is only emitted when actually referenced.
- **Name collision detection** — `extractMessages()` detects when different component messages share the same `name` field. By default this is a hard error. When `allowNameCollisions=true`, the second message is disambiguated using its component key (e.g. `submit_order_response` instead of `submit_order`).

## Requirements

- **Node.js** 18+
- **@asyncapi/cli** 6.x (`npm install -g @asyncapi/cli`)
- **Swift** 6.0+ (generated code)
- **Xcode** 16+ / macOS 13+
- **AsyncAPI spec** v3 with WebSocket (`ws` / `wss`) protocol

## Development

```bash
npm install
```

### Testing

The test suite has three tiers, all runnable via `npm test`:

```bash
# Run everything (static + compile + Swift runtime)
npm test

# Static output tests only (~30s) — validates file structure, naming, params
npm run test:static

# Swift compilation tests (~60s) — verifies all configs compile under Swift 6
npm run test:compile

# Swift runtime tests (~10s) — builds and runs generated types at runtime
npm run test:swift
```

Test fixtures live in `test/fixtures/` and cover:

| Fixture | Exercises |
|---------|-----------|
| `basic.asyncapi.yaml` | Minimal send/receive, CodingKeys, Error→ServerError rename |
| `enums-and-refs.asyncapi.yaml` | Enum extraction, deduplication, `$ref` resolution, array refs, reserved type handling |
| `msgpack.asyncapi.yaml` | MessagePack serialization, `wss://` protocol, DMMessagePack dependency, keyed map decoding (default) and array-format `UnkeyedDecodingContainer` decoding (`msgpackFormat=array`) for receive structs |
| `mixed-payloads.asyncapi.yaml` | Integer enums, non-object (plain string) message payloads, mixed decoding strategies |
| `custom-discriminator.asyncapi.yaml` | Non-standard discriminator key (`event_type`), server `pathname`, plain string const payloads (`PING`/`PONG`), public init with const auto-assignment |
| `anyof-inline.asyncapi.yaml` | `anyOf` nullable patterns (`[type, null]` → optional), multi-type `anyOf` → `JSONValue` fallback, inline anonymous objects in properties and array items, untyped object → `[String: JSONValue]`, conditional `JSONValue` generation |
| `name-collision.asyncapi.yaml` | Name collision detection (two messages with same `name`, different payloads), hard error by default, `allowNameCollisions=true` bypass with component-key disambiguation |

Parameter combinations tested: `serialization` (json/msgpack), `msgpackFormat` (map/array), `reconnect` (true/false), `typePrefix`, `packageName`, `allowNameCollisions`, and all combinations thereof.

### Manual generation

```bash
asyncapi generate fromTemplate test/fixtures/basic.asyncapi.yaml . -o output/basic \
  -p server=local --force-write

cd output/basic && swift build
```

## Known limitations

- **AsyncAPI v3 only** — v2 specs are not supported. The parser v3 API (`.all()` collections, method-based schema accessors) is used throughout.
- **Single discriminator key** — the discriminator key is auto-detected from the first `const` property found in receive message payloads. All incoming object messages must share the same discriminator key. Non-object payloads (plain strings) are matched by their `const` value.
- **Deep nesting** — inline struct extraction handles one level of anonymous objects (direct properties, array items, `anyOf` variants). Deeply nested anonymous objects beyond the first level may still fall back to `JSONValue`. (Note: `prefixItems` tuple arrays where all elements share the same type are correctly mapped to their common Swift type, e.g. `[String]`.)
- **Single connection per client** — the generated actor manages one `URLSessionWebSocketTask` at a time. Multiple concurrent connections require multiple client instances.
- **Apple platforms only** — generated code uses `URLSessionWebSocketTask` and Foundation, limiting it to Apple platforms. Linux/Windows support would require a different WebSocket library.
- **Limited `allOf` composition** — `anyOf` and `oneOf` are handled (nullable pattern → optional, multi-type → `JSONValue`), but `allOf` merging of multiple schemas into a single struct is not yet supported.
- **No query parameters or WebSocket binding support** — AsyncAPI WebSocket channel bindings (query params, headers at the channel level) are not read.
- **No authentication generation** — while auth headers can be passed via `ClientConfiguration.headers`, no auth-specific code is generated from security schemes.
- **MessagePack only via msgpack-swift** — the `DMMessagePack` product from [fumoboy007/msgpack-swift](https://github.com/fumoboy007/msgpack-swift) is the only supported MessagePack library.
- **MessagePack wire format must be specified** — when `serialization=msgpack`, the `msgpackFormat` parameter controls how incoming events are decoded: `map` (default) for keyed dictionaries, or `array` for positional arrays ordered by the `required` array in the schema. Outgoing commands always encode as keyed maps regardless of format.

## Roadmap

- [ ] **AsyncAPI v2 support** — detect spec version and use the appropriate parser API
- [x] **Schema composition (`anyOf` / `oneOf`)** — nullable patterns map to optionals; multi-type unions map to `JSONValue`
- [x] **Inline struct generation** — anonymous inline objects are extracted into dedicated structs, deduplicated by shape
- [x] **Name collision detection** — hard error when different messages share the same name; `allowNameCollisions` bypass with disambiguation
- [ ] **`allOf` schema merging** — merge multiple `allOf` schemas into a single struct
- [x] **Integer enum raw types** — detect numeric enums and generate `Int`-backed Swift enums
- [x] **Non-object message payloads** — plain string/const messages handled as `String` enum cases
- [ ] **Other enum raw types** — detect `Double` or other numeric enums beyond `Int`
- [ ] **WebSocket channel bindings** — read query parameters and channel-level headers from AsyncAPI bindings
- [ ] **Security scheme generation** — generate auth helpers from AsyncAPI security schemes (API key, bearer, OAuth2)
- [x] **Custom discriminator field** — auto-detected from the first `const` property in receive messages (e.g. `type`, `event_type`)
- [ ] **Linux / cross-platform support** — abstract the WebSocket transport to support `swift-nio` / `WebSocketKit` for server-side Swift
- [ ] **Combine publisher option** — generate `@Published` / `AnyPublisher` observation alongside or instead of `AsyncStream`
- [ ] **Protocol-based message handling** — generate a delegate protocol as an alternative to switch-based message dispatch
- [ ] **Per-message send/receive methods** — generate typed `send*()` and `on*()` convenience methods on the client
- [ ] **Unit test generation** — generate XCTest / Swift Testing stubs for the client and serializer
- [ ] **OpenAPI schema `$ref` to external files** — support cross-file `$ref` resolution
- [ ] **Configurable platform versions** — allow overriding minimum deployment targets via parameters
- [ ] **Protobuf serialization** — add a third serialization option using SwiftProtobuf
- [ ] **Retry / queue for outgoing messages** — buffer sends when disconnected and flush on reconnect
- [ ] **Connection health monitoring** — expose ping/pong latency and connection quality metrics
- [ ] **Documentation comments** — generate `///` doc comments from AsyncAPI descriptions on all types and properties
- [ ] **Publish to npm** — publish as a proper AsyncAPI generator template installable via npm
- [ ] **Sample data** - generate `.sample` extensions based on `example` values in the AsyncAPI spec for easier testing and debugging

## License

MIT
