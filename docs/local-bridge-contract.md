# Local LLM bridge contract

`local-feedbacker` never calls a local server unless the host app provides `onSendToBridge` and the reviewer presses **Send to local bridge**. A bridge should bind only to loopback, validate payload size, and keep all Codex/Claude credentials and command execution on the local machine.

The host callback receives:

```ts
{ prompt: string; feedback: string; url: string }
```

The bridge can pass `prompt` to a configured Codex CLI, Claude Code CLI, or compatible agent. It must not expose tokens, shell commands, or local filesystem paths to browser JavaScript. Start with clipboard copy; add a bridge only when the team owns and audits that local service.
