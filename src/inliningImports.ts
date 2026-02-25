/**
 * Collects which names are imported in a source file and which of those
 * are used in an expression (for adding missing imports when inlining).
 */

import * as ts from "typescript";

export interface ImportedNameIndex {
  byName: Map<string, ts.ImportDeclaration>;
  byModule: Map<string, ts.ImportDeclaration[]>;
  getAllByModule(module: string): ts.ImportDeclaration[];
}

export function collectImportedNames(
  fnSourceFile: ts.SourceFile,
): ImportedNameIndex {
  const byName = new Map<string, ts.ImportDeclaration>();
  const byModule = new Map<string, ts.ImportDeclaration[]>();

  for (const stmt of fnSourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;
    // Only copy non-relative imports to avoid incorrect relative paths.
    if (moduleSpecifier.startsWith(".")) continue;

    const list = byModule.get(moduleSpecifier) ?? [];
    list.push(stmt);
    byModule.set(moduleSpecifier, list);

    const clause = stmt.importClause;

    if (clause.name) {
      byName.set(clause.name.text, stmt);
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        byName.set(el.name.text, stmt);
      }
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      byName.set(clause.namedBindings.name.text, stmt);
    }
  }

  return {
    byName,
    byModule,
    getAllByModule(module: string) {
      return byModule.get(module) ?? [];
    },
  };
}

export function collectUsedImportedNames(
  expr: ts.Expression,
  importedNames: ImportedNameIndex,
): ts.ImportDeclaration[] {
  const used = new Set<ts.ImportDeclaration>();

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      // Ignore identifiers that are merely property names (obj.prop)
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        return;
      }
      const decl = importedNames.byName.get(node.text);
      if (decl) {
        used.add(decl);
      }
    }
    node.forEachChild(visit);
  }

  visit(expr);
  return Array.from(used);
}
