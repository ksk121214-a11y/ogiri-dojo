-- 司会コンソールのボット観客によるツッコミ/爆笑/拍手を、観客側の既存の
-- Postgres Changes 購読（public.live_tsukkomi_events）へ安全に届けるための
-- ホスト専用 RPC を追加する。
--
-- 背景：
-- - ボット反応はこれまで固定 topic 名への「生の Realtime Broadcast」で送っていたが、
--   (1) 観客側は 0044 以降 Broadcast を受信しておらず（live_tsukkomi_events の
--       Postgres Changes を購読）、受信者がいなかった。
--   (2) その固定 topic 名を観客側の Postgres Changes 購読と共有しており、
--       同一 Supabase クライアント内で supabase.channel() が既存チャンネルを返すため
--       観客側の後付け購読がサーバーへ反映されない衝突が起きえた。
-- - 対応として、0044 で廃止した「未認可の生 Broadcast」へは戻さず、
--   検証済みの「テーブルへの INSERT ＋ postgres_changes 購読」パターンへ統一する。
--
-- 既存の public.send_tsukkomi(uuid, text, text) は「呼び出し元 = そのライブの参加者」
-- を前提に participants.user_id = auth.uid() で本人を引くため、参加者でないことも
-- ある運営者（司会）からはそのまま流用できない。運営者専用の RPC を新設する。
-- send_tsukkomi 自体には一切手を加えない（人間用の安全性はそのまま）。

-- ============================================================
-- 1) ライブ単位のボット反応レート制限用カラム
-- ============================================================
alter table public.lives
  add column if not exists last_bot_tsukkomi_at timestamptz;

-- ============================================================
-- 2) ホスト専用 RPC：host_send_bot_tsukkomi
--    - auth.uid() が運営者（is_host()）であること
--    - 対象ライブが存在し、回答受付中（answering）であること
--    - 代理送信者 p_participant_id は「対象ライブの実在する、退場していない
--      player 参加者」で、かつ運営者本人ではないこと
--      （クライアントから任意の参加者になりすませない）
--    - kind/text は人間用 send_tsukkomi と完全に同じ許可リストのみ（自由入力不可）
--    - サーバー側レート制限（ライブ単位・1秒に1回）
--    - 直接 INSERT は一般ユーザーへ許可しない（RPC 経由のみ／既存の
--      live_tsukkomi_events は INSERT ポリシー無し＝直接 INSERT 不可を維持）
--    - SECURITY DEFINER ＋ 固定 search_path ＋ 関数内認可 ＋ 明示的な REVOKE/GRANT
-- ============================================================
create function public.host_send_bot_tsukkomi(
  p_live_id uuid,
  p_participant_id uuid,
  p_kind text,
  p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_participant public.participants%rowtype;
begin
  -- (a) 呼び出し元が運営者であること。authenticated へ EXECUTE を許可しても、
  --     ここで弾かれるため実質的なホスト権限は付与されない（多層防御）。
  if not public.is_host() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- (b) kind/text の組み合わせは、人間用 send_tsukkomi と完全に同一の許可リスト。
  --     （src/data/liveDemoData.ts の TSUKKOMI_TEMPLATES ＋ 「爆笑」「👏」）
  if (p_kind, p_text) not in (
    ('stamp', 'なんでやねん'),
    ('stamp', 'そうはならんやろ'),
    ('stamp', 'ちょっと待って'),
    ('stamp', 'それは無理あるて'),
    ('stamp', '爆笑'),
    ('clap', '👏')
  ) then
    raise exception 'INVALID_TSUKKOMI';
  end if;

  -- (c) 対象ライブが存在し、送信可能な状態（回答受付中）であること。
  --     行ロックでレート制限の判定と更新をアトミックにする。
  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;
  if v_live.current_phase <> 'answering' then
    raise exception 'LIVE_NOT_SENDABLE';
  end if;

  -- (d) サーバー側レート制限（ライブ単位・1秒に1回）。
  if v_live.last_bot_tsukkomi_at is not null
     and now() - v_live.last_bot_tsukkomi_at < interval '1 second' then
    raise exception 'RATE_LIMITED';
  end if;

  -- (e) 代理送信者は「対象ライブの実在する、退場していない player 参加者」で、
  --     かつ運営者本人ではないこと。別ライブの参加者・一般参加者としての
  --     自分自身・退場者・存在しない ID はすべて弾く。
  --     （このスキーマには「ボット参加者」を DB 上で区別する列が無いため、
  --      取りうる最も強い検証として「対象ライブの実在するアクティブな player」を
  --      要求する。RPC 自体が is_host() 限定なので、司会が自ライブの player の
  --      いずれかを演出上の送信者に指定できること自体は権限昇格ではない。）
  select * into v_participant from public.participants where id = p_participant_id;
  if not found
     or v_participant.live_id <> p_live_id
     or v_participant.role <> 'player'
     or v_participant.kicked_at is not null
     or v_participant.user_id = auth.uid() then
    raise exception 'INVALID_SENDER';
  end if;

  update public.lives set last_bot_tsukkomi_at = now() where id = p_live_id;

  insert into public.live_tsukkomi_events (live_id, participant_id, kind, text)
    values (p_live_id, p_participant_id, p_kind, p_text);
end;
$$;

-- authenticated のうち is_host() を満たす者だけが意味を持つ（関数内で検証）。
-- PUBLIC / anon は実行不可。
revoke execute on function public.host_send_bot_tsukkomi(uuid, uuid, text, text) from public;
revoke execute on function public.host_send_bot_tsukkomi(uuid, uuid, text, text) from anon;
grant execute on function public.host_send_bot_tsukkomi(uuid, uuid, text, text) to authenticated;
