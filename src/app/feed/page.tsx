import type { Metadata } from "next";
import { FeedCard, FeedTopBar } from "@/components/FeedCard";
import { POSTS } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Demo feed | Vouch",
  description: "A generic demo feed of short ads from fictional shops. Share one to Vouch to check it.",
};

export default function FeedPage() {
  return (
    <div className="h-dvh snap-y snap-mandatory overflow-y-scroll bg-black text-white">
      <FeedTopBar />
      {POSTS.map((post) => (
        <FeedCard key={post.id} post={post} />
      ))}
    </div>
  );
}
