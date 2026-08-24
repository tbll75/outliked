export type Listing = {
  id: string; // tweet id, the primary key
  site: string; // normalized https:// url
  domain: string; // hostname without www
  name: string;
  pitch: string;
  tweetUrl: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  likes: number;
  replies?: number; // reply count, used by the anti-cheat check
  cheatFlaggedAt?: string; // ISO, set when the auto anti-cheat pulled it off the board; cleared when replies appear or admin marks legit
  createdAt: string; // ISO, when listed
  lastRefreshedAt?: string; // ISO, when likes were last re-fetched
  hasFavicon?: boolean; // false when Google only has its generic globe
  authorFollowers?: number; // author's follower count, when known
  source?: "scout"; // set when auto-added by the launch-tweet scout
  scoutTerm?: string; // which search term surfaced it (outlike.lol / producthunt.com / #launch)
};

export type Board = {
  updatedAt: string; // ISO, last like-count refresh
  totalLikes: number;
  listings: Listing[]; // sorted by likes desc
};

export type TweetData = {
  id: string;
  text: string;
  urls: string[]; // expanded urls found in the tweet
  likes: number;
  replies?: number; // undefined when the source didn't report it
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  authorFollowers?: number;
  conversationId?: string; // thread root tweet id; differs from id on replies
};
