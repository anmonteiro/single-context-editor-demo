import { spawn } from "node:child_process";
import path from "node:path";

function encode(value) {
  if (Array.isArray(value)) {
    return Buffer.concat([
      Buffer.from("("),
      ...value.map(encode),
      Buffer.from(")"),
    ]);
  }

  const atom = Buffer.from(value);
  return Buffer.concat([Buffer.from(`${atom.length}:`), atom]);
}

function parse(buffer) {
  function at(offset) {
    if (buffer[offset] === 40) {
      const values = [];
      let next = offset + 1;
      while (buffer[next] !== 41) {
        const parsed = at(next);
        values.push(parsed.value);
        next = parsed.next;
      }
      return { value: values, next: next + 1 };
    }

    let colon = offset;
    while (buffer[colon] >= 48 && buffer[colon] <= 57) colon += 1;
    if (buffer[colon] !== 58) throw new Error(`invalid Csexp at byte ${offset}`);
    const length = Number(buffer.subarray(offset, colon).toString());
    const start = colon + 1;
    const end = start + length;
    if (end > buffer.length) throw new Error("truncated Csexp atom");
    return { value: buffer.subarray(start, end).toString(), next: end };
  }

  const parsed = at(0);
  if (parsed.next !== buffer.length) throw new Error("trailing Csexp data");
  return parsed.value;
}

function run(root, command, file) {
  return new Promise((resolve, reject) => {
    const child = spawn("dune", ["ocaml-merlin", "--root", root], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString().trim()));
      } else {
        resolve(parse(Buffer.concat(stdout)));
      }
    });
    child.stdin.end(encode([command, file]));
  });
}

function fields(configuration) {
  return new Map(
    configuration
      .slice(1)
      .filter(field => Array.isArray(field) && field.length === 2)
      .map(field => [field[0], field[1]]),
  );
}

function directiveValues(directives, tag) {
  return directives
    .filter(directive => Array.isArray(directive) && directive[0] === tag)
    .map(directive => directive[1]);
}

function classify(root, directives) {
  const stdlibPath = directiveValues(directives, "STDLIB")[0] ?? "";
  const stdlib = stdlibPath.toLowerCase().includes("melange")
    ? "melange"
    : "ocaml";

  const objects = new Set();
  for (const value of directiveValues(directives, "B")) {
    if (typeof value !== "string") continue;
    if (path.relative(root, value).startsWith("..")) continue;
    const match = value.match(/\.([^/]+)\.objs\/(byte|native|melange)(?:\/|$)/);
    if (match) objects.add(`${match[1]}:${match[2]}`);
  }

  const flags = directiveValues(directives, "FLG").flatMap(value =>
    Array.isArray(value) ? value : [value],
  );
  const flagText = flags.join(" ");
  const script = flagText.match(/(pp_[a-z]+\.sh)/)?.[1];
  const preprocess = script ?? (flags.includes("-ppx") ? "ppx" : "-");

  return {
    stdlib,
    objects: [...objects].sort().join(",") || "-",
    preprocess,
  };
}

function relative(root, value) {
  if (value === undefined) return "-";
  const result = path.relative(root, value);
  return result.startsWith("..") ? value : result;
}

function printConfiguration(root, configuration) {
  const configFields = fields(configuration);
  const directives = configFields.get("DIRECTIVES");
  const summary = classify(root, directives);
  console.log(
    [
      `mode=${configFields.get("MODE")}`,
      `default=${configFields.get("DEFAULT")}`,
      `kind=${configFields.get("KIND")}`,
      `counterpart=${relative(root, configFields.get("COUNTERPART"))}`,
      `stdlib=${summary.stdlib}`,
      `objects=${summary.objects}`,
      `preprocess=${summary.preprocess}`,
    ].join(" "),
  );
}

function printResponse(root, request, response) {
  if (request === "plural") {
    if (response[0] === "CONFIGURATIONS-ERROR") {
      console.log(`error=${response[1]}`);
      return;
    }
    if (response[0] !== "CONFIGURATIONS") {
      throw new Error(`unexpected plural response: ${JSON.stringify(response)}`);
    }
    for (const configuration of response[1]) {
      printConfiguration(root, configuration);
    }
    return;
  }

  const error = response.find(
    directive => Array.isArray(directive) && directive[0] === "ERROR",
  );
  if (error) {
    console.log(`error=${error[1]}`);
    return;
  }
  const summary = classify(root, response);
  console.log(
    `stdlib=${summary.stdlib} objects=${summary.objects} preprocess=${summary.preprocess}`,
  );
}

const [request, rootArgument, fileArgument] = process.argv.slice(2);
if (!request || !rootArgument || !fileArgument) {
  throw new Error("usage: protocol_client.mjs plural|legacy ROOT FILE");
}
const root = path.resolve(rootArgument);
const file = path.resolve(fileArgument);
const command = request === "plural" ? "File-Configurations" : "File";
const response = await run(root, command, file);
printResponse(root, request, response);
