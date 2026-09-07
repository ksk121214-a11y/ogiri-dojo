-- セキュリティレビュー対応 P1（5番）：
-- ローカルPostgreSQLで実際に確認したところ、profiles（0059で対応済み）と全く同じ形の
-- 問題がparticipantsにも存在した。
--
--   select table_name, column_name, privilege_type
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='participants'
--     and grantee='authenticated' and privilege_type='UPDATE';
--
-- で確認できる通り、authenticatedは(group_id, role, host_message,
-- host_message_sent_at, kicked_at)へのUPDATE権限を持っている。
--
-- 【原因】0026_participant_host_message_and_kick.sqlが
--   revoke update on public.participants from authenticated;
--   grant update (group_id, role, host_message, host_message_sent_at, kicked_at)
--     on public.participants to authenticated;
-- を実行していた。コメントには「司会が更新できる列を拡張する」という意図が
-- 書かれているが、0023(profiles)と同じ誤り＝列GRANTはロール単位にしか効かず、
-- 「is_host()なら」という条件は付けられない。一方、0010で作られた
-- participants_update_own_preferenceポリシー（auth.uid()=user_id and
-- group_id is null）が生き残っており、この5列のGRANTと組み合わさることで、
-- 「まだ組分けされていない（group_id is null）参加者が、自分の行のrole・
-- kicked_at・host_message・host_message_sent_at・group_idを直接書き換えられる」
-- という状態になっていた（見学者から演者への自己昇格、host_messageの
-- 捏造・消去、kicked_atの自己解除などが理論上可能）。
--
-- なお、0026が行った「revoke update on participants from authenticated」に
-- よって、0010でgrantされていたpreferred_role列のUPDATE権限も同時に失われて
-- いた（0026のgrant列リストにpreferred_roleが含まれていないため）。ただし
-- これは実害が無い：preferred_roleの変更は現在すべてjoin_live()という
-- SECURITY DEFINER RPC経由で行われており（src/store/useLiveFollowerStore.ts）、
-- 直接のtable UPDATEには最初から依存していなかった（RPCはRLS/列GRANTを
-- 経由しないため）。
--
-- 【対応方針】
-- 1) authenticatedからこの5列のUPDATE権限を剥奪する。
-- 2) participants_update_own_preferenceポリシーを削除する。このポリシーが
--    対象としていたpreferred_role列は既に上記の理由で誰も直接UPDATEできず
--    （grantが無い）、他の5列はこのmigrationで塞ぐため、このポリシーは
--    どの列に対しても実質的な効果を持たなくなる。0003が当初
--    「本人が参加登録後に自分でrole/group_idを書き換えてよいという正当な
--    用途が無い」として一度削除したself-updateポリシーの方針に立ち戻る形になる。
--    再度必要になった場合も、RPC（join_live等）による検証込みの経路を使う
--    べきであり、生のUPDATEを許可する理由は無い。
-- 3) host_message/host_message_sent_atの書き換え（運営メッセージの送信・解除、
--    /live/host画面）は、直接のUPDATE呼び出しから、is_host()をDB内で検証する
--    SECURITY DEFINER RPC（admin_set_participant_message）に差し替える。
--    role（kick/unkick）・group_id（組分け）は既にkick_participant/
--    unkick_participant/set_participant_group/randomize_groupsという
--    既存のSECURITY DEFINER RPC経由になっており、対応済みだった。

begin;

-- ============================================================
-- 0) 事前チェック
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'participants'
    and privilege_type = 'UPDATE' and grantee = 'authenticated'
    and column_name in ('group_id', 'role', 'host_message', 'host_message_sent_at', 'kicked_at');
  if v_count = 0 then
    raise notice '既にauthenticatedはparticipantsのgroup_id/role/host_message/host_message_sent_at/kicked_atへのUPDATE権限を持っていません（想定と異なりますが、これから行うrevokeは冪等なので処理は続行します）。';
  end if;
end $$;

-- ============================================================
-- 1) 脆弱性の直接原因を塞ぐ。
-- ============================================================
revoke update (group_id, role, host_message, host_message_sent_at, kicked_at)
  on public.participants from authenticated;

-- ============================================================
-- 2) 実質的に無効化された自己更新ポリシーを削除する。
-- ============================================================
drop policy if exists "participants_update_own_preference" on public.participants;

-- ============================================================
-- 3) 運営メッセージ送信・解除の専用RPC。
-- ============================================================
create function public.admin_set_participant_message(p_participant_id uuid, p_message text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.participants where id = p_participant_id) then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;

  -- p_messageが空/空白のみの場合はクリア扱いにする
  -- （既存のclearPrivateMessage()と同じ挙動：host_messageだけをnullにし、
  -- host_message_sent_atは変更しない＝いつ最後にメッセージが送られたかの
  -- 履歴は残す）。
  v_trimmed := nullif(trim(p_message), '');

  if v_trimmed is null then
    update public.participants set host_message = null where id = p_participant_id;
  else
    update public.participants
      set host_message = v_trimmed, host_message_sent_at = now()
      where id = p_participant_id;

    -- 送信時のみ記録する（既存のsendPrivateMessage()の挙動に合わせる。
    -- clearPrivateMessage()側は元々admin_action_logsへ記録していなかった）。
    -- レビュー指摘対応：個別メッセージの本文を監査ログへ複製しない
    -- （本文はparticipants.host_messageに既に保存されており、複製は
    -- 個人情報・機微情報の重複保持を増やすだけで得るものが無い、0059の
    -- admin_set_profile_memoと同じ判断）。target_id列に既にparticipant_idが
    -- 入っているため、detailへ重複させない。actor_id・created_atは列として
    -- 既に記録されるため、detailには「変更した事実」と「文字数」だけを残す。
    insert into public.admin_action_logs (actor_id, action, target_type, target_id, detail)
    values (
      auth.uid(), 'participant_private_message_sent', 'participants', p_participant_id::text,
      jsonb_build_object('message_changed', true, 'message_length', char_length(v_trimmed))
    );
  end if;
end;
$$;

grant execute on function public.admin_set_participant_message(uuid, text) to authenticated;
revoke execute on function public.admin_set_participant_message(uuid, text) from public;
revoke execute on function public.admin_set_participant_message(uuid, text) from anon;

commit;
