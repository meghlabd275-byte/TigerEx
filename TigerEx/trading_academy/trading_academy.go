package main

import (
	"fmt"
	"time"
)

// Course
type Course struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string  `json:"description"`
	Category   string   `json:"category"`
	Difficulty  string   `json:"difficulty"`
	Lessons    int      `json:"lessons"`
	Status     string   `json:"status"`
	Reward     float64  `json:"reward"`
	CreatedAt  int64    `json:"createdAt"`
}

// Quest
type Quest struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Type        string  `json:"type"` // daily, weekly, achievement
	Requirement string  `json:"requirement"`
	Reward      float64 `json:"reward"`
	CompletedBy int     `json:"completedBy"`
}

// Lesson progress
type LessonProgress struct {
	ID          string `json:"id"`
	LessonIndex int    `json:"lessonIndex"`
	Completed  bool   `json:"completed"`
	CompletedAt int64  `json:"completedAt"`
}

// User progress
type UserProgress struct {
	UserID          string           `json:"userId"`
	EnrolledCourses []string         `json:"enrolledCourses"`
	CompletedLessons map[string][]*LessonProgress `json:"completedLessons"`
	QuestsCompleted []string        `json:"questsCompleted"`
	XPEarned       int             `json:"xpEarned"`
	Badges         []string        `json:"badges"`
}

// Academy
type TradingAcademy struct {
	Courses     map[string]*Course
	Quests     map[string]*Quest
	UserProgress map[string]*UserProgress
}

// New creates academy
func NewTradingAcademy() *TradingAcademy {
	return &TradingAcademy{
		Courses: make(map[string]*Course),
		Quests: make(map[string]*Quest),
		UserProgress: make(map[string]*UserProgress),
	}
}

// Create course
func (a *TradingAcademy) CreateCourse(title, desc, category, difficulty string, reward float64) *Course {
	id := fmt.Sprintf("COURSE-%d", time.Now().UnixNano())
	
	course := &Course{
		ID: id,
		Title: title,
		Description: desc,
		Category: category,
		Difficulty: difficulty,
		Lessons: 0,
		Status: "published",
		Reward: reward,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	a.Courses[id] = course
	return course
}

// Enroll in course
func (a *TradingAcademy) Enroll(userID, courseID string) bool {
	course, exists := a.Courses[courseID]
	if !exists {
		return false
	}
	
	progress, exists := a.UserProgress[userID]
	if !exists {
		progress = &UserProgress{
			UserID: userID,
			EnrolledCourses: []string{},
			CompletedLessons: make(map[string][]*LessonProgress),
			QuestsCompleted: []string{},
			Badges: []string{},
		}
		a.UserProgress[userID] = progress
	}
	
	// Check if already enrolled
	for _, c := range progress.EnrolledCourses {
		if c == courseID {
			return false
		}
	}
	
	progress.EnrolledCourses = append(progress.EnrolledCourses, courseID)
	return true
}

// Complete lesson
func (a *TradingAcademy) CompleteLesson(userID, courseID string, lessonIndex int) bool {
	progress := a.UserProgress[userID]
	if progress == nil {
		return false
	}
	
	lesson := &LessonProgress{
		ID: fmt.Sprintf("lesson_%d", lessonIndex),
		LessonIndex: lessonIndex,
		Completed: true,
		CompletedAt: time.Now().UnixMilli(),
	}
	
	progress.CompletedLessons[courseID] = append(progress.CompletedLessons[courseID], lesson)
	progress.XPEarned += 10
	
	// Award badge on first lesson
	if len(progress.Badges) == 0 {
		progress.Badges = append(progress.Badges, "first_lesson")
	}
	
	return true
}

// Get user progress
func (a *TradingAcademy) GetUserProgress(userID string) *UserProgress {
	return a.UserProgress[userID]
}

func main() {
	academy := NewTradingAcademy()
	
	// Create course
	course := academy.CreateCourse("Intro to Trading", "Learn basics", "beginner", "easy", 50.0)
	fmt.Printf("Created: %s\n", course.Title)
	
	// Enroll
	academy.Enroll("user1", course.ID)
	fmt.Println("Enrolled")
	
	// Complete lesson
	academy.CompleteLesson("user1", course.ID, 0)
	
	// Get progress
	progress := academy.GetUserProgress("user1")
	fmt.Printf("XP: %d, Badges: %v\n", progress.XPEarned, progress.Badges)
}