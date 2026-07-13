import SnsAnswerDetail from "@/components/sns/SnsAnswerDetail";
import { INITIAL_SNS_ANSWERS } from "@/data/snsData";

export async function generateStaticParams() {
  return INITIAL_SNS_ANSWERS.map((answer) => ({ answerId: answer.id }));
}

export default async function SnsAnswerPage({
  params,
}: {
  params: Promise<{ answerId: string }>;
}) {
  const { answerId } = await params;
  return <SnsAnswerDetail answerId={answerId} />;
}
