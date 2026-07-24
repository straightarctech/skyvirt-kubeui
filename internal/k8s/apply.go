package k8s

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	k8syaml "k8s.io/apimachinery/pkg/runtime/serializer/yaml"
	"k8s.io/apimachinery/pkg/types"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/restmapper"
)

// ApplyResult describes the outcome of applying a single resource document.
type ApplyResult struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Action    string `json:"action"` // "configured" or "created"
}

// Cached REST mapper with TTL.
var (
	mapperMu       sync.Mutex
	cachedMapper   meta.RESTMapper
	cachedGroupRes []*restmapper.APIGroupResources
	mapperExpiry   time.Time
)

// resolveGVR uses the discovery client and a cached REST mapper to resolve
// a kind string to a GroupVersionResource. It searches all known API groups
// for the kind. Returns the GVR, whether the resource is namespaced, and any error.
func (c *Client) resolveGVR(kind string) (schema.GroupVersionResource, bool, error) {
	mapper, err := c.getMapper()
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("building REST mapper: %w", err)
	}

	// Try well-known groups first for common kinds to avoid ambiguity.
	knownGroups := map[string]string{
		"Deployment":            "apps",
		"StatefulSet":           "apps",
		"DaemonSet":             "apps",
		"ReplicaSet":            "apps",
		"Job":                   "batch",
		"CronJob":               "batch",
		"Ingress":               "networking.k8s.io",
		"NetworkPolicy":         "networking.k8s.io",
		"HorizontalPodAutoscaler": "autoscaling",
	}

	if group, ok := knownGroups[kind]; ok {
		gk := schema.GroupKind{Group: group, Kind: kind}
		mapping, mapErr := mapper.RESTMapping(gk)
		if mapErr == nil {
			namespaced := mapping.Scope.Name() == meta.RESTScopeNameNamespace
			return mapping.Resource, namespaced, nil
		}
	}

	// Search every discovered API group for the kind. This resolves CRDs such
	// as MetalLB's IPAddressPool / L2Advertisement (group "metallb.io") as well
	// as core kinds, which the knownGroups shortcut above does not cover.
	if gvk, ok := c.findGVKForKind(kind); ok {
		return c.resolveGVKToGVR(gvk)
	}

	// Last resort: try the core group (empty string) directly.
	gk := schema.GroupKind{Kind: kind}
	mapping, err := mapper.RESTMapping(gk)
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("mapping kind %q: %w", kind, err)
	}

	namespaced := mapping.Scope.Name() == meta.RESTScopeNameNamespace
	return mapping.Resource, namespaced, nil
}

// resolveGVKToGVR resolves a fully-specified GVK (with group and version) to a GVR.
func (c *Client) resolveGVKToGVR(gvk schema.GroupVersionKind) (schema.GroupVersionResource, bool, error) {
	mapper, err := c.getMapper()
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("building REST mapper: %w", err)
	}

	mapping, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("mapping GVK %s: %w", gvk.String(), err)
	}

	namespaced := mapping.Scope.Name() == meta.RESTScopeNameNamespace
	return mapping.Resource, namespaced, nil
}

// getMapper returns a cached REST mapper, refreshing it if expired.
func (c *Client) getMapper() (meta.RESTMapper, error) {
	mapperMu.Lock()
	defer mapperMu.Unlock()

	if cachedMapper != nil && time.Now().Before(mapperExpiry) {
		return cachedMapper, nil
	}

	dc, ok := c.Clientset.(discovery.DiscoveryInterface)
	if !ok {
		return nil, fmt.Errorf("clientset does not implement discovery interface")
	}

	groupResources, err := restmapper.GetAPIGroupResources(dc)
	if err != nil {
		return nil, fmt.Errorf("discovering API groups: %w", err)
	}

	cachedMapper = restmapper.NewDiscoveryRESTMapper(groupResources)
	cachedGroupRes = groupResources
	mapperExpiry = time.Now().Add(5 * time.Minute)
	return cachedMapper, nil
}

// findGVKForKind searches every discovered API group/version for a resource
// whose Kind matches, preferring each group's preferred version. This lets us
// resolve CRDs (e.g. MetalLB's IPAddressPool / L2Advertisement) that are not in
// the knownGroups shortcut map. Returns the GVK and true if found.
func (c *Client) findGVKForKind(kind string) (schema.GroupVersionKind, bool) {
	mapperMu.Lock()
	groupRes := cachedGroupRes
	mapperMu.Unlock()

	for _, agr := range groupRes {
		preferred := agr.Group.PreferredVersion.Version
		var fallback *schema.GroupVersionKind
		for version, resources := range agr.VersionedResources {
			for _, res := range resources {
				// Skip subresources (e.g. "deployments/status").
				if res.Kind != kind || strings.Contains(res.Name, "/") {
					continue
				}
				gvk := schema.GroupVersionKind{Group: agr.Group.Name, Version: version, Kind: kind}
				if version == preferred {
					return gvk, true
				}
				if fallback == nil {
					g := gvk
					fallback = &g
				}
			}
		}
		if fallback != nil {
			return *fallback, true
		}
	}
	return schema.GroupVersionKind{}, false
}

