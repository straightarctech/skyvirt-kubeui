package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/straightarctech/skyvirt-kubeui/internal/ai"
	"github.com/straightarctech/skyvirt-kubeui/internal/api"
	"github.com/straightarctech/skyvirt-kubeui/internal/audit"
	"github.com/straightarctech/skyvirt-kubeui/internal/auth"
	"github.com/straightarctech/skyvirt-kubeui/internal/db"
	"github.com/straightarctech/skyvirt-kubeui/internal/k8s"
)

var (
	version = "dev"
	commit  = "unknown"
	date    = "unknown"
)

//go:embed web/dist
var webFS embed.FS

// envBool reads a boolean-ish env var ("true", "1", "yes" are true).
func envBool(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "true", "1", "yes":
		return true
	}
	return false
}

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	logger.Info("starting skyvirthci-kubeui",
		zap.String("version", version),
		zap.String("commit", commit),
		zap.String("date", date),
	)

	// Initialize Kubernetes client.
	kc, err := k8s.NewClient(logger)
	if err != nil {
		logger.Fatal("failed to create k8s client", zap.Error(err))
	}
	logger.Info("kubernetes client initialized")

	// Initialize PostgreSQL (optional — skip if DATABASE_URL not set).
	var pgDB *db.PostgresDB
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		pgDB, err = db.New(dsn, logger)
		if err != nil {
			logger.Fatal("failed to connect to postgres", zap.Error(err))
		}
		defer pgDB.Close()
		if err := pgDB.Migrate(); err != nil {
			logger.Fatal("failed to run migrations", zap.Error(err))
		}
		logger.Info("postgresql connected and migrated")
	} else {
		logger.Info("DATABASE_URL not set, running without persistent storage")
	}

	// Audit store: durable Postgres when a DB is configured, else an in-memory
	// ring buffer (recent actions, lost on restart) so the feature works
	// standalone with no external dependency.
	var auditStore audit.Store
	if pgDB != nil {
		auditStore = audit.NewPostgresStore(pgDB, logger)
		logger.Info("audit: using durable postgres store")
	} else {
		auditStore = audit.NewMemoryStore(2000)
		logger.Info("audit: using in-memory store (set DATABASE_URL for durable audit)")
	}

	// Extract embedded web dist.
	webDist, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		logger.Fatal("failed to load embedded web assets", zap.Error(err))
	}

	// Engine proxy configuration.
	engineURL := os.Getenv("ENGINE_URL")

	// Auth configuration.
	authCfg := auth.Config{
		JWTSecret: os.Getenv("JWT_SECRET"),
		Enabled:   strings.ToLower(os.Getenv("AUTH_ENABLED")) == "true",
	}
	if authCfg.Enabled {
		if strings.TrimSpace(authCfg.JWTSecret) == "" {
			logger.Fatal("AUTH_ENABLED=true requires a non-empty JWT_SECRET")
		}
		logger.Info("authentication enabled")
	} else {
		logger.Warn("AUTH_ENABLED is not 'true' — authentication is DISABLED; " +
			"every request is served as a cluster admin. Do not expose this listener on an untrusted network.")
	}

	// Authorization configuration.
	authzCfg := api.AuthzConfig{
		ReadOnly:   envBool("KUBEUI_READ_ONLY"),
		WriteRoles: api.ParseWriteRoles(os.Getenv("KUBEUI_WRITE_ROLES")),
	}
	if authzCfg.ReadOnly {
		logger.Info("read-only mode enabled: all mutating operations are disabled")
	}

	// Optional on-prem AI (advisory only — powers Diagnose "Explain").
	aiCfg := ai.Config{
		BaseURL: strings.TrimSpace(os.Getenv("AI_BASE_URL")),
		Model:   strings.TrimSpace(os.Getenv("AI_MODEL")),
		APIKey:  strings.TrimSpace(os.Getenv("AI_API_KEY")),
	}
	if aiCfg.Enabled() {
		logger.Info("AI assistance enabled", zap.String("model", aiCfg.Model))
	}

	// Build router.
	router := api.NewRouter(kc, pgDB, auditStore, webDist, logger, engineURL, authCfg, authzCfg, aiCfg)

	// Determine listen address.
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown.
	done := make(chan os.Signal, 1)
	signal.Notify(done, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("listening", zap.String("addr", addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	<-done
	logger.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("shutdown error", zap.Error(err))
	}

	fmt.Println("bye")
}
