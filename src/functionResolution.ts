import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

export interface FunctionInfo {
  sourceFile: ts.SourceFile;
  node: ts.FunctionLikeDeclaration;
}

interface ImportInfo {
  moduleSpecifier: string;
  isRelative: boolean;
}

export async function resolveFunctionDefinition(
  name: string,
  currentSourceFile: ts.SourceFile,
  currentFileName: string,
  workspaceRoot: string,
): Promise<FunctionInfo | undefined> {
  // 1. Same file
  const local = findFunctionInSourceFile(currentSourceFile, name);
  if (local) {
    return { sourceFile: currentSourceFile, node: local };
  }

  // 2. Imported from other files
  const importInfo = findImportForIdentifier(currentSourceFile, name);
  if (!importInfo) {
    return undefined;
  }

  if (importInfo.isRelative) {
    const resolved = resolveRelativeModule(
      importInfo.moduleSpecifier,
      currentFileName,
    );
    if (!resolved) {
      return undefined;
    }
    const text = await tryReadFile(resolved);
    if (!text) {
      return undefined;
    }
    const sf = ts.createSourceFile(
      resolved,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const fn = findExportedFunctionInSourceFile(sf, name);
    if (fn) {
      return { sourceFile: sf, node: fn };
    }
    return undefined;
  } else {
    // 3. NPM module with potential source maps
    const resolvedModulePath = tryResolveNodeModule(
      importInfo.moduleSpecifier,
      workspaceRoot,
    );
    if (!resolvedModulePath) {
      return undefined;
    }

    // Try sibling .ts first
    const siblingTs = resolvedModulePath.replace(/\.js(x?)$/, ".ts$1");
    if (fs.existsSync(siblingTs)) {
      const text = await tryReadFile(siblingTs);
      if (text) {
        const sf = ts.createSourceFile(
          siblingTs,
          text,
          ts.ScriptTarget.Latest,
          true,
        );
        const fn = findExportedFunctionInSourceFile(sf, name);
        if (fn) {
          return { sourceFile: sf, node: fn };
        }
      }
    }

    // Then try reading source map to get original TS sources
    const candidate = await tryResolveFromSourceMap(resolvedModulePath, name);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function findFunctionInSourceFile(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | undefined {
  let match: ts.FunctionLikeDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      node.body
    ) {
      match = node;
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (
            decl.name.text === name &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            match = decl.initializer;
            return;
          }
        }
      }
    }
  });

  return match;
}

function findExportedFunctionInSourceFile(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | undefined {
  let match: ts.FunctionLikeDeclaration | undefined;

  sourceFile.forEachChild((node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name &&
      node.body
    ) {
      // either `export function` or exported via separate export list
      const hasExportModifier = !!node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (hasExportModifier || isExportedViaExportList(sourceFile, name)) {
        match = node;
        return;
      }
    }

    if (ts.isVariableStatement(node)) {
      const hasExportModifier = !!node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (
            decl.name.text === name &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            if (
              hasExportModifier ||
              isExportedViaExportList(sourceFile, name)
            ) {
              match = decl.initializer;
              return;
            }
          }
        }
      }
    }
  });

  return match;
}

function isExportedViaExportList(
  sourceFile: ts.SourceFile,
  name: string,
): boolean {
  let exported = false;
  sourceFile.forEachChild((node) => {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const spec of node.exportClause.elements) {
        if (spec.name.text === name) {
          exported = true;
          return;
        }
      }
    }
  });
  return exported;
}

function findImportForIdentifier(
  sourceFile: ts.SourceFile,
  name: string,
): ImportInfo | undefined {
  for (const stmt of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !stmt.importClause ||
      !stmt.moduleSpecifier
    )
      continue;
    const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    // import runMe from "./foo";
    if (stmt.importClause.name && stmt.importClause.name.text === name) {
      return { moduleSpecifier, isRelative: moduleSpecifier.startsWith(".") };
    }

    // import { runMe } from "./foo";
    if (
      stmt.importClause.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const element of stmt.importClause.namedBindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        const localName = element.name.text;
        if (localName === name) {
          return {
            moduleSpecifier,
            isRelative: moduleSpecifier.startsWith("."),
          };
        }
      }
    }

    // import * as ns from "./foo"; -> ns.runMe (not supported)
  }
  return undefined;
}

function resolveRelativeModule(
  moduleSpecifier: string,
  fromFile: string,
): string | undefined {
  const base = path.dirname(fromFile);
  const full = path.resolve(base, moduleSpecifier);

  const candidates = [
    full,
    full + ".ts",
    full + ".tsx",
    path.join(full, "index.ts"),
    path.join(full, "index.tsx"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return c;
    }
  }

  return undefined;
}

function tryResolveNodeModule(
  moduleSpecifier: string,
  workspaceRoot: string,
): string | undefined {
  try {
    const resolved = require.resolve(moduleSpecifier, {
      paths: [workspaceRoot],
    });
    return resolved;
  } catch {
    return undefined;
  }
}

async function tryReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function tryResolveFromSourceMap(
  jsFilePath: string,
  functionName: string,
): Promise<FunctionInfo | undefined> {
  const dir = path.dirname(jsFilePath);
  let mapPath = jsFilePath + ".map";

  if (!fs.existsSync(mapPath)) {
    // Try reading //# sourceMappingURL from file
    let jsText: string;
    try {
      jsText = await fs.promises.readFile(jsFilePath, "utf8");
    } catch {
      return undefined;
    }

    const match = jsText.match(/\/\/# sourceMappingURL=(.+)$/m);
    if (!match) {
      return undefined;
    }
    mapPath = path.resolve(dir, match[1]);
    if (!fs.existsSync(mapPath)) {
      return undefined;
    }
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(mapPath, "utf8");
  } catch {
    return undefined;
  }

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const sources: string[] | undefined = json.sources;
  if (!Array.isArray(sources)) {
    return undefined;
  }

  for (const srcRel of sources) {
    const srcPath = path.resolve(path.dirname(mapPath), srcRel);
    if (!srcPath.endsWith(".ts") && !srcPath.endsWith(".tsx")) {
      continue;
    }
    const text = await tryReadFile(srcPath);
    if (!text) continue;
    const sf = ts.createSourceFile(srcPath, text, ts.ScriptTarget.Latest, true);
    const fn = findExportedFunctionInSourceFile(sf, functionName);
    if (fn) {
      return { sourceFile: sf, node: fn };
    }
  }

  return undefined;
}

