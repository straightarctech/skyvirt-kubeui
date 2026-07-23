package k8s

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// DeprecatedAPI is a Kubernetes API version that has been (or will be) removed.
type DeprecatedAPI struct {
	APIVersion  string `json:"api_version"`
	Kind        string `json:"kind"`
	RemovedIn   string `json:"removed_in"`
	Replacement string `json:"replacement"`
}

// deprecatedAPIs — the API removals that actually break cluster upgrades. Kept
// curated (the high-impact ones) rather than exhaustive; extend as needed.
var deprecatedAPIs = []DeprecatedAPI{
	// Removed in 1.16
	{"extensions/v1beta1", "Deployment", "1.16", "apps/v1"},
	{"extensions/v1beta1", "DaemonSet", "1.16", "apps/v1"},
	{"extensions/v1beta1", "ReplicaSet", "1.16", "apps/v1"},
	{"extensions/v1beta1", "NetworkPolicy", "1.16", "networking.k8s.io/v1"},
	{"apps/v1beta1", "Deployment", "1.16", "apps/v1"},
	{"apps/v1beta2", "Deployment", "1.16", "apps/v1"},
	// Removed in 1.22
	{"extensions/v1beta1", "Ingress", "1.22", "networking.k8s.io/v1"},
	{"networking.k8s.io/v1beta1", "Ingress", "1.22", "networking.k8s.io/v1"},
	{"networking.k8s.io/v1beta1", "IngressClass", "1.22", "networking.k8s.io/v1"},
	{"apiextensions.k8s.io/v1beta1", "CustomResourceDefinition", "1.22", "apiextensions.k8s.io/v1"},
	{"admissionregistration.k8s.io/v1beta1", "ValidatingWebhookConfiguration", "1.22", "admissionregistration.k8s.io/v1"},
	{"admissionregistration.k8s.io/v1beta1", "MutatingWebhookConfiguration", "1.22", "admissionregistration.k8s.io/v1"},
	{"rbac.authorization.k8s.io/v1beta1", "ClusterRole", "1.22", "rbac.authorization.k8s.io/v1"},
	{"rbac.authorization.k8s.io/v1beta1", "ClusterRoleBinding", "1.22", "rbac.authorization.k8s.io/v1"},
	{"rbac.authorization.k8s.io/v1beta1", "Role", "1.22", "rbac.authorization.k8s.io/v1"},
	{"rbac.authorization.k8s.io/v1beta1", "RoleBinding", "1.22", "rbac.authorization.k8s.io/v1"},
	{"certificates.k8s.io/v1beta1", "CertificateSigningRequest", "1.22", "certificates.k8s.io/v1"},
	{"coordination.k8s.io/v1beta1", "Lease", "1.22", "coordination.k8s.io/v1"},
	{"scheduling.k8s.io/v1beta1", "PriorityClass", "1.22", "scheduling.k8s.io/v1"},
	{"storage.k8s.io/v1beta1", "CSINode", "1.22", "storage.k8s.io/v1"},
	// Removed in 1.25
	{"policy/v1beta1", "PodDisruptionBudget", "1.25", "policy/v1"},
	{"policy/v1beta1", "PodSecurityPolicy", "1.25", "Pod Security Admission (no direct replacement)"},
	{"batch/v1beta1", "CronJob", "1.25", "batch/v1"},
	{"discovery.k8s.io/v1beta1", "EndpointSlice", "1.25", "discovery.k8s.io/v1"},
	{"events.k8s.io/v1beta1", "Event", "1.25", "events.k8s.io/v1"},
	{"autoscaling/v2beta1", "HorizontalPodAutoscaler", "1.25", "autoscaling/v2"},
	{"node.k8s.io/v1beta1", "RuntimeClass", "1.25", "node.k8s.io/v1"},
	// Removed in 1.26
	{"autoscaling/v2beta2", "HorizontalPodAutoscaler", "1.26", "autoscaling/v2"},
	{"flowcontrol.apiserver.k8s.io/v1beta1", "FlowSchema", "1.26", "flowcontrol.apiserver.k8s.io/v1"},
	// Removed in 1.27
	{"storage.k8s.io/v1beta1", "CSIStorageCapacity", "1.27", "storage.k8s.io/v1"},
	// Removed in 1.29
	{"flowcontrol.apiserver.k8s.io/v1beta2", "FlowSchema", "1.29", "flowcontrol.apiserver.k8s.io/v1"},
}

// APIFinding is a discovered use of a deprecated API version.
type APIFinding struct {
	DeprecatedAPI
	Name   string `json:"name"`
	Source string `json:"source"` // where it was found, e.g. "helm:release (namespace)"
}

func lookupDeprecated(apiVersion, kind string) *DeprecatedAPI {
	for i := range deprecatedAPIs {
		if deprecatedAPIs[i].APIVersion == apiVersion && deprecatedAPIs[i].Kind == kind {
			return &deprecatedAPIs[i]
		}
	}
	return nil
}

