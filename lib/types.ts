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
  createdAt: string; // ISO, when listed
  lastRefreshedAt?: string; // ISO, when likes were last re-fetched
  hasFavicon?: boolean; // false when Google only has its generic globe
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
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
};
