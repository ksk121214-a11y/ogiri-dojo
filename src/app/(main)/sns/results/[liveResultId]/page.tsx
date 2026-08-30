import SnsLiveResultDetail from "@/components/sns/SnsLiveResultDetail";

// このプロジェクトはnext.config.tsでoutput:'export'を使っていない（Vercelへの
// 通常デプロイ）ため、generateStaticParamsは不要。paramsを受け取ってそのまま
// クライアントコンポーネントへ渡すだけのシンプルな構成にする。
export default async function SnsLiveResultPage({
  params,
}: {
  params: Promise<{ liveResultId: string }>;
}) {
  const { liveResultId } = await params;
  return <SnsLiveResultDetail liveResultId={liveResultId} />;
}
