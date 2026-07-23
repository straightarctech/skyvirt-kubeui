package k8s

import (
	"context"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// CRDSummary is the API-friendly custom resource definition representation.
type CRDSummary struct {
	Name      string    `json:"name"`
	Group     string    `json:"group"`
	Version   string    `json:"version"`
	Kind      string    `json:"kind"`
	Scope     string    `json:"scope"`
	CreatedAt time.Time `json:"created_at"`
}

// ListCRDs returns all custom resource definitions using the dynamic client.
func (c *Client) ListCRDs(ctx context.Context) ([]CRDSummary, error) {
	gvr := schema.GroupVersionResource{
		Group:    "apiextensions.k8s.io",
		Version:  "v1",
		Resource: "customresourcedefinitions",
	}

	list, err := c.DynamicClient.Resource(gvr).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("listing CRDs: %w", err)
	}

	out := make([]CRDSummary, 0, len(list.Items))
	for _, item := range list.Items {
		spec, _, _ := unstructured.NestedMap(item.Object, "spec")
		if spec == nil {
			continue
		}

		group, _, _ := unstructured.NestedString(item.Object, "spec", "group")
		scope, _, _ := unstructured.NestedString(item.Object, "spec", "scope")
		kind, _, _ := unstructured.NestedString(item.Object, "spec", "names", "kind")

		// Get the first served version.
		var version string
		versions, found, _ := unstructured.NestedSlice(item.Object, "spec", "versions")
		if found && len(versions) > 0 {
			if v, ok := versions[0].(map[string]interface{}); ok {
				version, _, _ = unstructured.NestedString(v, "name")
			}
		}

		createdAt := item.GetCreationTimestamp().Time

		out = append(out, CRDSummary{
			Name:      item.GetName(),
			Group:     group,
			Version:   version,
			Kind:      kind,
			Scope:     scope,
			CreatedAt: createdAt,
		})
	}
	return out, nil
}

// GetCRDInstances returns instances of a custom resource.
// Pass "" for namespace to list cluster-scoped resources.
func (c *Client) GetCRDInstances(ctx context.Context, group, version, resource, namespace string) ([]unstructured.Unstructured, error) {
	gvr := schema.GroupVersionResource{
		Group:    group,
		Version:  version,
		Resource: resource,
	}

	var list *unstructured.UnstructuredList
	var err error
	if namespace == "" {
		list, err = c.DynamicClient.Resource(gvr).List(ctx, metav1.ListOptions{})
	} else {
		list, err = c.DynamicClient.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{})
	}
	if err != nil {
		return nil, fmt.Errorf("listing CRD instances %s/%s/%s: %w", group, version, resource, err)
	}
	return list.Items, nil
}
