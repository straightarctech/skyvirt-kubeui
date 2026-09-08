package k8s

import (
	"fmt"
	"os"
	"path/filepath"

	"go.uber.org/zap"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Client wraps all Kubernetes API clients.
type Client struct {
	Clientset     kubernetes.Interface
	DynamicClient dynamic.Interface
	MetricsClient metricsv.Interface
	RestConfig    *rest.Config
	Logger        *zap.Logger
}

// NewClient creates a Kubernetes client, preferring in-cluster config
// and falling back to ~/.kube/config for local development.
func NewClient(logger *zap.Logger) (*Client, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		logger.Info("not running in-cluster, trying kubeconfig")
		kubeconfig := os.Getenv("KUBECONFIG")
		if kubeconfig == "" {
			home, _ := os.UserHomeDir()
			kubeconfig = filepath.Join(home, ".kube", "config")
		}
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, fmt.Errorf("unable to load kubeconfig: %w", err)
		}
	}

	// Increase QPS for production workloads.
	config.QPS = 50
	config.Burst = 100

	cs, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("creating clientset: %w", err)
	}

	dc, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("creating dynamic client: %w", err)
	}

	mc, err := metricsv.NewForConfig(config)
	if err != nil {
		logger.Warn("metrics client creation failed (metrics-server may not be installed)", zap.Error(err))
		mc = nil
	}

	return &Client{
		Clientset:     cs,
		DynamicClient: dc,
		MetricsClient: mc,
		RestConfig:    config,
		Logger:        logger.Named("k8s"),
	}, nil
}
