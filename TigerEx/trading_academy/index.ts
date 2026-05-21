/**
 * Trading Academy
 * 
 * Courses, Quests, Gamification, Learn & Earn
 */

export class TradingAcademy {
  private courses: Map<string, Course> = new Map();
  private quests: Map<string, Quest> = new Map();
  private userProgress: Map<string, UserProgress> = new Map();
  
  // Create course
  createCourse(course: CourseInput): Course {
    const c: Course = {
      id: `COURSE-${Date.now()}`,
      ...course,
      lessons: [],
      status: 'published',
      createdAt: new Date()
    };
    this.courses.set(c.id, c);
    return c;
  }
  
  // Get courses
  async getCourses(category?: string): Promise<Course[]> {
    const all = Array.from(this.courses.values());
    if (category) return all.filter(c => c.category === category);
    return all;
  }
  
  // Enroll in course
  async enroll(userId: string, courseId: string): Promise<void> {
    const progress = this.getOrCreateProgress(userId);
    if (!progress.enrolledCourses.includes(courseId)) {
      progress.enrolledCourses.push(courseId);
    }
  }
  
  // Complete lesson
  async completeLesson(userId: string, lessonId: string): Promise<void> {
    const progress = this.getOrCreateProgress(userId);
    if (!progress.completedLessons.includes(lessonId)) {
      progress.completedLessons.push(lessonId);
    }
  }
  
  // Create quest
  createQuest(quest: QuestInput): Quest {
    const q: Quest = {
      id: `QUEST-${Date.now()}`,
      ...quest,
      status: 'active',
      createdAt: new Date()
    };
    this.quests.set(q.id, q);
    return q;
  }
  
  // Complete quest & earn reward
  async completeQuest(userId: string, questId: string): Promise<QuestReward> {
    const quest = this.quests.get(questId);
    if (!quest) throw new Error('Quest not found');
    
    const progress = this.getOrCreateProgress(userId);
    progress.completedQuests.push(questId);
    progress.experience += quest.experience;
    
    // Level up check
    const newLevel = Math.floor(progress.experience / 1000) + 1;
    if (newLevel > progress.level) {
      progress.level = newLevel;
    }
    
    return { token: 'BNB', amount: quest.reward, experience: progress.experience };
  }
  
  // Get leaderboard
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const entries = Array.from(this.userProgress.values())
      .sort((a, b) => b.experience - a.experience)
      .slice(0, 100)
      .map((p, i) => ({ rank: i + 1, userId: p.userId, experience: p.experience }));
    return entries;
  }
  
  private getOrCreateProgress(userId: string): UserProgress {
    if (!this.userProgress.has(userId)) {
      this.userProgress.set(userId, {
        userId,
        enrolledCourses: [],
        completedLessons: [],
        completedQuests: [],
        experience: 0,
        level: 1,
        badges: []
      });
    }
    return this.userProgress.get(userId)!;
  }
}

interface CourseInput {
  title: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  lessons: LessonInput[];
  reward?: number;
}

interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  lessons: LessonInput[];
  status: string;
  createdAt: Date;
}

interface LessonInput {
  id: string;
  title: string;
  content: string;
  duration: number;
}

interface QuestInput {
  title: string;
  description: string;
  type: string;
  requirement: number;
  experience: number;
  reward: number;
}

interface Quest {
  id: string;
  title: string;
  description: string;
  type: string;
  requirement: number;
  experience: number;
  reward: number;
  status: string;
  createdAt: Date;
}

interface UserProgress {
  userId: string;
  enrolledCourses: string[];
  completedLessons: string[];
  completedQuests: string[];
  experience: number;
  level: number;
  badges: string[];
}

interface QuestReward {
  token: string;
  amount: number;
  experience: number;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  experience: number;
}