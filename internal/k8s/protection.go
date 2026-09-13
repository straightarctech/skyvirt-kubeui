package k8s

import (
	"context"
	"encoding/json"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
)

// ProtectionAnnotation is the annotation key used to mark resources as protected.
const ProtectionAnnotation = "kubeui.skyvirthci.io/protected"

// SetResourceAnnotation sets a single annotation on any Kubernetes resource
// identified by GVR, namespace, and name using a merge patch.
func (c *Client) SetResourceAnnotation(ctx context.Context, gvr schema.GroupVersionResource, namespace, name, key, value string) error {
	patch, err := json.Marshal(map[string]interface{}{
		"metadata": map[string]interface{}{
			"annotations": map[string]string{key: value},
		},
	})
	if err != nil {
		return fmt.Errorf("marshalling annotation patch: %w", err)
	}

	if namespace != "" {
		_, err = c.DynamicClient.Resource(gvr).Namespace(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	} else {
		_, err = c.DynamicClient.Resource(gvr).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	}
	if err != nil {
		return fmt.Errorf("patching annotation on %s %s/%s: %w", gvr.Resource, namespace, name, err)
	}
	return nil
}

// RemoveResourceAnnotation removes a single annotation from any Kubernetes
// resource by setting its value to null in a merge patch.
func (c *Client) RemoveResourceAnnotation(ctx context.Context, gvr schema.GroupVersionResource, namespace, name, key string) error {
	patch, err := json.Marshal(map[string]interface{}{
		"metadata": map[string]interface{}{
			"annotations": map[string]interface{}{key: nil},
		},
	})
	if err != nil {
		return fmt.Errorf("marshalling annotation removal patch: %w", err)
	}

	if namespace != "" {
		_, err = c.DynamicClient.Resource(gvr).Namespace(namespace).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	} else {
		_, err = c.DynamicClient.Resource(gvr).Patch(ctx, name, types.MergePatchType, patch, metav1.PatchOptions{})
	}
	if err != nil {
		return fmt.Errorf("removing annotation from %s %s/%s: %w", gvr.Resource, namespace, name, err)
	}
	return nil
}

// IsResourceProtected checks whether a resource has the protection annotation
// set to "true".
func (c *Client) IsResourceProtected(ctx context.Context, gvr schema.GroupVersionResource, namespace, name string) (bool, error) {
	var obj interface{ GetAnnotations() map[string]string }
	var err error

	if namespace != "" {
		obj, err = c.DynamicClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = c.DynamicClient.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		return false, fmt.Errorf("getting resource %s %s/%s: %w", gvr.Resource, namespace, name, err)
	}

	annotations := obj.GetAnnotations()
	if annotations == nil {
		return false, nil
	}
	return annotations[ProtectionAnnotation] == "true", nil
}
