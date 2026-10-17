import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ignored = new Set([".git", "node_modules", "dist", "coverage", ".next"]);
const owners = ["packages/storage", "packages/service", "apps/daemon", "tests"];

export async function findStorageImports(root) {
  const failures = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const local = relative(root, path).split(sep).join("/");
      if (owners.some((owner) => local.startsWith(`${owner}/`))) continue;
      const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
      function check(node) {
        let specifier;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
        else if (ts.isExternalModuleReference(node)) specifier = node.expression;
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const name = specifier.text;
          const target = relative(root, resolve(dirname(path), name)).split(sep).join("/");
          if (name === "@openmembrane/storage" || name.startsWith("@openmembrane/storage/") ||
            (name.startsWith(".") && (target === "packages/storage" || target.startsWith("packages/storage/")))) {
            const line = source.getLineAndCharacterOfPosition(specifier.getStart()).line + 1;
            failures.push(`${local}:${line}: forbidden storage import "${name}"`);
          }
        }
        ts.forEachChild(node, check);
      }
      check(source);
    }
  }
  await visit(resolve(root));
  return failures.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await findStorageImports(process.cwd());
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\nStorage imports belong only in packages/storage, packages/service, apps/daemon, or tests.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Storage import boundaries passed.\n");
  }
}
