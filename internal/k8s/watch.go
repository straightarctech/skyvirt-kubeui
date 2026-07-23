package k8s

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
)

// WatchResource resolves a kind to its GVR (CRD-aware) and starts a watch via
// the dynamic client. Pass namespace="" or "all" to watch cluster-wide (for a
// namespaced kind that watches across all namespaces). The returned
// watch.Interface streams ADDED/MODIFIED/DELETED/BOOKMARK events until the
// caller stops it or ctx is cancelled.
//
// The optional resourceVersion lets a reconnecting client resume; pass "" to
// start from the current state. AllowWatchBookmarks reduces the chance of a
// 410 Gone by having the apiserver periodically advance the resourceVersion.
func (c *Client) WatchResource(ctx context.Context, kind, namespace, resourceVersion string) (watch.Interface, error) {
	gvr, namespaced, err := c.resolveGVR(kind)
	if err != nil {
		return nil, fmt.Errorf("resolving GVR for kind %q: %w", kind, err)
	}

	opts := metav1.ListOptions{
		ResourceVersion:     resourceVersion,
		AllowWatchBookmarks: true,
	}

	if namespaced && namespace != "" && namespace != "all" {
		return c.DynamicClient.Resource(gvr).Namespace(namespace).Watch(ctx, opts)
	}
	return c.DynamicClient.Resource(gvr).Watch(ctx, opts)
}
