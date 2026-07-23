package k8s

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// VeleroNamespace is where Velero and its CRs live (its install default).
const VeleroNamespace = "velero"

var veleroGVRs = map[string]schema.GroupVersionResource{
	"backups":                {Group: "velero.io", Version: "v1", Resource: "backups"},
	"restores":               {Group: "velero.io", Version: "v1", Resource: "restores"},
	"schedules":              {Group: "velero.io", Version: "v1", Resource: "schedules"},
	"backupstoragelocations": {Group: "velero.io", Version: "v1", Resource: "backupstoragelocations"},
}

// VeleroInstalled reports whether Velero's CRDs are present (a list of backups
// succeeds only when the CRD exists).
func (c *Client) VeleroInstalled(ctx context.Context) bool {
	_, err := c.DynamicClient.Resource(veleroGVRs["backups"]).Namespace(VeleroNamespace).List(ctx, metav1.ListOptions{Limit: 1})
	return err == nil
}

// ListVelero returns the raw objects for a Velero resource kind
// ("backups"/"restores"/"schedules"/"backupstoragelocations"), newest first as
// the API returns them — the frontend renders name/phase/timestamps from them.
func (c *Client) ListVelero(ctx context.Context, resource string) ([]map[string]any, error) {
	gvr, ok := veleroGVRs[resource]
	if !ok {
		return nil, fmt.Errorf("unknown velero resource %q", resource)
	}
	list, err := c.DynamicClient.Resource(gvr).Namespace(VeleroNamespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, list.Items[i].Object)
	}
	return out, nil
}

// veleroBackupSpec builds a Backup/Schedule template spec.
func veleroBackupSpec(namespaces []string, ttlHours int, snapshotVolumes bool) map[string]any {
	spec := map[string]any{"snapshotVolumes": snapshotVolumes}
	if len(namespaces) > 0 {
		ns := make([]any, len(namespaces))
		for i, n := range namespaces {
			ns[i] = n
		}
		spec["includedNamespaces"] = ns
	}
	if ttlHours > 0 {
		spec["ttl"] = fmt.Sprintf("%dh0m0s", ttlHours)
	}
	return spec
}

// CreateVeleroBackup creates an on-demand Backup. Empty namespaces = whole cluster.
func (c *Client) CreateVeleroBackup(ctx context.Context, name string, namespaces []string, ttlHours int, snapshotVolumes bool) error {
	if err := validateHelmName(name, "backup name"); err != nil {
		return err
	}
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "velero.io/v1",
		"kind":       "Backup",
		"metadata":   map[string]any{"name": name, "namespace": VeleroNamespace},
		"spec":       veleroBackupSpec(namespaces, ttlHours, snapshotVolumes),
	}}
	_, err := c.DynamicClient.Resource(veleroGVRs["backups"]).Namespace(VeleroNamespace).Create(ctx, obj, metav1.CreateOptions{})
	return err
}

// CreateVeleroSchedule creates a scheduled backup (cron + backup template).
func (c *Client) CreateVeleroSchedule(ctx context.Context, name, cron string, namespaces []string, ttlHours int, snapshotVolumes bool) error {
	if err := validateHelmName(name, "schedule name"); err != nil {
		return err
	}
	if cron == "" {
		return fmt.Errorf("a cron schedule is required")
	}
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "velero.io/v1",
		"kind":       "Schedule",
		"metadata":   map[string]any{"name": name, "namespace": VeleroNamespace},
		"spec":       map[string]any{"schedule": cron, "template": veleroBackupSpec(namespaces, ttlHours, snapshotVolumes)},
	}}
	_, err := c.DynamicClient.Resource(veleroGVRs["schedules"]).Namespace(VeleroNamespace).Create(ctx, obj, metav1.CreateOptions{})
	return err
}

// CreateVeleroRestore restores from a named backup.
func (c *Client) CreateVeleroRestore(ctx context.Context, name, backupName string) error {
	if err := validateHelmName(name, "restore name"); err != nil {
		return err
	}
	if backupName == "" {
		return fmt.Errorf("a backup name is required")
	}
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "velero.io/v1",
		"kind":       "Restore",
		"metadata":   map[string]any{"name": name, "namespace": VeleroNamespace},
		"spec":       map[string]any{"backupName": backupName},
	}}
	_, err := c.DynamicClient.Resource(veleroGVRs["restores"]).Namespace(VeleroNamespace).Create(ctx, obj, metav1.CreateOptions{})
	return err
}

// DeleteVelero removes a Velero object (e.g. a schedule or a backup CR).
func (c *Client) DeleteVelero(ctx context.Context, resource, name string) error {
	gvr, ok := veleroGVRs[resource]
	if !ok {
		return fmt.Errorf("unknown velero resource %q", resource)
	}
	return c.DynamicClient.Resource(gvr).Namespace(VeleroNamespace).Delete(ctx, name, metav1.DeleteOptions{})
}
