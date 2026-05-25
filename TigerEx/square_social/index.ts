/**
 * TIGEREX SQUARE SOCIAL
 * Production - Community platform
 */

export interface Post {
  id: string;
  userId: string;
  username: string;
  content: string;
  media?: string[];
  likes: number;
  comments: number;
  createdAt: number;
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  username: string;
  content: string;
  createdAt: number;
}

export class SquarePlatform {
  private posts = new Map();
  private comments = new Map();
  private likes = new Set();
  private counter = 0;

  async post(params: { userId: string; username: string; content: string; media?: string[] }): Promise<Post> {
    const post: Post = {
      id: `POST_${++this.counter}`,
      userId: params.userId,
      username: params.username,
      content: params.content,
      media: params.media,
      likes: 0,
      comments: 0,
      createdAt: Date.now()
    };
    this.posts.set(post.id, post);
    return post;
  }

  async like(postId: string): Promise<{ success: boolean; likes: number }> {
    const post = this.posts.get(postId);
    if (!post) return { success: false, likes: 0 };
    const key = `${postId}_liked`;
    if (!this.likes.has(key)) {
      this.likes.add(key);
      post.likes++;
    }
    return { success: true, likes: post.likes };
  }

  async comment(params: { postId: string; userId: string; username: string; content: string }): Promise<Comment> {
    const comment: Comment = {
      id: `CMT_${++this.counter}`,
      postId: params.postId,
      userId: params.userId,
      username: params.username,
      content: params.content,
      createdAt: Date.now()
    };
    this.comments.set(comment.id, comment);
    const post = this.posts.get(params.postId);
    if (post) post.comments++;
    return comment;
  }

  async getFeed(limit: number = 50): Promise<Post[]> {
    return Array.from(this.posts.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async getPost(postId: string): Promise<Post | undefined> {
    return this.posts.get(postId);
  }

  async getComments(postId: string): Promise<Comment[]> {
    return Array.from(this.comments.values())
      .filter(c => c.postId === postId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}

export default SquarePlatform;