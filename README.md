# AsyncAPI Swift WebSocket Template

An [AsyncAPI Generator](https://github.com/asyncapi/generator) template that produces a **Swift 6** WebSocket client package from an AsyncAPI v3 specification.

> **AI Disclaimer** — This template was developed with the assistance of AI (GitHub Copilot / Claude Opus 4.6). All generated code has been reviewed, tested against real AsyncAPI specs, and validated to compile under Swift 6 strict concurrency. Users should review generated output for their specific use case.

## Features

- **Swift 6 strict concurrency** — all generated types are `Sendable`; the client is an `actor`
- **AsyncStream-based observation** — subscribe to incoming messages, connection-state changes, and non-fatal errors via `for await`
- **Configurable serialization** — JSON (default) or [MessagePack](https://github.com/fumoboy007/msgpack-swift) with a protocol-based abstraction. MessagePack mode supports both keyed map decoding (default) and positional array-format decoding via `UnkeyedDecodingContainer`, controlled by the `msgpackFormat` parameter
- **Auto-reconnect** — driven by an injectable `ReconnectionPolicy` (default: exponential backoff with jitter), with an `onConnected` hook that fires on every (re)connection so subscriptions can be restored automatically. Enabled by default; pass `NoReconnectionPolicy()` to own reconnection yourself
- **Type prefix** — optional prefix for all generated types to avoid naming collisions in multi-module projects
- **Discriminated decoding** — incoming messages are decoded via a discriminator field (e.g. `type`, `event_type`) into a tagged enum: the property whose `const` values tell every message apart. When both object and plain-string messages exist, the decoder tries the keyed container first and falls back to `singleValueContainer` in a `catch` block — this avoids a Swift `Decoder` crash where `singleValueContainer()` (which never throws) would register the top-level container and block subsequent `container(keyedBy:)` calls
- **`allOf` composition** — messages using `allOf` (e.g. combining a base schema via `$ref` with additional properties) are flattened into a single struct with all properties merged. Enum extraction and inline struct scanning also traverse `allOf` sub-schemas
- **`anyOf` / `oneOf` support** — `anyOf [Type, null]` maps to `Type?` (optional). Unions of JSON primitives (e.g. `string | integer`) become an enum with one case per type (`.int(Int)`, `.string(String)`); unions of objects that share a `const` discriminator become a tagged enum with one case per variant plus `unknown(String)`. Variants that differ only by `enum`, `const` or `pattern` collapse to their shared type. Anything else maps to `JSONValue` with a warning
- **Open enums** — with `openEnums=true`, every enum gets an `unknown(RawValue)` case, so a value the server adds later decodes instead of failing the message. Unknown values encode back unchanged and are reported to an optional handler on the serializer (see [Open enums](#open-enums))
- **Positional tuples** — arrays with mixed-type `prefixItems` (e.g. `[integer, integer, string, enum]`) become a struct encoded as an array, with elements named from each item's `title` (or an identifier-like `description`, else `item_N`)
- **Inline struct generation** — anonymous inline objects are extracted into dedicated structs at any depth (properties, array items, arrays of arrays, `anyOf`/`oneOf` variants, objects inside arrays), deduplicated by their whole schema (nested properties, enums and required lists included). `allOf` compositions are merged into one struct, a schema's own properties and nested `allOf` members included
- **`JSONValue` fallback type** — a `Codable & Sendable & Hashable` enum handling arbitrary JSON values (string, int, double, bool, object, array, null), generated only when needed
- **Name collision detection** — if different messages share the same `name` field, generation fails with a clear error. Pass `allowNameCollisions=true` to disambiguate using component keys instead. Messages without a `name` that two channels give the same key (each stream's own `auth`) are named after their components
- **Enums with a `null` member** — `enum: [a, b, null]` makes the property optional rather than adding a `null` case
- **Integer & string enums** — automatically detects `Int`-backed enums from integer enum values alongside `String`-backed enums. Enum values containing dots (e.g. `sensor.alarm.high_temperature`) are treated as word separators and converted to valid camelCase Swift identifiers with explicit raw value assignments
- **Undecodable message handling** — messages that fail to decode are surfaced as `.undecodable(Data, any Error)` cases on `IncomingMessage` by default, giving consumers access to the raw data and error for logging or debugging. Pass `undecodableMessages=drop` to silently skip malformed messages instead
- **Non-object message payloads** — plain string/const messages (e.g. `PING`/`PONG`) are handled as `String` cases without requiring a struct
- **Public initializers** — all generated structs include explicit `public init(...)` methods; `const` fields are auto-assigned and excluded from parameters
- **Server pathname support** — the generator appends the server's `pathname` to the `host` when building the default URL
- **SPM package** — generates a complete Swift Package Manager project targeting Apple platforms

## Generated Output

| File | Contents |
|------|----------|
| `Package.swift` | SPM manifest — iOS 16+, macOS 13+, tvOS 16+, watchOS 9+ |
| `Sources/Models.swift` | `Codable & Sendable` structs for every message payload, component schema, and inline anonymous object. Also holds generated union enums and tuple structs. Includes `JSONValue` enum when an unsupported union or untyped objects are present. When `msgpackFormat=array`, receive-direction structs include custom `init(from:)` using `UnkeyedDecodingContainer` for positional array decoding |
| `Sources/Enums.swift` | Shared enum types extracted from schemas — `String`-backed (e.g. `Side`) and `Int`-backed (e.g. `Level`). With `openEnums=true`, each has an `unknown` case, and `UnknownEnumValue` reports them |
| `Sources/MessageEnums.swift` | `IncomingMessage` / `OutgoingMessage` tagged enums with discriminated decoding |
| `Sources/MessageSerializer.swift` | `MessageSerializer` protocol + JSON and (optionally) MessagePack implementations |
| `Sources/WebSocketClient.swift` | Actor-based client using `URLSessionWebSocketTask`; `AsyncStream`s for `messages`, `connectionState`, and `errors`; optional auto-reconnect via an injectable `ReconnectionPolicy` with an `onConnected` hook |

## Usage

```bash
# Install the AsyncAPI CLI
npm install -g @asyncapi/cli

# Generate using the published template
asyncapi generate fromTemplate ./my-api.asyncapi.yaml @finlayjn/asyncapi-swift-ws-template -o ./MyClient -p server=dev

# With a client-perspective spec (non-standard AsyncAPI v3)
asyncapi generate fromTemplate ./my-api.asyncapi.yaml @finlayjn/asyncapi-swift-ws-template -o ./MyClient \
  -p server=dev -p perspective=client

# With MessagePack serialization (keyed map decoding, the default)
asyncapi generate fromTemplate ./my-api.asyncapi.yaml @finlayjn/asyncapi-swift-ws-template -o ./MyClient \
  -p server=dev -p serialization=msgpack

# With MessagePack positional array decoding
asyncapi generate fromTemplate ./my-api.asyncapi.yaml @finlayjn/asyncapi-swift-ws-template -o ./MyClient \
  -p server=dev -p serialization=msgpack -p msgpackFormat=array

# With a type prefix
asyncapi generate fromTemplate ./my-api.asyncapi.yaml @finlayjn/asyncapi-swift-ws-template -o ./MyClient \
  -p server=dev -p typePrefix=OMN

# Allow name collisions (when multiple messages share the same name field)
asyncapi generate fromTemplate ./my-api.asyncapi.yaml @finlayjn/asyncapi-swift-ws-template -o ./MyClient \
  -p server=dev -p allowNameCollisions=true

# Compile the generated package
cd ./MyClient && swift build
```

### As a library (no generator, any Node version)

`lib/` renders the same files without the AsyncAPI generator or its CLI, so it works on Node 26 and takes no npm installs or hooks. Parse the spec with `@asyncapi/parser`. If the spec `$ref`s other files, bundle it first with `@asyncapi/bundler`, as the CLI's `asyncapi bundle` does. Then pass the document and the same parameters:

```js
const { Parser, fromFile } = require('@asyncapi/parser');
const { generate } = require('@finlayjn/asyncapi-swift-ws-template/lib');

const { document } = await fromFile(new Parser(), 'asyncapi.yaml').parse();
const files = generate(document, { server: 'production', typePrefix: 'My', openEnums: 'true' });
// [{ path: 'Package.swift', content: '…' }, { path: 'Sources/Models.swift', content: '…' }, …]
```

The output is byte-for-byte what the generator writes (`test/library.test.js`). The `formatter` hook doesn't run.

### Shared helpers across clients

By default every client carries its own prefixed copy of the WebSocket client, reconnection policies, serializers and `UnknownEnumValue`. With several clients in one project, generate those once and share them:

```js
const { generate, generateHelpers, generateMessagePackHelpers } = require('@finlayjn/asyncapi-swift-ws-template/lib');

const helpers = generateHelpers();                              // a module, say `Helpers`
const messagePack = generateMessagePackHelpers('Helpers');      // a module with MessagePackSerializer
const client = generate(document, {
  server: 'production', typePrefix: 'My', openEnums: 'true',
  helpersModule: 'Helpers',
  messagePackHelpersModule: 'HelpersMessagePack',               // only with MessagePack
});
```

* **What the helpers module holds:** a `WebSocketClient` actor that is generic over a spec's incoming and outgoing messages, with its `WebSocketClientConfiguration`, reconnection policies, `WebSocketClientError`, `MessageSerializer` and `JSONMessageSerializer`, and `UnknownEnumValue`.
  * The serializer decides the socket frame: text, or binary for MessagePack.
  * Pass `generateHelpers({ unknownEnumValue: false })` when the module already has an `UnknownEnumValue` with the same API.
* **`MessagePackSerializer`** lives in its own module, so JSON-only projects don't depend on msgpack-swift.
* **Each client keeps its old names as type aliases** (`MyWebSocketClient`, `MyClientConfiguration`, `MyExponentialBackoffPolicy`, …), so code written against an inline client keeps compiling. The aliases name the helpers module (`Helpers.ExponentialBackoffPolicy`), so code imports the client module alone, as with an inline client; without a `typePrefix`, importing the helpers module as well would make the names ambiguous.
* **Each client's configuration adds an initializer with the spec's serializer.** There is no default URL: pass the server's.
* **Only `Sources/` is generated;** the host package declares the modules.

### Unknown values

Open enums decode a value the client doesn't know as `unknown(raw)`. If the spec itself has a value named `unknown`, that case is `unknownValue`, so `.unknown` means the same thing in every enum.

### Upgrading from 1.x

2.0.0 changes generated code that call sites can depend on:

* **`.unknown` is always the fallback case** of an open enum. In 1.x, a spec value named `unknown` kept the case `.unknown` and the fallback was `.unknownValue(raw)`; now the spec's value is `.unknownValue` and the fallback is `.unknown(raw)`. A `case .unknown:` still compiles but matches the other case, so check switches over enums whose spec has an `unknown` value.
* **Specs whose incoming messages can't all be told apart fail generation** instead of generating a client that can never receive some of them: two messages with the same discriminator value, or no property every message gives a constant.
* **`.connected` comes when the socket opens**, not when `connect()` is called, and `onConnected` fires then. Reconnect attempts count up until a socket opens.
* **Parameters can be booleans** when the template is called as a library (`openEnums: true`).
* **`allOf` is merged in full:** a schema's own `properties` beside an `allOf`, and `allOf` inside an `allOf` member, add their properties to the struct (1.x dropped them).
* **Inline objects share a struct only when their whole schema matches,** nested properties, enums and required lists included. Objects that 1.x merged by their top-level keys alone get their own structs, named after their context (`FillDetail`).
* **Enums of non-integer numbers are `Double`-backed** (1.x made them `String`-backed, so they never decoded), and negative number cases are named like `_minus2`.
* **`msgpackFormat=array` tags messages by their first element,** which must be a `const`, different in each incoming message; later constants are checked.

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `server` | **yes** | — | Name of the server entry in the AsyncAPI spec to use for the default connection URL |
| `packageName` | no | Derived from spec title | Name for the generated Swift package |
| `serialization` | no | `json` | Wire format: `json` or `msgpack` |
| `msgpackFormat` | no | `map` | Wire layout for msgpack messages: `map` (keyed dictionaries) or `array` (positional). Only applies when `serialization=msgpack` |
| `reconnect` | no | `true` | Generate auto-reconnect logic — the injectable `ReconnectionPolicy`, the `onConnected` hook, and the reconnection loop (`true` or `false`; `false` removes the code from the output) |
| `typePrefix` | no | `""` | Prefix prepended to all generated Swift type names (e.g. `OMN` → `OMNPlaceOrder`, `OMNWebSocketClient`) |
| `allowNameCollisions` | no | `"false"` | When `"true"`, allow multiple messages to share the same `name` field. Colliding messages are disambiguated using their component key (e.g. `order_preview_response`). Default is `"false"`, which treats collisions as a generation error. |
| `perspective` | no | `"server"` | Perspective from which the AsyncAPI spec is written: `server` (default, standard AsyncAPI v3 — `action: send` means server-to-client) or `client` (`action: send` means client-to-server). |
| `openEnums` | no | `"false"` | When `"true"`, every generated enum gets an `unknown(RawValue)` case and unknown values are reported to the serializer's `unknownEnumValueHandler`. See [Open enums](#open-enums). |
| `undecodableMessages` | no | `"yield"` | How to handle messages that fail to decode: `yield` (default — adds `.undecodable(Data, any Error)` case to `IncomingMessage`) or `drop` (silently skip malformed messages). |
| `helpersModule` | no | — | Module holding the shared helpers (see [Shared helpers across clients](#shared-helpers-across-clients)). The client imports it instead of carrying its own copy, and only `Sources/` is generated. |
| `messagePackHelpersModule` | with `helpersModule` and `serialization=msgpack` | — | Module holding the shared `MessagePackSerializer`. |
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
    for await state in await client.connectionState {
        print("Connection state: \(state)")
    }
}

// Observe non-fatal errors (connection drops, ping failures, and dropped decode failures)
Task {
    for await error in await client.errors {
        print("WebSocket error: \(error)")
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
        case .undecodable(let data, let error):
            print("Failed to decode \(data.count) bytes: \(error)")
        }
    }
}

// Send a message — const fields (like `type`) are auto-assigned
try await client.send(.auth(Auth(token: "my-token")))

// Disconnect
await client.disconnect()
```

## Open enums

A shipped app can't be updated as fast as a server adds enum values. With `-p openEnums=true`,
each generated enum keeps the spec's cases and adds a fallback:

```swift
public enum Side: RawRepresentable, CaseIterable, Codable, Sendable, Hashable {
    case buy
    case sell
    /// A value this version of the client doesn't know.
    case unknown(String)   // `unknown(Int)` for integer enums
}
```

- Decoding never throws on an unlisted value; it becomes `.unknown("short")`.
- Encoding writes the raw value back unchanged, so an unknown value round-trips.
- `allCases` lists only the spec's cases (for pickers).
- Unknown values are reported through the decoder's `userInfo`. Pass a handler to the
  serializer to send them to monitoring, so the client stays a contract canary without
  failing users:

```swift
let serializer = JSONMessageSerializer(unknownEnumValueHandler: { value in
    // value.type ("Side"), value.value ("short"), value.codingPath (["orders", "0", "side"])
    Monitoring.report(value.description)
})
let client = WebSocketClient(configuration: ClientConfiguration(serializer: serializer))
```

Switches over an open enum must handle `.unknown(raw)` (render a neutral fallback). If a spec value
is literally `unknown`, that value's case is named `unknownValue`, with a warning, so `.unknown`
always means a value the client doesn't know.

## Reconnection behavior

When `reconnect` is `true` (the default generation parameter), the generated client includes auto-reconnect logic, **enabled by default at runtime**. Reconnection is driven by an injectable `ReconnectionPolicy`, and you can re-establish subscriptions on every (re)connect via the `onConnected` hook:

```swift
let client = WebSocketClient(
    configuration: .init(
        // Default policy = ExponentialBackoffPolicy(base: 1.0, maxDelay: 60, maxAttempts: 10).
        // Pass NoReconnectionPolicy() to fully own reconnection yourself.
        reconnectionPolicy: ExponentialBackoffPolicy(),
        // Runs after every successful (re)connection, before messages are delivered.
        onConnected: {
            try? await client.send(.auth(Auth(token: token)))
            try? await client.send(.subscribe(Subscribe(channels: channels)))
        }
    )
)
```

**How it works:**

- `connect()` moves to `.connecting`, and to `.connected` when the socket's opening handshake finishes (the session delegate's open callback). A socket that never opens never reports `.connected`.
- The `onConnected` hook fires each time a socket opens: the first time and after every reconnect. Put authentication and subscription there so subscriptions are restored automatically after a reconnect without the caller tracking connection state. Messages can arrive while it runs.
- On unexpected disconnection, the client asks its `ReconnectionPolicy` for the delay before the next 1-based attempt; returning `nil` stops retrying and the state becomes `.disconnected`. The state is `.reconnecting(attempt:)` while it waits and while that attempt's socket opens. The default `ExponentialBackoffPolicy` uses `min(base * 2^(attempt-1), maxDelay) * random(jitter)` — jitter prevents thundering-herd reconnections.
- The attempt counter resets only when a socket opens, so while the server is unreachable the backoff grows and `maxAttempts` is enforced. Calling `connect()` yourself starts again from the first attempt.
- Calling `connect()` on a client that already has a socket closes that socket first: one client never holds two.
- A failed ping closes the socket, which ends the receive loop and reconnects (or, without reconnection, reports `.disconnected`).
- Calling `disconnect()` sets an `intentionalDisconnect` flag that suppresses any in-flight or future reconnect attempts.
- Connection state changes are observable via the `connectionState` AsyncStream: `.disconnected`, `.connecting`, `.connected`, `.reconnecting(attempt:)`.
- Non-fatal errors — connection drops, ping failures (`WebSocketClientError.pingFailed`), and, when `undecodableMessages=drop`, decode failures — are surfaced on the `errors` AsyncStream rather than swallowed silently.

To disable reconnection support entirely at generation time (removes the code from the output), pass `-p reconnect=false`. With shared helpers the shared client always has reconnection, so `reconnect=false` makes the spec's configuration default to `NoReconnectionPolicy()` instead.


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
- **`anyOf` / `oneOf` handling** — `anyOf [Type, null]` (the nullable pattern) maps to `Type?`. Primitive and discriminated unions are registered while property types are resolved and rendered after the structs; a union declared as a named component schema takes that name. Other multi-type unions map to `JSONValue` with a generation warning. The `JSONValue` enum is only emitted when actually referenced.
- **Stable names across versions** — deeper enum and inline-struct extraction runs as a second pass after the original one, so types the earlier passes named keep their names.
- **Message vs component-schema names** — a message struct is named after the message; when that name would equal a component schema's (message `fill` vs schema `Fill`), the message struct takes its payload schema's name instead (`FillMessage`) with a warning.
- **Name collision detection** — `extractMessages()` identifies a message by its component, so one message referenced from several channels is still one message. Different messages without a `name` that two channels give the same key are each named after their component (`Authentication`, `ExecutionAuthentication`), whatever order they come in. Different messages that share a `name` field are a hard error by default. When `allowNameCollisions=true`, the second message is disambiguated using its component key (e.g. `submit_order_response` instead of `submit_order`).
- **Decoder container ordering** — when both object and plain-string messages exist, the generated `init(from:)` tries the keyed container (`container(keyedBy:)`) first inside a `do` block, falling back to `singleValueContainer()` in the `catch` block. This ordering is critical: Swift's `Decoder` only allows one top-level container, and `singleValueContainer()` never throws — it always succeeds and registers itself, which would cause `container(keyedBy:)` to crash with *"Found existing top-level decoding container"*. The same pattern applies to msgpack array-format decoding (`unkeyedContainer()` first, `singleValueContainer()` in `catch`).

## Requirements

- **Node.js** 24.11 or later through the CLI, and not 26 (any version as a library, see above). `@asyncapi/cli` 6.2 and `@asyncapi/generator` 3.5 need Node 24.11. On Node 26, `@asyncapi/generator` 3.2.1 (bundled with the CLI 6.x) detects template hooks with `fs.promises.stat(path, F_OK)`, which throws on Node 26, so on Node 26 the hooks silently don't run: `Sources/` isn't created (generation fails with `ENOENT`) and the formatter is skipped. Use Node 24 until the generator is fixed; 3.5.0 doesn't load on Node 26 either (it looks for a global npm at load time).
- **@asyncapi/cli** 6.2 or later (`npm install -g @asyncapi/cli`)
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

# Swift runtime tests (~10s) — builds and runs generated types at runtime, and the client's
# connection lifecycle against a local WebSocket server and an unreachable port
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
| `channel-key-collision.asyncapi.yaml` | Two channels whose different `auth` messages share a channel key (each named after its component), and a message both channels share (one message) |
| `allof-outgoing.asyncapi.yaml` | `allOf` composition for outgoing messages — flattens `$ref` + inline properties into typed structs, enum extraction from composed schemas, const auto-assignment, `typePrefix` support |
| `client-perspective.asyncapi.yaml` | `perspective=client` parameter — spec written from client perspective (non-standard), verifies direction mapping inversion |
| `dotted-enums.asyncapi.yaml` | Enum values containing dots (namespaced codes like `sensor.alarm.high_temperature`), dot-to-camelCase conversion, explicit raw value assignments |
| `unions-and-nesting.asyncapi.yaml` | Primitive and discriminated `oneOf` unions, positional tuples (`prefixItems`), enums with a `null` member, enums in arrays and tuples, inline objects nested in arrays, `allOf`-merged array items, single-member `allOf`, a message whose name collides with a component schema, `openEnums=true` (with a Swift runtime test) |
| `allof-shared-const.asyncapi.yaml` | Messages composed with `allOf` that share a constant (a currency) and differ on another (`type`): decoding uses the one that tells them apart |
| `duplicate-discriminator.asyncapi.yaml` / `partial-discriminator.asyncapi.yaml` / `no-common-discriminator.asyncapi.yaml` | Specs whose incoming messages can't all be told apart fail generation, with the messages named |
| `composition-and-shapes.asyncapi.yaml` | `allOf` nested in `allOf` and beside a schema's own properties; inline objects with the same top-level keys but different contents |
| `msgpack-array-tags.asyncapi.yaml` / `msgpack-array-untagged.asyncapi.yaml` | Positional MessagePack messages tagged by their first element, with a second constant and a `Double` enum (with a Swift runtime test); a message whose first element isn't a constant fails generation |
| `one-direction.asyncapi.yaml` | A client that only receives (or, with `perspective=client`, only sends), and constants and keys that need escaping in Swift |
| `unknown-value.asyncapi.yaml` | A spec enum value named `unknown`, which becomes `unknownValue` |
| `server-variables*.asyncapi.yaml` | Server variables filled from their defaults, and refused without one or with an unsafe one |
| `malicious-url-backslash.asyncapi.yaml` / `malicious-url-quote.asyncapi.yaml` | URL-injection hardening — server `host`/`pathname` values containing backslashes or quotes are escaped/handled safely when building the default connection URL |

Parameter combinations tested: `serialization` (json/msgpack), `msgpackFormat` (map/array), `reconnect` (true/false), `typePrefix`, `packageName`, `allowNameCollisions`, `perspective` (server/client), `undecodableMessages` (yield/drop), `openEnums` (true/false), and all combinations thereof.

### Manual generation

```bash
asyncapi generate fromTemplate test/fixtures/basic.asyncapi.yaml . -o output/basic \
  -p server=local --force-write

cd output/basic && swift build
```

## Known limitations

- **AsyncAPI v3 only** — v2 specs are not supported. The parser v3 API (`.all()` collections, method-based schema accessors) is used throughout.
- **Single discriminator key** — incoming object messages are told apart by one property: the first that every message with a `const` gives a `const`, with a different value in each (so a constant they share, such as a channel, is skipped). A message with no `const` matches on its name. If no property qualifies, or two messages would match the same value, generation fails, since one of them could never be received. Non-object payloads (plain strings) are matched by their `const` value.
- **Unions** — object unions need a shared `const` discriminator property; unions mixing objects and primitives, or objects without a discriminator, fall back to `JSONValue`. Object unions aren't generated for `msgpackFormat=array` (they need keyed containers).
- **Tuples** — tuple elements must be primitives (or enums of them); a tuple with an object element falls back to `[JSONValue]`.
- **Single connection per client** — the generated actor manages one `URLSessionWebSocketTask` at a time. Multiple concurrent connections require multiple client instances.
- **Apple platforms only** — generated code uses `URLSessionWebSocketTask` and Foundation, limiting it to Apple platforms. Linux/Windows support would require a different WebSocket library.
- **No query parameters or WebSocket binding support** — AsyncAPI WebSocket channel bindings (query params, headers at the channel level) are not read.
- **No authentication generation** — while auth headers can be passed via `ClientConfiguration.headers`, no auth-specific code is generated from security schemes.
- **MessagePack only via msgpack-swift** — the `DMMessagePack` product from [fumoboy007/msgpack-swift](https://github.com/fumoboy007/msgpack-swift) is the only supported MessagePack library.
- **MessagePack wire format must be specified** — when `serialization=msgpack`, the `msgpackFormat` parameter controls how incoming events are decoded: `map` (default) for keyed dictionaries, or `array` for positional arrays ordered by the `required` array in the schema (then the remaining properties as declared). In an array, the first element is the message's tag: each incoming message's first property must be a `const`, different in each, or generation fails. Later constants are read and checked, so a row that doesn't match fails to decode instead of shifting its fields. Outgoing commands always encode as keyed maps regardless of format.
- **Enum raw types** — enums of integers are `Int`-backed and enums of other numbers `Double`-backed; any other enum, including one mixing strings and numbers, is `String`-backed.

## Roadmap

- [ ] **AsyncAPI v2 support** — detect spec version and use the appropriate parser API
- [x] **Schema composition (`anyOf` / `oneOf`)** — nullable patterns map to optionals; multi-type unions map to `JSONValue`
- [x] **Inline struct generation** — anonymous inline objects are extracted into dedicated structs, deduplicated by their whole schema
- [x] **Name collision detection** — hard error when different messages share the same name; `allowNameCollisions` bypass with disambiguation
- [x] **`allOf` schema merging** — `allOf` schemas are flattened into a single struct with merged properties and required fields
- [x] **Integer enum raw types** — detect numeric enums and generate `Int`-backed Swift enums
- [x] **Non-object message payloads** — plain string/const messages handled as `String` enum cases
- [x] **Open enums** — `openEnums=true` adds `unknown(RawValue)` to every enum, with an unknown-value report hook
- [x] **Unions** — primitive unions and discriminated object unions become enums instead of `JSONValue`
- [x] **Tuples** — mixed-type `prefixItems` become array-encoded structs
- [x] **Deep inline extraction** — anonymous objects and enums are found at any depth
- [x] **Other enum raw types** — enums of non-integer numbers are `Double`-backed
- [ ] **WebSocket channel bindings** — read query parameters and channel-level headers from AsyncAPI bindings
- [ ] **Security scheme generation** — generate auth helpers from AsyncAPI security schemes (API key, bearer, OAuth2)
- [x] **Custom discriminator field** — the property whose `const` tells every incoming message apart (e.g. `type`, `event_type`)
- [x] **Injectable reconnection policy** — `ReconnectionPolicy` protocol (default exponential backoff), an `onConnected` re-subscribe hook, ping-failure-triggered reconnect, and an `errors` AsyncStream for non-fatal failures
- [ ] **Linux / cross-platform support** — abstract the WebSocket transport to support `swift-nio` / `WebSocketKit` for server-side Swift
- [ ] **Protocol-based message handling** — generate a delegate protocol as an alternative to switch-based message dispatch
- [ ] **Per-message send/receive methods** — generate typed `send*()` and `on*()` convenience methods on the client
- [ ] **Unit test generation** — generate XCTest / Swift Testing stubs for the client and serializer
- [ ] **OpenAPI schema `$ref` to external files** — support cross-file `$ref` resolution
- [ ] **Configurable platform versions** — allow overriding minimum deployment targets via parameters
- [ ] **Protobuf serialization** — add a third serialization option using SwiftProtobuf
- [ ] **Retry / queue for outgoing messages** — buffer sends when disconnected and flush on reconnect
- [ ] **Connection health monitoring** — expose ping/pong latency and connection quality metrics
- [x] **Documentation comments** — generate `///` doc comments from AsyncAPI descriptions on types, struct properties, and message enum cases
- [x] **Publish to npm** — published as `@finlayjn/asyncapi-swift-ws-template`
- [ ] **Sample data** - generate `.sample` extensions based on `example` values in the AsyncAPI spec for easier testing and debugging

## License

Apache-2.0
