// 第3段階（ステージング運営環境）：src/lib/stagingEnv.tsの実行検証。
// stagingEnv.tsは"@/lib/supabase"を実際にimportするため（fetchEnvironmentMarker用）、
// 他の*.check.tsと同じ素のtsc起動では解決できない。useLiveFollowerStoreAnswerScore等と
// 同じ専用tsconfig経由でコンパイル・実行する（実行方法はsrc/lib/__tests__/run.sh参照）。
import assert from "node:assert/strict";

import {
  getAppEnv,
  getConfiguredProjectRef,
  getExpectedStagingProjectRef,
  isStagingMode,
  stagingProjectRefMatches,
} from "@/lib/stagingEnv";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// 1) appEnv判定：NEXT_PUBLIC_APP_ENVを優先し、未設定ならNODE_ENVへフォールバックする
withEnv({ NEXT_PUBLIC_APP_ENV: undefined, NODE_ENV: "development" }, () => {
  assert.equal(getAppEnv(), "development", "NEXT_PUBLIC_APP_ENV未設定・NODE_ENV=developmentでdevelopmentにならない");
  assert.equal(isStagingMode(), false);
});
withEnv({ NEXT_PUBLIC_APP_ENV: undefined, NODE_ENV: "production" }, () => {
  assert.equal(getAppEnv(), "production", "NEXT_PUBLIC_APP_ENV未設定・NODE_ENV=productionでproductionにならない");
});
withEnv({ NEXT_PUBLIC_APP_ENV: "staging", NODE_ENV: "production" }, () => {
  assert.equal(getAppEnv(), "staging", "NEXT_PUBLIC_APP_ENV=stagingがNODE_ENV=productionより優先されない");
  assert.equal(isStagingMode(), true);
});
console.log("PASS: getAppEnv/isStagingModeはNEXT_PUBLIC_APP_ENVを優先し、未設定時はNODE_ENVで判定する");

// 2) Project Refの抜き出し・一致判定：大文字小文字を吸収し、未設定時は安全側(false/null)
withEnv(
  {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcDEF123.supabase.co",
    NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "ABCdef123",
  },
  () => {
    assert.equal(getConfiguredProjectRef(), "abcdef123", "Project Refの抜き出しが小文字化されていない");
    assert.equal(getExpectedStagingProjectRef(), "abcdef123", "期待Project Refの読み取りが小文字化されていない");
    assert.equal(stagingProjectRefMatches(), true, "大文字小文字が違うだけのProject Refが一致判定されない");
  },
);
withEnv(
  {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdef123.supabase.co",
    NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: "different-ref",
  },
  () => {
    assert.equal(stagingProjectRefMatches(), false, "不一致のProject Refが一致判定されてしまう");
  },
);
withEnv(
  {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdef123.supabase.co",
    NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF: undefined,
  },
  () => {
    assert.equal(stagingProjectRefMatches(), false, "期待Project Ref未設定時に安全側(false)になっていない");
  },
);
withEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }, () => {
  assert.equal(getConfiguredProjectRef(), null, "URL未設定時にnullを返さない");
});
withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://not-a-supabase-host.example.com" }, () => {
  assert.equal(getConfiguredProjectRef(), null, "supabase.co以外のホストからProject Refらしき値を抜き出してしまう");
});
console.log("PASS: Project Refの抜き出し・一致判定は大文字小文字を吸収し、未設定・不正値では安全側(false/null)になる");

console.log("ALL STAGING_ENV_DYNAMIC CHECKS PASSED");