var (
	scanAPIVersionRe = regexp.MustCompile(`(?m)^apiVersion:\s*"?([^"\s]+)`)
	scanKindRe       = regexp.MustCompile(`(?m)^kind:\s*"?([^"\s]+)`)
	scanNameRe       = regexp.MustCompile(`(?m)^\s{0,2}name:\s*"?([^"\s]+)`)
)

// ScanDeprecatedAPIs scans every Helm release's rendered manifest for
// deprecated/removed API versions — the accurate signal, since the rendered
// manifest carries the exact apiVersions that were deployed (unlike live objects,
// which the API server converts to the served version).
func (c *Client) ScanDeprecatedAPIs(ctx context.Context) ([]APIFinding, error) {
	releases, err := c.ListReleases(ctx, "")
	if err != nil {
		return nil, err
	}
	var findings []APIFinding
	for _, r := range releases {
		manifest, err := c.HelmGetManifest(ctx, r.Namespace, r.Name, 0)
		if err != nil {
			continue // a single unreadable release must not fail the whole scan
		}
		for _, doc := range strings.Split(manifest, "\n---") {
			av := scanAPIVersionRe.FindStringSubmatch(doc)
			kd := scanKindRe.FindStringSubmatch(doc)
			if av == nil || kd == nil {
				continue
			}
			if dep := lookupDeprecated(strings.TrimSpace(av[1]), strings.TrimSpace(kd[1])); dep != nil {
				name := ""
				if nm := scanNameRe.FindStringSubmatch(doc); nm != nil {
					name = strings.TrimSpace(nm[1])
				}
				findings = append(findings, APIFinding{DeprecatedAPI: *dep, Name: name, Source: "helm:" + r.Name + " (" + r.Namespace + ")"})
			}
		}
	}
	return findings, nil
}

const lastAppliedAnnotation = "kubectl.kubernetes.io/last-applied-configuration"

// liveScanTarget is a currently-served GVR to enumerate when scanning live
// objects. The removal table's kinds are served at these current versions; the
// applied (possibly deprecated) apiVersion is read from each object's
// last-applied-configuration annotation.
type liveScanTarget struct {
	gvr        schema.GroupVersionResource
	namespaced bool
}

var liveScanTargets = []liveScanTarget{
	{schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}, true},
	{schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "daemonsets"}, true},
	{schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "replicasets"}, true},
	{schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "cronjobs"}, true},
	{schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"}, true},
	{schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"}, true},
	{schema.GroupVersionResource{Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"}, true},
	{schema.GroupVersionResource{Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"}, true},
	{schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"}, true},
	{schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"}, true},
	{schema.GroupVersionResource{Group: "networking.k8s.io", Version: "v1", Resource: "ingressclasses"}, false},
	{schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}, false},
	{schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"}, false},
	{schema.GroupVersionResource{Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"}, false},
	{schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"}, false},
	{schema.GroupVersionResource{Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"}, false},
	{schema.GroupVersionResource{Group: "scheduling.k8s.io", Version: "v1", Resource: "priorityclasses"}, false},
	{schema.GroupVersionResource{Group: "node.k8s.io", Version: "v1", Resource: "runtimeclasses"}, false},
}

// ScanDeprecatedAPIsLive finds live objects that were applied with a deprecated
// apiVersion. The API server serves objects at the current version, so the live
// apiVersion can't reveal the applied one — the reliable signal is the
// kubectl.kubernetes.io/last-applied-configuration annotation (the kubent
// approach). This catches non-Helm, kubectl-applied resources the manifest scan
// misses. Best-effort: an unserved GVR or a forbidden list is skipped, never fatal.
func (c *Client) ScanDeprecatedAPIsLive(ctx context.Context) []APIFinding {
	var findings []APIFinding
	for _, t := range liveScanTargets {
		ri := c.DynamicClient.Resource(t.gvr)
		var list *unstructured.UnstructuredList
		var err error
		if t.namespaced {
			list, err = ri.Namespace(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
		} else {
			list, err = ri.List(ctx, metav1.ListOptions{})
		}
		if err != nil || list == nil {
			continue
		}
		for i := range list.Items {
			obj := &list.Items[i]
			raw := obj.GetAnnotations()[lastAppliedAnnotation]
			if raw == "" {
				continue
			}
			var applied struct {
				APIVersion string `json:"apiVersion"`
				Kind       string `json:"kind"`
			}
			if json.Unmarshal([]byte(raw), &applied) != nil {
				continue
			}
			if dep := lookupDeprecated(applied.APIVersion, applied.Kind); dep != nil {
				src := "live:" + obj.GetName()
				if ns := obj.GetNamespace(); ns != "" {
					src = "live:" + ns + "/" + obj.GetName()
				}
				findings = append(findings, APIFinding{DeprecatedAPI: *dep, Name: obj.GetName(), Source: src})
			}
		}
	}
	return findings
}
