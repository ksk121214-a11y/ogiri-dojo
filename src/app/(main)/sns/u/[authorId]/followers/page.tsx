import SnsAuthorFollowers from "@/components/sns/SnsAuthorFollowers";
import { DUMMY_SNS_AUTHORS } from "@/data/snsAuthors";

export async function generateStaticParams() {
  return DUMMY_SNS_AUTHORS.map((author) => ({ authorId: author.id }));
}

export default async function SnsAuthorFollowersPage({
  params,
}: {
  params: Promise<{ authorId: string }>;
}) {
  const { authorId } = await params;
  return <SnsAuthorFollowers authorId={authorId} />;
}