// ApplyManifest parses a YAML/JSON manifest (possibly multi-document),
// resolves each document's GVR via discovery, and performs server-side apply.
func (c *Client) ApplyManifest(ctx context.Context, manifest []byte, force bool) ([]ApplyResult, error) {
	docs, err := splitYAMLDocuments(manifest)
	if err != nil {
		return nil, fmt.Errorf("splitting YAML documents: %w", err)
	}

	if len(docs) == 0 {
		return nil, fmt.Errorf("no valid documents found in manifest")
	}

	var results []ApplyResult

	decSerializer := k8syaml.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)

	for i, doc := range docs {
		obj := &unstructured.Unstructured{}
		_, gvk, err := decSerializer.Decode(doc, nil, obj)
		if err != nil {
			return results, fmt.Errorf("decoding document %d: %w", i, err)
		}

		if obj.GetName() == "" {
			return results, fmt.Errorf("document %d: resource name is required", i)
		}

		// Resolve the GVR from the fully specified GVK embedded in the document.
		gvr, namespaced, err := c.resolveGVKToGVR(*gvk)
		if err != nil {
			// Fall back to kind-only resolution.
			gvr, namespaced, err = c.resolveGVR(gvk.Kind)
			if err != nil {
				return results, fmt.Errorf("document %d: resolving GVR for kind %q: %w", i, gvk.Kind, err)
			}
		}

		// Determine namespace.
		ns := obj.GetNamespace()

		// Marshal the object to JSON for the patch call.
		data, err := json.Marshal(obj)
		if err != nil {
			return results, fmt.Errorf("document %d: marshalling to JSON: %w", i, err)
		}

		// Check if the resource already exists to determine action.
		var exists bool
		if namespaced {
			if ns == "" {
				ns = "default"
			}
			_, getErr := c.DynamicClient.Resource(gvr).Namespace(ns).Get(ctx, obj.GetName(), metav1.GetOptions{})
			exists = getErr == nil
		} else {
			_, getErr := c.DynamicClient.Resource(gvr).Get(ctx, obj.GetName(), metav1.GetOptions{})
			exists = getErr == nil
		}

		if exists {
			if err := c.guardProtectedUpdate(ctx, gvr, namespaced, ns, obj); err != nil {
				return results, err
			}
		}

		// Perform server-side apply. Force takes ownership of fields another manager
		// owns — needed for an intentional revert (e.g. rolling back a field that
		// `kubectl scale` set), off by default for ordinary applies.
		patchOpts := metav1.PatchOptions{
			FieldManager: "kubeui",
			Force:        &force,
		}

		if namespaced {
			_, err = c.DynamicClient.Resource(gvr).Namespace(ns).Patch(
				ctx, obj.GetName(), types.ApplyPatchType, data, patchOpts,
			)
		} else {
			ns = "" // Ensure namespace is empty for cluster-scoped resources.
			_, err = c.DynamicClient.Resource(gvr).Patch(
				ctx, obj.GetName(), types.ApplyPatchType, data, patchOpts,
			)
		}
		if err != nil {
			return results, fmt.Errorf("applying %s %q: %w", gvk.Kind, obj.GetName(), err)
		}

		action := "configured"
		if !exists {
			action = "created"
		}

		results = append(results, ApplyResult{
			Kind:      gvk.Kind,
			Name:      obj.GetName(),
			Namespace: ns,
			Action:    action,
		})
	}

	return results, nil
}

// GetResourceYAML fetches a resource by kind, namespace, and name and returns
// it as JSON bytes. Pass namespace="" for cluster-scoped resources.
func (c *Client) GetResourceYAML(ctx context.Context, kind, namespace, name string) ([]byte, error) {
	gvr, namespaced, err := c.resolveGVR(kind)
	if err != nil {
		return nil, fmt.Errorf("resolving GVR for kind %q: %w", kind, err)
	}

	var obj *unstructured.Unstructured
	if namespaced && namespace != "" {
		obj, err = c.DynamicClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = c.DynamicClient.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		if errors.IsNotFound(err) {
			return nil, fmt.Errorf("resource %s %s/%s not found: %w", kind, namespace, name, err)
		}
		return nil, fmt.Errorf("getting %s %s/%s: %w", kind, namespace, name, err)
	}

	data, err := json.Marshal(obj)
	if err != nil {
		return nil, fmt.Errorf("marshalling resource to JSON: %w", err)
	}
	return data, nil
}

