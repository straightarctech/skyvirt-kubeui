package k8s

import (
	"context"
	"errors"
	"fmt"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
)

// ErrKindNotInstalled marks "this kind does not exist in this cluster" — an
// optional operator's CRDs (MetalLB, Multus, cert-manager…) simply aren't
// installed. It is a permanent, expected condition, NOT a transient failure:
// callers surface it as "not installed" and must not retry in a hot loop.
var ErrKindNotInstalled = errors.New("kind not installed in this cluster")

// IsKindNotInstalled reports whether err means the requested kind/resource has
// no API endpoint here (REST-mapper no-match, or the apiserver 404 the dynamic
// client returns for an unknown GVR).
func IsKindNotInstalled(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, ErrKindNotInstalled) || meta.IsNoMatchError(err) || apierrors.IsNotFound(err)
}

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
		// Nothing in discovery serves this kind — the operator that owns it is
		// not installed. Flag it so the caller stops retrying (see BUG: the L2
		// Networking page hot-reconnected every 500ms against absent CRDs).
		return nil, fmt.Errorf("resolving GVR for kind %q: %w: %v", kind, ErrKindNotInstalled, err)
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
