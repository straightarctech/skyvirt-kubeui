package k8s

import (
	"context"
	"encoding/json"
	"reflect"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
)

// PlanItem is one resource's disposition when a Git manifest is compared to the
// live cluster.
type PlanItem struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Action    string `json:"action"` // create | update | unchanged | error
	Error     string `json:"error,omitempty"`
}

// PlanReport is the drift plan for a whole manifest set.
type PlanReport struct {
	Items     []PlanItem `json:"items"`
	Create    int        `json:"create"`
	Update    int        `json:"update"`
	Unchanged int        `json:"unchanged"`
	Errors    int        `json:"errors"`
	InSync    bool       `json:"in_sync"` // no create/update/error needed
}

// PlanManifest compares each document in a manifest against the live cluster and
// reports what a sync would do — without changing anything. "update" means the
// live object differs from the desired spec in the fields the manifest declares
// (defaulted/controller-managed fields the manifest doesn't set are ignored, so
// a sparse manifest doesn't read as perpetual drift).
func (c *Client) PlanManifest(ctx context.Context, manifest []byte) (*PlanReport, error) {
	docs, err := splitYAMLDocuments(manifest)
	if err != nil {
		return nil, err
	}
	rep := &PlanReport{Items: []PlanItem{}}
	for _, doc := range docs {
		obj := &unstructured.Unstructured{}
		if err := decodeUnstructured(doc, obj); err != nil {
			rep.Items = append(rep.Items, PlanItem{Action: "error", Error: err.Error()})
			rep.Errors++
			continue
		}
		if obj.GetKind() == "" || obj.GetName() == "" {
			continue // not a concrete object (empty doc / list separator)
		}
		it := PlanItem{Kind: obj.GetKind(), Name: obj.GetName(), Namespace: obj.GetNamespace()}
		gvr, namespaced, err := c.resolveGVKToGVR(obj.GroupVersionKind())
		if err != nil {
			gvr, namespaced, err = c.resolveGVR(obj.GetKind())
		}
		if err != nil {
			it.Action, it.Error = "error", "resolve kind: "+err.Error()
			rep.Items, rep.Errors = append(rep.Items, it), rep.Errors+1
			continue
		}
		ns := obj.GetNamespace()
		var live *unstructured.Unstructured
		if namespaced {
			if ns == "" {
				ns = "default"
			}
			live, err = c.DynamicClient.Resource(gvr).Namespace(ns).Get(ctx, obj.GetName(), metav1.GetOptions{})
		} else {
			live, err = c.DynamicClient.Resource(gvr).Get(ctx, obj.GetName(), metav1.GetOptions{})
		}
		if err != nil {
			it.Action = "create" // not found (or unreadable) — a sync would create it
			rep.Create++
		} else if changed, derr := c.wouldChange(ctx, gvr, namespaced, ns, obj, live); derr != nil {
			it.Action, it.Error = "error", "dry-run: "+derr.Error()
			rep.Errors++
		} else if changed {
			it.Action = "update"
			rep.Update++
		} else {
			it.Action = "unchanged"
			rep.Unchanged++
		}
		rep.Items = append(rep.Items, it)
	}
	rep.InSync = rep.Create == 0 && rep.Update == 0 && rep.Errors == 0
	return rep, nil
}

func decodeUnstructured(doc []byte, obj *unstructured.Unstructured) error {
	var m map[string]any
	if err := utilyaml.Unmarshal(doc, &m); err != nil {
		return err
	}
	obj.Object = m
	return nil
}

// wouldChange reports whether applying desired would actually change live. It
// uses a server-side apply dry-run (Force, so a field owned by another manager
// doesn't error but shows as the change it is) and compares the server-
// normalized result to live — so quantity/port/defaulting normalization can't
// produce false drift. Only real spec differences remain.
func (c *Client) wouldChange(ctx context.Context, gvr schema.GroupVersionResource, namespaced bool, ns string, desired, live *unstructured.Unstructured) (bool, error) {
	data, err := json.Marshal(desired.Object)
	if err != nil {
		return false, err
	}
	force := true
	opts := metav1.PatchOptions{FieldManager: "kubeui", Force: &force, DryRun: []string{metav1.DryRunAll}}
	var res *unstructured.Unstructured
	if namespaced {
		res, err = c.DynamicClient.Resource(gvr).Namespace(ns).Patch(ctx, desired.GetName(), types.ApplyPatchType, data, opts)
	} else {
		res, err = c.DynamicClient.Resource(gvr).Patch(ctx, desired.GetName(), types.ApplyPatchType, data, opts)
	}
	if err != nil {
		return false, err
	}
	return !reflect.DeepEqual(stripForDiff(res.Object), stripForDiff(live.Object)), nil
}

// stripForDiff returns a deep copy with server-owned, always-differing fields
// removed, so two server-normalized objects compare on spec/labels/annotations
// alone.
func stripForDiff(o map[string]any) map[string]any {
	c := runtime.DeepCopyJSON(o)
	delete(c, "status")
	if md, ok := c["metadata"].(map[string]any); ok {
		for _, k := range []string{"managedFields", "resourceVersion", "generation", "creationTimestamp", "uid", "selfLink"} {
			delete(md, k)
		}
		if ann, ok := md["annotations"].(map[string]any); ok {
			delete(ann, "kubectl.kubernetes.io/last-applied-configuration")
			if len(ann) == 0 {
				delete(md, "annotations")
			}
		}
	}
	return c
}