// UpdateResource parses a YAML/JSON manifest for a single resource,
// resolves its GVR, and performs an update via the dynamic client.
func (c *Client) UpdateResource(ctx context.Context, manifest []byte) error {
	decSerializer := k8syaml.NewDecodingSerializer(unstructured.UnstructuredJSONScheme)

	obj := &unstructured.Unstructured{}
	_, gvk, err := decSerializer.Decode(manifest, nil, obj)
	if err != nil {
		return fmt.Errorf("decoding manifest: %w", err)
	}

	if obj.GetName() == "" {
		return fmt.Errorf("resource name is required")
	}

	gvr, namespaced, err := c.resolveGVKToGVR(*gvk)
	if err != nil {
		gvr, namespaced, err = c.resolveGVR(gvk.Kind)
		if err != nil {
			return fmt.Errorf("resolving GVR for kind %q: %w", gvk.Kind, err)
		}
	}

	ns := obj.GetNamespace()
	if namespaced && ns == "" {
		ns = "default"
	}
	if err := c.guardProtectedUpdate(ctx, gvr, namespaced, ns, obj); err != nil {
		return err
	}
	if namespaced {
		_, err = c.DynamicClient.Resource(gvr).Namespace(ns).Update(ctx, obj, metav1.UpdateOptions{})
	} else {
		_, err = c.DynamicClient.Resource(gvr).Update(ctx, obj, metav1.UpdateOptions{})
	}
	if err != nil {
		return fmt.Errorf("updating %s %q: %w", gvk.Kind, obj.GetName(), err)
	}

	return nil
}

// DeleteResource resolves a kind to its GVR (CRD-aware) and deletes the named
// resource via the dynamic client. Pass namespace="" for cluster-scoped
// resources. Protected resources are refused.
func (c *Client) DeleteResource(ctx context.Context, kind, namespace, name string) error {
	gvr, namespaced, err := c.resolveGVR(kind)
	if err != nil {
		return fmt.Errorf("resolving GVR for kind %q: %w", kind, err)
	}

	checkNS := namespace
	if !namespaced {
		checkNS = ""
	}
	// Fail closed: if protection can't be verified, refuse the delete.
	if protected, perr := c.IsResourceProtected(ctx, gvr, checkNS, name); perr != nil {
		return fmt.Errorf("could not verify protection for %s %q: %w", kind, name, perr)
	} else if protected {
		return fmt.Errorf("%s %q is protected — unprotect it before deleting", kind, name)
	}

	if namespaced && namespace != "" {
		err = c.DynamicClient.Resource(gvr).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	} else {
		err = c.DynamicClient.Resource(gvr).Delete(ctx, name, metav1.DeleteOptions{})
	}
	if err != nil {
		if errors.IsNotFound(err) {
			return fmt.Errorf("resource %s %s/%s not found: %w", kind, namespace, name, err)
		}
		return fmt.Errorf("deleting %s %s/%s: %w", kind, namespace, name, err)
	}
	return nil
}

// guardProtectedUpdate blocks manifest writes that would strip the protection
// annotation from a currently protected resource. Regular edits that keep the
// annotation are allowed — protection guards against deletion/replacement, and
// removing it must go through the explicit unprotect endpoint.
func (c *Client) guardProtectedUpdate(ctx context.Context, gvr schema.GroupVersionResource, namespaced bool, ns string, obj *unstructured.Unstructured) error {
	checkNS := ns
	if !namespaced {
		checkNS = ""
	}
	protected, err := c.IsResourceProtected(ctx, gvr, checkNS, obj.GetName())
	if err != nil {
		// Fail closed: can't confirm the resource is unprotected.
		return fmt.Errorf("could not verify protection for %s %q: %w", obj.GetKind(), obj.GetName(), err)
	}
	if !protected {
		return nil
	}
	if obj.GetAnnotations()[ProtectionAnnotation] != "true" {
		return fmt.Errorf("%s %q is protected — protection cannot be removed via manifest edit; unprotect it first", obj.GetKind(), obj.GetName())
	}
	return nil
}

// ResolveKindToGVR is the public wrapper around resolveGVR. It resolves a
// Kubernetes kind string (e.g. "Deployment") to its GroupVersionResource.
func (c *Client) ResolveKindToGVR(kind string) (schema.GroupVersionResource, bool, error) {
	return c.resolveGVR(kind)
}

// splitYAMLDocuments splits a multi-document YAML byte slice into individual
// document byte slices, skipping empty documents.
func splitYAMLDocuments(data []byte) ([][]byte, error) {
	var docs [][]byte
	reader := utilyaml.NewYAMLOrJSONDecoder(bytes.NewReader(data), 4096)

	for {
		var raw json.RawMessage
		err := reader.Decode(&raw)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		// Skip null / empty docs.
		trimmed := strings.TrimSpace(string(raw))
		if trimmed == "" || trimmed == "null" || trimmed == "{}" {
			continue
		}

		docs = append(docs, raw)
	}

	return docs, nil
}
