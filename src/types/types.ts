export type UserRole = 'user' | 'admin';
export type MessageType = 'text' | 'image' | 'emoji';
export type FriendshipStatus = 'pending' | 'accepted' | 'rejected';
export type ConversationType = 'private' | 'group';

export interface Profile {
  id: string;
  username: string;
  nickname: string;
  avatar_url: string | null;
  bio: string;
  role: UserRole;
  email: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
  requester?: Profile;
  addressee?: Profile;
}

export interface Group {
  id: string;
  name: string;
  avatar_url: string | null;
  owner_id: string;
  announcement: string | null;
  created_at: string;
  updated_at: string;
  owner?: Profile;
  member_count?: number;
  conversation_id?: string | null;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  joined_at: string;
  profile?: Profile;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  group_id: string | null;
  created_at: string;
  updated_at: string;
  group?: Group;
  participants?: ConversationParticipant[];
  last_message?: Message;
  unread_count?: number;
  other_user?: Profile;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  profile?: Profile;
}

// ==================== 朋友圈 ====================
export interface Moment {
  id: string;
  user_id: string;
  content: string;
  image_urls: string[];
  created_at: string;
  updated_at: string;
  author?: Profile;
  likes?: MomentLike[];
  comments?: MomentComment[];
  likes_count?: number;
  comments_count?: number;
  liked_by_me?: boolean;
}

export interface MomentLike {
  id: string;
  moment_id: string;
  user_id: string;
  created_at: string;
  user?: Profile;
}

export interface MomentComment {
  id: string;
  moment_id: string;
  user_id: string;
  content: string;
  created_at: string;
  user?: Profile;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  message_type: MessageType;
  image_url: string | null;
  is_read: boolean;
  is_recalled: boolean;
  recalled_at: string | null;
  created_at: string;
  sender?: Profile;
}
