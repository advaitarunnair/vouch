import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeedCard, FeedTopBar } from "@/components/FeedCard";
import { POSTS, getPost } from "@/lib/posts";

export function generateStaticParams() {
  return POSTS.map((p) => ({ id: p.id }));
}

// Link-preview metadata is all Vouch reads from a shared post link.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const post = getPost((await params).id);
  if (!post) return {};
  const title = `${post.creator} on Demo feed: "${post.hook}"`;
  return {
    title,
    description: post.caption,
    openGraph: { title, description: post.caption, siteName: "Demo feed", type: "article" },
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const post = getPost((await params).id);
  if (!post) notFound();
  return (
    <div className="h-dvh bg-black text-white">
      <FeedTopBar />
      <FeedCard post={post} />
    </div>
  );
}
