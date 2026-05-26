// Package backup - Backup Service
package main

import (
	"fmt"
	"os"
	"time"
)

type Backup struct {
	ID, Path, CreatedAt string
	Size int64
}

func backup(src, dst string) error {
	srcFile, _ := os.Open(src)
	defer srcFile.Close()
	
	dstFile, _ := os.Create(dst)
	defer dstFile.Close()
	
	buf := make([]byte, 1024)
	for {
		n, _ := srcFile.Read(buf)
		if n == 0 { break }
		dstFile.Write(buf[:n])
	}
	return nil
}

type BackupService struct {
	backups map[string]*Backup
}

func New() *BackupService {
	return &BackupService{make(map[string]*Backup)}
}

func (bs *BackupService) Create(path, dest string) *Backup {
	backup(path, dest)
	return &Backup{ID: path, Path: dest, CreatedAt: time.Now().Format(time.RFC3339)}
}

func main() {
	bs := New()
	bk := bs.Create("data/db", "backup/db.bak")
	fmt.Printf("Backup: %s\n", bk.ID)
}