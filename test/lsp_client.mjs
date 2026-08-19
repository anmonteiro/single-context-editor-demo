import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

class Client {
  constructor(root) {
    this.root = root;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.stderr = [];
    this.buffer = Buffer.alloc(0);
    this.child = spawn("ocamllsp", [], {
      cwd: root,
      env: { ...process.env, OCAMLLSP_PROJECT_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", chunk => this.onData(chunk));
    this.child.stderr.on("data", chunk => this.stderr.push(chunk));
    this.child.on("exit", (code, signal) => {
      const reason = new Error(
        `ocamllsp exited before replying (code=${code} signal=${signal})`,
      );
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(reason);
      }
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const separator = this.buffer.indexOf("\r\n\r\n");
      if (separator === -1) return;
      const header = this.buffer.subarray(0, separator).toString();
      const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(length)) throw new Error("missing Content-Length");
      const bodyStart = separator + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const message = JSON.parse(this.buffer.subarray(bodyStart, bodyEnd).toString());
      this.buffer = this.buffer.subarray(bodyEnd);
      this.onMessage(message);
    }
  }

  onMessage(message) {
    if (process.env.DEBUG_LSP_CLIENT) {
      console.error("<-", JSON.stringify(message));
    }
    if (message.id !== undefined && message.method !== undefined) {
      this.onRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(message.error);
      else pending.resolve(message.result);
      return;
    }

    this.notifications.push(message);
    const remaining = [];
    for (const waiter of this.waiters) {
      if (waiter.predicate(message)) waiter.resolve(message);
      else remaining.push(waiter);
    }
    this.waiters = remaining;
  }

  onRequest(message) {
    let result;
    switch (message.method) {
      case "workspace/configuration":
        result = (message.params?.items ?? []).map(() => ({}));
        break;
      case "client/registerCapability":
      case "window/workDoneProgress/create":
        result = null;
        break;
      case "window/showDocument":
        result = { success: false };
        break;
      case "workspace/applyEdit":
        result = { applied: false };
        break;
      default:
        this.send({
          id: message.id,
          error: { code: -32601, message: `unsupported client request: ${message.method}` },
        });
        return;
    }
    this.send({ id: message.id, result });
  }

  send(message) {
    if (process.env.DEBUG_LSP_CLIENT) {
      console.error("->", JSON.stringify(message));
    }
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  request(method, params, timeout = 15000) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        const stderr = Buffer.concat(this.stderr).toString().trim();
        const trace = this.notifications
          .filter(message => message.method === "$/logTrace")
          .slice(-20)
          .map(message =>
            [message.params.message, message.params.verbose].filter(Boolean).join(": "),
          )
          .join("\n");
        const details = [
          stderr ? `ocamllsp stderr:\n${stderr}` : "",
          trace ? `ocamllsp trace:\n${trace}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        this.child.kill("SIGKILL");
        reject(
          new Error(
            `request timeout: ${method}${details ? `\n${details}` : ""}`,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.send({ id, method, params });
    return result;
  }

  notify(method, params) {
    this.send({ method, params });
  }

  waitForNotification(predicate, timeout = 15000) {
    const existing = this.notifications.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("notification timeout")), timeout);
      this.waiters.push({
        predicate,
        resolve: message => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  async initialize() {
    const rootUri = pathToFileURL(this.root).href;
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      trace: "verbose",
      workspaceFolders: [{ uri: rootUri, name: "demo" }],
      capabilities: {
        workspace: {
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ["create", "rename", "delete"],
          },
        },
        window: { showDocument: { support: true } },
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: {
            completionItem: {
              documentationFormat: ["markdown", "plaintext"],
              resolveSupport: { properties: ["documentation"] },
            },
          },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        },
      },
    });
    this.notify("initialized", {});
    this.notify("workspace/didChangeConfiguration", {
      settings: { diagnostics_delay: 0.01 },
    });
  }

  open(file, text) {
    const uri = pathToFileURL(file).href;
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: file.endsWith(".re") ? "reason" : "ocaml",
        version: 1,
        text,
      },
    });
    return uri;
  }

  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      await this.request("shutdown");
      const exited = new Promise(resolve => this.child.once("exit", resolve));
      this.notify("exit");
      this.child.stdin.end();
      let timeoutId;
      const timeout = new Promise(resolve => {
        timeoutId = setTimeout(resolve, 3000);
      });
      await Promise.race([exited, timeout]);
      clearTimeout(timeoutId);
    } finally {
      if (this.child.exitCode === null) this.child.kill("SIGKILL");
    }
  }
}

function relativeUri(root, uri) {
  return path.relative(root, new URL(uri).pathname);
}

function locationLines(root, result) {
  const locations = result === null ? [] : Array.isArray(result) ? result : [result];
  return locations
    .map(location => {
      const uri = location.uri ?? location.targetUri;
      const range = location.range ?? location.targetRange;
      return `${relativeUri(root, uri)}:${range.start.line}:${range.start.character}`;
    })
    .sort();
}

function hoverType(contents, mode) {
  const value = contents.value ?? contents;
  const start = value.indexOf(`### ${mode}`);
  if (start === -1) return "missing";
  const next = value.indexOf("\n### ", start + 1);
  const section = value.slice(start, next === -1 ? undefined : next);
  const code = section.match(/```[^\n]*\n([^\n]+)\n```/)?.[1];
  return code ?? "unknown";
}

function diagnosticModes(diagnostic) {
  return diagnostic.data?.ocamllsp?.modes?.join(",") ?? "-";
}

function countEdits(edit) {
  const changes = Object.values(edit.changes ?? {}).reduce(
    (count, edits) => count + edits.length,
    0,
  );
  const documentChanges = (edit.documentChanges ?? []).reduce(
    (count, change) => count + (change.edits?.length ?? 0),
    0,
  );
  return changes + documentChanges;
}

const [rootArgument, command, fileArgument, ...args] = process.argv.slice(2);
if (!rootArgument || !command || !fileArgument) {
  throw new Error("usage: lsp_client.mjs ROOT COMMAND FILE [ARGS]");
}

const root = path.resolve(rootArgument);
const file = path.resolve(fileArgument);
let text = fs.readFileSync(file, "utf8");
let diagnosticTarget;
if (command === "completion") {
  text += "\nlet completion_probe = completion_\n";
} else if (command === "diagnostic-mode") {
  diagnosticTarget = "completion_ocaml";
  text += `\nlet diagnostic_probe = ${diagnosticTarget}\n`;
} else if (command === "diagnostic-shared") {
  diagnosticTarget = "completion_missing";
  text += `\nlet diagnostic_probe = ${diagnosticTarget}\n`;
}

const client = new Client(root);
try {
  await client.initialize();
  const uri = client.open(file, text);

  if (command === "configurations") {
    const configurations = await client.request("ocamllsp/merlinConfigurations", {
      textDocument: { uri },
    });
    for (const configuration of configurations) {
      console.log(`mode=${configuration.mode} default=${configuration.isDefault}`);
    }
  } else if (command === "definition") {
    const [line, character] = args.map(Number);
    const result = await client.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    });
    for (const location of locationLines(root, result)) console.log(location);
  } else if (command === "hover") {
    const [line, character] = args.map(Number);
    const hover = await client.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    });
    console.log(`OCaml: ${hoverType(hover.contents, "OCaml")}`);
    console.log(`Melange: ${hoverType(hover.contents, "Melange")}`);
  } else if (command === "completion") {
    const line = text.trimEnd().split("\n").length - 1;
    const result = await client.request("textDocument/completion", {
      textDocument: { uri },
      position: { line, character: "let completion_probe = completion_".length },
      context: { triggerKind: 1 },
    });
    const items = result?.items ?? result ?? [];
    for (const item of items
      .filter(item => item.label.startsWith("completion_"))
      .sort((left, right) => left.label.localeCompare(right.label))) {
      console.log(`${item.label}: ${(item.detail ?? "-").replaceAll("\n", " | ")}`);
    }
  } else if (command === "diagnostic-mode" || command === "diagnostic-shared") {
    const notification = await client.waitForNotification(
      message =>
        message.method === "textDocument/publishDiagnostics" &&
        message.params.uri === uri &&
        message.params.diagnostics.some(diagnostic =>
          JSON.stringify(diagnostic.message).includes(diagnosticTarget),
        ),
    );
    const diagnostics = notification.params.diagnostics.filter(diagnostic =>
      JSON.stringify(diagnostic.message).includes(diagnosticTarget),
    );
    for (const diagnostic of diagnostics) {
      console.log(
        `source=${diagnostic.source} modes=${diagnosticModes(diagnostic)} target=${diagnosticTarget}`,
      );
    }
  } else if (command === "symbols") {
    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    const symbol = symbols.find(candidate => candidate.name === args[0]);
    console.log(`${symbol.name}: ${(symbol.detail ?? "-").replaceAll("\n", " | ")}`);
  } else if (command === "switch") {
    const result = await client.request("ocamllsp/switchImplIntf", [uri]);
    for (const target of result.map(target => relativeUri(root, target)).sort()) {
      console.log(target);
    }
  } else if (command === "rename") {
    const [line, character, newName] = args;
    const edit = await client.request("textDocument/rename", {
      textDocument: { uri },
      position: { line: Number(line), character: Number(character) },
      newName,
    });
    console.log(`edits=${countEdits(edit)}`);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error) {
    console.log(`error=${error.code}:${error.message}`);
  } else {
    throw error;
  }
} finally {
  await client.close();
}
