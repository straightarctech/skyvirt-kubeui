// Package ai is a minimal OpenAI-compatible chat client for the on-prem vLLM.
// It is used only for advisory, read-only assistance (e.g. explaining a
// diagnosis) — it never takes cluster actions.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Config points at an OpenAI-compatible endpoint (e.g. the local vLLM).
type Config struct {
	BaseURL string // e.g. http://vllm.example.com:8000
	Model   string // served-model-name
	APIKey  string
}

// Enabled reports whether AI features should be offered.
func (c Config) Enabled() bool { return c.BaseURL != "" && c.Model != "" }

type Client struct {
	cfg  Config
	http *http.Client
}

func New(cfg Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: 60 * time.Second}}
}

func (c *Client) Enabled() bool { return c.cfg.Enabled() }

type chatReq struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
	Stream      bool          `json:"stream"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResp struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Chat sends a system+user prompt and returns the assistant's reply.
func (c *Client) Chat(ctx context.Context, system, user string) (string, error) {
	if !c.cfg.Enabled() {
		return "", fmt.Errorf("AI is not configured")
	}
	body, err := json.Marshal(chatReq{
		Model:       c.cfg.Model,
		Messages:    []chatMessage{{Role: "system", Content: system}, {Role: "user", Content: user}},
		Temperature: 0.2,
		MaxTokens:   600,
		Stream:      false,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("calling AI endpoint: %w", err)
	}
	defer resp.Body.Close()

	var out chatResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decoding AI response (HTTP %d): %w", resp.StatusCode, err)
	}
	if out.Error != nil {
		return "", fmt.Errorf("AI error: %s", out.Error.Message)
	}
	if len(out.Choices) == 0 {
		return "", fmt.Errorf("AI returned no completion (HTTP %d)", resp.StatusCode)
	}
	return out.Choices[0].Message.Content, nil
}
