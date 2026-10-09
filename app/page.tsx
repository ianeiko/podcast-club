import PodcastRoom from "./podcast-room";
import episode from "@/data/episode.json";
import discussion from "@/data/discussion.json";
export default function Page() {
  return <PodcastRoom episode={episode} segments={discussion.segments} />;
}
