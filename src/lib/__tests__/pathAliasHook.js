// "@/..." インポートを、tscコンパイル後の出力先(<outDir>/src/...)へ解決するための
// 最小限のrequireフック。tsconfig-paths等の追加npm依存を増やさず、
// Module._resolveFilenameを直接パッチするだけの自己完結スクリプト。
// 使い方: node -r ./pathAliasHook.js <エントリポイントのコンパイル済みjs>
// 環境変数 FOLLOWER_RACE_OUT_DIR に、tscの--outDirへ渡したのと同じディレクトリを渡すこと。
"use strict";
// node -r 経由で読み込む素のCommonJSスクリプトのため、requireを使う。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("module");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const outDir = process.env.FOLLOWER_RACE_OUT_DIR;
const repoRoot = process.env.FOLLOWER_RACE_REPO_ROOT;
if (!outDir) {
  throw new Error("pathAliasHook.js: 環境変数 FOLLOWER_RACE_OUT_DIR が未設定です");
}
if (!repoRoot) {
  throw new Error("pathAliasHook.js: 環境変数 FOLLOWER_RACE_REPO_ROOT が未設定です");
}
const repoNodeModules = path.join(repoRoot, "node_modules");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    request = path.join(outDir, "src", request.slice(2));
  } else if (!request.startsWith(".") && !path.isAbsolute(request)) {
    // "zustand"・"@supabase/supabase-js"等の裸のパッケージ指定子。コンパイル出力は
    // 一時ディレクトリ配下にありnode_modulesを持たないため、リポジトリ本体の
    // node_modulesを追加の探索先として渡す（組み込みモジュールは素の解決に任せる）。
    options = Object.assign({}, options, {
      paths: [...((options && options.paths) || []), repoNodeModules],
    });
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
