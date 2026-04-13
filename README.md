# AsyncAPI Swift WebSocket Template

An [AsyncAPI Generator](https://github.com/asyncapi/generator) template that produces a **Swift 6** WebSocket client package from an AsyncAPI v3 specification.

> **AI Disclaimer** — This template was developed with the assistance of AI (GitHub Copilot / Claude Opus 4.6). All generated code has been reviewed, tested against real AsyncAPI specs, and validated to compile under Swift 6 strict concurrency. Users should review generated output for their specific use case.

## Features

- **Swift 6 strict concurrency** — all generated types are `Sendable`; the client is an `actor`
- **AsyncStream-based observation** — subscribe to incoming messages and connection state changes via `for await`
- **Configurable serialization** — JSON (default) or [MessagePack](https://github.com/fumoboy007/msgpack-swift) with a protocol-based abstraction
- **Auto-reconnect** — optional exponential backoff with configurable max attempts and base delay
- **Type prefix** — optional prefix for all generated types to avoid naming collisions in multi-module projects
- **Discriminated decoding** — incoming messages are decoded via a `type` field discriminator into a tagged enum
- **Integer & string enums** — automatically detects `Int`-backed enums from integer enum values alongside `String`-backed enums
- **Non-object message payloads** — plain string/const messages (e.g. `PING`/`PONG`) are handled as `String` cases without requiring a struct
- **SPM package** — generates a complete Swift Package Manager project targeting Apple platforms

## Generated Output

| File | Contents |
|------|----------|
| `Package.swift` | SPM manifest — iOS 16+, macOS 13+, tvOS 16+, watchOS 9+ |
| `Sources/Models.swift` | `Codable & Sendable` structs for every message payload and component schema |
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

# With MessagePack serialization
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient \
  -p server=dev -p serialization=msgpack

# With a type prefix
asyncapi generate fromTemplate ./my-api.asyncapi.yaml ./ -o ./MyClient \
  -p server=dev -p typePrefix=OMN

# Compile the generated package
cd ./MyClient && swift build
```

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `server` | **yes** | — | Name of the server entry in the AsyncAPI spec to use for the default connection URL |
| `packageName` | no | Derived from spec title | Name for the generated Swift package |
| `serialization` | no | `json` | Wire format: `json` or `msgpack` |
| `reconnect` | no | `true` | Generate auto-reconnect logic with exponential backoff (`true` or `false`) |
| `typePrefix` | no | `""` | Prefix prepended to all generated Swift type names (e.g. `OMN` → `OMNPlaceOrder`, `OMNWebSocketClient`) |
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

// Send a message
try await client.send(.auth(Auth(type: "auth", token: "my-token")))

// Disconnect
await client.disconnect()
```

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
- **`$ref` resolution** — the AsyncAPI parser v3 inlines `$ref` targets. The template reads `_schemaId` from resolved schemas to recover the original type name, filtering out parser-generated `AnonymousSchema*` identifiers.

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
| `msgpack.asyncapi.yaml` | MessagePack serialization, `wss://` protocol, DMMessagePack dependency |
| `mixed-payloads.asyncapi.yaml` | Integer enums, non-object (plain string) message payloads, mixed decoding strategies |

Parameter combinations tested: `serialization` (json/msgpack), `reconnect` (true/false), `typePrefix`, `packageName`, and all combinations thereof.

### Manual generation

```bash
asyncapi generate fromTemplate test/fixtures/basic.asyncapi.yaml . -o output/basic \
  -p server=local --force-write

cd output/basic && swift build
```

## Known limitations

- **AsyncAPI v3 only** — v2 specs are not supported. The parser v3 API (`.all()` collections, method-based schema accessors) is used throughout.
- **`type` field discriminator** — incoming object message decoding assumes a `type` field in the payload for discrimination. Specs without this convention will need manual adjustment. Non-object payloads (plain strings) are matched by value.
- **Flat struct generation** — nested anonymous objects in schemas may be mapped to `AnyCodable` or a parent-derived name rather than dedicated nested types.
- **Single connection per client** — the generated actor manages one `URLSessionWebSocketTask` at a time. Multiple concurrent connections require multiple client instances.
- **Apple platforms only** — generated code uses `URLSessionWebSocketTask` and Foundation, limiting it to Apple platforms. Linux/Windows support would require a different WebSocket library.
- **No `oneOf` / `allOf` / `anyOf` composition** — schema composition keywords are not handled. Only direct `properties` on schemas are processed.
- **No query parameters or WebSocket binding support** — AsyncAPI WebSocket channel bindings (query params, headers at the channel level) are not read.
- **No authentication generation** — while auth headers can be passed via `ClientConfiguration.headers`, no auth-specific code is generated from security schemes.
- **MessagePack only via msgpack-swift** — the `DMMessagePack` product from [fumoboy007/msgpack-swift](https://github.com/fumoboy007/msgpack-swift) is the only supported MessagePack library.

## Roadmap

- [ ] **AsyncAPI v2 support** — detect spec version and use the appropriate parser API
- [ ] **Schema composition** — handle `oneOf`, `allOf`, `anyOf` for richer type generation
- [ ] **Nested struct generation** — generate dedicated structs for inline anonymous object schemas instead of flattening
- [x] **Integer enum raw types** — detect numeric enums and generate `Int`-backed Swift enums
- [x] **Non-object message payloads** — plain string/const messages handled as `String` enum cases
- [ ] **Other enum raw types** — detect `Double` or other numeric enums beyond `Int`
- [ ] **WebSocket channel bindings** — read query parameters and channel-level headers from AsyncAPI bindings
- [ ] **Security scheme generation** — generate auth helpers from AsyncAPI security schemes (API key, bearer, OAuth2)
- [ ] **Custom discriminator field** — allow configuring the message discrimination field name (currently hardcoded to `type`)
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
