package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

// EngineClient wraps an HTTP client that talks to the SkyVirtHCI engine.
type EngineClient struct {
	baseURL    string
	httpClient *http.Client
	logger     *zap.Logger
}

// NewEngineClient creates an engine proxy client. TLS verification is disabled
// because the engine uses a self-signed certificate.
func NewEngineClient(baseURL string, logger *zap.Logger) *EngineClient {
	return &EngineClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
		logger: logger,
	}
}

// ProxyRequest forwards an HTTP request to the engine, copying method, path,
// query string, body, and authorization header. It writes the engine's
// response directly to the client.
func (ec *EngineClient) ProxyRequest(w http.ResponseWriter, r *http.Request, enginePath string) {
	targetURL := ec.baseURL + enginePath
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create proxy request")
		return
	}

	// Forward content type and auth header.
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	if auth := r.Header.Get("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}

	resp, err := ec.httpClient.Do(req)
	if err != nil {
		ec.logger.Error("engine proxy error", zap.String("path", enginePath), zap.Error(err))
		writeError(w, http.StatusBadGateway, "engine unavailable")
		return
	}
	defer resp.Body.Close()

	// Copy response headers.
	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// Do performs a single request against the engine and returns the status code
// and body — used where the response must be inspected or rewritten rather
// than streamed through (e.g. the login → console-token exchange).
func (ec *EngineClient) Do(ctx context.Context, method, path, contentType string, body []byte, authHeader string) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, ec.baseURL+path, rd)
	if err != nil {
		return 0, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := ec.httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, b, err
}

// ProxyHandler returns an http.HandlerFunc that proxies the request to the
// given engine API path. It preserves the full original request path suffix
// when pathPrefix is provided (for wildcard routes).
func (ec *EngineClient) ProxyHandler(enginePath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ec.ProxyRequest(w, r, enginePath)
	}
}
