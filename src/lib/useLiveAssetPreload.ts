"use client";

// ライブ待機画面（開幕・参加登録受付中）で、以降のフェーズ（お題発表・回答・審査）に
// 必要な必須素材（画像・BGM・SE）を裏で事前読み込みするためのフック。
//
// 設計方針：
// ・画像は`fetch`ではなく`new Image()`＋`img.decode()`を使う。decode()は
//   ダウンロードだけでなく実際のピクセルデコードまで完了させてから解決するため、
//   「表示した瞬間に一瞬デコード待ちで固まる」ことも防げる。ブラウザのHTTPキャッシュを
//   経由するため、同じセッション内で複数回呼んでもネットワーク重複は起きない。
// ・BGM/SEはsrc/lib/audio/audioManager.tsの事前読み込み処理（preloadBgmOne/
//   preloadSfxOne）にそのまま委譲する。ここで新しい読み込み経路を作らない。
// ・同時実行数を制限する簡易キュー（Promise.allのような無制限並列にしない）。
//   モバイル回線でも通信の奪い合いを起こさないための対応。
// ・進捗は「今までに完了（成功／最終的に諦めた失敗）した数」を1つずつ増やして
//   通知する。1回のsetStateにまとめず、完了ごとに更新することで
//   「準備中 12/15」のような表示がリアルタイムに動く。
// ・失敗時は2回まで自動再試行（合計3回）し、それでも失敗したものだけ
//   `failedItems`に残す。呼び出し側は`retryFailed()`で再試行できる。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import * as audioManager from "@/lib/audio/audioManager";
import {
  LIVE_CRITICAL_BGM,
  LIVE_CRITICAL_IMAGE_PATHS,
  LIVE_CRITICAL_SFX,
  resolveLiveAssetUrl,
} from "@/lib/liveAssetManifest";

const MAX_CONCURRENCY = 5; // 要件どおり4〜6の中間値
const MAX_ATTEMPTS = 3; // 初回+自動再試行2回＝合計3回
// BGMファイルは1本あたり十数MBあり、低速回線ではcanplaythroughが非常に遅く
// （あるいは実質発火せず）に終わることがある。タイムアウト無しだと「失敗」として
// 扱えず、進捗が永遠に進まなくなるため、素材種別ごとに上限時間を設けて
// 打ち切る（打ち切られたものは失敗としてリトライ対象になる）。
// 2026-08-29: 低速回線（400kbps相当）で実測したところ、BGMは20秒のタイムアウトでも
// 3回リトライすると合計60秒近くかかり、進捗表示が長時間「準備中」のまま止まって
// 見える体験になってしまった。BGMは無くても回答・審査自体は進められる演出要素の
// ため、タイムアウトを短くして早めに見切りを付け、再読み込みボタンをすぐ提示できる
// ようにする（画像・SEは表示直結のためタイムアウトはそのまま）。
const TASK_TIMEOUT_MS: Record<AssetKind, number> = {
  image: 8_000,
  bgm: 7_000,
  sfx: 8_000,
};

export interface LiveAssetPreloadState {
  total: number;
  loaded: number; // 成功・失敗を問わず「決着がついた」件数（進捗表示用の分母消化）
  failedItems: string[]; // 3回失敗して諦めた素材の表示用ラベル
  status: "loading" | "ready" | "error"; // error＝失敗が1件以上残ったまま終了
  retryFailed: () => void;
}

type AssetKind = "image" | "bgm" | "sfx";
interface AssetTask {
  kind: AssetKind;
  key: string; // 画像パス、またはBGM/SE名
  label: string; // 失敗表示用の分かりやすい名前
}

function decodeImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
    if (typeof img.decode === "function") {
      img.decode().then(resolve).catch(() => {
        // decode()が失敗しても、onload相当（naturalWidthが入っている）なら
        // 表示自体はできるとみなし、成功扱いにする（Safari等でdecode()の
        // 例外だけが起きるケースの保険）。
        if (img.complete && img.naturalWidth > 0) resolve();
        else reject(new Error(`image decode failed: ${url}`));
      });
    } else {
      img.onload = () => resolve();
    }
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function runTaskOnce(task: AssetTask): Promise<boolean> {
  if (task.kind === "image") {
    await decodeImage(resolveLiveAssetUrl(task.key));
    return true;
  }
  if (task.kind === "bgm") {
    const result = await audioManager.preloadBgmOne(task.key as audioManager.BgmName);
    return result.ok;
  }
  const result = await audioManager.preloadSfxOne(task.key as audioManager.SfxName);
  return result.ok;
}

async function runTask(task: AssetTask): Promise<boolean> {
  try {
    return await withTimeout(runTaskOnce(task), TASK_TIMEOUT_MS[task.kind]);
  } catch {
    return false;
  }
}

function buildTasks(): AssetTask[] {
  const tasks: AssetTask[] = [];
  for (const path of LIVE_CRITICAL_IMAGE_PATHS) {
    tasks.push({ kind: "image", key: path, label: path.split("/").pop() ?? path });
  }
  for (const name of LIVE_CRITICAL_BGM) {
    tasks.push({ kind: "bgm", key: name, label: `BGM: ${name}` });
  }
  for (const name of LIVE_CRITICAL_SFX) {
    tasks.push({ kind: "sfx", key: name, label: `SE: ${name}` });
  }
  return tasks;
}

// 同時実行数を制限しながら、渡されたタスクを1件ずつ処理する。
// 1件終わるたびにonSettledを呼ぶ（進捗表示・失敗収集の両方をここで行う）。
async function runWithConcurrency(
  tasks: AssetTask[],
  onSettled: (task: AssetTask, ok: boolean) => void,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < tasks.length) {
      const task = tasks[index];
      index += 1;
      let ok = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        ok = await runTask(task);
        if (ok) break;
      }
      onSettled(task, ok);
    }
  };
  const workerCount = Math.min(MAX_CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export function useLiveAssetPreload(): LiveAssetPreloadState {
  // タスク一覧はコンポーネントの生存期間中不変のため、useMemoで初回レンダー時に
  // 1度だけ構築する（useRefの初期値をレンダー中に読むのはReactの新しいガイドライン
  // 上避けるべきとされているため、useMemoで扱う）。
  const tasks = useMemo(() => buildTasks(), []);
  const total = tasks.length;

  const [loaded, setLoaded] = useState(0);
  const [failedItems, setFailedItems] = useState<string[]>([]);
  const [status, setStatus] = useState<LiveAssetPreloadState["status"]>("loading");
  const runIdRef = useRef(0);

  const runAll = useCallback((targetTasks: AssetTask[]) => {
    const runId = ++runIdRef.current;
    const failed: string[] = [];
    let settledCount = 0;
    setStatus("loading");
    runWithConcurrency(targetTasks, (task, ok) => {
      if (runId !== runIdRef.current) return; // 追い越された古い実行は無視
      settledCount += 1;
      if (!ok) failed.push(task.label);
      setLoaded((n) => n + 1);
      if (settledCount === targetTasks.length) {
        setFailedItems(failed);
        setStatus(failed.length > 0 ? "error" : "ready");
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 素材の事前読み込み（外部リソースの取得）をマウント時に1回だけ開始する、
    // まさにuseEffectが意図する「外部システムとの同期」の典型例。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runAll(tasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryFailed = useCallback(() => {
    const failedTasks = tasks.filter((t) => failedItems.includes(t.label));
    if (failedTasks.length === 0) return;
    setLoaded(total - failedTasks.length);
    runAll(failedTasks);
  }, [failedItems, runAll, tasks, total]);

  return { total, loaded, failedItems, status, retryFailed };
}
