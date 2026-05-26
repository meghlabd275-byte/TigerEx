package main

import (
	"fmt"
	"time"
)

// Storage provider
type StorageProvider string

const (
	ProviderIPFS StorageProvider = "ipfs"
	ProviderArweave StorageProvider = "arweave"
	ProviderAWSS3 StorageProvider = "aws_s3"
	ProviderPinata StorageProvider = "pinata"
	ProviderNFTStorage StorageProvider = "nft_storage"
	ProviderWeb3Storage StorageProvider = "web3_storage"
)

// Content type
type ContentType string

const (
	ContentImage ContentType = "image"
	ContentVideo ContentType = "video"
	ContentAudio ContentType = "audio"
	ContentModel3D ContentType = "model_3d"
	ContentPDF ContentType = "pdf"
	ContentJSON ContentType = "json"
)

// Stored content
type StoredContent struct {
	ID          string        `json:"id"`
	CID         string        `json:"cid"`
	Provider    StorageProvider `json:"provider"`
	ContentType ContentType  `json:"contentType"`
	Size       int64        `json:"size"`
	MimeType   string      `json:"mimeType"`
	UploadedAt int64       `json:"uploadedAt"`
	Pinned     bool        `json:"pinned"`
	PinExpiry  *int64     `json:"pinExpiry,omitempty"`
	GatewayURLs []string    `json:"gatewayUrls"`
}

// IPFS Storage service
type IPFSStorage struct {
	Contents map[string]*StoredContent
}

// New creates storage
func NewIPFSStorage() *IPFSStorage {
	return &IPFSStorage{
		Contents: make(map[string]*StoredContent),
	}
}

// Upload content
func (s *IPFSStorage) Upload(data []byte, provider StorageProvider, contentType ContentType, mimeType string) *StoredContent {
	id := fmt.Sprintf("content_%d", time.Now().UnixNano())
	// Real impl would upload to IPFS and get CID
	cid := "QmHash" + fmt.Sprintf("%x", time.Now().UnixNano())[:8]
	
	content := &StoredContent{
		ID: id,
		CID: cid,
		Provider: provider,
		ContentType: contentType,
		Size: int64(len(data)),
		MimeType: mimeType,
		UploadedAt: time.Now().UnixMilli(),
		Pinned: true,
		GatewayURLs: []string{
			"https://ipfs.io/ipfs/" + cid,
			"https://cloudflare-ipfs.com/ipfs/" + cid,
		},
	}
	
	s.Contents[id] = content
	return content
}

// Pin content
func (s *IPFSStorage) Pin(contentID string, durationHours int) bool {
	content, ok := s.Contents[contentID]
	if !ok {
		return false
	}
	
	now := time.Now().UnixMilli()
	content.Pinned = true
	content.PinExpiry = func() *int64 {
		e := now + int64(durationHours*3600000)
		return &e
	}()
	
	return true
}

// Unpin content
func (s *IPFSStorage) Unpin(contentID string) bool {
	content, ok := s.Contents[contentID]
	if !ok {
		return false
	}
	
	content.Pinned = false
	content.PinExpiry = nil
	return true
}

// Get gateway URL
func (s *IPFSStorage) GetGatewayURL(contentID string) string {
	content, ok := s.Contents[contentID]
	if !ok || len(content.GatewayURLs) == 0 {
		return ""
	}
	
	return content.GatewayURLs[0]
}

// List pinned content
func (s *IPFSStorage) GetPinned() []*StoredContent {
	var result []*StoredContent
	for _, c := range s.Contents {
		if c.Pinned {
			result = append(result, c)
		}
	}
	return result
}

func main() {
	storage := NewIPFSStorage()
	
	// Upload
	testData := []byte("fake image data")
	content := storage.Upload(testData, ProviderIPFS, ContentImage, "image/png")
	fmt.Printf("Uploaded: %s\n", content.CID)
	
	// Get URL
	url := storage.GetGatewayURL(content.ID)
	fmt.Printf("Gateway: %s\n", url)
	
	// List pinned
	pinned := storage.GetPinned()
	fmt.Printf("Pinned: %d\n", len(pinned))
}