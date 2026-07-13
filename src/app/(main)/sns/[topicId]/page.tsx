import SnsTopicDetail from "@/components/sns/SnsTopicDetail";
import { INITIAL_SNS_TOPICS } from "@/data/snsData";

export async function generateStaticParams() {
  return INITIAL_SNS_TOPICS.map((topic) => ({ topicId: topic.id }));
}

export default async function SnsTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <SnsTopicDetail topicId={topicId} />;
}
